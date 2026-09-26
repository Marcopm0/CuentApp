import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { auth, db } from '@/services/firebase';

const CATEGORIAS_GASTO = [
    '🍿 Ocio',
    '🌮 Comida / Antojos',
    '🛒 Despensa',
    '🚌 Transporte',
    '💡 Servicios / Fijos',
    '💊 Salud',
    '📦 Otro Gasto',
];

const CATEGORIAS_INGRESO = [
    '💵 Sueldo Extra',
    '💼 Venta',
    '🎁 Regalo',
    '✨ Otro Ingreso',
];

export default function AgregarRegistroScreen() {
    const router = useRouter();

    // Estados principales
    const [isExpense, setIsExpense] = useState<boolean>(true); // true = Gasto (-), false = Ingreso (+)
    const [amount, setAmount] = useState<string>('');
    const [description, setDescription] = useState<string>('');
    const [category, setCategory] = useState<string>('🍿 Ocio');
    const [isShared, setIsShared] = useState<boolean>(false); // De adorno visual por ahora
    const [modalCategoryVisible, setModalCategoryVisible] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);

    // Destino del ingreso cuando entra dinero extra
    const [targetBucket, setTargetBucket] = useState<'leisure' | 'buffer' | 'savings'>('leisure');

    // Mes en curso YYYY-MM
    const currentMonthYear = useMemo(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }, []);

    const handleToggleType = () => {
        const nextType = !isExpense;
        setIsExpense(nextType);
        setCategory(nextType ? CATEGORIAS_GASTO[0] : CATEGORIAS_INGRESO[0]);
    };

    const handleSave = async () => {
        const numericAmount = parseFloat(amount);

        if (isNaN(numericAmount) || numericAmount <= 0) {
            Alert.alert('Monto requerido', 'Por favor ingresa una cantidad válida mayor a $0.');
            return;
        }

        const user = auth.currentUser;
        if (!user) {
            Alert.alert('Error', 'No hay sesión activa.');
            return;
        }

        setLoading(true);

        try {
            await addDoc(collection(db, 'transactions'), {
                userId: user.uid,
                type: isExpense ? 'expense' : 'income',
                amount: numericAmount,
                description: description.trim() || (isExpense ? 'Gasto registrado' : 'Ingreso extra'),
                category,
                // Si es ingreso guardamos la bolsa elegida; si es gasto es null
                targetBucket: isExpense ? null : targetBucket,
                isShared: false,
                sharedFundId: null,
                monthYear: currentMonthYear,
                createdAt: serverTimestamp(),
            });

            Alert.alert('Guardado', `${isExpense ? 'Gasto' : 'Ingreso'} registrado con éxito.`);
            setAmount('');
            setDescription('');

            if (router.canGoBack()) {
                router.back();
            }
        } catch (error) {
            console.error('Error al guardar registro:', error);
            Alert.alert('Error', 'No se pudo guardar el movimiento.');
        } finally {
            setLoading(false);
        }
    };

    const currentCategoryList = isExpense ? CATEGORIAS_GASTO : CATEGORIAS_INGRESO;

    return (
        <SafeAreaView style={styles.safeArea}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <KeyboardAvoidingView
                    style={styles.container}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View style={styles.content}>
                        {/* Header con botón para volver atrás */}
                        <View style={styles.headerRow}>
                            <TouchableOpacity
                                onPress={() => router.canGoBack() && router.back()}
                                style={styles.backButton}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="arrow-back" size={22} color="#94A3B8" />
                            </TouchableOpacity>
                            <Text style={styles.screenTitle}>Nuevo Registro</Text>
                            <View style={{ width: 40 }} />
                        </View>

                        {/* ─────────────────────────────────────────────────────────────
                TARJETA PRINCIPAL DISPLAY 
               ───────────────────────────────────────────────────────────── */}
                        <View style={styles.card}>
                            {/* Selectores superiores: Gasto/Ingreso y Categoría */}
                            <View style={styles.topRow}>
                                <TouchableOpacity
                                    style={[
                                        styles.selectorBtn,
                                        isExpense ? styles.selectorExpense : styles.selectorIncome,
                                    ]}
                                    onPress={handleToggleType}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.selectorText}>
                                        {isExpense ? 'Gasto (-)' : 'Ingreso (+)'}
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.selectorBtn}
                                    onPress={() => setModalCategoryVisible(true)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.selectorText} numberOfLines={1}>
                                        {category} ▾
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {/* Selector de Destino: SOLO si es un Ingreso (+) */}
                            {!isExpense && (
                                <View style={styles.targetBucketContainer}>
                                    <Text style={styles.targetLabel}>¿A dónde va este ingreso?</Text>
                                    <View style={styles.targetBucketRow}>
                                        <TouchableOpacity
                                            style={[
                                                styles.targetBtn,
                                                targetBucket === 'leisure' && styles.targetBtnActive,
                                            ]}
                                            onPress={() => setTargetBucket('leisure')}
                                            activeOpacity={0.7}
                                        >
                                            <Text
                                                style={[
                                                    styles.targetBtnText,
                                                    targetBucket === 'leisure' && styles.targetBtnTextActive,
                                                ]}
                                            >
                                                🍿 Ocio
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={[
                                                styles.targetBtn,
                                                targetBucket === 'buffer' && styles.targetBtnActive,
                                            ]}
                                            onPress={() => setTargetBucket('buffer')}
                                            activeOpacity={0.7}
                                        >
                                            <Text
                                                style={[
                                                    styles.targetBtnText,
                                                    targetBucket === 'buffer' && styles.targetBtnTextActive,
                                                ]}
                                            >
                                                🛡️ Colchón
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={[
                                                styles.targetBtn,
                                                targetBucket === 'savings' && styles.targetBtnActive,
                                            ]}
                                            onPress={() => setTargetBucket('savings')}
                                            activeOpacity={0.7}
                                        >
                                            <Text
                                                style={[
                                                    styles.targetBtnText,
                                                    targetBucket === 'savings' && styles.targetBtnTextActive,
                                                ]}
                                            >
                                                🐖 Ahorro
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}

                            {/* Display del Monto (Input con teclado numérico del cel) */}
                            <View style={styles.amountDisplayRow}>
                                <Text style={styles.amountPrefix}>$</Text>
                                <TextInput
                                    style={[
                                        styles.amountInput,
                                        isExpense ? styles.amountExpense : styles.amountIncome,
                                    ]}
                                    placeholder="0.00"
                                    placeholderTextColor="#475569"
                                    keyboardType="decimal-pad"
                                    value={amount}
                                    onChangeText={setAmount}
                                    autoFocus={true}
                                    selectionColor="#38BDF8"
                                />
                            </View>

                            {/* Concepto / En qué se gastó */}
                            <View style={styles.conceptBox}>
                                <Ionicons name="pencil-outline" size={16} color="#94A3B8" />
                                <TextInput
                                    style={styles.conceptInput}
                                    placeholder={
                                        isExpense
                                            ? '¿En qué se gastó? (Ej. Café, Tacos...)'
                                            : '¿De qué fue el ingreso? (Ej. Venta, Propina...)'
                                    }
                                    placeholderTextColor="#64748B"
                                    value={description}
                                    onChangeText={setDescription}
                                    maxLength={45}
                                />
                            </View>

                            {/* Fondo Compartido (Adorno visual por ahora) */}
                            <View style={styles.sharedRow}>
                                <View style={styles.sharedIcons}>
                                    <Ionicons
                                        name="people"
                                        size={22}
                                        color={isShared ? '#38BDF8' : '#64748B'}
                                    />
                                    <Text style={styles.sharedHintText}>Fondo compartido</Text>
                                </View>
                                <Switch
                                    value={isShared}
                                    onValueChange={setIsShared}
                                    trackColor={{ false: '#24324D', true: '#38BDF8' }}
                                    thumbColor={isShared ? '#FFFFFF' : '#94A3B8'}
                                />
                            </View>
                        </View>

                        {/* Botón Guardar / Ir */}
                        <TouchableOpacity
                            style={[
                                styles.saveButton,
                                isExpense ? styles.saveButtonExpense : styles.saveButtonIncome,
                                loading && { opacity: 0.6 },
                            ]}
                            onPress={handleSave}
                            disabled={loading}
                            activeOpacity={0.8}
                        >
                            {loading ? (
                                <ActivityIndicator color="#FFFFFF" />
                            ) : (
                                <Text style={styles.saveButtonText}>
                                    {isExpense ? 'Guardar Gasto' : 'Guardar Ingreso'}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>

                    {/* Modal de Selección de Categoría */}
                    <Modal
                        visible={modalCategoryVisible}
                        transparent={true}
                        animationType="fade"
                        onRequestClose={() => setModalCategoryVisible(false)}
                    >
                        <TouchableOpacity
                            style={styles.modalOverlay}
                            activeOpacity={1}
                            onPress={() => setModalCategoryVisible(false)}
                        >
                            <View style={styles.modalContent}>
                                <Text style={styles.modalTitle}>Selecciona una Categoría</Text>
                                {currentCategoryList.map((cat) => (
                                    <TouchableOpacity
                                        key={cat}
                                        style={[
                                            styles.categoryItem,
                                            category === cat && styles.categoryItemActive,
                                        ]}
                                        onPress={() => {
                                            setCategory(cat);
                                            setModalCategoryVisible(false);
                                        }}
                                    >
                                        <Text
                                            style={[
                                                styles.categoryItemText,
                                                category === cat && styles.categoryItemTextActive,
                                            ]}
                                        >
                                            {cat}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </TouchableOpacity>
                    </Modal>
                </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
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
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
        paddingTop: 10,
        gap: 16,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginVertical: 4,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#161F30',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#24324D',
    },
    screenTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#FFFFFF',
        textAlign: 'center',
    },
    card: {
        backgroundColor: '#161F30',
        borderRadius: 24,
        borderWidth: 1.5,
        borderColor: '#24324D',
        padding: 20,
        gap: 14,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 10,
    },
    selectorBtn: {
        flex: 1,
        backgroundColor: '#0B0F17',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#24324D',
        alignItems: 'center',
        justifyContent: 'center',
    },
    selectorExpense: {
        borderColor: 'rgba(239, 68, 68, 0.6)',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
    },
    selectorIncome: {
        borderColor: 'rgba(16, 185, 129, 0.6)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
    },
    selectorText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '700',
    },
    targetBucketContainer: {
        gap: 6,
        backgroundColor: '#0B0F17',
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#24324D',
    },
    targetLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: '#94A3B8',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    targetBucketRow: {
        flexDirection: 'row',
        gap: 8,
    },
    targetBtn: {
        flex: 1,
        backgroundColor: '#161F30',
        paddingVertical: 8,
        borderRadius: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#24324D',
    },
    targetBtnActive: {
        borderColor: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
    },
    targetBtnText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#94A3B8',
    },
    targetBtnTextActive: {
        color: '#10B981',
    },
    amountDisplayRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
    },
    amountPrefix: {
        fontSize: 36,
        fontWeight: '800',
        color: '#94A3B8',
        marginRight: 4,
    },
    amountInput: {
        fontSize: 44,
        fontWeight: '900',
        minWidth: 120,
        textAlign: 'left',
    },
    amountExpense: {
        color: '#FFFFFF',
    },
    amountIncome: {
        color: '#10B981',
    },
    conceptBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0B0F17',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: '#24324D',
        gap: 10,
    },
    conceptInput: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 15,
    },
    sharedRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 6,
        borderTopWidth: 1,
        borderTopColor: '#24324D',
    },
    sharedIcons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    sharedHintText: {
        fontSize: 12,
        color: '#64748B',
        fontWeight: '600',
    },
    saveButton: {
        paddingVertical: 16,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 'auto',
        marginBottom: 20,
    },
    saveButtonExpense: {
        backgroundColor: '#EF4444',
    },
    saveButtonIncome: {
        backgroundColor: '#10B981',
    },
    saveButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        width: '85%',
        backgroundColor: '#161F30',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#24324D',
        padding: 18,
        gap: 8,
    },
    modalTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: '#FFFFFF',
        marginBottom: 8,
        textAlign: 'center',
    },
    categoryItem: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        backgroundColor: '#0B0F17',
    },
    categoryItemActive: {
        borderColor: '#38BDF8',
        borderWidth: 1,
    },
    categoryItemText: {
        color: '#94A3B8',
        fontSize: 14,
        fontWeight: '600',
    },
    categoryItemTextActive: {
        color: '#38BDF8',
        fontWeight: '800',
    },
});