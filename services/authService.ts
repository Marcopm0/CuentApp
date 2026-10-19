import { FirebaseError } from 'firebase/app';
import {
    createUserWithEmailAndPassword,
    sendEmailVerification,
    signOut,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth, db } from '@/services/firebase';

export interface RegisterUserData {
    email: string;
    password: string;
    displayName: string;
}

export type FirestoreUserInsert = {
    uid: string;
    email: string;
    displayName: string;
    currency: string;
    hasCompletedOnboarding: boolean;
    createdAt: ReturnType<typeof serverTimestamp>;
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
        currency: 'MXN',
        hasCompletedOnboarding: false,
        createdAt: serverTimestamp(),
    };

    await setDoc(doc(db, 'users', user.uid), newUserProfile);
    await sendEmailVerification(user);
    await signOut(auth);
};

export const getAuthErrorMessage = (error: unknown): string => {
    const err = error as { code?: string; message?: string };
    if (err && typeof err === 'object' && err.code) {
        switch (err.code) {
            case 'auth/email-already-in-use':
                return 'Este correo electrónico ya está registrado.';
            case 'auth/invalid-email':
                return 'El formato del correo electrónico no es válido.';
            case 'auth/weak-password':
                return 'La contraseña debe contener al menos 6 caracteres.';
            case 'auth/network-request-failed':
                return 'Error de conexión. Verifica tu conexión a internet.';
            default:
                return `Error (${err.code}): ${err.message || 'Error al procesar la solicitud.'}`;
        }
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Ocurrió un error inesperado en el sistema.';
};