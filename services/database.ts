import {
    collection,
    doc,
    deleteDoc,
    serverTimestamp,
    updateDoc,
    arrayUnion,
    arrayRemove,
    writeBatch,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { SharedExpense } from '@/types/database';
import { getLocalDateString } from '@/utils/dates';

export interface PersonalTxPayload {
    userId: string;
    amount: number;
    description: string;
    category?: string;
    targetBucket?: 'leisure' | 'buffer' | null;
}

export interface SettlementDetails {
    debtorUid: string;
    debtorName: string;
    creditorUid: string;
    creditorName: string;
    amount: number;
}

/**
 * Alterna el estado de transferencia de la cuota de un servicio del hogar.
 * Si isCurrentlyTransferred es true, se remueve el UID de transferredBy (revertir).
 * Si es false, se agrega el UID a transferredBy.
 */
export const toggleServiceTransferred = async (
    fundId: string,
    serviceId: string,
    userId: string,
    isCurrentlyTransferred: boolean
): Promise<void> => {
    if (!fundId || !serviceId || !userId) return;
    const serviceRef = doc(db, 'sharedFunds', fundId, 'services', serviceId);
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (isCurrentlyTransferred) {
        await updateDoc(serviceRef, {
            'status.transferredBy': arrayRemove(userId),
        });
    } else {
        await updateDoc(serviceRef, {
            'status.transferredBy': arrayUnion(userId),
            'status.lastPaidMonth': currentMonthStr,
        });
    }
};

/**
 * Alterna el estado de liquidación oficial de un servicio del hogar con el proveedor (responsabilidad del titular).
 * Si isCurrentlyPaid es true, se restablece a false (revertir a pendiente).
 * Si es false, se marca como pagado (true) y se registra el mes actual.
 */
export const toggleServicePaidToProvider = async (
    fundId: string,
    serviceId: string,
    isCurrentlyPaid: boolean
): Promise<void> => {
    if (!fundId || !serviceId) return;
    const serviceRef = doc(db, 'sharedFunds', fundId, 'services', serviceId);
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    if (isCurrentlyPaid) {
        await updateDoc(serviceRef, {
            'status.paidToProvider': false,
            'status.isPaidByOwner': false,
        });
    } else {
        await updateDoc(serviceRef, {
            'status.paidToProvider': true,
            'status.isPaidByOwner': true,
            'status.lastPaidMonth': currentMonthStr,
        });
    }
};

export const toggleServicePaidByOwner = toggleServicePaidToProvider;

/**
 * Registra una nueva aportación libre dentro del espacio compartido.
 * Si se especifica personalTx, crea atómicamente la transacción correspondiente
 * en la colección personal de transacciones del usuario pagador para impactar su Disponible.
 */
export const addSharedExpense = async (
    fundId: string,
    expense: Omit<SharedExpense, 'id' | 'createdAt'>,
    personalTx?: PersonalTxPayload
): Promise<string> => {
    if (!fundId) {
        throw new Error('fundId es requerido para registrar un gasto compartido.');
    }

    const batch = writeBatch(db);
    const expensesRef = doc(collection(db, 'sharedFunds', fundId, 'expenses'));
    let linkedTxId: string | null = null;

    if (personalTx && personalTx.amount > 0) {
        const txRef = doc(collection(db, 'transactions'));
        linkedTxId = txRef.id;
        const now = new Date();
        const dateStr = getLocalDateString(now);
        const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        batch.set(txRef, {
            id: txRef.id,
            userId: personalTx.userId,
            type: 'expense',
            amount: personalTx.amount,
            description: personalTx.description,
            category: personalTx.category || '🏠 Hogar Compartido',
            isFixedExpense: false,
            budgetId: null,
            targetBucket: personalTx.targetBucket || 'leisure',
            isShared: false,
            sharedFundId: null,
            date: dateStr,
            monthYear,
            createdAt: serverTimestamp(),
        });
    }

    batch.set(expensesRef, {
        ...expense,
        personalTxId: linkedTxId,
        settled: expense.settled ?? false,
        createdAt: serverTimestamp(),
    });

    await batch.commit();
    return expensesRef.id;
};

/**
 * Marca como saldados (settled: true) un conjunto de gastos pendientes en una operación atómica por lotes.
 * Si se proporcionan detalles de liquidación (deudor y acreedor con saldo > 0):
 * - Registra una transacción de gasto de salida para el deudor: "Liquidación Hogar -> [NombrePareja]"
 * - Registra una transacción de entrada / reembolso para el acreedor: "Reembolso Hogar <- [NombrePareja]"
 */
export const settleSharedExpenses = async (
    fundId: string,
    expenseIds: string[],
    settlementDetails?: SettlementDetails
): Promise<void> => {
    if (!fundId || expenseIds.length === 0) return;

    const batch = writeBatch(db);
    expenseIds.forEach((id) => {
        const expenseRef = doc(db, 'sharedFunds', fundId, 'expenses', id);
        batch.update(expenseRef, {
            settled: true,
            settledAt: serverTimestamp(),
        });
    });

    if (settlementDetails && settlementDetails.amount > 0) {
        const now = new Date();
        const dateStr = getLocalDateString(now);
        const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // 1. Gasto de salida para quien salda la deuda
        const debtorTxRef = doc(collection(db, 'transactions'));
        batch.set(debtorTxRef, {
            id: debtorTxRef.id,
            userId: settlementDetails.debtorUid,
            type: 'expense',
            amount: settlementDetails.amount,
            category: '🏠 Hogar Compartido',
            description: `Liquidación Hogar -> ${settlementDetails.creditorName}`,
            targetBucket: 'leisure',
            isFixedExpense: false,
            budgetId: null,
            isShared: false,
            sharedFundId: null,
            date: dateStr,
            monthYear,
            createdAt: serverTimestamp(),
        });

        // 2. Ingreso / reembolso para quien recibe el saldo
        const creditorTxRef = doc(collection(db, 'transactions'));
        batch.set(creditorTxRef, {
            id: creditorTxRef.id,
            userId: settlementDetails.creditorUid,
            type: 'income',
            amount: settlementDetails.amount,
            category: '🏠 Hogar Compartido',
            description: `Reembolso Hogar <- ${settlementDetails.debtorName}`,
            targetBucket: 'leisure',
            isFixedExpense: false,
            budgetId: null,
            isShared: false,
            sharedFundId: null,
            date: dateStr,
            monthYear,
            createdAt: serverTimestamp(),
        });
    }

    try {
        await batch.commit();
    } catch (error) {
        console.warn('Error en commit del batch de liquidación, ejecutando fallback de seguridad:', error);
        // Fallback en caso de que reglas de Firestore impidan escribir la transacción del otro usuario
        const fallbackBatch = writeBatch(db);
        expenseIds.forEach((id) => {
            const expenseRef = doc(db, 'sharedFunds', fundId, 'expenses', id);
            fallbackBatch.update(expenseRef, {
                settled: true,
                settledAt: serverTimestamp(),
            });
        });

        const currentUid = auth.currentUser?.uid;
        if (settlementDetails && settlementDetails.amount > 0 && currentUid) {
            const now = new Date();
            const dateStr = getLocalDateString(now);
            const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

            if (currentUid === settlementDetails.debtorUid) {
                const txRef = doc(collection(db, 'transactions'));
                fallbackBatch.set(txRef, {
                    id: txRef.id,
                    userId: currentUid,
                    type: 'expense',
                    amount: settlementDetails.amount,
                    category: '🏠 Hogar Compartido',
                    description: `Liquidación Hogar -> ${settlementDetails.creditorName}`,
                    targetBucket: 'leisure',
                    isFixedExpense: false,
                    budgetId: null,
                    isShared: false,
                    sharedFundId: null,
                    date: dateStr,
                    monthYear,
                    createdAt: serverTimestamp(),
                });
            } else if (currentUid === settlementDetails.creditorUid) {
                const txRef = doc(collection(db, 'transactions'));
                fallbackBatch.set(txRef, {
                    id: txRef.id,
                    userId: currentUid,
                    type: 'income',
                    amount: settlementDetails.amount,
                    category: '🏠 Hogar Compartido',
                    description: `Reembolso Hogar <- ${settlementDetails.debtorName}`,
                    targetBucket: 'leisure',
                    isFixedExpense: false,
                    budgetId: null,
                    isShared: false,
                    sharedFundId: null,
                    date: dateStr,
                    monthYear,
                    createdAt: serverTimestamp(),
                });
            }
        }
        await fallbackBatch.commit();
    }
};

/**
 * Elimina una aportación del espacio compartido.
 * Si tenía una transacción personal vinculada, la elimina también para mantener
 * consistencia en el Disponible de Inicio.
 */
export const deleteSharedExpense = async (
    fundId: string,
    expenseId: string,
    personalTxId?: string | null
): Promise<void> => {
    if (!fundId || !expenseId) return;

    const batch = writeBatch(db);
    const expenseRef = doc(db, 'sharedFunds', fundId, 'expenses', expenseId);
    batch.delete(expenseRef);

    if (personalTxId) {
        const txRef = doc(db, 'transactions', personalTxId);
        batch.delete(txRef);
    }

    try {
        await batch.commit();
    } catch {
        // Si no se pudo borrar la transacción por lote, al menos borrar el gasto compartido
        await deleteDoc(expenseRef);
    }
};
