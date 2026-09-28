// services/onboardingService.ts
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
            date: serverTimestamp(),
            createdAt: serverTimestamp(),
            isShared: false,
        });
    }

    // 2. Crear un presupuesto específico para CADA gasto fijo desglosado
    data.fixedExpenses.forEach((expense) => {
        if (expense.amount > 0) {
            const cleanCategory = sanitizeBudgetId(expense.name);
            const budgetDocId = `${currentUser.uid}_${cleanCategory}_${monthYear}`;
            const budgetRef = doc(db, 'budgets', budgetDocId);

            batch.set(budgetRef, {
                id: budgetDocId,
                userId: currentUser.uid,
                category: expense.name, // Mantiene el nombre legible original para mostrar en la interfaz
                limitAmount: expense.amount,
                currentSpent: 0,
                monthYear,
                isFixedExpense: true,
                dueBlock: expense.dueBlock || 'mid', // Bloque de vencimiento (start | mid | end)
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        }
    });

    // 3. Crear el presupuesto para Ocio / Gustos personales
    if (data.leisureBudget > 0) {
        const leisureDocId = `${currentUser.uid}_ocio_${monthYear}`;
        const leisureRef = doc(db, 'budgets', leisureDocId);

        batch.set(leisureRef, {
            id: leisureDocId,
            userId: currentUser.uid,
            category: 'Ocio y Deseos',
            limitAmount: data.leisureBudget,
            currentSpent: 0,
            monthYear,
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