import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function WelcomeAuthScreen() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>

                {/* Encabezado / Logo */}
                <View style={styles.header}>
                    <Text style={styles.appTitle}>CuentApp</Text>
                    <Text style={styles.tagline}>Controla tus gastos personales y fondos compartidos.</Text>
                </View>

                {/* Acciones centradas y separadas */}
                <View style={styles.buttonContainer}>
                    <TouchableOpacity
                        style={styles.primaryButton}
                        activeOpacity={0.8}
                        onPress={() => router.push('/(auth)/register')}
                    >
                        <Text style={styles.primaryButtonText}>Crear cuenta</Text>
                    </TouchableOpacity>

                    <Text style={styles.tagline}>O</Text>

                    <TouchableOpacity
                        style={styles.secondaryButton}
                        activeOpacity={0.8}
                        onPress={() => router.push('/(auth)/login')}
                    >
                        <Text style={styles.secondaryButtonText}>Ya tengo cuenta</Text>
                    </TouchableOpacity>
                </View>

            </View>
            <TouchableOpacity
                style={styles.termsButton}
                activeOpacity={0.7}
                hitSlop={{ top: 12, bottom: 16, left: 20, right: 20 }}
                onPress={() => router.push('/(auth)/terms')}>
                <Text style={styles.avisoText}>
                    Al continuar aceptas nuestros Términos de uso y Aviso de privacidad</Text>
            </TouchableOpacity>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#0B0F17',
    },
    container: {
        flex: 1,
        paddingHorizontal: 24,
        backgroundColor: '#0B0F17',
    },
    header: {
        alignItems: 'center',
        gap: 12,
        marginTop: 80,
    },
    appTitle: {
        fontSize: 34,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 0.5,
    },
    tagline: {
        fontSize: 15,
        color: '#94A3B8',
        textAlign: 'center',
        lineHeight: 22,
        paddingHorizontal: 16,
    },
    avisoText: {
        fontSize: 12,
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 18,
        textDecorationLine: 'underline',
    },
    buttonContainer: {
        flex: 1,
        justifyContent: 'center',
        width: '100%',
        gap: 24,
    },
    primaryButton: {
        backgroundColor: '#38BDF8',
        paddingVertical: 16,
        borderRadius: 14,
        alignItems: 'center',
    },
    primaryButtonText: {
        color: '#0B0F17',
        fontSize: 16,
        fontWeight: '700',
    },
    secondaryButton: {
        backgroundColor: '#161F30',
        paddingVertical: 16,
        borderRadius: 14,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#24324D',
    },
    secondaryButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    termsButton: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        marginBottom: 20,

    },
});