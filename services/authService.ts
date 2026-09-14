import { FirebaseError } from 'firebase/app';
import {
    createUserWithEmailAndPassword,
    sendEmailVerification,
    signOut,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth, db } from '@/services/firebase';
import type { UserProfile } from '@/types/database';

export interface RegisterUserData {
    email: string;
    password: string;
    displayName: string;
}

export type FirestoreUserInsert = Omit<UserProfile, 'createdAt' | 'updatedAt'> & {
    createdAt: ReturnType<typeof serverTimestamp>;
    updatedAt: ReturnType<typeof serverTimestamp>;
};

export const registerUser = async ({
    email,
    password,
    displayName,
}: RegisterUserData): Promise<void> => {
    const userCredential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
    );
    const user = userCredential.user;

    const newUserProfile: FirestoreUserInsert = {
        uid: user.uid,
        email: user.email ?? email.trim(),
        displayName: displayName.trim(),
        photoURL: null,
        currency: 'MXN',
        hasCompletedOnboarding: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, 'users', user.uid), newUserProfile);
    await sendEmailVerification(user);
    await signOut(auth);
};

export const getAuthErrorMessage = (error: unknown): string => {
    if (error instanceof FirebaseError) {
        switch (error.code) {
            case 'auth/email-already-in-use':
                return 'Este correo electrónico ya está registrado.';
            case 'auth/invalid-email':
                return 'El formato del correo electrónico no es válido.';
            case 'auth/weak-password':
                return 'La contraseña debe contener al menos 6 caracteres.';
            case 'auth/network-request-failed':
                return 'Error de conexión. Verifica tu conexión a internet.';
            default:
                return `Error al procesar la solicitud (${error.code}).`;
        }
    }
    return 'Ocurrió un error inesperado en el sistema.';
};