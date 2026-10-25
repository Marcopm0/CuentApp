import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation } from 'expo-router';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
    writeBatch,
} from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    BackHandler,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Theme } from '@/constants/theme';
import { auth, db } from '@/services/firebase';
import { Budget, UserProfile } from '@/types/database';
import { getLocalDateString } from '@/utils/dates';
import { getPeriodInfo, PayFrequency } from '@/utils/periods';

interface InitialFormState {
    payFrequency: PayFrequency;
    payDayOfWeek: number;
    amountPerPeriod: string;
    savingsPerPeriod: string;
    leisurePerPeriod: string;
}

interface FixedExpenseItem {
    id: string;
    concept: string;
    amount: number;
    dueBlock: '1-10' | '11-20' | '21-end' | string;
    createdAt?: any;
    isShared?: boolean;
}

const DIAS_SEMANA = [
    { label: 'Lunes', value: 1 },
    { label: 'Jueves', value: 4 },
    { label: 'Viernes', value: 5 },
    { label: 'Sábado', value: 6 },
];

export default function ConfigScreen() {
    const navigation = useNavigation();
    const isSavedRef = useRef<boolean>(false);

    const [loading, setLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);

    // Estados del formulario
    const [payFrequency, setPayFrequency] = useState<PayFrequency>('biweekly');
    const [payDayOfWeek, setPayDayOfWeek] = useState<number>(5);
    const [amountPerPeriod, setAmountPerPeriod] = useState<string>('');
    const [savingsPerPeriod, setSavingsPerPeriod] = useState<string>('');
    const [leisurePerPeriod, setLeisurePerPeriod] = useState<string>('');

    // Estados de Gastos Fijos (Fase 2)
    const [fixedExpenses, setFixedExpenses] = useState<FixedExpenseItem[]>([]);
    const [modalVisible, setModalVisible] = useState<boolean>(false);
    const [newConcept, setNewConcept] = useState<string>('');
    const [newAmount, setNewAmount] = useState<string>('');
    const [newDueBlock, setNewDueBlock] = useState<'1-10' | '11-20' | '21-end'>('1-10');
    const [isSubmittingFixed, setIsSubmittingFixed] = useState<boolean>(false);

    // Estado inicial para comparar cambios
    const [initialState, setInitialState] = useState<InitialFormState | null>(null);

    // Cálculo dinámico del total mensual de fijos (Reactividad inmediata sobre fuente única de verdad)
    const totalFixedMonthly = useMemo(() => {
        return fixedExpenses.reduce((acc, f) => acc + (Number(f.amount) || 0), 0);
    }, [fixedExpenses]);

    // 1. Cargar datos del usuario autenticado con aislamiento estricto
    useEffect(() => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            router.replace('/(auth)/login');
            return;
        }

        const fetchFinancialData = async () => {
            try {
                // A. Leer perfil de usuario
                const userDocRef = doc(db, 'users', currentUser.uid);
                const userSnap = await getDoc(userDocRef);

                let freq: PayFrequency = 'biweekly';
                let dayOfWeek = 5;
                let periodAmount = 0;
                let savingsMonthly = 0;
                let leisureMonthly = 0;
                let userData: (UserProfile & { leisureBudget?: number; habitualFixedExpenses?: any[] }) | null = null;

                if (userSnap.exists()) {
                    userData = userSnap.data() as UserProfile & { leisureBudget?: number; habitualFixedExpenses?: any[] };
                    freq = (userData.payFrequency as PayFrequency) || 'biweekly';
                    dayOfWeek = typeof userData.payDayOfWeek === 'number' ? userData.payDayOfWeek : 5;
                    savingsMonthly = Number(userData.savingsTarget) || 0;
                    leisureMonthly = Number(userData.leisureBudget) || 0;

                    const divisor = freq === 'weekly' ? 4 : freq === 'biweekly' ? 2 : 1;
                    periodAmount = userData.amountPerPeriod
                        ? Number(userData.amountPerPeriod)
                        : (Number(userData.monthlyIncome) || 0) / divisor;
                }

                // B. Leer presupuestos permanentes (Ocio)
                const budgetsQuery = query(
                    collection(db, 'budgets'),
                    where('userId', '==', currentUser.uid)
                );
                const budgetsSnap = await getDocs(budgetsQuery);
                const budgetsList: Budget[] = budgetsSnap.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as Omit<Budget, 'id'>),
                }));

                const leisureBudgetDoc = budgetsList.find((b) => !b.isFixedExpense);
                if (leisureBudgetDoc && leisureBudgetDoc.limitAmount) {
                    leisureMonthly = Number(leisureBudgetDoc.limitAmount) || 0;
                }

                // C. Migración / Fallback automático a users/{uid}/fixedExpenses
                // Si la subcolección está vacía, migra automáticamente de habitualFixedExpenses o budgets
                const fixedSnap = await getDocs(collection(db, 'users', currentUser.uid, 'fixedExpenses'));
                if (fixedSnap.empty) {
                    const batch = writeBatch(db);
                    let count = 0;
                    const habitual = userData?.habitualFixedExpenses;
                    if (Array.isArray(habitual) && habitual.length > 0) {
                        habitual.forEach((item: any) => {
                            if (item && item.name && Number(item.defaultAmount) > 0) {
                                const newDocRef = doc(collection(db, 'users', currentUser.uid, 'fixedExpenses'));
                                let block: '1-10' | '11-20' | '21-end' = '11-20';
                                if (item.dueBlock === 'start' || item.dueBlock === '1-10') block = '1-10';
                                else if (item.dueBlock === 'end' || item.dueBlock === '21-end') block = '21-end';
                                else block = '11-20';

                                batch.set(newDocRef, {
                                    concept: item.name,
                                    amount: Number(item.defaultAmount) || 0,
                                    dueBlock: block,
                                    createdAt: serverTimestamp(),
                                    isShared: false,
                                });
                                count++;
                            }
                        });
                    } else if (budgetsList.filter((b) => b.isFixedExpense).length > 0) {
                        budgetsList.filter((b) => b.isFixedExpense).forEach((b) => {
                            if (Number(b.limitAmount) > 0) {
                                const newDocRef = doc(collection(db, 'users', currentUser.uid, 'fixedExpenses'));
                                let block: '1-10' | '11-20' | '21-end' = '11-20';
                                const rawBlock = b.dueBlock as string | undefined;
                                if (rawBlock === 'start' || rawBlock === '1-10') block = '1-10';
                                else if (rawBlock === 'end' || rawBlock === '21-end') block = '21-end';
                                else block = '11-20';

                                batch.set(newDocRef, {
                                    concept: b.category || b.name,
                                    amount: Number(b.limitAmount) || 0,
                                    dueBlock: block,
                                    createdAt: serverTimestamp(),
                                    isShared: false,
                                });
                                count++;
                            }
                        });
                    }
                    if (count > 0) {
                        await batch.commit();
                    }
                }

                const divisor = freq === 'weekly' ? 4 : freq === 'biweekly' ? 2 : 1;
                const savingsPeriod = savingsMonthly / divisor;
                const leisurePeriod = leisureMonthly / divisor;

                const amountStr = periodAmount > 0
                    ? (periodAmount % 1 === 0 ? periodAmount.toString() : periodAmount.toFixed(2))
                    : '';
                const savingsStr = savingsPeriod > 0
                    ? (savingsPeriod % 1 === 0 ? savingsPeriod.toString() : savingsPeriod.toFixed(2))
                    : '';
                const leisureStr = leisurePeriod > 0
                    ? (leisurePeriod % 1 === 0 ? leisurePeriod.toString() : leisurePeriod.toFixed(2))
                    : '';

                setPayFrequency(freq);
                setPayDayOfWeek(dayOfWeek);
                setAmountPerPeriod(amountStr);
                setSavingsPerPeriod(savingsStr);
                setLeisurePerPeriod(leisureStr);

                setInitialState({
                    payFrequency: freq,
                    payDayOfWeek: dayOfWeek,
                    amountPerPeriod: amountStr,
                    savingsPerPeriod: savingsStr,
                    leisurePerPeriod: leisureStr,
                });
            } catch (error) {
                console.error('Error al cargar ajustes financieros:', error);
                Alert.alert(
                    'Error de conexión',
                    'No se pudieron cargar tus datos financieros. Por favor intenta de nuevo.'
                );
            } finally {
                setLoading(false);
            }
        };

        fetchFinancialData();

        // 1.1 Suscripción reactiva en tiempo real a la subcolección fixedExpenses (Fase 2)
        const fixedExpensesQuery = query(
            collection(db, 'users', currentUser.uid, 'fixedExpenses'),
            orderBy('createdAt', 'desc')
        );

        const unsubscribeFixed = onSnapshot(
            fixedExpensesQuery,
            (snapshot) => {
                const items: FixedExpenseItem[] = snapshot.docs.map((docSnap) => {
                    const data = docSnap.data();
                    return {
                        id: docSnap.id,
                        concept: data.concept || data.name || 'Gasto Fijo',
                        amount: Number(data.amount) || 0,
                        dueBlock: data.dueBlock || '1-10',
                        createdAt: data.createdAt,
                        isShared: data.isShared || false,
                    };
                });
                setFixedExpenses(items);
            },
            (error) => {
                console.error('Error al suscribir subcolección fixedExpenses:', error);
            }
        );

        return () => {
            unsubscribeFixed();
        };
    }, []);

    // 2. Cálculos reactivos y dinámicos (Simulador de Colchón en Vivo)
    const currentDivisor = payFrequency === 'weekly' ? 4 : payFrequency === 'biweekly' ? 2 : 1;
    const numericAmount = parseFloat(amountPerPeriod) || 0;
    const numericSavings = parseFloat(savingsPerPeriod) || 0;
    const numericLeisure = parseFloat(leisurePerPeriod) || 0;
    const fixedPerPeriod = totalFixedMonthly / currentDivisor;

    const colchonPeriodo = numericAmount - (fixedPerPeriod + numericSavings + numericLeisure);
    const isDeficit = colchonPeriodo < 0;

    // Sufijos y labels dinámicos según periodicidad
    const periodSuffix =
        payFrequency === 'weekly' ? 'por semana' : payFrequency === 'biweekly' ? 'por quincena' : 'al mes';
    const incomeLabel =
        payFrequency === 'weekly' ? 'Ingreso neto por semana' : payFrequency === 'biweekly' ? 'Ingreso neto por quincena' : 'Ingreso neto mensual';
    const savingsLabel =
        payFrequency === 'weekly' ? 'Meta de ahorro por semana' : payFrequency === 'biweekly' ? 'Meta de ahorro por quincena' : 'Meta de ahorro mensual';
    const leisureLabel =
        payFrequency === 'weekly' ? 'Presupuesto de ocio por semana' : payFrequency === 'biweekly' ? 'Presupuesto de ocio por quincena' : 'Presupuesto de ocio mensual';

    // Detección de cambios reales en el formulario
    const hasChanges = useMemo(() => {
        if (!initialState) return false;
        return (
            payFrequency !== initialState.payFrequency ||
            payDayOfWeek !== initialState.payDayOfWeek ||
            amountPerPeriod !== initialState.amountPerPeriod ||
            savingsPerPeriod !== initialState.savingsPerPeriod ||
            leisurePerPeriod !== initialState.leisurePerPeriod
        );
    }, [initialState, payFrequency, payDayOfWeek, amountPerPeriod, savingsPerPeriod, leisurePerPeriod]);

    const hasUnsavedChanges = hasChanges;

    // Intercepción controlada de salida con cambios sin confirmar
    const handleBackPress = () => {
        if (hasUnsavedChanges && !isSavedRef.current) {
            Alert.alert(
                'Descartar cambios',
                'Tienes ajustes sin guardar. ¿Deseas salir y descartar las modificaciones?',
                [
                    { text: 'Seguir editando', style: 'cancel' },
                    {
                        text: 'Descartar',
                        style: 'destructive',
                        onPress: () => {
                            isSavedRef.current = true;
                            if (initialState) {
                                setPayFrequency(initialState.payFrequency);
                                setPayDayOfWeek(initialState.payDayOfWeek);
                                setAmountPerPeriod(initialState.amountPerPeriod);
                                setSavingsPerPeriod(initialState.savingsPerPeriod);
                                setLeisurePerPeriod(initialState.leisurePerPeriod);
                            }
                            router.back();
                        },
                    },
                ]
            );
        } else {
            router.back();
        }
    };

    // Intercepción de gestos de navegación nativos (swipe back en iOS o navegación de React Navigation)
    useEffect(() => {
        const unsubscribe = navigation.addListener('beforeRemove', (e) => {
            if (!hasUnsavedChanges || isSavedRef.current) {
                return;
            }

            e.preventDefault();

            Alert.alert(
                'Descartar cambios',
                'Tienes ajustes sin guardar. ¿Deseas salir y descartar las modificaciones?',
                [
                    { text: 'Seguir editando', style: 'cancel' },
                    {
                        text: 'Descartar',
                        style: 'destructive',
                        onPress: () => {
                            isSavedRef.current = true;
                            if (initialState) {
                                setPayFrequency(initialState.payFrequency);
                                setPayDayOfWeek(initialState.payDayOfWeek);
                                setAmountPerPeriod(initialState.amountPerPeriod);
                                setSavingsPerPeriod(initialState.savingsPerPeriod);
                                setLeisurePerPeriod(initialState.leisurePerPeriod);
                            }
                            navigation.dispatch(e.data.action);
                        },
                    },
                ]
            );
        });

        return unsubscribe;
    }, [navigation, hasUnsavedChanges, initialState]);

    // Intercepción de botón físico de retroceso en Android
    useEffect(() => {
        const onBackPress = () => {
            if (hasUnsavedChanges && !isSavedRef.current) {
                handleBackPress();
                return true;
            }
            return false;
        };

        const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
        return () => backHandler.remove();
    }, [hasUnsavedChanges, initialState]);

    // Limpieza de banderas al desmontar
    useEffect(() => {
        return () => {
            isSavedRef.current = false;
        };
    }, []);

    // Sanitizador de entrada numérica (solo dígitos y un punto decimal, máx 2 decimales)
    const handleNumberInput = (text: string, setter: (val: string) => void) => {
        const cleaned = text.replace(/[^0-9.]/g, '');
        const parts = cleaned.split('.');
        if (parts.length > 2) return;
        if (parts[1] && parts[1].length > 2) {
            setter(`${parts[0]}.${parts[1].slice(0, 2)}`);
            return;
        }
        setter(cleaned);
    };

    // Helper para formatear bloque de vencimiento
    const getDueBlockLabel = (block?: string) => {
        switch (block) {
            case '1-10':
            case 'start':
                return 'Días 1-10';
            case '11-20':
            case 'mid':
                return 'Días 11-20';
            case '21-end':
            case 'end':
                return 'Días 21-Fin';
            default:
                return 'Días 1-10';
        }
    };

    // Flujo de eliminación de un gasto fijo (Fase 2)
    const handleDeleteFixedExpense = (item: FixedExpenseItem) => {
        const currentUser = auth.currentUser;
        if (!currentUser) return;

        Alert.alert(
            '¿Eliminar gasto fijo?',
            `¿Seguro que deseas eliminar "${item.concept}"? Esto actualizará tu presupuesto del periodo.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteDoc(doc(db, 'users', currentUser.uid, 'fixedExpenses', item.id));
                        } catch (error) {
                            console.error('Error al eliminar gasto fijo:', error);
                            Alert.alert('Error', 'No se pudo eliminar el gasto fijo.');
                        }
                    },
                },
            ]
        );
    };

    // Flujo para agregar un nuevo gasto fijo (Fase 2)
    const handleAddFixedExpense = async () => {
        const currentUser = auth.currentUser;
        if (!currentUser) return;

        if (!newConcept.trim()) {
            Alert.alert('Concepto requerido', 'Por favor ingresa el nombre o concepto del gasto fijo.');
            return;
        }

        const numericVal = parseFloat(newAmount);
        if (isNaN(numericVal) || numericVal <= 0) {
            Alert.alert('Monto inválido', 'Por favor ingresa un monto mensual mayor a $0.');
            return;
        }

        setIsSubmittingFixed(true);
        try {
            await addDoc(collection(db, 'users', currentUser.uid, 'fixedExpenses'), {
                concept: newConcept.trim(),
                amount: numericVal,
                dueBlock: newDueBlock,
                createdAt: serverTimestamp(),
                isShared: false,
            });

            setNewConcept('');
            setNewAmount('');
            setNewDueBlock('1-10');
            setModalVisible(false);
        } catch (error) {
            console.error('Error al agregar gasto fijo:', error);
            Alert.alert('Error', 'No se pudo registrar el gasto fijo. Intenta de nuevo.');
        } finally {
            setIsSubmittingFixed(false);
        }
    };

    // 3. Guardado con Normalización Idempotente en Firestore
    const handleSave = async () => {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            Alert.alert('Error', 'No hay sesión de usuario activa.');
            return;
        }

        if (numericAmount <= 0) {
            Alert.alert('Monto requerido', 'Por favor ingresa un ingreso válido mayor a $0.');
            return;
        }

        if (isDeficit) {
            Alert.alert(
                'Presupuesto deficitario',
                `Tus compromisos fijos, ahorro y ocio superan tu ingreso disponible ${periodSuffix} por $${Math.abs(colchonPeriodo).toFixed(2)} MXN. Ajusta tus bolsas antes de guardar.`
            );
            return;
        }

        setIsSaving(true);
        try {
            // Normalizar a escala mensual para Firestore (semanal * 4, quincenal * 2, mensual * 1)
            const normalizedMonthlyIncome = numericAmount * currentDivisor;
            const normalizedMonthlySavings = numericSavings * currentDivisor;
            const normalizedMonthlyLeisure = numericLeisure * currentDivisor;

            const batch = writeBatch(db);

            // A. Actualizar documento users/{uid}
            const userRef = doc(db, 'users', currentUser.uid);
            batch.update(userRef, {
                payFrequency,
                payDayOfWeek: payFrequency === 'weekly' ? payDayOfWeek : 5,
                amountPerPeriod: numericAmount,
                monthlyIncome: normalizedMonthlyIncome,
                savingsTarget: normalizedMonthlySavings,
                leisureBudget: normalizedMonthlyLeisure,
                updatedAt: serverTimestamp(),
            });

            // B. Actualizar presupuesto permanente de ocio en colección budgets
            const leisureDocId = `${currentUser.uid}_ocio`;
            const leisureRef = doc(db, 'budgets', leisureDocId);
            batch.set(
                leisureRef,
                {
                    id: leisureDocId,
                    userId: currentUser.uid,
                    name: 'Ocio y Deseos',
                    category: 'Ocio y Deseos',
                    limitAmount: normalizedMonthlyLeisure,
                    isFixedExpense: false,
                    updatedAt: serverTimestamp(),
                },
                { merge: true }
            );

            // C. Reconciliación atómica del Ahorro Base del ciclo activo
            const periodInfo = getPeriodInfo(payFrequency, payDayOfWeek);
            const ahorroBaseDocId = `${currentUser.uid}_ahorro_base_${periodInfo.periodKey}`;
            const ahorroBaseRef = doc(db, 'transactions', ahorroBaseDocId);

            // Verificar si el ciclo en curso ya fue cobrado
            const sueldoQuery = query(
                collection(db, 'transactions'),
                where('userId', '==', currentUser.uid),
                where('periodKey', '==', periodInfo.periodKey),
                where('category', '==', '💵 Sueldo')
            );
            const sueldoSnap = await getDocs(sueldoQuery);
            const yaCobrado = !sueldoSnap.empty;

            const ahorroBaseSnap = await getDoc(ahorroBaseRef);

            if (yaCobrado || ahorroBaseSnap.exists()) {
                if (ahorroBaseSnap.exists()) {
                    batch.update(ahorroBaseRef, {
                        amount: numericSavings,
                        updatedAt: serverTimestamp(),
                    });
                } else if (numericSavings > 0) {
                    const todayStr = getLocalDateString(new Date());
                    const now = new Date();
                    const currentMonthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                    batch.set(ahorroBaseRef, {
                        id: ahorroBaseDocId,
                        userId: currentUser.uid,
                        type: 'income',
                        amount: numericSavings,
                        category: '🎯 Ahorro Base',
                        description: 'Aporte base presupuestado al ahorro',
                        targetBucket: 'savings',
                        periodKey: periodInfo.periodKey,
                        monthYear: currentMonthYear,
                        date: todayStr,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                        isShared: false,
                        sharedFundId: null,
                    });
                }
            }

            await batch.commit();

            isSavedRef.current = true;
            Alert.alert(
                'Ajustes guardados',
                'Tus parámetros de nómina y arquitectura de bolsas han sido actualizados con éxito.',
                [{ text: 'Aceptar', onPress: () => router.back() }]
            );
        } catch (error) {
            console.error('Error al guardar ajustes financieros:', error);
            Alert.alert(
                'Error al guardar',
                'No se pudieron guardar los ajustes. Verifica tu conexión e intenta de nuevo.'
            );
        } finally {
            setIsSaving(false);
        }
    };

    if (loading) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
                <ActivityIndicator size="large" color={Theme.colors.borderFocus} />
                <Text style={styles.loadingText}>Cargando configuración financiera...</Text>
            </SafeAreaView>
        );
    }

    const isButtonDisabled = !hasChanges || isDeficit || numericAmount <= 0 || isSaving;

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
            <KeyboardAvoidingView
                style={styles.container}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                {/* Header de Navegación */}
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={handleBackPress}
                        activeOpacity={0.7}
                        accessibilityLabel="Volver atrás"
                    >
                        <Ionicons name="arrow-back" size={22} color={Theme.colors.textPrimary} />
                    </TouchableOpacity>
                    <View style={styles.headerTitleContainer}>
                        <Text style={styles.headerTitle}>Ajustes Financieros</Text>
                        <Text style={styles.headerSubtitle}>Nómina, bolsas y arquitectura de capital</Text>
                    </View>
                </View>

                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* SECCIÓN 1: PERIODICIDAD DE NÓMINA */}
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                                <Ionicons name="calendar-outline" size={18} color={Theme.colors.borderFocus} />
                            </View>
                            <View>
                                <Text style={styles.cardTitle}>Periodicidad de Nómina</Text>
                                <Text style={styles.cardSubtitle}>¿Con qué frecuencia recibes tu sueldo?</Text>
                            </View>
                        </View>

                        <View style={styles.freqRow}>
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

                        {/* Selector de día para cobro semanal */}
                        {payFrequency === 'weekly' && (
                            <View style={styles.daySelectorContainer}>
                                <Text style={styles.inputLabel}>Día de cobro en la semana</Text>
                                <View style={styles.dayRow}>
                                    {DIAS_SEMANA.map((d) => (
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
                    </View>

                    {/* SECCIÓN 2: INGRESO POR CORTE */}
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(52, 211, 153, 0.15)' }]}>
                                <Ionicons name="cash-outline" size={18} color={Theme.colors.income} />
                            </View>
                            <View>
                                <Text style={styles.cardTitle}>Ingreso por Periodo</Text>
                                <Text style={styles.cardSubtitle}>Monto libre que depositan en cada corte</Text>
                            </View>
                        </View>

                        <View style={styles.inputBlock}>
                            <Text style={styles.inputLabel}>{incomeLabel}</Text>
                            <View style={styles.amountInputContainer}>
                                <Text style={styles.currencySymbol}>$</Text>
                                <TextInput
                                    style={styles.amountInput}
                                    placeholder="0.00"
                                    placeholderTextColor={Theme.colors.textMuted}
                                    keyboardType="numeric"
                                    value={amountPerPeriod}
                                    onChangeText={(val) => handleNumberInput(val, setAmountPerPeriod)}
                                />
                                <Text style={styles.currencyCode}>MXN</Text>
                            </View>
                        </View>

                        {numericAmount > 0 && payFrequency !== 'monthly' && (
                            <View style={styles.equivalentNote}>
                                <Ionicons name="information-circle-outline" size={15} color={Theme.colors.borderFocus} />
                                <Text style={styles.equivalentNoteText}>
                                    Equivale a{' '}
                                    <Text style={styles.highlightText}>
                                        ${(numericAmount * currentDivisor).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
                                    </Text>{' '}
                                    al mes de ingreso base.
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* SECCIÓN 3: BOLSAS Y METAS POR CORTE */}
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(168, 85, 247, 0.15)' }]}>
                                <Ionicons name="pie-chart-outline" size={18} color={Theme.colors.savings} />
                            </View>
                            <View>
                                <Text style={styles.cardTitle}>Distribución de Bolsas</Text>
                                <Text style={styles.cardSubtitle}>Cuotas asignadas en cada corte de nómina</Text>
                            </View>
                        </View>

                        {/* Compromisos fijos informativos */}
                        <View style={styles.infoRow}>
                            <View style={styles.infoLeft}>
                                <Text style={styles.infoTitle}>🏠 Compromisos Fijos Proporcionales</Text>
                                <Text style={styles.infoSub}>
                                    Apartado calculado de fijos mensuales (${totalFixedMonthly.toLocaleString('es-MX', { minimumFractionDigits: 2 })})
                                </Text>
                            </View>
                            <Text style={styles.infoAmount}>
                                ${fixedPerPeriod.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                            </Text>
                        </View>

                        <View style={styles.cardDivider} />

                        {/* Meta de Ahorro */}
                        <View style={styles.inputBlock}>
                            <Text style={styles.inputLabel}>{savingsLabel}</Text>
                            <View style={styles.amountInputContainer}>
                                <Text style={styles.currencySymbol}>$</Text>
                                <TextInput
                                    style={styles.amountInput}
                                    placeholder="0.00"
                                    placeholderTextColor={Theme.colors.textMuted}
                                    keyboardType="numeric"
                                    value={savingsPerPeriod}
                                    onChangeText={(val) => handleNumberInput(val, setSavingsPerPeriod)}
                                />
                                <Text style={styles.currencyCode}>MXN</Text>
                            </View>
                        </View>

                        {/* Presupuesto de Ocio */}
                        <View style={styles.inputBlock}>
                            <Text style={styles.inputLabel}>{leisureLabel}</Text>
                            <View style={styles.amountInputContainer}>
                                <Text style={styles.currencySymbol}>$</Text>
                                <TextInput
                                    style={styles.amountInput}
                                    placeholder="0.00"
                                    placeholderTextColor={Theme.colors.textMuted}
                                    keyboardType="numeric"
                                    value={leisurePerPeriod}
                                    onChangeText={(val) => handleNumberInput(val, setLeisurePerPeriod)}
                                />
                                <Text style={styles.currencyCode}>MXN</Text>
                            </View>
                        </View>
                    </View>

                    {/* SECCIÓN 4: GASTOS Y SUSCRIPCIONES FIJAS (FASE 2) */}
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                                <Ionicons name="receipt-outline" size={18} color={Theme.colors.fixed} />
                            </View>
                            <View style={styles.cardTitleContainer}>
                                <Text style={styles.cardTitle}>Gastos y Suscripciones Fijas</Text>
                                <Text style={styles.cardSubtitle}>Servicios recurrentes que impactan tu corte</Text>
                            </View>
                            {totalFixedMonthly > 0 && (
                                <View style={styles.totalFixedBadge}>
                                    <Text style={styles.totalFixedBadgeText}>
                                        ${totalFixedMonthly.toLocaleString('es-MX', { minimumFractionDigits: 2 })}/mes
                                    </Text>
                                </View>
                            )}
                        </View>

                        {/* Listado de Gastos Fijos */}
                        {fixedExpenses.length === 0 ? (
                            <View style={styles.emptyFixedContainer}>
                                <Ionicons name="receipt-outline" size={30} color={Theme.colors.textMuted} />
                                <Text style={styles.emptyFixedTitle}>Sin gastos fijos registrados</Text>
                                <Text style={styles.emptyFixedSubtitle}>
                                    Agrega tus compromisos mensuales recurrentes (renta, internet, suscripciones) para sincronizar tu disponible real.
                                </Text>
                            </View>
                        ) : (
                            <View style={styles.fixedListContainer}>
                                {fixedExpenses.map((item) => (
                                    <View key={item.id} style={styles.fixedItemCard}>
                                        <View style={styles.fixedItemLeft}>
                                            <Text style={styles.fixedItemConcept} numberOfLines={1}>
                                                {item.concept}
                                            </Text>
                                            <View style={styles.fixedItemMetaRow}>
                                                <Text style={styles.fixedItemAmount}>
                                                    ${Number(item.amount).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN al mes
                                                </Text>
                                                <View style={styles.dueBlockBadge}>
                                                    <Text style={styles.dueBlockBadgeText}>
                                                        {getDueBlockLabel(item.dueBlock)}
                                                    </Text>
                                                </View>
                                            </View>
                                        </View>
                                        <TouchableOpacity
                                            style={styles.deleteFixedButton}
                                            onPress={() => handleDeleteFixedExpense(item)}
                                            activeOpacity={0.7}
                                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                            accessibilityLabel={`Eliminar ${item.concept}`}
                                        >
                                            <Ionicons name="trash-outline" size={16} color={Theme.colors.statusDanger} />
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </View>
                        )}

                        {/* Botón Destacado + Agregar Gasto Fijo */}
                        <TouchableOpacity
                            style={styles.addFixedButton}
                            onPress={() => {
                                setNewConcept('');
                                setNewAmount('');
                                setNewDueBlock('1-10');
                                setModalVisible(true);
                            }}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="add-circle-outline" size={18} color={Theme.colors.borderFocus} />
                            <Text style={styles.addFixedButtonText}>+ Agregar Gasto Fijo</Text>
                        </TouchableOpacity>
                    </View>

                    {/* SECCIÓN 5: SIMULADOR DE COLCHÓN EN VIVO */}
                    <View
                        style={[
                            styles.bufferCard,
                            isDeficit ? styles.bufferCardDeficit : styles.bufferCardHealthy,
                        ]}
                    >
                        <View style={styles.bufferHeader}>
                            <View
                                style={[
                                    styles.iconCircle,
                                    { backgroundColor: isDeficit ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)' },
                                ]}
                            >
                                <Ionicons
                                    name={isDeficit ? 'alert-circle' : 'shield-checkmark-outline'}
                                    size={20}
                                    color={isDeficit ? Theme.colors.statusDanger : Theme.colors.buffer}
                                />
                            </View>
                            <View style={styles.bufferTitleGroup}>
                                <Text style={styles.bufferCardTitle}>
                                    {isDeficit ? 'Presupuesto con Déficit' : 'Colchón Proyectado'}
                                </Text>
                                <Text style={styles.bufferCardSub}>
                                    Saldo restante libre {periodSuffix}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.bufferAmountRow}>
                            <Text
                                style={[
                                    styles.bufferAmountText,
                                    { color: isDeficit ? Theme.colors.statusDanger : Theme.colors.buffer },
                                ]}
                            >
                                {isDeficit ? '-' : '+'}$
                                {Math.abs(colchonPeriodo).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </Text>
                            <Text style={styles.currencyBadge}>MXN</Text>
                        </View>

                        <Text style={styles.bufferExplanation}>
                            {isDeficit
                                ? `Tus apartados y gastos superan tu ingreso ${periodSuffix} por $${Math.abs(colchonPeriodo).toFixed(2)} MXN. Reduce el ahorro o el ocio para equilibrar tus finanzas.`
                                : `Margen positivo para imprevistos en cada corte. Equivale a $${(colchonPeriodo * currentDivisor).toFixed(2)} MXN al mes de holgura.`}
                        </Text>
                    </View>

                    {/* SECCIÓN 6: BOTÓN GUARDAR AJUSTES */}
                    <TouchableOpacity
                        style={[
                            styles.saveButton,
                            isButtonDisabled && styles.saveButtonDisabled,
                        ]}
                        onPress={handleSave}
                        disabled={isButtonDisabled}
                        activeOpacity={0.8}
                    >
                        {isSaving ? (
                            <ActivityIndicator size="small" color={Theme.colors.background} />
                        ) : (
                            <>
                                <Ionicons name="checkmark-circle-outline" size={20} color={Theme.colors.background} />
                                <Text style={styles.saveButtonText}>Guardar Ajustes</Text>
                            </>
                        )}
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>

            {/* MODAL PARA AGREGAR NUEVO GASTO FIJO (FASE 2) */}
            <Modal
                visible={modalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setModalVisible(false)}
            >
                <KeyboardAvoidingView
                    style={styles.modalOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHeaderTitleGroup}>
                                <Text style={styles.modalTitle}>Nuevo Gasto Fijo</Text>
                                <Text style={styles.modalSubtitle}>Suscripción o compromiso recurrente</Text>
                            </View>
                            <TouchableOpacity
                                style={styles.modalCloseButton}
                                onPress={() => setModalVisible(false)}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="close" size={20} color={Theme.colors.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        {/* Input Concepto */}
                        <View style={styles.inputBlock}>
                            <Text style={styles.inputLabel}>Concepto o Servicio</Text>
                            <TextInput
                                style={styles.modalTextInput}
                                placeholder="Ej. Renta, Internet, Gimnasio..."
                                placeholderTextColor={Theme.colors.textMuted}
                                value={newConcept}
                                onChangeText={setNewConcept}
                                maxLength={50}
                            />
                        </View>

                        {/* Input Monto Mensual */}
                        <View style={styles.inputBlock}>
                            <Text style={styles.inputLabel}>Monto Mensual Base</Text>
                            <View style={styles.amountInputContainer}>
                                <Text style={styles.currencySymbol}>$</Text>
                                <TextInput
                                    style={styles.amountInput}
                                    placeholder="0.00"
                                    placeholderTextColor={Theme.colors.textMuted}
                                    keyboardType="numeric"
                                    value={newAmount}
                                    onChangeText={(val) => handleNumberInput(val, setNewAmount)}
                                />
                                <Text style={styles.currencyCode}>MXN</Text>
                            </View>
                        </View>

                        {/* Selector Bloque de Vencimiento */}
                        <View style={styles.inputBlock}>
                            <Text style={styles.inputLabel}>Bloque de Vencimiento</Text>
                            <View style={styles.dueBlockSelectorRow}>
                                {[
                                    { label: '1 al 10', value: '1-10' as const },
                                    { label: '11 al 20', value: '11-20' as const },
                                    { label: '21 a fin de mes', value: '21-end' as const },
                                ].map((b) => (
                                    <TouchableOpacity
                                        key={b.value}
                                        style={[
                                            styles.dueBlockChip,
                                            newDueBlock === b.value && styles.dueBlockChipActive,
                                        ]}
                                        onPress={() => setNewDueBlock(b.value)}
                                        activeOpacity={0.7}
                                    >
                                        <Text
                                            style={[
                                                styles.dueBlockChipText,
                                                newDueBlock === b.value && styles.dueBlockChipTextActive,
                                            ]}
                                        >
                                            {b.label}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>

                        {/* Botones de Acción */}
                        <View style={styles.modalActionsRow}>
                            <TouchableOpacity
                                style={styles.modalCancelButton}
                                onPress={() => setModalVisible(false)}
                                activeOpacity={0.7}
                                disabled={isSubmittingFixed}
                            >
                                <Text style={styles.modalCancelButtonText}>Cancelar</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.modalSaveButton, isSubmittingFixed && styles.modalSaveButtonDisabled]}
                                onPress={handleAddFixedExpense}
                                activeOpacity={0.8}
                                disabled={isSubmittingFixed}
                            >
                                {isSubmittingFixed ? (
                                    <ActivityIndicator size="small" color={Theme.colors.background} />
                                ) : (
                                    <Text style={styles.modalSaveButtonText}>Guardar Gasto</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
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
    loadingContainer: {
        flex: 1,
        backgroundColor: Theme.colors.background,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
    },
    loadingText: {
        fontSize: 14,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
        borderBottomWidth: 1,
        borderBottomColor: Theme.colors.border,
        backgroundColor: Theme.colors.background,
    },
    backButton: {
        width: 38,
        height: 38,
        borderRadius: Theme.radius.md,
        backgroundColor: Theme.colors.cardSurface,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    headerTitleContainer: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
        letterSpacing: -0.3,
    },
    headerSubtitle: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        marginTop: 1,
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 40,
        gap: 16,
    },
    card: {
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.lg,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        padding: 16,
        gap: 14,
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    iconCircle: {
        width: 34,
        height: 34,
        borderRadius: Theme.radius.sm,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    cardSubtitle: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        marginTop: 1,
    },
    freqRow: {
        flexDirection: 'row',
        gap: 8,
    },
    freqChip: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: Theme.radius.md,
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        alignItems: 'center',
        justifyContent: 'center',
    },
    freqChipActive: {
        borderColor: Theme.colors.borderFocus,
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
    },
    freqChipText: {
        fontSize: 13,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    freqChipTextActive: {
        color: Theme.colors.borderFocus,
        fontWeight: '800',
    },
    daySelectorContainer: {
        gap: 8,
        marginTop: 4,
    },
    dayRow: {
        flexDirection: 'row',
        gap: 8,
    },
    dayChip: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: Theme.radius.sm,
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dayChipActive: {
        borderColor: Theme.colors.borderFocus,
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
    },
    dayChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    dayChipTextActive: {
        color: Theme.colors.borderFocus,
        fontWeight: '700',
    },
    inputBlock: {
        gap: 6,
    },
    inputLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    amountInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderRadius: Theme.radius.md,
        borderWidth: 1.5,
        borderColor: Theme.colors.borderSubtle,
        paddingHorizontal: 14,
        paddingVertical: 6,
    },
    currencySymbol: {
        fontSize: 20,
        fontWeight: '700',
        color: Theme.colors.borderFocus,
        marginRight: 6,
    },
    amountInput: {
        flex: 1,
        fontSize: 20,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
        paddingVertical: 4,
    },
    currencyCode: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.textMuted,
    },
    equivalentNote: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(56, 189, 248, 0.08)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: Theme.radius.sm,
    },
    equivalentNoteText: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
    },
    highlightText: {
        color: Theme.colors.borderFocus,
        fontWeight: '700',
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        padding: 12,
        borderRadius: Theme.radius.md,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
    },
    infoLeft: {
        flex: 1,
        marginRight: 10,
        gap: 2,
    },
    infoTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    infoSub: {
        fontSize: 11,
        color: Theme.colors.textMuted,
    },
    infoAmount: {
        fontSize: 15,
        fontWeight: '800',
        color: Theme.colors.fixed,
    },
    cardDivider: {
        height: 1,
        backgroundColor: Theme.colors.borderSubtle,
        width: '100%',
    },
    bufferCard: {
        borderRadius: Theme.radius.lg,
        padding: 16,
        borderWidth: 1,
        gap: 10,
    },
    bufferCardHealthy: {
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderColor: Theme.colors.border,
    },
    bufferCardDeficit: {
        backgroundColor: 'rgba(239, 68, 68, 0.08)',
        borderColor: Theme.colors.statusDanger,
    },
    bufferHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    bufferTitleGroup: {
        flex: 1,
    },
    bufferCardTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    bufferCardSub: {
        fontSize: 11,
        color: Theme.colors.textSecondary,
        marginTop: 1,
    },
    bufferAmountRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
    },
    bufferAmountText: {
        fontSize: 28,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    currencyBadge: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.textMuted,
    },
    bufferExplanation: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        lineHeight: 16,
    },
    saveButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: Theme.colors.borderFocus,
        paddingVertical: 14,
        borderRadius: Theme.radius.lg,
        marginTop: 8,
    },
    saveButtonDisabled: {
        opacity: 0.5,
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: '800',
        color: Theme.colors.background,
    },
    // Estilos Fase 2: Gastos Fijos
    cardTitleContainer: {
        flex: 1,
    },
    totalFixedBadge: {
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        borderColor: 'rgba(56, 189, 248, 0.3)',
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: Theme.radius.sm,
    },
    totalFixedBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: Theme.colors.fixed,
    },
    emptyFixedContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 20,
        paddingHorizontal: 16,
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderRadius: Theme.radius.md,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        gap: 6,
    },
    emptyFixedTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    emptyFixedSubtitle: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 16,
    },
    fixedListContainer: {
        gap: 8,
    },
    fixedItemCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: Theme.radius.md,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
    },
    fixedItemLeft: {
        flex: 1,
        marginRight: 10,
        gap: 4,
    },
    fixedItemConcept: {
        fontSize: 14,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    fixedItemMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    fixedItemAmount: {
        fontSize: 12,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    dueBlockBadge: {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: Theme.radius.xs,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
    },
    dueBlockBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: Theme.colors.textMuted,
    },
    deleteFixedButton: {
        width: 32,
        height: 32,
        borderRadius: Theme.radius.sm,
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    addFixedButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 11,
        borderRadius: Theme.radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: Theme.colors.borderFocus,
        backgroundColor: 'rgba(56, 189, 248, 0.05)',
        marginTop: 4,
    },
    addFixedButtonText: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.borderFocus,
    },
    // Estilos Modal Fase 2
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalCard: {
        width: '100%',
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.lg,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        padding: 20,
        gap: 16,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    modalHeaderTitleGroup: {
        flex: 1,
    },
    modalTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
    },
    modalSubtitle: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        marginTop: 2,
    },
    modalCloseButton: {
        width: 32,
        height: 32,
        borderRadius: Theme.radius.sm,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Theme.colors.cardSurfaceSubtle,
    },
    modalTextInput: {
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderRadius: Theme.radius.md,
        borderWidth: 1.5,
        borderColor: Theme.colors.borderSubtle,
        paddingHorizontal: 14,
        paddingVertical: 10,
        fontSize: 15,
        fontWeight: '600',
        color: Theme.colors.textPrimary,
    },
    dueBlockSelectorRow: {
        flexDirection: 'row',
        gap: 8,
    },
    dueBlockChip: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: Theme.radius.sm,
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dueBlockChipActive: {
        borderColor: Theme.colors.borderFocus,
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
    },
    dueBlockChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    dueBlockChipTextActive: {
        color: Theme.colors.borderFocus,
        fontWeight: '700',
    },
    modalActionsRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 6,
    },
    modalCancelButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: Theme.radius.md,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Theme.colors.cardSurfaceSubtle,
    },
    modalCancelButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    modalSaveButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: Theme.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: Theme.colors.borderFocus,
    },
    modalSaveButtonDisabled: {
        opacity: 0.5,
    },
    modalSaveButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: Theme.colors.background,
    },
});
