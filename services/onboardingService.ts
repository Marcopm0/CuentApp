// services/onboardingService.ts
import { getLocalDateString } from '@/utils/dates';
import { DueBlock, getPeriodInfo, PayFrequency } from '@/utils/periods';
import {
    collection,
    doc,
    serverTimestamp,
    writeBatch,
} from 'firebase/firestore';
import { auth, db } from './firebase';

export interface FixedExpense {
    id: string;
    name: string;
    amount: number;
    dueBlock: DueBlock;
}

export interface OnboardingPayload {
    monthlyIncome: number;
    payFrequency: PayFrequency;
    payDayOfWeek?: number;
    amountPerPeriod: number;
    fixedExpenses: FixedExpense[];
    savingsTarget: number;
    leisureBudget: number;
    hasPreSavedNextCycle?: boolean;
}

// Función auxiliar para normalizar nombres en IDs de Firestore (sin acentos ni espacios)
const sanitizeBudgetId = (categoryName: string): string => {
    return categoryName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Quita acentos (Energía -> Energia)
        .replace(/[^a-z0-9]/g, '_')     // Reemplaza paréntesis o espacios por guion bajo
        .replace(/_+/g, '_');           // Elimina guiones bajos repetidos
};

export const completeOnboarding = async (data: OnboardingPayload): Promise<void> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
        throw new Error('No hay una sesión activa para completar la configuración.');
    }

    const batch = writeBatch(db);
    const now = new Date();
    const todayStr = getLocalDateString(now);
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentPeriod = getPeriodInfo(data.payFrequency, data.payDayOfWeek);

    // 1. Inyectar el primer abono con la periodKey del ciclo actual
    const initialAmount = data.amountPerPeriod > 0 ? data.amountPerPeriod : data.monthlyIncome;
    if (initialAmount > 0) {
        const txRef = doc(collection(db, 'transactions'));
        batch.set(txRef, {
            id: txRef.id,
            userId: currentUser.uid,
            sharedFundId: null,
            type: 'income',
            amount: initialAmount,
            category: '💵 Sueldo',
            description: `Primer cobro (${currentPeriod.label})`,
            targetBucket: 'leisure',
            periodKey: currentPeriod.periodKey,
            monthYear,
            date: todayStr,
            createdAt: serverTimestamp(),
            isShared: false,
        });
    }

    // 1.1 Inyectar la cuota base de ahorro inicial del ciclo actual (Idempotente)
    const divisor = data.payFrequency === 'weekly' ? 4 : data.payFrequency === 'biweekly' ? 2 : 1;
    const cuotaAhorro = (data.savingsTarget || 0) / divisor;

    if (cuotaAhorro > 0) {
        const ahorroBaseDocId = `${currentUser.uid}_ahorro_base_${currentPeriod.periodKey}`;
        const ahorroBaseRef = doc(db, 'transactions', ahorroBaseDocId);
        batch.set(ahorroBaseRef, {
            id: ahorroBaseDocId,
            userId: currentUser.uid,
            sharedFundId: null,
            type: 'income',
            amount: cuotaAhorro,
            category: '🎯 Ahorro Base',
            description: 'Aporte base presupuestado al ahorro',
            targetBucket: 'savings',
            periodKey: currentPeriod.periodKey,
            monthYear,
            date: todayStr,
            createdAt: serverTimestamp(),
            isShared: false,
        });
    }

    // 2. Crear un presupuesto maestro permanente para CADA gasto fijo desglosado (Opción B)
    // y registrar en la subcolección canónica users/{uid}/fixedExpenses
    data.fixedExpenses.forEach((expense) => {
        if (expense.amount > 0) {
            const cleanCategory = sanitizeBudgetId(expense.name);
            const budgetDocId = `${currentUser.uid}_${cleanCategory}`;
            const budgetRef = doc(db, 'budgets', budgetDocId);

            batch.set(budgetRef, {
                id: budgetDocId,
                userId: currentUser.uid,
                name: expense.name,
                category: expense.name, // Mantiene el nombre legible original para mostrar en la interfaz
                limitAmount: expense.amount,
                dueBlock: expense.dueBlock || 'mid', // Bloque de vencimiento (start | mid | end)
                isFixedExpense: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            // Registrar en subcolección users/{uid}/fixedExpenses
            const fixedExpenseRef = doc(collection(db, 'users', currentUser.uid, 'fixedExpenses'));
            let blockStr = '11-20';
            if (expense.dueBlock === 'start') blockStr = '1-10';
            else if (expense.dueBlock === 'end') blockStr = '21-end';
            else blockStr = '11-20';

            batch.set(fixedExpenseRef, {
                concept: expense.name,
                amount: expense.amount,
                dueBlock: blockStr,
                createdAt: serverTimestamp(),
                isShared: false,
            });
        }
    });

    // 3. Crear el presupuesto maestro permanente para Ocio / Gustos personales
    if (data.leisureBudget > 0) {
        const leisureDocId = `${currentUser.uid}_ocio`;
        const leisureRef = doc(db, 'budgets', leisureDocId);

        batch.set(leisureRef, {
            id: leisureDocId,
            userId: currentUser.uid,
            name: 'Ocio y Deseos',
            category: 'Ocio y Deseos',
            limitAmount: data.leisureBudget,
            isFixedExpense: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
    }

    // 4. Actualizar el perfil del usuario con metas, periodicidad de nómina, fijos y cerrar onboarding
    const userRef = doc(db, 'users', currentUser.uid);
    const userUpdateData: Record<string, any> = {
        hasCompletedOnboarding: true,
        monthlyIncome: data.monthlyIncome,
        payFrequency: data.payFrequency,
        amountPerPeriod: data.amountPerPeriod,
        savingsTarget: data.savingsTarget,
        hasPreSavedNextCycle: data.payFrequency === 'monthly' ? true : (data.hasPreSavedNextCycle ?? true),
        firstPeriodKey: currentPeriod.periodKey,
        habitualFixedExpenses: data.fixedExpenses.map((expense) => ({
            name: expense.name,
            defaultAmount: expense.amount,
            dueBlock: expense.dueBlock,
        })),
        updatedAt: serverTimestamp(),
    };

    if (data.payFrequency === 'weekly' && data.payDayOfWeek !== undefined) {
        userUpdateData.payDayOfWeek = data.payDayOfWeek;
    }

    batch.update(userRef, userUpdateData);

    // Ejecución atómica de todas las operaciones
    await batch.commit();
};