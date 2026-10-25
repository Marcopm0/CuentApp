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