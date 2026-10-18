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
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface Transaction {
    id: string;
    userId?: string;
    type: 'income' | 'expense';
    amount: number;
    category: string;
    description?: string;
    targetBucket?: 'leisure' | 'buffer' | 'savings' | null;
    isFixedExpense?: boolean;
    budgetId?: string | null;
    isShared?: boolean;
    sharedFundId?: string | null;
    monthYear?: string;
    periodKey?: string;
    createdAt?: any;
    date?: any;
}

export interface Budget {
    id: string;
    userId?: string;
    category: string;
    limitAmount: number;
    currentSpent: number;
    monthYear?: string;
    isFixedExpense: boolean;
    dueBlock?: DueBlock;
    createdAt?: any;
    updatedAt?: any;
}