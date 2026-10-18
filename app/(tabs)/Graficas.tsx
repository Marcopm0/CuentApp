import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    RefreshControl,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { auth, db } from '@/services/firebase';
import { Budget, Transaction, UserProfile } from '@/types/database';
import { DueBlock, getNextCycleBlocks, getPeriodInfo, PayFrequency } from '@/utils/periods';

// Helper de formato de moneda estándar MXN
const formatCurrency = (val: number = 0): string => {
    const num = isNaN(val) ? 0 : val;
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(num);
};

// Formato compacto para números enteros en leyendas o barras
const formatShortCurrency = (val: number = 0): string => {
    const num = isNaN(val) ? 0 : val;
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        maximumFractionDigits: 0,
    }).format(num);
};

export default function GraficasScreen() {
    // 1. Estados de Temporalidad y UI
    const [scope, setScope] = useState<'cycle' | 'month'>('cycle');
    const [loading, setLoading] = useState<boolean>(true);
    const [refreshing, setRefreshing] = useState<boolean>(false);

    // 2. Datos desde Firestore
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [budgets, setBudgets] = useState<Budget[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);

    // Mes en curso YYYY-MM
    const currentMonthYear = useMemo(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }, []);

    // Nombre legible del mes en curso (ej. "Septiembre 2026")
    const currentMonthLabel = useMemo(() => {
        const d = new Date();
        const monthName = d.toLocaleDateString('es-MX', { month: 'long' });
        const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
        return `${capitalized} ${d.getFullYear()}`;
    }, []);

    // 3. Suscripciones en tiempo real a Firestore (Read-Only)
    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            setLoading(false);
            return;
        }

        let unsubscribeUser = () => { };
        let unsubscribeBudgets = () => { };
        let unsubscribeTxs = () => { };

        try {
            // A. Perfil de Usuario
            const userRef = doc(db, 'users', user.uid);
            unsubscribeUser = onSnapshot(
                userRef,
                (docSnap) => {
                    if (docSnap.exists()) {
                        setUserProfile({
                            uid: docSnap.id,
                            ...(docSnap.data() as Omit<UserProfile, 'uid'>),
                        });
                    }
                },
                (error) => {
                    console.error('Error al suscribir perfil de usuario en Graficas:', error);
                }
            );

            // B. Presupuestos del mes
            const budgetsQuery = query(
                collection(db, 'budgets'),
                where('userId', '==', user.uid),
                where('monthYear', '==', currentMonthYear)
            );
            unsubscribeBudgets = onSnapshot(
                budgetsQuery,
                (snapshot) => {
                    const docs: Budget[] = snapshot.docs.map((d) => ({
                        id: d.id,
                        ...(d.data() as Omit<Budget, 'id'>),
                    }));
                    setBudgets(docs);
                },
                (error) => {
                    console.error('Error al suscribir presupuestos en Graficas:', error);
                }
            );

            // C. Transacciones personales
            const txQuery = query(
                collection(db, 'transactions'),
                where('userId', '==', user.uid),
                where('sharedFundId', '==', null)
            );
            unsubscribeTxs = onSnapshot(
                txQuery,
                (snapshot) => {
                    const docs: Transaction[] = snapshot.docs.map((d) => ({
                        id: d.id,
                        ...(d.data() as Omit<Transaction, 'id'>),
                    }));
                    setTransactions(docs);
                    setLoading(false);
                    setRefreshing(false);
                },
                (error) => {
                    console.error('Error al suscribir transacciones en Graficas:', error);
                    setLoading(false);
                    setRefreshing(false);
                }
            );
        } catch (err) {
            console.error('Error configurando listeners de Firestore:', err);
            setLoading(false);
            setRefreshing(false);
        }

        return () => {
            unsubscribeUser();
            unsubscribeBudgets();
            unsubscribeTxs();
        };
    }, [currentMonthYear]);

    // Pull-to-refresh
    const onRefresh = () => {
        setRefreshing(true);
        // Las suscripciones en tiempo real actualizarán los datos; este timeout asegura feedback háptico/visual
        setTimeout(() => setRefreshing(false), 800);
    };

    // 4. Parámetros y Periodo Activo
    const payFrequency = (userProfile?.payFrequency as PayFrequency) || 'biweekly';
    const payDayOfWeek = typeof userProfile?.payDayOfWeek === 'number' ? userProfile.payDayOfWeek : 5;
    const monthlyIncome = Number(userProfile?.monthlyIncome) || 0;
    const savingsTarget = Number(userProfile?.savingsTarget) || 0;

    // Divisor para prorrateos según frecuencia
    const cycleDivisor = payFrequency === 'weekly' ? 4 : payFrequency === 'biweekly' ? 2 : 1;
    const amountPerPeriod = userProfile?.amountPerPeriod
        ? Number(userProfile.amountPerPeriod)
        : monthlyIncome > 0
            ? monthlyIncome / cycleDivisor
            : 0;

    const periodInfo = useMemo(() => {
        return getPeriodInfo(payFrequency, payDayOfWeek);
    }, [payFrequency, payDayOfWeek]);

    // Detectar si el usuario está en su primer ciclo de cobro
    const isFirstCycle = useMemo(() => {
        if (!userProfile) return false;
        if (userProfile.firstPeriodKey) {
            return userProfile.firstPeriodKey === periodInfo.periodKey;
        }
        if (userProfile.createdAt && periodInfo.startDate && periodInfo.endDate) {
            const createdMs = userProfile.createdAt?.toMillis
                ? userProfile.createdAt.toMillis()
                : userProfile.createdAt?.seconds
                    ? userProfile.createdAt.seconds * 1000
                    : null;
            if (createdMs) {
                const d = new Date(createdMs);
                return d >= periodInfo.startDate && d <= periodInfo.endDate;
            }
        }
        return false;
    }, [userProfile, periodInfo]);

    // 5. Filtro de Transacciones según el Alcance Seleccionado (Este Ciclo vs. Mes Completo)
    const isInScope = useMemo(() => {
        return (t: Transaction, s: 'cycle' | 'month'): boolean => {
            if (s === 'cycle') {
                if (t.periodKey) {
                    return t.periodKey === periodInfo.periodKey;
                }
                if (periodInfo.startDate && periodInfo.endDate) {
                    const time = t.createdAt?.toMillis
                        ? t.createdAt.toMillis()
                        : t.createdAt?.seconds
                            ? t.createdAt.seconds * 1000
                            : t.date?.toMillis
                                ? t.date.toMillis()
                                : t.date?.seconds
                                    ? t.date.seconds * 1000
                                    : null;
                    if (time) {
                        const txDate = new Date(time);
                        return txDate >= periodInfo.startDate && txDate <= periodInfo.endDate;
                    }
                }
                return t.monthYear === currentMonthYear;
            } else {
                // Mes completo
                if (t.monthYear) {
                    return t.monthYear === currentMonthYear;
                }
                const time = t.createdAt?.toMillis
                    ? t.createdAt.toMillis()
                    : t.createdAt?.seconds
                        ? t.createdAt.seconds * 1000
                        : t.date?.toMillis
                            ? t.date.toMillis()
                            : t.date?.seconds
                                ? t.date.seconds * 1000
                                : null;
                if (time) {
                    const d = new Date(time);
                    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    return ym === currentMonthYear;
                }
                return false;
            }
        };
    }, [periodInfo, currentMonthYear]);

    // Transacciones filtradas para el scope activo
    const scopedTransactions = useMemo(() => {
        return transactions.filter((t) => isInScope(t, scope));
    }, [transactions, isInScope, scope]);

    // ─────────────────────────────────────────────────────────────
    // CÁLCULOS: MÓDULO 1 (Resumen Global y Balance)
    // ─────────────────────────────────────────────────────────────
    const {
        totalIngresos,
        totalGastosReales,
        remanenteNeto,
        fijosCubiertos,
        gastosVariablesConsumidos,
    } = useMemo(() => {
        // Ingresos:
        // Base presupuestada (nómina del ciclo o mensual)
        const baseIncome = scope === 'cycle' ? amountPerPeriod : (monthlyIncome || amountPerPeriod * cycleDivisor);

        // Sueldos registrados efectivamente en transacciones para el periodo
        const salaryIncomes = scopedTransactions
            .filter((t) => t.type === 'income' && t.category === '💵 Sueldo')
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        // Ingresos extraordinarios (excluyendo sueldo base e ingreso inicial de setup)
        const extraIncomes = scopedTransactions
            .filter((t) => t.type === 'income' && t.category !== '💵 Sueldo' && t.category !== 'Ingreso Inicial')
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        // Total Ingresos = Si ya se abonó el sueldo, se toma el valor real; si no, la base presupuestada esperada + extras
        const ingresos = Math.max(baseIncome, salaryIncomes) + extraIncomes;

        // Fijos Cubiertos:
        // Se calcula a partir de los pagos efectuados en presupuestos fijos y las transacciones de gastos fijos
        let fijosPagados = 0;
        if (scope === 'cycle') {
            // Pagos en los bloques activos de este ciclo
            const fijosBudgetsCycle = budgets
                .filter((b) => b.isFixedExpense && b.dueBlock && periodInfo.activeBlocks.includes(b.dueBlock))
                .reduce((acc, b) => acc + (Number(b.currentSpent) || 0), 0);

            const fijosTxsCycle = scopedTransactions
                .filter((t) => t.type === 'expense' && (t.isFixedExpense || t.category === 'Gasto Fijo'))
                .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

            fijosPagados = Math.max(fijosBudgetsCycle, fijosTxsCycle);
        } else {
            // Mes completo
            const fijosBudgetsMonth = budgets
                .filter((b) => b.isFixedExpense)
                .reduce((acc, b) => acc + (Number(b.currentSpent) || 0), 0);

            const fijosTxsMonth = scopedTransactions
                .filter((t) => t.type === 'expense' && (t.isFixedExpense || t.category === 'Gasto Fijo'))
                .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

            fijosPagados = Math.max(fijosBudgetsMonth, fijosTxsMonth);
        }

        // Gastos Variables consumidos en el periodo
        const variables = scopedTransactions
            .filter((t) => t.type === 'expense' && !t.isFixedExpense && t.category !== 'Gasto Fijo')
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        const gastosTotales = fijosPagados + variables;
        const remanente = ingresos - gastosTotales;

        return {
            totalIngresos: ingresos,
            totalGastosReales: gastosTotales,
            remanenteNeto: remanente,
            fijosCubiertos: fijosPagados,
            gastosVariablesConsumidos: variables,
        };
    }, [scope, amountPerPeriod, monthlyIncome, cycleDivisor, scopedTransactions, budgets, periodInfo]);

    // ─────────────────────────────────────────────────────────────
    // CÁLCULOS: MÓDULO 2 (Distribución de Bolsas Maestras)
    // ─────────────────────────────────────────────────────────────
    const {
        fijosMaster,
        ahorroMaster,
        ocioMaster,
        bufferMaster,
        totalMaster,
        pctFijos,
        pctAhorro,
        pctOcio,
        pctBuffer,
    } = useMemo(() => {
        const isCycle = scope === 'cycle';
        const div = isCycle ? cycleDivisor : 1;

        // 1. 🏠 Gastos Fijos
        let fijos = 0;
        if (isCycle && userProfile?.hasPreSavedNextCycle === false && isFirstCycle) {
            const nextCycleBlocks = getNextCycleBlocks(payFrequency, payDayOfWeek);
            const relevantBlocks = new Set([...periodInfo.activeBlocks, ...nextCycleBlocks]);
            fijos = budgets
                .filter((b) => b.isFixedExpense && b.dueBlock && relevantBlocks.has(b.dueBlock))
                .reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);
        } else {
            const totalFijosMensuales = budgets
                .filter((b) => b.isFixedExpense)
                .reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);
            fijos = totalFijosMensuales / div;
        }

        // 2. 🐖 Ahorro Programado
        const ahorro = (savingsTarget || 0) / div;

        // 3. 🍿 Ocio / Variable
        const leisureDoc = budgets.find((b) => !b.isFixedExpense);
        const ocioMensual = leisureDoc ? Number(leisureDoc.limitAmount) || 0 : 0;
        const ocio = ocioMensual / div;

        // 4. 🛡️ Colchón / Buffer
        const baseCobro = isCycle
            ? amountPerPeriod
            : (monthlyIncome || amountPerPeriod * cycleDivisor);
        const buffer = Math.max(0, baseCobro - (fijos + ahorro + ocio));

        const total = fijos + ahorro + ocio + buffer;

        const pFijos = total > 0 ? (fijos / total) * 100 : 0;
        const pAhorro = total > 0 ? (ahorro / total) * 100 : 0;
        const pOcio = total > 0 ? (ocio / total) * 100 : 0;
        const pBuffer = total > 0 ? (buffer / total) * 100 : 0;

        return {
            fijosMaster: fijos,
            ahorroMaster: ahorro,
            ocioMaster: ocio,
            bufferMaster: buffer,
            totalMaster: total,
            pctFijos: pFijos,
            pctAhorro: pAhorro,
            pctOcio: pOcio,
            pctBuffer: pBuffer,
        };
    }, [
        scope,
        cycleDivisor,
        userProfile,
        isFirstCycle,
        payFrequency,
        payDayOfWeek,
        periodInfo,
        budgets,
        savingsTarget,
        amountPerPeriod,
        monthlyIncome,
    ]);

    // ─────────────────────────────────────────────────────────────
    // CÁLCULOS: MÓDULO 3 (Top de Gastos por Categoría)
    // ─────────────────────────────────────────────────────────────
    const { topCategorias, totalGastosScope } = useMemo(() => {
        // Agrupar todas las transacciones de tipo 'expense' del scope activo
        const transaccionesGasto = scopedTransactions.filter((t) => t.type === 'expense');

        const mapCat = new Map<string, { total: number; count: number }>();
        let granTotal = 0;

        for (const t of transaccionesGasto) {
            const rawCat = t.category?.trim() || '📦 Otro Gasto';
            const monto = Number(t.amount) || 0;
            granTotal += monto;

            const existing = mapCat.get(rawCat) || { total: 0, count: 0 };
            existing.total += monto;
            existing.count += 1;
            mapCat.set(rawCat, existing);
        }

        const lista = Array.from(mapCat.entries())
            .map(([category, data]) => ({
                category,
                total: data.total,
                count: data.count,
                percentage: granTotal > 0 ? (data.total / granTotal) * 100 : 0,
            }))
            .sort((a, b) => b.total - a.total);

        return {
            topCategorias: lista,
            totalGastosScope: granTotal,
        };
    }, [scopedTransactions]);

    // ─────────────────────────────────────────────────────────────
    // CÁLCULOS: MÓDULO 4 (Salud del Presupuesto: Planeado vs Consumido)
    // ─────────────────────────────────────────────────────────────
    const saludPresupuesto = useMemo(() => {
        const isCycle = scope === 'cycle';
        const div = isCycle ? cycleDivisor : 1;

        // A. Compromisos Fijos
        let compromisoPresupuestado = 0;
        if (isCycle) {
            const blocks = periodInfo.activeBlocks;
            const compromisosBloque = budgets
                .filter((b) => b.isFixedExpense && b.dueBlock && blocks.includes(b.dueBlock))
                .reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);

            compromisoPresupuestado = compromisosBloque > 0
                ? compromisosBloque
                : (budgets.filter((b) => b.isFixedExpense).reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0) / div);
        } else {
            compromisoPresupuestado = budgets
                .filter((b) => b.isFixedExpense)
                .reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);
        }

        const compromisoPagado = fijosCubiertos;
        const compromisoPct = compromisoPresupuestado > 0
            ? Math.min(100, (compromisoPagado / compromisoPresupuestado) * 100)
            : 100;

        // B. Ocio / Variable
        const extraOcio = scopedTransactions
            .filter((t) => t.type === 'income' && t.category !== '💵 Sueldo' && (t.targetBucket === 'leisure' || !t.targetBucket))
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        const limiteOcio = ocioMaster + extraOcio;
        const ocioConsumido = gastosVariablesConsumidos;
        const ocioPct = limiteOcio > 0 ? (ocioConsumido / limiteOcio) * 100 : 0;
        const ocioAgotado = ocioConsumido > limiteOcio;
        const ocioRestante = Math.max(0, limiteOcio - ocioConsumido);

        // C. Colchón / Reserva de Imprevistos
        const extraBuffer = scopedTransactions
            .filter((t) => t.type === 'income' && t.targetBucket === 'buffer')
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        const bufferTotalInicial = bufferMaster + extraBuffer;

        // Consumos dirigidos explícitamente a colchón o desbordamiento de ocio
        const gastoExcedenteOcio = Math.max(0, ocioConsumido - limiteOcio);
        const gastosConBucketBuffer = scopedTransactions
            .filter((t) => t.type === 'expense' && t.targetBucket === 'buffer')
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        const bufferConsumido = Math.min(
            bufferTotalInicial,
            gastoExcedenteOcio + gastosConBucketBuffer
        );
        const bufferIntacto = Math.max(0, bufferTotalInicial - bufferConsumido);
        const bufferPctIntacto = bufferTotalInicial > 0 ? (bufferIntacto / bufferTotalInicial) * 100 : 0;

        return {
            fijos: {
                compromisoPresupuestado,
                compromisoPagado,
                compromisoPct,
            },
            ocio: {
                limiteOcio,
                ocioConsumido,
                ocioPct,
                ocioAgotado,
                ocioRestante,
            },
            buffer: {
                bufferTotalInicial,
                bufferConsumido,
                bufferIntacto,
                bufferPctIntacto,
            },
        };
    }, [
        scope,
        cycleDivisor,
        periodInfo,
        budgets,
        fijosCubiertos,
        scopedTransactions,
        ocioMaster,
        gastosVariablesConsumidos,
        bufferMaster,
    ]);

    // Colores para las barras de progreso del Top de Categorías
    const categoriaColores = [
        '#38BDF8', // Cyan
        '#A855F7', // Morado
        '#F59E0B', // Ámbar
        '#10B981', // Esmeralda
        '#EC4899', // Rosa
        '#6366F1', // Índigo
        '#14B8A6', // Teal
        '#F97316', // Naranja
    ];

    if (loading) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <StatusBar barStyle="light-content" backgroundColor="#0B0F17" />
                <ActivityIndicator size="large" color="#38BDF8" />
                <Text style={styles.loadingText}>Cargando análisis financiero...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="light-content" backgroundColor="#0B0F17" />
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor="#38BDF8"
                        colors={['#38BDF8']}
                    />
                }
            >
                {/* ─────────────────────────────────────────────────────────────
            ENCABEZADO DE PANTALLA & SELECTOR DE TEMPORALIDAD
            ───────────────────────────────────────────────────────────── */}
                <View style={styles.screenHeader}>
                    <View>
                        <Text style={styles.screenTitle}>Estadísticas</Text>
                        <Text style={styles.screenSubtitle}>
                            Control de flujo y disciplina de presupuesto
                        </Text>
                    </View>

                    {/* Badge informativo de fecha/ciclo */}
                    <View style={styles.periodBadge}>
                        <Ionicons name="calendar-outline" size={13} color="#38BDF8" />
                        <Text style={styles.periodBadgeText}>
                            {scope === 'cycle' ? periodInfo.label : currentMonthLabel}
                        </Text>
                    </View>
                </View>

                {/* Tabs Segmentados: Este Ciclo vs. Mes Completo */}
                <View style={styles.temporalToggleContainer}>
                    <TouchableOpacity
                        style={[
                            styles.temporalTab,
                            scope === 'cycle' && styles.temporalTabActive,
                        ]}
                        onPress={() => setScope('cycle')}
                        activeOpacity={0.7}
                    >
                        <Ionicons
                            name="flash-outline"
                            size={14}
                            color={scope === 'cycle' ? '#0B0F17' : '#94A3B8'}
                        />
                        <Text
                            style={[
                                styles.temporalTabText,
                                scope === 'cycle' && styles.temporalTabTextActive,
                            ]}
                        >
                            Este Ciclo ({periodInfo.label})
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[
                            styles.temporalTab,
                            scope === 'month' && styles.temporalTabActive,
                        ]}
                        onPress={() => setScope('month')}
                        activeOpacity={0.7}
                    >
                        <Ionicons
                            name="calendar"
                            size={14}
                            color={scope === 'month' ? '#0B0F17' : '#94A3B8'}
                        />
                        <Text
                            style={[
                                styles.temporalTabText,
                                scope === 'month' && styles.temporalTabTextActive,
                            ]}
                        >
                            Mes Completo
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* ─────────────────────────────────────────────────────────────
            MÓDULO 1: CABECERA Y RESUMEN GLOBAL (BALANCE DE FLUJO)
            ───────────────────────────────────────────────────────────── */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                                <Ionicons name="wallet-outline" size={18} color="#38BDF8" />
                            </View>
                            <Text style={styles.cardTitle}>Balance del Periodo</Text>
                        </View>
                        <View
                            style={[
                                styles.statusPill,
                                remanenteNeto >= 0 ? styles.statusPillPositive : styles.statusPillNegative,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.statusPillText,
                                    remanenteNeto >= 0 ? styles.statusTextPositive : styles.statusTextNegative,
                                ]}
                            >
                                {remanenteNeto >= 0 ? 'Superávit neto' : 'Déficit / Sobregiro'}
                            </Text>
                        </View>
                    </View>

                    {/* Gran Cifra: Remanente Neto Resultante */}
                    <View style={styles.netRemainingBox}>
                        <Text style={styles.netRemainingLabel}>Remanente Neto Resultante</Text>
                        <View style={styles.netAmountRow}>
                            <Text
                                style={[
                                    styles.netRemainingAmount,
                                    { color: remanenteNeto >= 0 ? '#10B981' : '#EF4444' },
                                ]}
                            >
                                {remanenteNeto >= 0 ? '+' : ''}
                                {formatCurrency(remanenteNeto)}
                            </Text>
                            <Text style={styles.currencyBadge}>MXN</Text>
                        </View>
                        <Text style={styles.netRemainingExplanation}>
                            {remanenteNeto >= 0
                                ? 'Capital libre disponible tras cubrir compromisos fijos y consumos variables.'
                                : 'Tus consumos actuales superan el ingreso asignado para este corte.'}
                        </Text>
                    </View>

                    <View style={styles.cardDivider} />

                    {/* Comparativa Ingresos vs. Gastos Totales Reales */}
                    <View style={styles.balanceSplitRow}>
                        {/* Columna Ingresos */}
                        <View style={styles.balanceColumn}>
                            <View style={styles.balanceItemHeader}>
                                <Ionicons name="arrow-down-circle" size={16} color="#34D399" />
                                <Text style={styles.balanceItemLabel}>Ingresos</Text>
                            </View>
                            <Text style={[styles.balanceItemValue, { color: '#34D399' }]}>
                                +{formatCurrency(totalIngresos)}
                            </Text>
                            <Text style={styles.balanceItemSub}>
                                {scope === 'cycle' ? 'Sueldo ciclo + extras' : 'Sueldo mes + extras'}
                            </Text>
                        </View>

                        {/* Línea divisoria vertical */}
                        <View style={styles.verticalDivider} />

                        {/* Columna Gastos Totales */}
                        <View style={styles.balanceColumn}>
                            <View style={styles.balanceItemHeader}>
                                <Ionicons name="arrow-up-circle" size={16} color="#F87171" />
                                <Text style={styles.balanceItemLabel}>Gastos Totales</Text>
                            </View>
                            <Text style={[styles.balanceItemValue, { color: '#F87171' }]}>
                                -{formatCurrency(totalGastosReales)}
                            </Text>
                            <Text style={styles.balanceItemSub}>
                                Fijos cubiertos + variables
                            </Text>
                        </View>
                    </View>

                    {/* Desglose de Gastos en pie de tarjeta */}
                    <View style={styles.balanceFootnote}>
                        <Text style={styles.balanceFootnoteText}>
                            Desglose de gastos:{' '}
                            <Text style={styles.footnoteHighlight}>
                                {formatCurrency(fijosCubiertos)}
                            </Text>{' '}
                            en fijos pagados y{' '}
                            <Text style={styles.footnoteHighlight}>
                                {formatCurrency(gastosVariablesConsumidos)}
                            </Text>{' '}
                            en gastos diarios.
                        </Text>
                    </View>
                </View>

                {/* ─────────────────────────────────────────────────────────────
            MÓDULO 2: DISTRIBUCIÓN DE BOLSAS (BARRA SEGMENTADA FINTECH)
            ───────────────────────────────────────────────────────────── */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(168, 85, 247, 0.15)' }]}>
                                <Feather name="pie-chart" size={17} color="#A855F7" />
                            </View>
                            <View>
                                <Text style={styles.cardTitle}>Distribución de Bolsas</Text>
                                <Text style={styles.cardSubtitle}>
                                    Arquitectura de capital del periodo
                                </Text>
                            </View>
                        </View>
                        <Text style={styles.totalBudgetBadge}>
                            {formatShortCurrency(totalMaster)}
                        </Text>
                    </View>

                    {/* Barra Segmentada Continua Horizontal Estilo Fintech / Revolut */}
                    <View style={styles.segmentedBarTrack}>
                        {pctFijos > 0 && (
                            <View
                                style={[
                                    styles.segment,
                                    { flex: pctFijos, backgroundColor: '#38BDF8' },
                                ]}
                            />
                        )}
                        {pctAhorro > 0 && (
                            <View
                                style={[
                                    styles.segment,
                                    { flex: pctAhorro, backgroundColor: '#A855F7' },
                                ]}
                            />
                        )}
                        {pctOcio > 0 && (
                            <View
                                style={[
                                    styles.segment,
                                    { flex: pctOcio, backgroundColor: '#F59E0B' },
                                ]}
                            />
                        )}
                        {pctBuffer > 0 && (
                            <View
                                style={[
                                    styles.segment,
                                    { flex: pctBuffer, backgroundColor: '#10B981' },
                                ]}
                            />
                        )}
                        {totalMaster === 0 && (
                            <View style={[styles.segment, { flex: 1, backgroundColor: '#24324D' }]} />
                        )}
                    </View>

                    {/* Leyenda en Cuadrícula (Grid de 2 Columnas) */}
                    <View style={styles.legendGrid}>
                        {/* Bolsa 1: Gastos Fijos */}
                        <View style={styles.legendItem}>
                            <View style={styles.legendDotRow}>
                                <View style={[styles.legendDot, { backgroundColor: '#38BDF8' }]} />
                                <Text style={styles.legendName} numberOfLines={1}>
                                    🏠 Gastos Fijos
                                </Text>
                            </View>
                            <View style={styles.legendValuesRow}>
                                <Text style={styles.legendPercentage}>
                                    {pctFijos.toFixed(1)}%
                                </Text>
                                <Text style={styles.legendAmount}>
                                    {formatCurrency(fijosMaster)}
                                </Text>
                            </View>
                        </View>

                        {/* Bolsa 2: Ahorro Programado */}
                        <View style={styles.legendItem}>
                            <View style={styles.legendDotRow}>
                                <View style={[styles.legendDot, { backgroundColor: '#A855F7' }]} />
                                <Text style={styles.legendName} numberOfLines={1}>
                                    🐖 Ahorro
                                </Text>
                            </View>
                            <View style={styles.legendValuesRow}>
                                <Text style={styles.legendPercentage}>
                                    {pctAhorro.toFixed(1)}%
                                </Text>
                                <Text style={styles.legendAmount}>
                                    {formatCurrency(ahorroMaster)}
                                </Text>
                            </View>
                        </View>

                        {/* Bolsa 3: Ocio / Variable */}
                        <View style={styles.legendItem}>
                            <View style={styles.legendDotRow}>
                                <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                                <Text style={styles.legendName} numberOfLines={1}>
                                    🍿 Ocio / Variable
                                </Text>
                            </View>
                            <View style={styles.legendValuesRow}>
                                <Text style={styles.legendPercentage}>
                                    {pctOcio.toFixed(1)}%
                                </Text>
                                <Text style={styles.legendAmount}>
                                    {formatCurrency(ocioMaster)}
                                </Text>
                            </View>
                        </View>

                        {/* Bolsa 4: Colchón / Buffer */}
                        <View style={styles.legendItem}>
                            <View style={styles.legendDotRow}>
                                <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                                <Text style={styles.legendName} numberOfLines={1}>
                                    🛡️ Colchón / Buffer
                                </Text>
                            </View>
                            <View style={styles.legendValuesRow}>
                                <Text style={styles.legendPercentage}>
                                    {pctBuffer.toFixed(1)}%
                                </Text>
                                <Text style={styles.legendAmount}>
                                    {formatCurrency(bufferMaster)}
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* ─────────────────────────────────────────────────────────────
            MÓDULO 3: TOP DE GASTOS POR CATEGORÍA
            ───────────────────────────────────────────────────────────── */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                                <Ionicons name="bar-chart-outline" size={18} color="#F59E0B" />
                            </View>
                            <View>
                                <Text style={styles.cardTitle}>Top de Gastos por Categoría</Text>
                                <Text style={styles.cardSubtitle}>
                                    Concentración del egreso en el periodo
                                </Text>
                            </View>
                        </View>
                        {totalGastosScope > 0 && (
                            <View style={styles.countBadge}>
                                <Text style={styles.countBadgeText}>
                                    {topCategorias.length} cats
                                </Text>
                            </View>
                        )}
                    </View>

                    {topCategorias.length === 0 ? (
                        <View style={styles.emptyStateContainer}>
                            <Ionicons name="receipt-outline" size={40} color="#475569" />
                            <Text style={styles.emptyStateTitle}>
                                Sin gastos registrados en este periodo
                            </Text>
                            <Text style={styles.emptyStateSubtitle}>
                                Tus movimientos aparecerán ordenados por volumen aquí automáticamente.
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.categoryList}>
                            {topCategorias.map((item, index) => {
                                const barColor = categoriaColores[index % categoriaColores.length];
                                return (
                                    <View key={item.category} style={styles.categoryItem}>
                                        <View style={styles.categoryTopRow}>
                                            <View style={styles.categoryNameRow}>
                                                <Text style={styles.categoryNameText} numberOfLines={1}>
                                                    {item.category}
                                                </Text>
                                                <View style={styles.categoryCountBadge}>
                                                    <Text style={styles.categoryCountBadgeText}>
                                                        {item.count} ops
                                                    </Text>
                                                </View>
                                            </View>

                                            <View style={styles.categoryAmountRow}>
                                                <Text style={styles.categoryAmountText}>
                                                    {formatCurrency(item.total)}
                                                </Text>
                                                <Text style={[styles.categoryPctBadge, { color: barColor }]}>
                                                    {item.percentage.toFixed(1)}%
                                                </Text>
                                            </View>
                                        </View>

                                        {/* Barra de progreso horizontal individual */}
                                        <View style={styles.categoryTrackBar}>
                                            <View
                                                style={[
                                                    styles.categoryFillBar,
                                                    {
                                                        width: `${Math.min(100, Math.max(2, item.percentage))}%`,
                                                        backgroundColor: barColor,
                                                    },
                                                ]}
                                            />
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    )}
                </View>

                {/* ─────────────────────────────────────────────────────────────
            MÓDULO 4: SALUD DEL PRESUPUESTO (PLANEADO VS. CONSUMIDO)
            ───────────────────────────────────────────────────────────── */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                                <MaterialCommunityIcons name="shield-check-outline" size={18} color="#10B981" />
                            </View>
                            <View>
                                <Text style={styles.cardTitle}>Salud del Presupuesto</Text>
                                <Text style={styles.cardSubtitle}>
                                    Planeado vs. Consumido en tiempo real
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Métrica 1: Compromisos Fijos */}
                    <View style={styles.healthItem}>
                        <View style={styles.healthItemHeader}>
                            <View style={styles.healthItemTitleRow}>
                                <Text style={styles.healthItemTitle}>🏠 Compromisos Fijos</Text>
                                <Text style={styles.healthItemSub}>
                                    Obligaciones esenciales del periodo
                                </Text>
                            </View>
                            <View
                                style={[
                                    styles.healthBadge,
                                    saludPresupuesto.fijos.compromisoPct >= 100
                                        ? styles.healthBadgeSuccess
                                        : saludPresupuesto.fijos.compromisoPct > 0
                                            ? styles.healthBadgeProgress
                                            : styles.healthBadgePending,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.healthBadgeText,
                                        saludPresupuesto.fijos.compromisoPct >= 100
                                            ? styles.healthTextSuccess
                                            : saludPresupuesto.fijos.compromisoPct > 0
                                                ? styles.healthTextProgress
                                                : styles.healthTextPending,
                                    ]}
                                >
                                    {saludPresupuesto.fijos.compromisoPct >= 100
                                        ? '100% Cubierto'
                                        : `${saludPresupuesto.fijos.compromisoPct.toFixed(0)}% cubierto`}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.healthItemAmounts}>
                            <Text style={styles.healthNumbers}>
                                {formatCurrency(saludPresupuesto.fijos.compromisoPagado)}
                                <Text style={styles.healthNumbersMuted}>
                                    {' '}
                                    / {formatCurrency(saludPresupuesto.fijos.compromisoPresupuestado)}
                                </Text>
                            </Text>
                        </View>

                        <View style={styles.healthTrackBar}>
                            <View
                                style={[
                                    styles.healthFillBar,
                                    {
                                        width: `${Math.min(100, saludPresupuesto.fijos.compromisoPct)}%`,
                                        backgroundColor:
                                            saludPresupuesto.fijos.compromisoPct >= 100 ? '#10B981' : '#38BDF8',
                                    },
                                ]}
                            />
                        </View>
                    </View>

                    <View style={styles.innerDivider} />

                    {/* Métrica 2: Ocio y Gastos Variables */}
                    <View style={styles.healthItem}>
                        <View style={styles.healthItemHeader}>
                            <View style={styles.healthItemTitleRow}>
                                <Text style={styles.healthItemTitle}>🍿 Dinero Libre / Ocio</Text>
                                <Text style={styles.healthItemSub}>
                                    Consumo variable vs. límite asignado
                                </Text>
                            </View>
                            <View
                                style={[
                                    styles.healthBadge,
                                    saludPresupuesto.ocio.ocioAgotado
                                        ? styles.healthBadgeDanger
                                        : saludPresupuesto.ocio.ocioPct >= 75
                                            ? styles.healthBadgeWarning
                                            : styles.healthBadgeSuccess,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.healthBadgeText,
                                        saludPresupuesto.ocio.ocioAgotado
                                            ? styles.healthTextDanger
                                            : saludPresupuesto.ocio.ocioPct >= 75
                                                ? styles.healthTextWarning
                                                : styles.healthTextSuccess,
                                    ]}
                                >
                                    {saludPresupuesto.ocio.ocioAgotado
                                        ? '⚠️ Agotado'
                                        : saludPresupuesto.ocio.ocioPct >= 75
                                            ? '⚡ Precaución'
                                            : '✅ Bajo control'}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.healthItemAmounts}>
                            <Text style={styles.healthNumbers}>
                                {formatCurrency(saludPresupuesto.ocio.ocioConsumido)}
                                <Text style={styles.healthNumbersMuted}>
                                    {' '}
                                    / {formatCurrency(saludPresupuesto.ocio.limiteOcio)}
                                </Text>
                            </Text>
                            <Text style={styles.healthRemainingSub}>
                                {saludPresupuesto.ocio.ocioAgotado
                                    ? `Sobregiro de ${formatCurrency(
                                        saludPresupuesto.ocio.ocioConsumido - saludPresupuesto.ocio.limiteOcio
                                    )}`
                                    : `Disponible: ${formatCurrency(saludPresupuesto.ocio.ocioRestante)}`}
                            </Text>
                        </View>

                        <View style={styles.healthTrackBar}>
                            <View
                                style={[
                                    styles.healthFillBar,
                                    {
                                        width: `${Math.min(100, saludPresupuesto.ocio.ocioPct)}%`,
                                        backgroundColor: saludPresupuesto.ocio.ocioAgotado
                                            ? '#EF4444'
                                            : saludPresupuesto.ocio.ocioPct >= 75
                                                ? '#F59E0B'
                                                : '#10B981',
                                    },
                                ]}
                            />
                        </View>
                    </View>

                    <View style={styles.innerDivider} />

                    {/* Métrica 3: Colchón / Reserva de Seguridad */}
                    <View style={styles.healthItem}>
                        <View style={styles.healthItemHeader}>
                            <View style={styles.healthItemTitleRow}>
                                <Text style={styles.healthItemTitle}>🛡️ Colchón de Imprevistos</Text>
                                <Text style={styles.healthItemSub}>
                                    Reserva táctica de emergencia
                                </Text>
                            </View>
                            <View
                                style={[
                                    styles.healthBadge,
                                    saludPresupuesto.buffer.bufferTotalInicial === 0
                                        ? styles.healthBadgePending
                                        : saludPresupuesto.buffer.bufferConsumido === 0
                                            ? styles.healthBadgeSuccess
                                            : saludPresupuesto.buffer.bufferIntacto > 0
                                                ? styles.healthBadgeWarning
                                                : styles.healthBadgeDanger,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.healthBadgeText,
                                        saludPresupuesto.buffer.bufferTotalInicial === 0
                                            ? styles.healthTextPending
                                            : saludPresupuesto.buffer.bufferConsumido === 0
                                                ? styles.healthTextSuccess
                                                : saludPresupuesto.buffer.bufferIntacto > 0
                                                    ? styles.healthTextWarning
                                                    : styles.healthTextDanger,
                                    ]}
                                >
                                    {saludPresupuesto.buffer.bufferTotalInicial === 0
                                        ? 'Sin asignar'
                                        : saludPresupuesto.buffer.bufferConsumido === 0
                                            ? '🛡️ 100% Intacto'
                                            : saludPresupuesto.buffer.bufferIntacto > 0
                                                ? `⚠️ En reserva (-${formatCurrency(saludPresupuesto.buffer.bufferConsumido)})`
                                                : ' Agotado'}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.healthItemAmounts}>
                            <Text style={styles.healthNumbers}>
                                {formatCurrency(saludPresupuesto.buffer.bufferIntacto)}
                                <Text style={styles.healthNumbersMuted}>
                                    {' '}
                                    intacto de {formatCurrency(saludPresupuesto.buffer.bufferTotalInicial)}
                                </Text>
                            </Text>
                        </View>

                        <View style={styles.healthTrackBar}>
                            <View
                                style={[
                                    styles.healthFillBar,
                                    {
                                        width: `${Math.min(100, saludPresupuesto.buffer.bufferPctIntacto)}%`,
                                        backgroundColor:
                                            saludPresupuesto.buffer.bufferTotalInicial === 0
                                                ? '#475569'
                                                : saludPresupuesto.buffer.bufferConsumido === 0
                                                    ? '#10B981'
                                                    : saludPresupuesto.buffer.bufferIntacto > 0
                                                        ? '#F59E0B'
                                                        : '#EF4444',
                                    },
                                ]}
                            />
                        </View>
                    </View>
                </View>

                {/* Espacio inferior de respiro para que no choque con la TabBar */}
                <View style={styles.bottomSpacer} />
            </ScrollView>
        </SafeAreaView>
    );
}

// ─────────────────────────────────────────────────────────────
// SISTEMA DE DISEÑO (DARK MODE ESTRICTO)
// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#0B0F17',
    },
    loadingContainer: {
        flex: 1,
        backgroundColor: '#0B0F17',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
    },
    loadingText: {
        color: '#94A3B8',
        fontSize: 14,
        fontWeight: '500',
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 24,
        gap: 16,
    },

    // Header Principal de la Pantalla
    screenHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 4,
        marginBottom: 2,
    },
    screenTitle: {
        fontSize: 26,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: -0.5,
    },
    screenSubtitle: {
        fontSize: 12,
        color: '#94A3B8',
        marginTop: 2,
    },
    periodBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: '#161F30',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#24324D',
    },
    periodBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#38BDF8',
    },

    // Selector de Temporalidad (Pill Segmentado)
    temporalToggleContainer: {
        flexDirection: 'row',
        backgroundColor: '#161F30',
        borderRadius: 14,
        padding: 4,
        borderWidth: 1,
        borderColor: '#24324D',
        gap: 6,
    },
    temporalTab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderRadius: 10,
        gap: 6,
    },
    temporalTabActive: {
        backgroundColor: '#38BDF8',
    },
    temporalTabText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#94A3B8',
    },
    temporalTabTextActive: {
        color: '#0B0F17',
        fontWeight: '800',
    },

    // Tarjeta Modular Base
    card: {
        backgroundColor: '#161F30',
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#24324D',
        padding: 18,
        gap: 14,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    cardHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flex: 1,
    },
    iconCircle: {
        width: 34,
        height: 34,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    cardTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: '#F8FAFC',
    },
    cardSubtitle: {
        fontSize: 12,
        color: '#94A3B8',
        marginTop: 1,
    },
    cardDivider: {
        height: 1,
        backgroundColor: '#1E293B',
        width: '100%',
    },
    innerDivider: {
        height: 1,
        backgroundColor: 'rgba(36, 50, 77, 0.6)',
        width: '100%',
        marginVertical: 4,
    },

    // Módulo 1: Balance y Remanente
    statusPill: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusPillPositive: {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
    },
    statusPillNegative: {
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
    },
    statusPillText: {
        fontSize: 11,
        fontWeight: '700',
    },
    statusTextPositive: {
        color: '#10B981',
    },
    statusTextNegative: {
        color: '#EF4444',
    },
    netRemainingBox: {
        backgroundColor: '#0E1420',
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#1E293B',
        gap: 4,
    },
    netRemainingLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#94A3B8',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    netAmountRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
    },
    netRemainingAmount: {
        fontSize: 30,
        fontWeight: '800',
        letterSpacing: -0.5,
    },
    currencyBadge: {
        fontSize: 14,
        fontWeight: '700',
        color: '#64748B',
    },
    netRemainingExplanation: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 4,
        lineHeight: 16,
    },
    balanceSplitRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
    },
    balanceColumn: {
        flex: 1,
        gap: 4,
    },
    balanceItemHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    balanceItemLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#94A3B8',
    },
    balanceItemValue: {
        fontSize: 18,
        fontWeight: '800',
    },
    balanceItemSub: {
        fontSize: 11,
        color: '#64748B',
    },
    verticalDivider: {
        width: 1,
        backgroundColor: '#1E293B',
        alignSelf: 'stretch',
    },
    balanceFootnote: {
        backgroundColor: 'rgba(36, 50, 77, 0.4)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 10,
    },
    balanceFootnoteText: {
        fontSize: 12,
        color: '#94A3B8',
        lineHeight: 16,
    },
    footnoteHighlight: {
        color: '#F8FAFC',
        fontWeight: '700',
    },

    // Módulo 2: Distribución de Bolsas
    totalBudgetBadge: {
        fontSize: 13,
        fontWeight: '700',
        color: '#38BDF8',
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 8,
    },
    segmentedBarTrack: {
        flexDirection: 'row',
        height: 14,
        borderRadius: 7,
        overflow: 'hidden',
        backgroundColor: '#24324D',
        marginTop: 4,
    },
    segment: {
        height: '100%',
    },
    legendGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginTop: 4,
    },
    legendItem: {
        width: '48%',
        backgroundColor: '#0E1420',
        borderRadius: 12,
        padding: 10,
        borderWidth: 1,
        borderColor: '#1E293B',
        gap: 4,
    },
    legendDotRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    legendDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    legendName: {
        fontSize: 12,
        fontWeight: '600',
        color: '#94A3B8',
        flex: 1,
    },
    legendValuesRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 2,
    },
    legendPercentage: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
    },
    legendAmount: {
        fontSize: 13,
        fontWeight: '800',
        color: '#FFFFFF',
    },

    // Módulo 3: Top Gastos
    countBadge: {
        backgroundColor: '#24324D',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    countBadgeText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#94A3B8',
    },
    emptyStateContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 24,
        gap: 6,
    },
    emptyStateTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#94A3B8',
        fontStyle: 'italic',
        marginTop: 6,
        textAlign: 'center',
    },
    emptyStateSubtitle: {
        fontSize: 12,
        color: '#64748B',
        textAlign: 'center',
        paddingHorizontal: 16,
    },
    categoryList: {
        gap: 12,
        marginTop: 4,
    },
    categoryItem: {
        gap: 6,
    },
    categoryTopRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    categoryNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
    },
    categoryNameText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#F8FAFC',
        maxWidth: '70%',
    },
    categoryCountBadge: {
        backgroundColor: '#24324D',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    categoryCountBadgeText: {
        fontSize: 10,
        fontWeight: '600',
        color: '#94A3B8',
    },
    categoryAmountRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    categoryAmountText: {
        fontSize: 14,
        fontWeight: '800',
        color: '#FFFFFF',
    },
    categoryPctBadge: {
        fontSize: 12,
        fontWeight: '700',
        minWidth: 42,
        textAlign: 'right',
    },
    categoryTrackBar: {
        height: 7,
        borderRadius: 4,
        backgroundColor: '#24324D',
        overflow: 'hidden',
    },
    categoryFillBar: {
        height: '100%',
        borderRadius: 4,
    },

    // Módulo 4: Salud del Presupuesto
    healthItem: {
        gap: 8,
    },
    healthItemHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    healthItemTitleRow: {
        flex: 1,
        gap: 2,
    },
    healthItemTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#F8FAFC',
    },
    healthItemSub: {
        fontSize: 11,
        color: '#64748B',
    },
    healthBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    healthBadgeSuccess: {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
    },
    healthBadgeProgress: {
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
    },
    healthBadgeWarning: {
        backgroundColor: 'rgba(245, 158, 11, 0.15)',
    },
    healthBadgeDanger: {
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
    },
    healthBadgePending: {
        backgroundColor: 'rgba(100, 116, 139, 0.2)',
    },
    healthBadgeText: {
        fontSize: 11,
        fontWeight: '700',
    },
    healthTextSuccess: {
        color: '#10B981',
    },
    healthTextProgress: {
        color: '#38BDF8',
    },
    healthTextWarning: {
        color: '#F59E0B',
    },
    healthTextDanger: {
        color: '#EF4444',
    },
    healthTextPending: {
        color: '#94A3B8',
    },
    healthItemAmounts: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
    },
    healthNumbers: {
        fontSize: 15,
        fontWeight: '800',
        color: '#FFFFFF',
    },
    healthNumbersMuted: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
    },
    healthRemainingSub: {
        fontSize: 12,
        fontWeight: '600',
        color: '#94A3B8',
    },
    healthTrackBar: {
        height: 8,
        borderRadius: 4,
        backgroundColor: '#0B0F17',
        overflow: 'hidden',
    },
    healthFillBar: {
        height: '100%',
        borderRadius: 4,
    },

    bottomSpacer: {
        height: 20,
    },
});