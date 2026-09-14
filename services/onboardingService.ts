// services/onboardingService.ts
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
}

export interface OnboardingPayload {
    monthlyIncome: number;
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

    // 1. Registrar el ingreso/saldo inicial como transacción de apertura
    if (data.monthlyIncome > 0) {
        const txRef = doc(collection(db, 'transactions'));
        batch.set(txRef, {
            id: txRef.id,
            userId: currentUser.uid,
            sharedFundId: null,
            type: 'income',
            amount: data.monthlyIncome,
            category: 'Ingreso Inicial',
            description: 'Ingreso mensual base reportado en configuración inicial',
            date: serverTimestamp(),
            createdAt: serverTimestamp(),
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

    // 4. Actualizar el perfil del usuario con metas, fijos habituales y cerrar onboarding
    const userRef = doc(db, 'users', currentUser.uid);
    batch.update(userRef, {
        hasCompletedOnboarding: true,
        monthlyIncome: data.monthlyIncome,
        savingsTarget: data.savingsTarget,
        habitualFixedExpenses: data.fixedExpenses.map((expense) => ({
            name: expense.name,
            defaultAmount: expense.amount,
        })),
        updatedAt: serverTimestamp(),
    });

    // Ejecución atómica de todas las operaciones
    await batch.commit();
};