import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    where,
} from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Theme } from '@/constants/theme';
import { auth, db } from '@/services/firebase';
import { Budget, Transaction } from '@/types/database';
import { deduplicateBudgets } from '@/utils/budgets';
import { getLocalDateString } from '@/utils/dates';

const CATEGORIAS_GASTO_VARIABLES = [
    '🍿 Ocio',
    '🌮 Comida / Antojos',
    '🛒 Despensa',
    '🚌 Transporte',
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

    // Presupuestos activos para el mes actual y selección de presupuesto fijo
    const [budgets, setBudgets] = useState<Budget[]>([]);
    const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);

    // Destino del ingreso cuando entra dinero extra
    const [targetBucket, setTargetBucket] = useState<'leisure' | 'buffer' | 'savings'>('leisure');

    // Origen del gasto diario/variable (Detalle 1: Ocio vs Colchón)
    const [expenseTargetBucket, setExpenseTargetBucket] = useState<'leisure' | 'buffer'>('leisure');

    // Registro de montos liquidados de gastos fijos este mes (Detalle 2)
    const [paidFixedMap, setPaidFixedMap] = useState<Record<string, number>>({});

    // Mes en curso YYYY-MM
    const currentMonthYear = useMemo(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }, []);

    // Cargar presupuestos activos y gastos fijos ya liquidados para el monthYear actual
    useEffect(() => {
        const user = auth.currentUser;
        if (!user) return;

        const fetchBudgetsAndTxs = async () => {
            try {
                // 1. Obtener presupuestos permanentes (Opción B)
                const qBudgets = query(
                    collection(db, 'budgets'),
                    where('userId', '==', user.uid)
                );
                const snapshotBudgets = await getDocs(qBudgets);
                const rawDocs: Budget[] = snapshotBudgets.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as Omit<Budget, 'id'>),
                }));
                // Deduplicar presupuestos por categoría
                setBudgets(deduplicateBudgets(rawDocs));

                // 2. Obtener transacciones de gastos fijos del mes actual para cruzar pagos
                const qTxs = query(
                    collection(db, 'transactions'),
                    where('userId', '==', user.uid),
                    where('monthYear', '==', currentMonthYear),
                    where('type', '==', 'expense'),
                    where('isFixedExpense', '==', true)
                );
                const snapshotTxs = await getDocs(qTxs);
                const paidMap: Record<string, number> = {};
                snapshotTxs.docs.forEach((docSnap) => {
                    const data = docSnap.data();
                    const amt = Number(data.amount) || 0;
                    if (data.budgetId) {
                        paidMap[data.budgetId] = (paidMap[data.budgetId] || 0) + amt;
                    }
                    if (data.category) {
                        paidMap[data.category] = (paidMap[data.category] || 0) + amt;
                    }
                });
                setPaidFixedMap(paidMap);
            } catch (error) {
                console.error('Error al cargar presupuestos activos y fijos pagados:', error);
            }
        };

        fetchBudgetsAndTxs();
    }, [currentMonthYear]);

    // Saldo pendiente del presupuesto fijo actualmente seleccionado (calculado dinámicamente - Opción B)
    const pendingFixedAmount = useMemo(() => {
        if (!selectedBudget || !selectedBudget.isFixedExpense) return null;
        const spentFromTxs = Math.max(
            paidFixedMap[selectedBudget.id] || 0,
            paidFixedMap[selectedBudget.category] || 0
        );
        const limit = Number(selectedBudget.limitAmount || 0);
        return Math.max(0, limit - spentFromTxs);
    }, [selectedBudget, paidFixedMap]);

    const handleToggleType = () => {
        const nextType = !isExpense;
        setIsExpense(nextType);
        setSelectedBudget(null);
        setExpenseTargetBucket('leisure');
        setTargetBucket('leisure');
        setCategory(nextType ? CATEGORIAS_GASTO_VARIABLES[0] : CATEGORIAS_INGRESO[0]);
    };

    // Controlador y sanitizador de entrada de monto
    const handleAmountChange = (text: string) => {
        let cleaned = text.replace(',', '.');
        cleaned = cleaned.replace(/[^0-9.]/g, '');
        const parts = cleaned.split('.');
        if (parts.length > 2) {
            cleaned = parts[0] + '.' + parts.slice(1).join('');
        }
        if (parts[1] && parts[1].length > 2) {
            cleaned = parts[0] + '.' + parts[1].slice(0, 2);
        }

        const num = parseFloat(cleaned);
        // Punto 2: Límite máximo de $100,000 MXN para evitar descuidos tipográficos
        if (!isNaN(num) && num > 100000) {
            Alert.alert('Límite de monto', 'El monto máximo por transacción es de $100,000 MXN.');
            return;
        }

        // Punto 1: Bloquear si excede el saldo pendiente en compromisos fijos
        if (selectedBudget?.isFixedExpense && pendingFixedAmount !== null) {
            if (!isNaN(num) && num > pendingFixedAmount) {
                Alert.alert(
                    'Monto excede saldo pendiente',
                    `El saldo pendiente de "${selectedBudget.category}" es de $${pendingFixedAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN. No puedes ingresar una cifra mayor.`
                );
                const capped = pendingFixedAmount > 0
                    ? (pendingFixedAmount % 1 === 0 ? pendingFixedAmount.toString() : pendingFixedAmount.toFixed(2))
                    : '0';
                setAmount(capped);
                return;
            }
        }

        setAmount(cleaned);
    };

    const handleSave = async () => {
        const numericAmount = parseFloat(amount);

        // Punto 2: Validación de monto mínimo > $0 y límite superior
        if (isNaN(numericAmount) || numericAmount <= 0) {
            Alert.alert('Monto inválido', 'Por favor ingresa una cantidad válida mayor a $0.');
            return;
        }

        if (numericAmount > 100000) {
            Alert.alert('Límite excedido', 'El monto máximo por transacción es de $100,000 MXN.');
            return;
        }

        const user = auth.currentUser;
        if (!user) {
            Alert.alert('Error', 'No hay sesión activa.');
            return;
        }

        setLoading(true);

        try {
            // Detectar si la categoría seleccionada corresponde a un presupuesto fijo
            const isFixed = isExpense && selectedBudget !== null && selectedBudget.isFixedExpense === true;
            const targetBudgetId = isFixed && selectedBudget ? selectedBudget.id : null;

            // Punto 1: Validación estricta en Firestore antes de guardar (Opción B dinámica)
            if (isFixed && targetBudgetId) {
                const budgetRef = doc(db, 'budgets', targetBudgetId);
                const budgetSnap = await getDoc(budgetRef);
                if (!budgetSnap.exists()) {
                    Alert.alert('Error', 'El compromiso presupuestal seleccionado ya no existe.');
                    setLoading(false);
                    return;
                }

                const bData = budgetSnap.data();
                const freshLimit = Number(bData.limitAmount || 0);

                // Consulta en vivo a transacciones del mes en curso para asegurar que no se haya liquidado concurrentemente
                const qTxsCheck = query(
                    collection(db, 'transactions'),
                    where('userId', '==', user.uid),
                    where('monthYear', '==', currentMonthYear),
                    where('type', '==', 'expense'),
                    where('isFixedExpense', '==', true)
                );
                const snapTxsCheck = await getDocs(qTxsCheck);
                let freshSpentTxs = 0;
                snapTxsCheck.docs.forEach((d) => {
                    const data = d.data();
                    if (data.budgetId === targetBudgetId || data.category === category) {
                        freshSpentTxs += Number(data.amount || 0);
                    }
                });

                const remainingBalance = Math.max(0, freshLimit - freshSpentTxs);

                if (freshLimit > 0 && freshSpentTxs >= freshLimit) {
                    Alert.alert(
                        'Compromiso liquidado',
                        'Este compromiso ya fue liquidado en este mes calendario.'
                    );
                    setLoading(false);
                    return;
                }

                if (freshLimit > 0 && numericAmount > remainingBalance) {
                    Alert.alert(
                        'Monto excedido',
                        `El monto ingresado ($${numericAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}) supera el saldo pendiente de este compromiso ($${remainingBalance.toLocaleString('es-MX', { minimumFractionDigits: 2 })}).`
                    );
                    setLoading(false);
                    return;
                }
            }

            // Para gastos variables: leisure o buffer según elección. Para fijos: null. Para ingresos: targetBucket.
            const resolvedTargetBucket = isExpense
                ? (isFixed ? null : expenseTargetBucket)
                : targetBucket;

            const todayStr = getLocalDateString(new Date());

            await addDoc(collection(db, 'transactions'), {
                userId: user.uid,
                type: isExpense ? 'expense' : 'income',
                amount: numericAmount,
                description: description.trim() || (isExpense ? (isFixed ? `Gasto fijo: ${category}` : 'Gasto registrado') : 'Ingreso extra'),
                category,
                isFixedExpense: isFixed,
                budgetId: targetBudgetId,
                targetBucket: resolvedTargetBucket,
                isShared: false,
                sharedFundId: null,
                monthYear: currentMonthYear,
                date: todayStr,
                createdAt: serverTimestamp(),
            });

            Alert.alert('Guardado', `${isExpense ? 'Gasto' : 'Ingreso'} registrado con éxito.`);
            setAmount('');
            setDescription('');
            setSelectedBudget(null);
            setExpenseTargetBucket('leisure');

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
                                <Ionicons name="arrow-back" size={22} color={Theme.colors.textSecondary} />
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
                                                targetBucket === 'leisure' && styles.targetBtnActiveLeisure,
                                            ]}
                                            onPress={() => setTargetBucket('leisure')}
                                            activeOpacity={0.7}
                                        >
                                            <Text
                                                style={[
                                                    styles.targetBtnText,
                                                    targetBucket === 'leisure' && styles.targetBtnTextActiveLeisure,
                                                ]}
                                            >
                                                🍿 Ocio
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={[
                                                styles.targetBtn,
                                                targetBucket === 'buffer' && styles.targetBtnActiveBuffer,
                                            ]}
                                            onPress={() => setTargetBucket('buffer')}
                                            activeOpacity={0.7}
                                        >
                                            <Text
                                                style={[
                                                    styles.targetBtnText,
                                                    targetBucket === 'buffer' && styles.targetBtnTextActiveBuffer,
                                                ]}
                                            >
                                                🛡️ Colchón
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={[
                                                styles.targetBtn,
                                                targetBucket === 'savings' && styles.targetBtnActiveSavings,
                                            ]}
                                            onPress={() => setTargetBucket('savings')}
                                            activeOpacity={0.7}
                                        >
                                            <Text
                                                style={[
                                                    styles.targetBtnText,
                                                    targetBucket === 'savings' && styles.targetBtnTextActiveSavings,
                                                ]}
                                            >
                                                🐖 Ahorro
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}

                            {/* Selector de Origen: SOLO si es Gasto Diario / Variable (-) */}
                            {isExpense && (!selectedBudget || !selectedBudget.isFixedExpense) && (
                                <View style={styles.targetBucketContainer}>
                                    <Text style={styles.targetLabel}>Origen del gasto:</Text>
                                    <View style={styles.targetBucketRow}>
                                        <TouchableOpacity
                                            style={[
                                                styles.targetBtn,
                                                expenseTargetBucket === 'leisure' && styles.targetBtnActiveLeisure,
                                            ]}
                                            onPress={() => setExpenseTargetBucket('leisure')}
                                            activeOpacity={0.7}
                                        >
                                            <Text
                                                style={[
                                                    styles.targetBtnText,
                                                    expenseTargetBucket === 'leisure' && styles.targetBtnTextActiveLeisure,
                                                ]}
                                                numberOfLines={1}
                                            >
                                                🍿 Dinero Libre / Ocio
                                            </Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            style={[
                                                styles.targetBtn,
                                                expenseTargetBucket === 'buffer' && styles.targetBtnActiveBuffer,
                                            ]}
                                            onPress={() => setExpenseTargetBucket('buffer')}
                                            activeOpacity={0.7}
                                        >
                                            <Text
                                                style={[
                                                    styles.targetBtnText,
                                                    expenseTargetBucket === 'buffer' && styles.targetBtnTextActiveBuffer,
                                                ]}
                                                numberOfLines={1}
                                            >
                                                🛡️ Colchón de Imprevistos
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
                                    placeholderTextColor={Theme.colors.textMuted}
                                    keyboardType="decimal-pad"
                                    value={amount}
                                    onChangeText={handleAmountChange}
                                    autoFocus={true}
                                    selectionColor={Theme.colors.fixed}
                                />
                            </View>

                            {/* Indicador de compromiso fijo con saldo pendiente */}
                            {selectedBudget?.isFixedExpense && pendingFixedAmount !== null && (
                                <View style={styles.fixedLockHint}>
                                    <Ionicons name="lock-closed" size={12} color={Theme.colors.fixed} />
                                    <Text style={styles.fixedLockText}>
                                        Compromiso fijo · Saldo pendiente: ${pendingFixedAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
                                    </Text>
                                </View>
                            )}

                            {/* Concepto / En qué se gastó */}
                            <View style={styles.conceptBox}>
                                <Ionicons name="pencil-outline" size={16} color={Theme.colors.textSecondary} />
                                <TextInput
                                    style={styles.conceptInput}
                                    placeholder={
                                        isExpense
                                            ? '¿En qué se gastó? (Ej. Café, Tacos...)'
                                            : '¿De qué fue el ingreso? (Ej. Venta, Propina...)'
                                    }
                                    placeholderTextColor={Theme.colors.textMuted}
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
                                        color={isShared ? Theme.colors.fixed : Theme.colors.textMuted}
                                    />
                                    <Text style={styles.sharedHintText}>Fondo compartido</Text>
                                </View>
                                <Switch
                                    value={isShared}
                                    onValueChange={setIsShared}
                                    trackColor={{ false: Theme.colors.border, true: Theme.colors.fixed }}
                                    thumbColor={isShared ? Theme.colors.textPrimary : Theme.colors.textSecondary}
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
                                <ActivityIndicator color={Theme.colors.textPrimary} />
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
                            <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
                                <Text style={styles.modalTitle}>Selecciona una Categoría</Text>
                                <ScrollView
                                    style={styles.modalScrollView}
                                    showsVerticalScrollIndicator={false}
                                >
                                    {isExpense ? (
                                        <>
                                            <Text style={styles.modalSectionLabel}>Gastos Variables</Text>
                                            {CATEGORIAS_GASTO_VARIABLES.map((cat) => {
                                                const isSelected = selectedBudget === null && category === cat;
                                                return (
                                                    <TouchableOpacity
                                                        key={cat}
                                                        style={[
                                                            styles.categoryItem,
                                                            isSelected && styles.categoryItemActive,
                                                        ]}
                                                        onPress={() => {
                                                            setCategory(cat);
                                                            setSelectedBudget(null);
                                                            setModalCategoryVisible(false);
                                                        }}
                                                    >
                                                        <Text
                                                            style={[
                                                                styles.categoryItemText,
                                                                isSelected && styles.categoryItemTextActive,
                                                            ]}
                                                        >
                                                            {cat}
                                                        </Text>
                                                    </TouchableOpacity>
                                                );
                                            })}

                                            {budgets.filter((b) => b.isFixedExpense).length > 0 && (
                                                <>
                                                    <Text style={styles.modalSectionLabel}>Gastos Fijos Programados</Text>
                                                    {budgets
                                                        .filter((b) => b.isFixedExpense)
                                                        .map((b) => {
                                                            const spentThisMonth = Math.max(paidFixedMap[b.id] || 0, paidFixedMap[b.category] || 0);
                                                            const limitAmt = Number(b.limitAmount || 0);
                                                            const isPaid = spentThisMonth >= limitAmt && limitAmt > 0;
                                                            const pending = Math.max(0, limitAmt - spentThisMonth);
                                                            const isSelected = selectedBudget?.id === b.id;
                                                            const blockText = b.dueBlock === 'start'
                                                                ? '1-10 (Principio)'
                                                                : b.dueBlock === 'mid'
                                                                    ? '11-20 (Mediados)'
                                                                    : b.dueBlock === 'end'
                                                                        ? '21-31 (Fin)'
                                                                        : 'Mes';
                                                            return (
                                                                <TouchableOpacity
                                                                    key={b.id}
                                                                    disabled={isPaid || pending <= 0}
                                                                    style={[
                                                                        styles.categoryItem,
                                                                        isSelected && styles.categoryItemActive,
                                                                        (isPaid || pending <= 0) && styles.categoryItemPaid,
                                                                    ]}
                                                                    onPress={() => {
                                                                        if (isPaid || pending <= 0) return;
                                                                        setCategory(b.category);
                                                                        setSelectedBudget(b);
                                                                        // Autocompletar con saldo pendiente
                                                                        const pendingStr = pending > 0
                                                                            ? (pending % 1 === 0 ? pending.toString() : pending.toFixed(2))
                                                                            : '0';
                                                                        setAmount(pendingStr);
                                                                        setModalCategoryVisible(false);
                                                                    }}
                                                                >
                                                                    <View style={styles.fixedCategoryRow}>
                                                                        <View style={styles.fixedCategoryLeft}>
                                                                            <View style={styles.fixedCategoryHeader}>
                                                                                <Text
                                                                                    style={[
                                                                                        styles.categoryItemText,
                                                                                        styles.fixedCategoryTitleText,
                                                                                        isSelected && styles.categoryItemTextActive,
                                                                                        isPaid && styles.categoryItemTextPaid,
                                                                                    ]}
                                                                                    numberOfLines={1}
                                                                                >
                                                                                    {b.category}
                                                                                </Text>
                                                                                {isPaid && (
                                                                                    <View style={styles.paidBadge}>
                                                                                        <Text style={styles.paidBadgeText}>✓ Pagado este mes</Text>
                                                                                    </View>
                                                                                )}
                                                                            </View>
                                                                            <Text style={styles.fixedCategoryMeta}>
                                                                                Bloque: {blockText}
                                                                            </Text>
                                                                        </View>
                                                                        <Text
                                                                            style={[
                                                                                styles.fixedCategoryAmount,
                                                                                isPaid && styles.fixedCategoryAmountPaid,
                                                                            ]}
                                                                        >
                                                                            ${limitAmt.toLocaleString('es-MX', { minimumFractionDigits: 0 })}
                                                                        </Text>
                                                                    </View>
                                                                </TouchableOpacity>
                                                            );
                                                        })}
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <Text style={styles.modalSectionLabel}>Ingresos Extra</Text>
                                            {CATEGORIAS_INGRESO.map((cat) => {
                                                const isSelected = category === cat;
                                                return (
                                                    <TouchableOpacity
                                                        key={cat}
                                                        style={[
                                                            styles.categoryItem,
                                                            isSelected && styles.categoryItemActive,
                                                        ]}
                                                        onPress={() => {
                                                            setCategory(cat);
                                                            setSelectedBudget(null);
                                                            setModalCategoryVisible(false);
                                                        }}
                                                    >
                                                        <Text
                                                            style={[
                                                                styles.categoryItemText,
                                                                isSelected && styles.categoryItemTextActive,
                                                            ]}
                                                        >
                                                            {cat}
                                                        </Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </>
                                    )}
                                </ScrollView>
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
        backgroundColor: Theme.colors.background,
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
        backgroundColor: Theme.colors.cardSurface,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: Theme.colors.border,
    },
    screenTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
        textAlign: 'center',
    },
    card: {
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.xl,
        borderWidth: 1.5,
        borderColor: Theme.colors.border,
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
        backgroundColor: Theme.colors.background,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
    },
    selectorExpense: {
        borderColor: 'rgba(248, 113, 113, 0.6)',
        backgroundColor: 'rgba(248, 113, 113, 0.1)',
    },
    selectorIncome: {
        borderColor: 'rgba(52, 211, 153, 0.6)',
        backgroundColor: 'rgba(52, 211, 153, 0.1)',
    },
    selectorText: {
        color: Theme.colors.textPrimary,
        fontSize: 13,
        fontWeight: '700',
    },
    targetBucketContainer: {
        gap: 6,
        backgroundColor: Theme.colors.background,
        padding: 10,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: Theme.colors.border,
    },
    targetLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: Theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    targetBucketRow: {
        flexDirection: 'row',
        gap: 8,
    },
    targetBtn: {
        flex: 1,
        backgroundColor: Theme.colors.cardSurface,
        paddingVertical: 8,
        borderRadius: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: Theme.colors.border,
    },
    targetBtnActive: {
        borderColor: Theme.colors.statusSuccess,
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
    },
    targetBtnActiveLeisure: {
        borderColor: Theme.colors.leisure,
        backgroundColor: 'rgba(245, 158, 11, 0.15)',
    },
    targetBtnTextActiveLeisure: {
        color: Theme.colors.leisure,
        fontWeight: '700',
    },
    targetBtnActiveBuffer: {
        borderColor: Theme.colors.buffer,
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
    },
    targetBtnTextActiveBuffer: {
        color: Theme.colors.buffer,
        fontWeight: '700',
    },
    targetBtnActiveSavings: {
        borderColor: Theme.colors.savings,
        backgroundColor: 'rgba(168, 85, 247, 0.15)',
    },
    targetBtnTextActiveSavings: {
        color: Theme.colors.savings,
        fontWeight: '700',
    },
    targetBtnText: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.textSecondary,
    },
    targetBtnTextActive: {
        color: Theme.colors.statusSuccess,
    },
    amountDisplayRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderRadius: Theme.radius.lg,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    amountPrefix: {
        fontSize: 36,
        fontWeight: '800',
        color: Theme.colors.textSecondary,
        marginRight: 4,
    },
    amountInput: {
        fontSize: 44,
        fontWeight: '900',
        minWidth: 120,
        textAlign: 'left',
    },
    amountExpense: {
        color: Theme.colors.textPrimary,
    },
    amountIncome: {
        color: Theme.colors.income,
    },
    conceptBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderRadius: Theme.radius.md,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        gap: 10,
    },
    conceptInput: {
        flex: 1,
        color: Theme.colors.textPrimary,
        fontSize: 15,
    },
    sharedRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 6,
        borderTopWidth: 1,
        borderTopColor: Theme.colors.borderSubtle,
    },
    sharedIcons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    sharedHintText: {
        fontSize: 12,
        color: Theme.colors.textMuted,
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
        backgroundColor: Theme.colors.statusDanger,
    },
    saveButtonIncome: {
        backgroundColor: Theme.colors.statusSuccess,
    },
    saveButtonText: {
        color: Theme.colors.textPrimary,
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
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.xl,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        padding: 18,
        gap: 8,
    },
    modalTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
        marginBottom: 8,
        textAlign: 'center',
    },
    categoryItem: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        backgroundColor: Theme.colors.background,
    },
    categoryItemActive: {
        borderColor: Theme.colors.fixed,
        borderWidth: 1,
    },
    categoryItemPaid: {
        opacity: 0.55,
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderColor: Theme.colors.borderSubtle,
        borderWidth: 1,
    },
    categoryItemText: {
        color: Theme.colors.textSecondary,
        fontSize: 14,
        fontWeight: '600',
    },
    categoryItemTextActive: {
        color: Theme.colors.fixed,
        fontWeight: '800',
    },
    categoryItemTextPaid: {
        color: Theme.colors.textMuted,
        textDecorationLine: 'line-through',
    },
    modalScrollView: {
        maxHeight: 380,
        width: '100%',
    },
    modalSectionLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.fixed,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginTop: 10,
        marginBottom: 6,
    },
    fixedCategoryRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    fixedCategoryLeft: {
        flex: 1,
        marginRight: 8,
    },
    fixedCategoryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    fixedCategoryTitleText: {
        flexShrink: 1,
    },
    paidBadge: {
        flexShrink: 0,
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        borderColor: 'rgba(16, 185, 129, 0.4)',
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    paidBadgeText: {
        color: Theme.colors.statusSuccess,
        fontSize: 11,
        fontWeight: '700',
    },
    fixedCategoryMeta: {
        fontSize: 11,
        color: Theme.colors.textMuted,
        marginTop: 2,
    },
    fixedCategoryAmount: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.fixed,
    },
    fixedCategoryAmountPaid: {
        color: Theme.colors.textMuted,
    },
    fixedLockHint: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        borderColor: 'rgba(56, 189, 248, 0.3)',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
        alignSelf: 'center',
        marginTop: -4,
        marginBottom: 4,
    },
    fixedLockText: {
        color: Theme.colors.fixed,
        fontSize: 12,
        fontWeight: '700',
    },
});