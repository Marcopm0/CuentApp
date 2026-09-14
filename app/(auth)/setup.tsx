import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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

import { completeOnboarding, FixedExpense } from '@/services/onboardingService';

interface ExpenseOption {
    id: string;
    name: string;
    icon: keyof typeof Ionicons.glyphMap;
    selected: boolean;
    amount: string;
}

const INITIAL_OPTIONS: ExpenseOption[] = [
    { id: 'rent', name: 'Renta o Hipoteca', icon: 'home-outline', selected: false, amount: '' },
    { id: 'electricity', name: 'Energía Eléctrica (Luz)', icon: 'flash-outline', selected: false, amount: '' },
    { id: 'water', name: 'Agua Potable', icon: 'water-outline', selected: false, amount: '' },
    { id: 'gas', name: 'Gas Doméstico', icon: 'flame-outline', selected: false, amount: '' },
    { id: 'internet', name: 'Internet y Telefonía', icon: 'wifi-outline', selected: false, amount: '' },
    { id: 'groceries', name: 'Despensa Básica', icon: 'cart-outline', selected: false, amount: '' },
    { id: 'transport', name: 'Transporte / Gasolina', icon: 'car-outline', selected: false, amount: '' },
    { id: 'subscriptions', name: 'Suscripciones Fijas', icon: 'tv-outline', selected: false, amount: '' },
];

export default function SetupScreen() {
    const router = useRouter();

    // Paso 1: Ingreso mensual | Paso 2: Gastos Fijos desglosados | Paso 3: Ahorro y Ocio
    const [step, setStep] = useState<number>(1);

    // Estados de datos
    const [income, setIncome] = useState<string>('');
    const [expenses, setExpenses] = useState<ExpenseOption[]>(INITIAL_OPTIONS);
    const [savings, setSavings] = useState<string>('');
    const [leisure, setLeisure] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const numericIncome = parseFloat(income) || 0;

    // Totales calculados en memoria
    const totalFixed = useMemo(() => {
        return expenses.reduce((acc, item) => {
            if (!item.selected) return acc;
            const val = parseFloat(item.amount);
            return acc + (isNaN(val) ? 0 : val);
        }, 0);
    }, [expenses]);

    const remainingAfterFixed = Math.max(0, numericIncome - totalFixed);
    const numericSaving = parseFloat(savings) || 0;
    const numericLeisure = parseFloat(leisure) || 0;
    const totalAllocatedPaso3 = numericSaving + numericLeisure;
    const unallocatedBuffer = remainingAfterFixed - totalAllocatedPaso3;

    // Selección/deselección de un gasto fijo
    const toggleExpense = (id: string) => {
        setExpenses((prev) =>
            prev.map((item) =>
                item.id === id
                    ? { ...item, selected: !item.selected, amount: !item.selected ? item.amount : '' }
                    : item
            )
        );
    };

    // Cambio de monto individual en cada gasto fijo
    const updateExpenseAmount = (id: string, value: string) => {
        setExpenses((prev) =>
            prev.map((item) => (item.id === id ? { ...item, amount: value } : item))
        );
    };

    const handleNext = () => {
        if (step === 1) {
            if (!income || numericIncome <= 0) {
                Alert.alert('Monto requerido', 'Por favor ingresa tu ingreso mensual disponible.');
                return;
            }
            setStep(2);
        } else if (step === 2) {
            const selectedActive = expenses.filter((e) => e.selected);
            const hasEmptyAmount = selectedActive.some(
                (e) => !e.amount || isNaN(Number(e.amount)) || Number(e.amount) <= 0
            );

            if (hasEmptyAmount) {
                Alert.alert(
                    'Montos pendientes',
                    'Ingresa el monto estimado de cada gasto seleccionado o desactiva los que no uses.'
                );
                return;
            }

            if (totalFixed > numericIncome) {
                Alert.alert(
                    'Atención',
                    'Tus gastos fijos superan tu ingreso reportado. Revisa los valores antes de continuar.'
                );
                return;
            }
            setStep(3);
        }
    };

    const handleBack = () => {
        if (step === 2) {
            setExpenses(INITIAL_OPTIONS);
            setStep(1);
        } else if (step === 3) {
            setSavings('');
            setLeisure('');
            setStep(2);
        }
    };

    const handleFinish = async () => {
        if (unallocatedBuffer < 0) {
            Alert.alert(
                'Distribución excedida',
                `La suma de ahorro y ocio ($${totalAllocatedPaso3.toFixed(2)}) supera los $${remainingAfterFixed.toFixed(2)} que tenías disponibles tras tus gastos fijos.`
            );
            return;
        }

        setIsLoading(true);
        try {
            const activeExpenses: FixedExpense[] = expenses
                .filter((e) => e.selected && parseFloat(e.amount) > 0)
                .map((e) => ({
                    id: e.id,
                    name: e.name,
                    amount: parseFloat(e.amount),
                }));

            await completeOnboarding({
                monthlyIncome: numericIncome,
                fixedExpenses: activeExpenses,
                savingsTarget: numericSaving,
                leisureBudget: numericLeisure,
            });

            router.replace('/(tabs)');
        } catch (error: unknown) {
            const err = error as Error;
            Alert.alert('Error', err.message || 'No se pudo guardar la configuración inicial.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView
                style={styles.keyboardView}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView
                    contentContainerStyle={styles.scrollContainer}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.cardContainer}>
                        {/* Indicador de pasos */}
                        <View style={styles.stepsIndicator}>
                            {[1, 2, 3].map((s) => (
                                <View
                                    key={s}
                                    style={[
                                        styles.stepPill,
                                        step >= s ? styles.stepPillActive : styles.stepPillInactive,
                                    ]}
                                />
                            ))}
                        </View>

                        {/* PASO 1: Ingreso Mensual */}
                        {step === 1 && (
                            <View style={styles.stepContent}>
                                <View style={styles.iconCircle}>
                                    <Ionicons name="wallet-outline" size={32} color="#38BDF8" />
                                </View>
                                <Text style={styles.title}>¿Cuál es tu ingreso mensual?</Text>
                                <Text style={styles.subtitle}>
                                    Con esto partiremos para crear tu control de gastos.
                                </Text>

                                <View style={styles.amountInputContainer}>
                                    <Text style={styles.currencySymbol}>$</Text>
                                    <TextInput
                                        style={styles.amountInput}
                                        placeholder="0.00"
                                        placeholderTextColor="#475569"
                                        keyboardType="numeric"
                                        value={income}
                                        onChangeText={setIncome}
                                        autoFocus
                                    />
                                    <Text style={styles.currencyCode}>MXN</Text>
                                </View>
                            </View>
                        )}

                        {/* PASO 2: Gastos Fijos Desglosados */}
                        {step === 2 && (
                            <View style={styles.stepContent}>
                                <View style={styles.iconCircle}>
                                    <Ionicons name="receipt-outline" size={32} color="#38BDF8" />
                                </View>
                                <Text style={styles.title}>Tus Gastos Fijos</Text>
                                <Text style={styles.subtitle}>
                                    Selecciona los que pagas cada mes e indica cuánto cuesta cada uno para vigilar si suben. Si no encuentras algún apartado lo podrás crear después.
                                </Text>

                                <View style={styles.expensesList}>
                                    {expenses.map((item) => (
                                        <View
                                            key={item.id}
                                            style={[
                                                styles.expenseItemCard,
                                                item.selected && styles.expenseItemCardActive,
                                            ]}
                                        >
                                            <TouchableOpacity
                                                style={styles.expenseHeader}
                                                onPress={() => toggleExpense(item.id)}
                                                activeOpacity={0.7}
                                            >
                                                <Ionicons
                                                    name={item.icon}
                                                    size={22}
                                                    color={item.selected ? '#38BDF8' : '#94A3B8'}
                                                />
                                                <Text
                                                    style={[
                                                        styles.expenseName,
                                                        item.selected && styles.expenseNameActive,
                                                    ]}
                                                >
                                                    {item.name}
                                                </Text>
                                                <Ionicons
                                                    name={item.selected ? 'checkbox' : 'square-outline'}
                                                    size={22}
                                                    color={item.selected ? '#38BDF8' : '#64748B'}
                                                />
                                            </TouchableOpacity>

                                            {item.selected && (
                                                <View style={styles.expenseInputRow}>
                                                    <Text style={styles.smallCurrency}>$</Text>
                                                    <TextInput
                                                        style={styles.expenseInput}
                                                        placeholder="Monto mensual"
                                                        placeholderTextColor="#475569"
                                                        keyboardType="numeric"
                                                        value={item.amount}
                                                        onChangeText={(val) => updateExpenseAmount(item.id, val)}
                                                        autoFocus
                                                    />
                                                    <Text style={styles.smallCode}>MXN</Text>
                                                </View>
                                            )}
                                        </View>
                                    ))}
                                </View>

                                <View style={styles.summaryBar}>
                                    <Text style={styles.summaryText}>
                                        Total en Fijos: <Text style={styles.summaryHighlight}>${totalFixed.toFixed(2)} MXN</Text>
                                    </Text>
                                </View>
                            </View>
                        )}

                        {/* PASO 3: Ahorro y Dinero Libre */}
                        {step === 3 && (
                            <View style={styles.stepContent}>
                                <View style={styles.iconCircle}>
                                    <Ionicons name="sparkles-outline" size={32} color="#38BDF8" />
                                </View>
                                <Text style={styles.title}>Ahorro y Ocio</Text>
                                <Text style={styles.subtitle}>
                                    Te quedan <Text style={styles.summaryHighlight}>${remainingAfterFixed.toFixed(2)} MXN</Text> libres.
                                    Repártelos entre tus metas de ahorro y entretenimiento.
                                </Text>

                                <View style={styles.inputBlock}>
                                    <Text style={styles.inputLabel}>🎯 Meta de Ahorro Mensual</Text>
                                    <View style={styles.amountInputContainer}>
                                        <Text style={styles.currencySymbol}>$</Text>
                                        <TextInput
                                            style={styles.amountInput}
                                            placeholder="0.00"
                                            placeholderTextColor="#475569"
                                            keyboardType="numeric"
                                            value={savings}
                                            onChangeText={setSavings}
                                        />
                                        <Text style={styles.currencyCode}>MXN</Text>
                                    </View>
                                </View>

                                <View style={styles.inputBlock}>
                                    <Text style={styles.inputLabel}>🍿 Presupuesto para Ocio y Salidas</Text>
                                    <View style={styles.amountInputContainer}>
                                        <Text style={styles.currencySymbol}>$</Text>
                                        <TextInput
                                            style={styles.amountInput}
                                            placeholder="0.00"
                                            placeholderTextColor="#475569"
                                            keyboardType="numeric"
                                            value={leisure}
                                            onChangeText={setLeisure}
                                        />
                                        <Text style={styles.currencyCode}>MXN</Text>
                                    </View>
                                </View>

                                {/* Tarjeta de retroalimentación en vivo sobre el dinero restante */}
                                <View
                                    style={[
                                        styles.bufferCard,
                                        unallocatedBuffer < 0 && styles.bufferCardError,
                                    ]}
                                >
                                    <Ionicons
                                        name={unallocatedBuffer < 0 ? 'alert-circle' : 'shield-checkmark-outline'}
                                        size={22}
                                        color={unallocatedBuffer < 0 ? '#F87171' : '#38BDF8'}
                                    />
                                    <View style={styles.bufferTextContainer}>
                                        <Text
                                            style={[
                                                styles.bufferTitle,
                                                unallocatedBuffer < 0 && styles.bufferTitleError,
                                            ]}
                                        >
                                            {unallocatedBuffer < 0
                                                ? 'Superaste tu disponible'
                                                : `Colchón libre: $${unallocatedBuffer.toFixed(2)} MXN`}
                                        </Text>
                                        <Text style={styles.bufferDescription}>
                                            {unallocatedBuffer < 0
                                                ? `Te pasaste por $${Math.abs(unallocatedBuffer).toFixed(2)} MXN. Reduce el ahorro o el ocio.`
                                                : 'Este dinero no comprometido permanece en tu cuenta como margen de seguridad para imprevistos.'}
                                        </Text>
                                    </View>
                                </View>
                            </View>
                        )}

                        {/* Acciones de Navegación */}
                        <View style={styles.actionsContainer}>
                            {step > 1 && (
                                <TouchableOpacity
                                    style={styles.secondaryButton}
                                    onPress={handleBack}
                                    disabled={isLoading}
                                    activeOpacity={0.7}
                                >
                                    <Text style={styles.secondaryButtonText}>Atrás</Text>
                                </TouchableOpacity>
                            )}

                            {step < 3 ? (
                                <TouchableOpacity
                                    style={styles.primaryButton}
                                    onPress={handleNext}
                                    activeOpacity={0.8}
                                >
                                    <Text style={styles.primaryButtonText}>Siguiente</Text>
                                </TouchableOpacity>
                            ) : (
                                <TouchableOpacity
                                    style={[
                                        styles.primaryButton,
                                        (isLoading || unallocatedBuffer < 0) && styles.buttonDisabled,
                                    ]}
                                    onPress={handleFinish}
                                    disabled={isLoading || unallocatedBuffer < 0}
                                    activeOpacity={0.8}
                                >
                                    {isLoading ? (
                                        <ActivityIndicator color="#0B0F17" />
                                    ) : (
                                        <Text style={styles.primaryButtonText}>Comenzar en CuentApp</Text>
                                    )}
                                </TouchableOpacity>
                            )}
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
    },
    cardContainer: {
        backgroundColor: '#161F30',
        borderRadius: 24,
        padding: 24,
        gap: 20,
        borderWidth: 1.5,
        borderColor: '#38BDF8',
        shadowColor: '#38BDF8',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.65,
        shadowRadius: 18,
        elevation: 12,
    },
    stepsIndicator: {
        flexDirection: 'row',
        gap: 8,
        justifyContent: 'center',
    },
    stepPill: {
        flex: 1,
        height: 6,
        borderRadius: 3,
    },
    stepPillActive: {
        backgroundColor: '#38BDF8',
        shadowColor: '#38BDF8',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 6,
        elevation: 4,
    },
    stepPillInactive: {
        backgroundColor: '#24324D',
    },
    stepContent: {
        alignItems: 'center',
        gap: 14,
    },
    iconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.4)',
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        color: '#FFFFFF',
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 14,
        color: '#94A3B8',
        textAlign: 'center',
        lineHeight: 20,
        paddingHorizontal: 6,
    },
    amountInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0B0F17',
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: '#38BDF8',
        paddingHorizontal: 16,
        paddingVertical: 6,
        width: '100%',
        marginTop: 6,
    },
    currencySymbol: {
        fontSize: 26,
        fontWeight: '700',
        color: '#38BDF8',
        marginRight: 6,
    },
    amountInput: {
        flex: 1,
        fontSize: 24,
        fontWeight: '700',
        color: '#FFFFFF',
        paddingVertical: 6,
    },
    currencyCode: {
        fontSize: 13,
        fontWeight: '600',
        color: '#64748B',
    },
    expensesList: {
        width: '100%',
        gap: 10,
        marginTop: 6,
    },
    expenseItemCard: {
        backgroundColor: '#0B0F17',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#24324D',
        padding: 12,
        gap: 10,
    },
    expenseItemCardActive: {
        borderColor: '#38BDF8',
        backgroundColor: 'rgba(56, 189, 248, 0.05)',
    },
    expenseHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
    },
    expenseName: {
        flex: 1,
        fontSize: 15,
        color: '#94A3B8',
        fontWeight: '600',
    },
    expenseNameActive: {
        color: '#FFFFFF',
        fontWeight: '700',
    },
    expenseInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#161F30',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#38BDF8',
        paddingHorizontal: 12,
        paddingVertical: 4,
    },
    expenseInput: {
        flex: 1,
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        paddingVertical: 4,
    },
    smallCurrency: {
        color: '#38BDF8',
        fontSize: 16,
        fontWeight: '700',
        marginRight: 6,
    },
    smallCode: {
        color: '#64748B',
        fontSize: 12,
        fontWeight: '600',
    },
    summaryBar: {
        width: '100%',
        backgroundColor: '#0B0F17',
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#24324D',
        alignItems: 'center',
        marginTop: 6,
    },
    summaryText: {
        color: '#94A3B8',
        fontSize: 14,
    },
    summaryHighlight: {
        color: '#38BDF8',
        fontWeight: '700',
    },
    inputBlock: {
        width: '100%',
        gap: 6,
        marginTop: 4,
    },
    inputLabel: {
        color: '#94A3B8',
        fontSize: 14,
        fontWeight: '600',
    },
    actionsContainer: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 10,
    },
    primaryButton: {
        flex: 1,
        backgroundColor: '#38BDF8',
        paddingVertical: 14,
        borderRadius: 14,
        alignItems: 'center',
        shadowColor: '#38BDF8',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
        elevation: 6,
    },
    primaryButtonText: {
        color: '#0B0F17',
        fontSize: 16,
        fontWeight: '700',
    },
    secondaryButton: {
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#24324D',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#0B0F17',
    },
    secondaryButtonText: {
        color: '#94A3B8',
        fontSize: 15,
        fontWeight: '600',
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    bufferCard: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        backgroundColor: '#0B0F17',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#24324D',
        padding: 14,
        width: '100%',
        marginTop: 8,
    },
    bufferCardError: {
        borderColor: '#F87171',
        backgroundColor: 'rgba(248, 113, 113, 0.8)',
    },
    bufferTextContainer: {
        flex: 1,
    },
    bufferTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#38BDF8',
        marginTop: 2,
    },
    bufferTitleError: {
        color: '#F87171',

    },
    bufferDescription: {
        fontSize: 12,
        color: '#94A3B8',
        lineHeight: 16,


    },
});