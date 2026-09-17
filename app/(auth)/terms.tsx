import EasterEggModal from '@/components/EasterEggModal';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
    Animated,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function TermsScreen() {
    const router = useRouter();
    const [modalVisible, setModalVisible] = useState(false);
    const [activeTaps, setActiveTaps] = useState(0);
    const tapCount = useRef(0);
    const lastTap = useRef(0);
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const resetTimer = useRef<NodeJS.Timeout | null>(null);

    const handleSecretTap = () => {
        const now = Date.now();
        if (resetTimer.current) {
            clearTimeout(resetTimer.current);
        }
        if (now - lastTap.current > 500) {
            tapCount.current = 1;
        } else {
            tapCount.current += 1;
        }
        lastTap.current = now;

        setActiveTaps(tapCount.current);

        Animated.sequence([
            Animated.timing(scaleAnim, {
                toValue: 1.2,
                duration: 80,
                useNativeDriver: true,
            }),
            Animated.timing(scaleAnim, {
                toValue: 1,
                duration: 4,
                useNativeDriver: true,
            }),
        ]).start();

        if (tapCount.current >= 5) {
            tapCount.current = 0;
            setActiveTaps(0);
            setModalVisible(true);
            return;
        }

        resetTimer.current = setTimeout(() => {
            tapCount.current = 0;
            setActiveTaps(0);
        }, 600);
    }

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

                {/*gatillo secreto: 5 toques seguidos en CuentApp*/}
                <TouchableOpacity
                    onPress={handleSecretTap}
                    activeOpacity={0.8}
                    style={styles.titleContainer}>
                    <Animated.Text style={[styles.topBarTitle, activeTaps > 0 && styles.topBarTitleActive, { transform: [{ scale: scaleAnim }] },
                    ]}>
                        CuentApp
                    </Animated.Text>

                    {/* Indicador discreto de los 5 toques  */}
                    <View style={styles.dotsRow}>
                        {[1, 2, 3, 4, 5].map((num) => (
                            <View
                                key={num}
                                style={[
                                    styles.dot,
                                    activeTaps >= num && styles.dotActive,
                                ]}
                            />
                        ))}
                    </View>
                </TouchableOpacity>
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
            {/*Modal interactivo del juego y creditos*/}
            <EasterEggModal visible={modalVisible}
                onClose={() => setModalVisible(false)}
            />
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
    titleContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        paddingVertical: 4,
    },
    topBarTitle: {
        color: '#FFFFFF',
        fontSize: 25,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    topBarTitleActive: {
        color: '#38BDF8',
        textShadowColor: 'rgba(56, 189, 248, 0.75)',
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 8,
    },
    dotsRow: {
        flexDirection: 'row',
        gap: 4,
        marginTop: 4,
        height: 4,
    },
    dot: {
        width: 4,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'transparent',
    },
    dotActive: {
        backgroundColor: '#38BDF8',
        shadowColor: '#38BDF8',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 4,
        elevation: 2,
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