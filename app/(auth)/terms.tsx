import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TermsScreen() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.topBar}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                    activeOpacity={0.7}
                >
                    <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.topBarTitle}>Legal y Privacidad</Text>
                <View style={styles.placeholder} />
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContainer}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.cardContainer}>
                    <Text style={styles.mainTitle}>Términos y Aviso de Privacidad</Text>
                    <Text style={styles.lastUpdate}>Última actualización: Septiembre 2026</Text>

                    <Text style={styles.sectionHeader}>1. Términos de Uso</Text>
                    <Text style={styles.bodyText}>
                        Bienvenido a CuentApp. Al registrarte y utilizar nuestra plataforma, aceptas
                        cumplir con las normas de uso responsable para la gestión de finanzas personales
                        y fondos compartidos.
                    </Text>

                    <Text style={styles.sectionHeader}>2. Aviso de Privacidad</Text>
                    <Text style={styles.bodyText}>
                        Tus datos personales y registros financieros se procesan de forma cifrada. No
                        comercializamos tu información con terceros.
                    </Text>

                    <Text style={styles.sectionHeader}>3. Seguridad</Text>
                    <Text style={styles.bodyText}>
                        Implementamos autenticación segura y reglas de acceso en la nube. Puedes solicitar
                        la eliminación de tu cuenta en cualquier momento desde tu perfil.
                    </Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#0B0F17',
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#24324D',
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 10,
        backgroundColor: '#161F30',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#24324D',
    },
    topBarTitle: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
    placeholder: {
        width: 40,
    },
    scrollContainer: {
        paddingHorizontal: 20,
        paddingVertical: 24,
    },
    cardContainer: {
        backgroundColor: '#161F30',
        borderRadius: 20,
        padding: 24,
        borderWidth: 1,
        borderColor: '#24324D',
        gap: 14,
    },
    mainTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#FFFFFF',
        lineHeight: 28,
    },
    lastUpdate: {
        fontSize: 12,
        color: '#64748B',
        marginBottom: 8,
    },
    sectionHeader: {
        fontSize: 16,
        fontWeight: '700',
        color: '#38BDF8',
        marginTop: 8,
    },
    bodyText: {
        fontSize: 14,
        color: '#94A3B8',
        lineHeight: 22,
    },
});