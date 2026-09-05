import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Servicios de Firebase
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../services/firebase';

export default function ForgotPasswordScreen() {
    const router = useRouter();

    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleResetPassword = async () => {
        if (!email.trim()) {
            Alert.alert('Campo requerido', 'Por favor ingresa tu correo electrónico.');
            return;
        }

        setIsLoading(true);

        try {
            // Envía el correo oficial de recuperación de Firebase
            await sendPasswordResetEmail(auth, email.trim());

            Alert.alert(
                'Correo enviado',
                'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña. Revisa tu bandeja de entrada o spam.',
                [
                    {
                        text: 'Volver a Iniciar Sesión',
                        onPress: () => router.back(),
                    },
                ]
            );
        } catch (error: any) {
            let errorMessage = 'No se pudo enviar el correo de recuperación.';

            if (error.code === 'auth/invalid-email') {
                errorMessage = 'El formato del correo no es válido.';
            } else if (error.code === 'auth/user-not-found') {
                // Por seguridad, muchas veces se muestra el mismo mensaje genérico
                errorMessage = 'No encontramos una cuenta con ese correo.';
            } else if (error.code === 'auth/network-request-failed') {
                errorMessage = 'Sin conexión a internet. Revisa tu red.';
            }

            Alert.alert('Error', errorMessage);
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
                    showsVerticalScrollIndicator={false}
                >
                    {/* Botón superior de regreso */}
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.back()}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
                    </TouchableOpacity>

                    <View style={styles.cardContainer}>
                        {/* Encabezado */}
                        <View style={styles.header}>
                            <Text style={styles.appTitle}>Recuperar</Text>
                            <Text style={styles.appTitle}>Contraseña</Text>
                            <Text style={styles.tagline}>
                                Ingresa tu correo registrado y te enviaremos un enlace para restablecer tu contraseña.
                            </Text>
                        </View>

                        <View style={styles.buttonContainer}>
                            {/* Input Correo */}
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Correo electrónico</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="ejemplo@correo.com"
                                    placeholderTextColor="#64748B"
                                    value={email}
                                    onChangeText={setEmail}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            </View>

                            {/* Botón de Enviar */}
                            <TouchableOpacity
                                style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
                                activeOpacity={0.8}
                                onPress={handleResetPassword}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <ActivityIndicator color="#0B0F17" />
                                ) : (
                                    <Text style={styles.primaryButtonText}>Enviar enlace</Text>
                                )}
                            </TouchableOpacity>

                            {/* Regresar al Login */}
                            <TouchableOpacity
                                activeOpacity={0.8}
                                onPress={() => router.back()}
                                disabled={isLoading}
                            >
                                <Text style={styles.footerButtonText}>
                                    ¿Recordaste tu contraseña? INICIAR SESIÓN
                                </Text>
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
        paddingHorizontal: 20,
        paddingVertical: 30,
        backgroundColor: '#0B0F17',
    },
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: '#161F30',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#24324D',
    },
    cardContainer: {
        width: '100%',
        backgroundColor: '#161F30',
        borderRadius: 24,
        paddingHorizontal: 24,
        paddingVertical: 36,
        borderColor: '#24324D',
        borderWidth: 1,
        gap: 24,
    },
    header: {
        alignItems: 'center',
        gap: 8,
    },
    appTitle: {
        fontSize: 30,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 0.5,
    },
    tagline: {
        fontSize: 14,
        color: '#94A3B8',
        textAlign: 'center',
        lineHeight: 20,
        marginTop: 6,
    },
    buttonContainer: {
        width: '100%',
        gap: 20,
    },
    inputGroup: {
        width: '100%',
        gap: 8,
    },
    label: {
        fontSize: 14,
        color: '#94A3B8',
        fontWeight: '600',
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
    primaryButton: {
        width: '100%',
        backgroundColor: '#38BDF8',
        paddingVertical: 15,
        borderRadius: 14,
        alignItems: 'center',
        marginTop: 6,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    primaryButtonText: {
        color: '#0B0F17',
        fontSize: 16,
        fontWeight: '700',
    },
    footerButtonText: {
        marginTop: 8,
        color: '#38BDF8',
        textAlign: 'center',
        fontSize: 13,
        fontWeight: '600',
    },
});