import { Timestamp } from 'firebase/firestore';
import { DueBlock, PayFrequency } from '@/utils/periods';

export interface UserProfile {
    uid: string;
    email: string;
    displayName: string;
    photoURL: string | null;
    currency: string;
    hasCompletedOnboarding: boolean; //bandera de control
    monthlyIncome?: number;
    payFrequency?: PayFrequency;
    payDayOfWeek?: number;
    amountPerPeriod?: number;
    savingsTarget?: number;
    hasPreSavedNextCycle?: boolean;
    firstPeriodKey?: string;
    activeSharedFundId?: string | null;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface SharedFundMemberDetails {
    displayName: string;
    email: string;
    joinedAt: any;
}

export interface SharedFund {
    id: string;
    inviteCode: string;
    createdAt: any;
    members: string[];
    memberDetails: Record<string, SharedFundMemberDetails>;
    active: boolean;
    maxMembers: number;
}

export interface SharedService {
    id: string;
    concept: string;               // Ej: "Internet Totalplay", "Renta", "Gas"
    totalAmount: number;           // Monto total del recibo mensual
    dueBlock: '1-10' | '11-20' | '21-end';
    holderUid: string;             // UID del miembro responsable de pagar la factura oficial
    split: {
        [uid: string]: number;       // Cuota exacta que aporta cada uno (por defecto 50/50)
    };
    status: {
        transferredBy: string[];     // UIDs de quienes ya transfirieron su cuota a la contraparte
        paidToProvider: boolean;     // true si el titular ya liquidó el recibo completo al proveedor
        isPaidByOwner?: boolean;     // alias compatible con paidToProvider
        lastPaidMonth?: string;      // Formato 'YYYY-MM' para control de ciclo
    };
    createdAt: any;
}

export interface SharedExpense {
    id: string;
    concept: string;
    amount: number;
    paidBy: string;
    paidByName: string;
    date: string;
    split: {
        [uid: string]: number;
    };
    settled: boolean;
    personalTxId?: string | null;
    createdAt: Timestamp | any;
}

export interface Transaction {
    id?: string;
    userId: string;
    amount: number;
    type: 'income' | 'expense';
    category: string;
    description?: string;
    isFixedExpense?: boolean;
    budgetId?: string | null;
    origin?: 'ocio' | 'buffer' | 'fixed' | 'income';
    destination?: string;
    date: string; // Formato estricto 'YYYY-MM-DD' para agrupaciones y filtros
    createdAt: any; // Firestore FieldValue (serverTimestamp) o Timestamp
    targetBucket?: 'leisure' | 'buffer' | 'savings' | null;
    monthYear?: string;
    periodKey?: string;
    isShared?: boolean;
    sharedFundId?: string | null;
}

export interface Budget {
    id: string;
    userId?: string;
    name?: string;
    category: string;
    limitAmount: number;
    isFixedExpense: boolean;
    dueBlock?: DueBlock;
    createdAt?: any;
    updatedAt?: any;
}