import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';


import { sendEmailVerification, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../services/firebase';

export default function WelcomeAuthScreen() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    //Funcion principal del login
    const handleLogin = async () => {
        if (!email.trim() || !password) {
            Alert.alert('Campos incompletos', 'Ingresa tu correo y contraseña');
            return;
        }
        setIsLoading(true);

        try {
            //Autenticacion con fire base
            const userCredential = await signInWithEmailAndPassword(
                auth,
                email.trim(),
                password
            );
            const user = userCredential.user;
            //validar correo 
            if (!user.emailVerified) {
                await signOut(auth);
                Alert.alert('Correo no verificado', 'Por favor verifica tu correo electronico para iniciar sesion',
                    [
                        {
                            text: 'Renviar correo',
                            onPress: async () => {
                                try {
                                    const tempCred = await signInWithEmailAndPassword(
                                        auth,
                                        email.trim(),
                                        password
                                    );
                                    await sendEmailVerification(tempCred.user);
                                    await signOut(auth);
                                    Alert.alert('Correo reenviado', 'Por favor verifica tu correo electronico para iniciar sesion');
                                } catch {
                                    Alert.alert('Error', 'No se pudo enviar el correo intentelo mas tarde');
                                }
                            },
                        }, {
                            text: 'Entendido',
                            style: 'cancel',
                        },
                    ]
                );
                return;
            }
            const userDocRef = doc(db, 'users', user.uid);
            const userDocSnap = await getDoc(userDocRef);
            const hasCompletedOnboarding =
                userDocSnap.exists() && userDocSnap.data()?.hasCompletedOnboarding === true;
            //vamos a decidir a donde va el usuario
            if (hasCompletedOnboarding) {
                router.replace('/(tabs)');
            } else {
                router.replace('/(auth)/setup');
            }
        } catch (error: any) {
            let errorMessage = 'No se pudo iniciar sesion. Verifique sus datos.';

            //Mapeo de errores de firebase
            if (
                error.code === 'auth/invalid-credential' ||
                error.code === 'auth/user-not-found' ||
                error.code === 'auth/wrong-password'
            ) {
                errorMessage = 'Correo o contraseña incorrectos';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'El formato del correo es invalido';
            } else if (error.code === 'auth/too-many-requests') {
                errorMessage = 'Demasidos intentos fallidos. Intentelo más tarde.';
            } else if (error.code === 'auth/network-request-failed') {
                errorMessage = 'Sin conexion a internet. Revisa tu red.';
            }

            Alert.alert('Error de acceso', errorMessage);

        } finally {
            setIsLoading(false);
        }
    };



    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView
                style={styles.keyboardView}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
            >
                <ScrollView
                    contentContainerStyle={styles.scrollContainer}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}>


                    {/* Encabezado */}
                    <View style={styles.header}>
                        <Text style={styles.appTitle}>Iniciar sesion</Text>
                    </View>
                    <View style={styles.container}>

                        <View style={styles.inputGroup}>
                            <TextInput
                                style={styles.input}
                                placeholder="Correo electronico"
                                placeholderTextColor="#64748B"
                                value={email}
                                onChangeText={setEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </View>
                        <View style={styles.inputGroup}>
                            <View style={styles.passwordInputWrapper}>
                                <TextInput
                                    style={styles.passwordInput}
                                    placeholder='Contraseña'
                                    placeholderTextColor="#64748B"
                                    value={password}
                                    onChangeText={setPassword}
                                    autoCapitalize="none"
                                    secureTextEntry={!isPasswordVisible}
                                />
                                <TouchableOpacity
                                    style={styles.eyeButton}
                                    onPress={() => setIsPasswordVisible(!isPasswordVisible)}
                                    activeOpacity={0.8}
                                >
                                    <Ionicons
                                        name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                                        size={20}
                                        color="#94A3B8"
                                    />
                                </TouchableOpacity>
                            </View>
                        </View>

                        <View style={styles.buttonContainer}>
                            <TouchableOpacity
                                style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
                                activeOpacity={0.8}
                                onPress={handleLogin}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <ActivityIndicator color="#0B0F17" />
                                ) : (
                                    <Text style={styles.primaryButtonText}>Continuar</Text>
                                )}

                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.8}
                                onPress={() => router.push('/(auth)/forgot-password' as any)}
                                disabled={isLoading}
                            >
                                <Text style={styles.taglineolvido}>¿Olvido su contraseña?</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.8}
                                onPress={() => router.push('/(auth)/setup' as any)}
                                disabled={isLoading}
                            >
                                <Text style={styles.taglineolvido}>momentaneo para ver setup</Text>
                            </TouchableOpacity>

                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#0B0F17',
    },
    keyboardView: {
        flex: 1,
    },
    scrollContainer: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingVertical: 40,
        backgroundColor: '#0B0F17',
        gap: 36,
    },
    container: {
        width: '100%',
        gap: 20,
    },
    header: {
        alignItems: 'center',
        gap: 8,

    },
    appTitle: {
        fontSize: 34,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 0.5,

    },
    taglineolvido: {
        fontSize: 14,
        color: '#a525c5ff',
        textDecorationLine: "underline",
        alignSelf: 'flex-end',
        marginTop: 4,
    },
    buttonContainer: {
        width: '100%',
        gap: 16,
        marginTop: 8,
    },
    primaryButton: {
        backgroundColor: '#38BDF8',
        paddingVertical: 16,
        borderRadius: 14,
        alignItems: 'center',
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    primaryButtonText: {
        color: '#0B0F17',
        fontSize: 16,
        fontWeight: '700',
    },


    inputGroup: {
        width: "100%",
        gap: 12,
    },
    input: {
        backgroundColor: '#0B0F17',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        color: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#24324D',
        fontSize: 15,
    },
    eyeButton: {
        padding: 6,
    },
    passwordInputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0B0F17',
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#24324D',
    },
    passwordInput: {
        flex: 1,
        paddingVertical: 14,
        color: '#FFFFFF',
        fontSize: 15,
    }

});