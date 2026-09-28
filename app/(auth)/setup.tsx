import { completeOnboarding, FixedExpense } from '@/services/onboardingService';
import { DueBlock, PayFrequency } from '@/utils/periods';
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

interface ExpenseOption {
    id: string;
    name: string;
    icon: keyof typeof Ionicons.glyphMap;
    selected: boolean;
    amount: string;
    dueBlock: DueBlock; // 'start' | 'mid' | 'end'
}

const INITIAL_OPTIONS: ExpenseOption[] = [
    { id: 'rent', name: 'Renta o Hipoteca', icon: 'home-outline', selected: false, amount: '', dueBlock: 'start' },
    { id: 'electricity', name: 'Energía Eléctrica (Luz)', icon: 'flash-outline', selected: false, amount: '', dueBlock: 'mid' },
    { id: 'water', name: 'Agua Potable', icon: 'water-outline', selected: false, amount: '', dueBlock: 'mid' },
    { id: 'gas', name: 'Gas Doméstico', icon: 'flame-outline', selected: false, amount: '', dueBlock: 'mid' },
    { id: 'internet', name: 'Internet y Telefonía', icon: 'wifi-outline', selected: false, amount: '', dueBlock: 'mid' },
    { id: 'groceries', name: 'Despensa Básica', icon: 'cart-outline', selected: false, amount: '', dueBlock: 'start' },
    { id: 'transport', name: 'Transporte / Gasolina', icon: 'car-outline', selected: false, amount: '', dueBlock: 'mid' },
    { id: 'subscriptions', name: 'Suscripciones Fijas', icon: 'tv-outline', selected: false, amount: '', dueBlock: 'mid' },
];

export default function SetupScreen() {
    const router = useRouter();

    // Paso 1: Ingreso mensual | Paso 2: Gastos Fijos | Paso 3: Ahorro y Ocio
    const [step, setStep] = useState<number>(1);

    // Estados de datos
    // Frecuencia y monto por periodo
    const [payFrequency, setPayFrequency] = useState<PayFrequency>('biweekly');
    const [payDayOfWeek, setPayDayOfWeek] = useState<number>(5); // default Viernes = 5
    const [periodAmount, setPeriodAmount] = useState<string>('');

    // Cálculo automático del ingreso mensual normalizado
    const numericPeriodAmount = parseFloat(periodAmount) || 0;
    const numericIncome = useMemo(() => {
        if (payFrequency === 'monthly') return numericPeriodAmount;
        if (payFrequency === 'biweekly') return numericPeriodAmount * 2;
        return numericPeriodAmount * 4; // weekly
    }, [payFrequency, numericPeriodAmount]);
    const [expenses, setExpenses] = useState<ExpenseOption[]>(INITIAL_OPTIONS);
    const [savings, setSavings] = useState<string>('');
    const [leisure, setLeisure] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);



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

    const toggleExpense = (id: string) => {
        setExpenses((prev) =>
            prev.map((item) =>
                item.id === id
                    ? { ...item, selected: !item.selected, amount: !item.selected ? item.amount : '' }
                    : item
            )
        );
    };

    const updateExpenseAmount = (id: string, value: string) => {
        setExpenses((prev) =>
            prev.map((item) => (item.id === id ? { ...item, amount: value } : item))
        );
    };

    const updateExpenseDueBlock = (id: string, dueBlock: DueBlock) => {
        setExpenses((prev) =>
            prev.map((item) => (item.id === id ? { ...item, dueBlock } : item))
        );
    };

    const handleNext = () => {
        if (step === 1) {
            if (!periodAmount || numericIncome <= 0) {
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
            setStep(1);
        } else if (step === 3) {
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
                    dueBlock: e.dueBlock,
                }));

            await completeOnboarding({
                monthlyIncome: numericIncome,
                payFrequency: payFrequency,
                payDayOfWeek: payFrequency === 'weekly' ? payDayOfWeek : undefined,
                amountPerPeriod: numericPeriodAmount,
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
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
            >
                <ScrollView
                    contentContainerStyle={styles.scrollContainer}
                    keyboardShouldPersistTaps="handled"
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
                        {/* PASO 1: Periodicidad e Ingreso */}
                        {step === 1 && (
                            <View style={styles.stepContent}>
                                <View style={styles.iconCircle}>
                                    <Ionicons name="wallet-outline" size={32} color="#38BDF8" />
                                </View>
                                <Text style={styles.title}>¿Cómo recibes tus ingresos?</Text>
                                <Text style={styles.subtitle}>
                                    Adaptaremos los recordatorios de nómina a tus fechas reales de cobro.
                                </Text>

                                {/* Selector de Frecuencia */}
                                <View style={styles.freqSelectorRow}>
                                    <TouchableOpacity
                                        style={[
                                            styles.freqChip,
                                            payFrequency === 'weekly' && styles.freqChipActive,
                                        ]}
                                        onPress={() => setPayFrequency('weekly')}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={[styles.freqChipText, payFrequency === 'weekly' && styles.freqChipTextActive]}>
                                            Semanal
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.freqChip,
                                            payFrequency === 'biweekly' && styles.freqChipActive,
                                        ]}
                                        onPress={() => setPayFrequency('biweekly')}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={[styles.freqChipText, payFrequency === 'biweekly' && styles.freqChipTextActive]}>
                                            Quincenal
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.freqChip,
                                            payFrequency === 'monthly' && styles.freqChipActive,
                                        ]}
                                        onPress={() => setPayFrequency('monthly')}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={[styles.freqChipText, payFrequency === 'monthly' && styles.freqChipTextActive]}>
                                            Mensual
                                        </Text>
                                    </TouchableOpacity>
                                </View>

                                {/* Selector de día de cobro semanal */}
                                {payFrequency === 'weekly' && (
                                    <View style={styles.daySelectorWrapper}>
                                        <Text style={styles.inputLabelPeriod}>¿Qué día recibes tu cobro semanal?</Text>
                                        <View style={styles.daySelectorRow}>
                                            {[
                                                { label: 'Lunes', value: 1 },
                                                { label: 'Jueves', value: 4 },
                                                { label: 'Viernes', value: 5 },
                                                { label: 'Sábado', value: 6 },
                                            ].map((d) => (
                                                <TouchableOpacity
                                                    key={d.value}
                                                    style={[
                                                        styles.dayChip,
                                                        payDayOfWeek === d.value && styles.dayChipActive,
                                                    ]}
                                                    onPress={() => setPayDayOfWeek(d.value)}
                                                    activeOpacity={0.7}
                                                >
                                                    <Text
                                                        style={[
                                                            styles.dayChipText,
                                                            payDayOfWeek === d.value && styles.dayChipTextActive,
                                                        ]}
                                                    >
                                                        {d.label}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </View>
                                )}

                                {/* Input de Monto por Pago */}
                                <Text style={styles.inputLabelPeriod}>
                                    {payFrequency === 'weekly'
                                        ? '¿Cuánto cobras cada semana?'
                                        : payFrequency === 'biweekly'
                                            ? '¿Cuánto cobras cada quincena?'
                                            : '¿Cuánto cobras al mes?'}
                                </Text>

                                <View style={styles.amountInputContainer}>
                                    <Text style={styles.currencySymbol}>$</Text>
                                    <TextInput
                                        style={styles.amountInput}
                                        placeholder="0.00"
                                        placeholderTextColor="#475569"
                                        keyboardType="numeric"
                                        value={periodAmount}
                                        onChangeText={setPeriodAmount}
                                        autoFocus
                                    />
                                    <Text style={styles.currencyCode}>MXN</Text>
                                </View>

                                {/* Nota de conversión al mes */}
                                {numericPeriodAmount > 0 && payFrequency !== 'monthly' && (
                                    <View style={styles.monthlyEquivalentBadge}>
                                        <Ionicons name="information-circle-outline" size={16} color="#38BDF8" />
                                        <Text style={styles.monthlyEquivalentText}>
                                            Equivale a un ingreso de{' '}
                                            <Text style={styles.summaryHighlight}>
                                                ${numericIncome.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
                                            </Text>{' '}
                                            al mes para tus presupuestos base.
                                        </Text>
                                    </View>
                                )}
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
                                                <View style={styles.expenseConfigContainer}>
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

                                                    <View style={styles.dueBlockWrapper}>
                                                        <Text style={styles.dueBlockSectionLabel}>¿En qué periodo del mes se paga?</Text>
                                                        <View style={styles.dueBlockRow}>
                                                            <TouchableOpacity
                                                                style={[
                                                                    styles.dueBlockChip,
                                                                    item.dueBlock === 'start' && styles.dueBlockChipActive,
                                                                ]}
                                                                onPress={() => updateExpenseDueBlock(item.id, 'start')}
                                                                activeOpacity={0.7}
                                                            >
                                                                <Text
                                                                    style={[
                                                                        styles.dueBlockChipText,
                                                                        item.dueBlock === 'start' && styles.dueBlockChipTextActive,
                                                                    ]}
                                                                >
                                                                    1-10 (Principio)
                                                                </Text>
                                                            </TouchableOpacity>

                                                            <TouchableOpacity
                                                                style={[
                                                                    styles.dueBlockChip,
                                                                    item.dueBlock === 'mid' && styles.dueBlockChipActive,
                                                                ]}
                                                                onPress={() => updateExpenseDueBlock(item.id, 'mid')}
                                                                activeOpacity={0.7}
                                                            >
                                                                <Text
                                                                    style={[
                                                                        styles.dueBlockChipText,
                                                                        item.dueBlock === 'mid' && styles.dueBlockChipTextActive,
                                                                    ]}
                                                                >
                                                                    11-20 (Mediados)
                                                                </Text>
                                                            </TouchableOpacity>

                                                            <TouchableOpacity
                                                                style={[
                                                                    styles.dueBlockChip,
                                                                    item.dueBlock === 'end' && styles.dueBlockChipActive,
                                                                ]}
                                                                onPress={() => updateExpenseDueBlock(item.id, 'end')}
                                                                activeOpacity={0.7}
                                                            >
                                                                <Text
                                                                    style={[
                                                                        styles.dueBlockChipText,
                                                                        item.dueBlock === 'end' && styles.dueBlockChipTextActive,
                                                                    ]}
                                                                >
                                                                    21-31 (Fin)
                                                                </Text>
                                                            </TouchableOpacity>
                                                        </View>
                                                    </View>
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

                        {/* Acciones de Navegación (Único bloque, sin duplicados) */}
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
        paddingVertical: 24,
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
        backgroundColor: 'rgba(248, 113, 113, 0.08)',
    },
    bufferTextContainer: {
        flex: 1,
    },
    bufferTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#38BDF8',
        marginBottom: 2,
    },
    bufferTitleError: {
        color: '#F87171',
    },
    bufferDescription: {
        fontSize: 12,
        color: '#94A3B8',
        lineHeight: 16,
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
        opacity: 0.5,
    },
    freqSelectorRow: {
        flexDirection: 'row',
        gap: 8,
        width: '100%',
        marginVertical: 12,
    },
    freqChip: {
        flex: 1,
        backgroundColor: '#0B0F17',
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#24324D',
    },
    freqChipActive: {
        borderColor: '#38BDF8',
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
    },
    freqChipText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#94A3B8',
    },
    freqChipTextActive: {
        color: '#38BDF8',
    },
    inputLabelPeriod: {
        fontSize: 14,
        fontWeight: '600',
        color: '#E2E8F0',
        alignSelf: 'flex-start',
        marginTop: 10,
        marginBottom: 6,
    },
    monthlyEquivalentBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(56, 189, 248, 0.08)',
        borderRadius: 10,
        padding: 10,
        gap: 6,
        marginTop: 14,
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.2)',
    },
    monthlyEquivalentText: {
        fontSize: 12,
        color: '#94A3B8',
        flex: 1,
    },
    daySelectorWrapper: {
        width: '100%',
        marginTop: 6,
    },
    daySelectorRow: {
        flexDirection: 'row',
        gap: 8,
        width: '100%',
        marginTop: 6,
    },
    dayChip: {
        flex: 1,
        backgroundColor: '#0B0F17',
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#24324D',
    },
    dayChipActive: {
        borderColor: '#38BDF8',
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
    },
    dayChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#94A3B8',
    },
    dayChipTextActive: {
        color: '#38BDF8',
    },
    expenseConfigContainer: {
        gap: 8,
        width: '100%',
    },
    dueBlockWrapper: {
        gap: 6,
        width: '100%',
        marginTop: 2,
    },
    dueBlockSectionLabel: {
        fontSize: 12,
        color: '#94A3B8',
        fontWeight: '600',
    },
    dueBlockRow: {
        flexDirection: 'row',
        gap: 6,
        width: '100%',
    },
    dueBlockChip: {
        flex: 1,
        backgroundColor: '#161F30',
        paddingVertical: 8,
        borderRadius: 8,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#24324D',
    },
    dueBlockChipActive: {
        borderColor: '#38BDF8',
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
    },
    dueBlockChipText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#94A3B8',
    },
    dueBlockChipTextActive: {
        color: '#38BDF8',
        fontWeight: '700',
    },
});