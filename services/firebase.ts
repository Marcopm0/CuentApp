import { getApp, getApps, initializeApp } from 'firebase/app';
import {
    getAuth,
    inMemoryPersistence,
    initializeAuth,
    type Auth
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const requiredEnvVars = [
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
];

if (requiredEnvVars.some((v) => !v)) {
    throw new Error('Faltan variables de entorno para la configuración de Firebase.');
}

const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

let auth: Auth;
try {
    auth = initializeAuth(app, {
        // MODO PRUEBAS: La sesión se borra al recargar la app
        persistence: inMemoryPersistence,
        // MODO PRODUCCIÓN (Descomentar cuando termines las pruebas de login/registro):
        // persistence: getReactNativePersistence(AsyncStorage),
    });
} catch {
    auth = getAuth(app);
}

const db = getFirestore(app);

export { app, auth, db };

