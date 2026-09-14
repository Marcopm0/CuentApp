import { Timestamp } from 'firebase/firestore';

export interface UserProfile {
    uid: string;
    email: string;
    displayName: string;
    photoURL: string | null;
    currency: string;
    hasCompletedOnboarding: boolean; //bandera de control
    createdAt: Timestamp;
    updatedAt: Timestamp;
}