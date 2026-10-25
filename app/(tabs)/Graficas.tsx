import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
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

import { Theme } from '@/constants/theme';
import { auth, db } from '@/services/firebase';
import { Budget, Transaction, UserProfile } from '@/types/database';
import { deduplicateBudgets } from '@/utils/budgets';
import { getTransactionDate } from '@/utils/dates';
import { getNextCycleBlocks, getPeriodInfo, PayFrequency } from '@/utils/periods';

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
    const [subFixedExpenses, setSubFixedExpenses] = useState<Budget[]>([]);
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
        let unsubscribeFixed = () => { };
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

            // B. Presupuestos permanentes (Opción B)
            const budgetsQuery = query(
                collection(db, 'budgets'),
                where('userId', '==', user.uid)
            );
            unsubscribeBudgets = onSnapshot(
                budgetsQuery,
                (snapshot) => {
                    const rawDocs: Budget[] = snapshot.docs.map((d) => ({
                        id: d.id,
                        ...(d.data() as Omit<Budget, 'id'>),
                    }));
                    // Deduplicar presupuestos por categoría
                    setBudgets(deduplicateBudgets(rawDocs));
                },
                (error) => {
                    console.error('Error al suscribir presupuestos en Graficas:', error);
                }
            );

            // B.1 Suscripción reactiva en tiempo real a la subcolección users/{uid}/fixedExpenses
            const fixedExpensesRef = collection(db, 'users', user.uid, 'fixedExpenses');
            const unsubscribeFixed = onSnapshot(
                fixedExpensesRef,
                (snapshot) => {
                    const items: Budget[] = snapshot.docs.map((d) => {
                        const data = d.data();
                        const rawBlock = data.dueBlock;
                        let dueBlock: any = 'mid';
                        if (rawBlock === '1-10' || rawBlock === 'start') dueBlock = 'start';
                        else if (rawBlock === '11-20' || rawBlock === 'mid') dueBlock = 'mid';
                        else if (rawBlock === '21-end' || rawBlock === 'end') dueBlock = 'end';

                        return {
                            id: d.id,
                            userId: user.uid,
                            name: data.concept || data.name || 'Gasto Fijo',
                            category: data.concept || data.name || 'Gasto Fijo',
                            limitAmount: Number(data.amount) || 0,
                            dueBlock,
                            isFixedExpense: true,
                            createdAt: data.createdAt,
                            updatedAt: data.updatedAt,
                        };
                    });
                    setSubFixedExpenses(items);
                },
                (error) => {
                    console.error('Error al suscribir fixedExpenses en Graficas:', error);
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
            unsubscribeFixed();
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
    const isMonthlyPay = payFrequency === 'monthly';
    const effectiveScope: 'cycle' | 'month' = isMonthlyPay ? 'month' : scope;
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
                    const txDate = getTransactionDate(t);
                    return txDate >= periodInfo.startDate && txDate <= periodInfo.endDate;
                }
                return t.monthYear === currentMonthYear;
            } else {
                // Mes completo
                if (t.monthYear) {
                    return t.monthYear === currentMonthYear;
                }
                const d = getTransactionDate(t);
                const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                return ym === currentMonthYear;
            }
        };
    }, [periodInfo, currentMonthYear]);

    // Transacciones filtradas para el scope activo
    const scopedTransactions = useMemo(() => {
        return transactions.filter((t) => isInScope(t, effectiveScope));
    }, [transactions, isInScope, effectiveScope]);

    // Presupuestos fijos unificados (subcolección reactiva + retrocompatibilidad budgets)
    const presupuestosFijos = useMemo(() => {
        if (subFixedExpenses.length > 0) return subFixedExpenses;
        return budgets.filter((b) => b.isFixedExpense);
    }, [subFixedExpenses, budgets]);

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
        const baseIncome = effectiveScope === 'cycle' ? amountPerPeriod : (monthlyIncome || amountPerPeriod * cycleDivisor);

        // Sueldos registrados efectivamente en transacciones para el periodo
        const salaryIncomes = scopedTransactions
            .filter((t) => t.type === 'income' && t.category === '💵 Sueldo')
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        // Ingresos extraordinarios (excluyendo sueldo base, ingreso inicial de setup y cuota base de ahorro)
        const extraIncomes = scopedTransactions
            .filter(
                (t) =>
                    t.type === 'income' &&
                    t.category !== '💵 Sueldo' &&
                    t.category !== 'Ingreso Inicial' &&
                    t.category !== '🎯 Ahorro Base'
            )
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        // Total Ingresos = Si ya se abonó el sueldo, se toma el valor real; si no, la base presupuestada esperada + extras
        const ingresos = Math.max(baseIncome, salaryIncomes) + extraIncomes;

        // Fijos Cubiertos:
        // Se calcula reactivamente a partir de las transacciones de gastos fijos del periodo (Opción B)
        let fijosPagados = 0;
        if (effectiveScope === 'cycle') {
            fijosPagados = scopedTransactions
                .filter((t) => t.type === 'expense' && (t.isFixedExpense || t.category === 'Gasto Fijo'))
                .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        } else {
            // Mes completo
            fijosPagados = scopedTransactions
                .filter((t) => t.type === 'expense' && (t.isFixedExpense || t.category === 'Gasto Fijo'))
                .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
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
    }, [effectiveScope, amountPerPeriod, monthlyIncome, cycleDivisor, scopedTransactions, budgets, periodInfo]);

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
        const isCycle = effectiveScope === 'cycle';
        const div = isCycle ? cycleDivisor : 1;

        // 1. 🏠 Gastos Fijos
        let fijos = 0;
        if (isCycle && userProfile?.hasPreSavedNextCycle === false && isFirstCycle) {
            const nextCycleBlocks = getNextCycleBlocks(payFrequency, payDayOfWeek);
            const relevantBlocks = new Set([...periodInfo.activeBlocks, ...nextCycleBlocks]);
            fijos = presupuestosFijos
                .filter((b) => b.isFixedExpense && b.dueBlock && relevantBlocks.has(b.dueBlock))
                .reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);
        } else {
            const totalFijosMensuales = presupuestosFijos
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
        effectiveScope,
        cycleDivisor,
        userProfile,
        isFirstCycle,
        payFrequency,
        payDayOfWeek,
        periodInfo,
        budgets,
        presupuestosFijos,
        savingsTarget,
        amountPerPeriod,
        monthlyIncome,
    ]);

    // ─────────────────────────────────────────────────────────────
    // CÁLCULOS: AHORRO ACUMULADO HISTÓRICO (Opción A: Flujo Real)
    // ─────────────────────────────────────────────────────────────
    const ahorroAcumuladoData = useMemo(() => {
        const isSavingsIncome = (t: Transaction): boolean => {
            if (t.type !== 'income') return false;
            const target = (
                (t.targetBucket as string) ||
                (t as any).toBucket ||
                (t as any).destination ||
                ''
            ).toLowerCase();
            const cat = (t.category || '').toLowerCase();
            return target === 'savings' || target === 'ahorro' || cat.includes('ahorro');
        };

        const isSavingsExpense = (t: Transaction): boolean => {
            if (t.type !== 'expense') return false;
            const origin = (
                (t.origin as string) ||
                (t as any).fromBucket ||
                (t as any).sourceBucket ||
                (t.targetBucket as string) ||
                ''
            ).toLowerCase();
            const cat = (t.category || '').toLowerCase();
            return (
                origin === 'savings' ||
                origin === 'ahorro' ||
                cat.includes('retiro de ahorro') ||
                cat.includes('retiro ahorro')
            );
        };

        // 1. Histórico Completo
        let totalIngresos = 0;
        let totalEgresos = 0;
        for (const t of transactions) {
            const amount = Number(t.amount) || 0;
            if (isSavingsIncome(t)) {
                totalIngresos += amount;
            } else if (isSavingsExpense(t)) {
                totalEgresos += amount;
            }
        }
        const totalAcumulado = Math.max(0, totalIngresos - totalEgresos);

        // 2. Aportación / Movimiento en el Periodo Activo (scopedTransactions)
        let periodoIngresos = 0;
        let periodoEgresos = 0;
        for (const t of scopedTransactions) {
            const amount = Number(t.amount) || 0;
            if (isSavingsIncome(t)) {
                periodoIngresos += amount;
            } else if (isSavingsExpense(t)) {
                periodoEgresos += amount;
            }
        }
        const periodoNeto = periodoIngresos - periodoEgresos;

        return {
            totalAcumulado,
            totalIngresos,
            totalEgresos,
            periodoNeto,
            periodoIngresos,
            periodoEgresos,
        };
    }, [transactions, scopedTransactions]);

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
        const isCycle = effectiveScope === 'cycle';
        const div = isCycle ? cycleDivisor : 1;

        // A. Compromisos Fijos anclados SIEMPRE a escala mensual (Punto 1)
        const compromisoPresupuestado = presupuestosFijos
            .reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);

        const compromisoPagado = transactions
            .filter((t) => {
                if (t.type !== 'expense') return false;
                if (!t.isFixedExpense && t.category !== 'Gasto Fijo') return false;
                if (t.monthYear) return t.monthYear === currentMonthYear;
                const d = getTransactionDate(t);
                const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                return ym === currentMonthYear;
            })
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        const compromisoPct = compromisoPresupuestado > 0
            ? Math.min(100, (compromisoPagado / compromisoPresupuestado) * 100)
            : 100;

        // B. Ocio / Variable
        const extraOcio = scopedTransactions
            .filter((t) => t.type === 'income' && t.category !== '💵 Sueldo' && (t.targetBucket === 'leisure' || !t.targetBucket))
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

        const limiteOcio = ocioMaster + extraOcio;
        // Solo computar como ocio las transacciones variables que no estén asignadas a colchón
        const ocioConsumido = scopedTransactions
            .filter((t) => t.type === 'expense' && !t.isFixedExpense && t.category !== 'Gasto Fijo' && t.targetBucket !== 'buffer')
            .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        const ocioPct = limiteOcio > 0 ? (ocioConsumido / limiteOcio) * 100 : 0;
        const ocioAgotado = limiteOcio > 0 ? ocioConsumido >= limiteOcio : false;
        const ocioRestante = Math.max(0, limiteOcio - ocioConsumido);

        // Indicador de Ritmo Temporal (Pacing - Punto 2)
        const now = new Date();
        const totalDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        let diaActual = 1;
        let diasTotales = 30;

        if (effectiveScope === 'month' || payFrequency === 'monthly') {
            diaActual = Math.min(totalDaysInMonth, Math.max(1, now.getDate()));
            diasTotales = totalDaysInMonth;
        } else if (payFrequency === 'weekly') {
            const targetDay = typeof payDayOfWeek === 'number' && payDayOfWeek >= 0 && payDayOfWeek <= 6 ? payDayOfWeek : 5;
            const currentDayOfWeek = now.getDay();
            const diff = (currentDayOfWeek - targetDay + 7) % 7;
            diaActual = Math.min(7, Math.max(1, diff + 1));
            diasTotales = 7;
        } else {
            // biweekly (quincenal)
            const day = now.getDate();
            if (day <= 15) {
                diaActual = Math.min(15, Math.max(1, day));
                diasTotales = 15;
            } else {
                diaActual = Math.min(totalDaysInMonth - 15, Math.max(1, day - 15));
                diasTotales = totalDaysInMonth - 15;
            }
        }

        const pacingLegend = limiteOcio > 0
            ? `Vas gastando ${formatCurrency(ocioConsumido)} de ${formatCurrency(limiteOcio)} al día ${diaActual} de ${diasTotales}`
            : `Vas gastando ${formatCurrency(ocioConsumido)} al día ${diaActual} de ${diasTotales}`;

        const pctTiempo = diasTotales > 0 ? (diaActual / diasTotales) * 100 : 0;
        const isLimitReached = ocioAgotado;
        const isAccelerated = !isLimitReached && limiteOcio > 0 && (ocioPct > pctTiempo + 5 || ocioPct >= 80);
        const isUnderControl = !isLimitReached && !isAccelerated;

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

        const totalConsumoBuffer = gastoExcedenteOcio + gastosConBucketBuffer;
        const bufferConsumido = Math.min(
            bufferTotalInicial,
            totalConsumoBuffer
        );
        const bufferIntacto = Math.max(0, bufferTotalInicial - totalConsumoBuffer);
        const bufferPctIntacto = bufferTotalInicial > 0 ? (bufferIntacto / bufferTotalInicial) * 100 : 0;

        // Estados del Colchón homologados con el Home (umbral 25% y 15%)
        const userHasBuffer = bufferTotalInicial > 0;
        const isBufferOverdrawn = totalConsumoBuffer > bufferTotalInicial;
        const isBufferCritical = isBufferOverdrawn || (userHasBuffer && (bufferPctIntacto < 15 || ocioAgotado));
        const isBufferWarning = !isBufferCritical && userHasBuffer && bufferConsumido > 0 && bufferPctIntacto < 25;
        const isBufferActiveHealthy = !isBufferCritical && !isBufferWarning && userHasBuffer && bufferConsumido > 0 && bufferPctIntacto >= 25 && !ocioAgotado;

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
                diaActual,
                diasTotales,
                pacingLegend,
                isLimitReached,
                isAccelerated,
                isUnderControl,
            },
            buffer: {
                bufferTotalInicial,
                bufferConsumido,
                bufferIntacto,
                bufferPctIntacto,
                isBufferActiveHealthy,
                isBufferWarning,
                isBufferCritical,
            },
        };
    }, [
        effectiveScope,
        cycleDivisor,
        periodInfo,
        budgets,
        presupuestosFijos,
        transactions,
        currentMonthYear,
        payFrequency,
        payDayOfWeek,
        scopedTransactions,
        ocioMaster,
        bufferMaster,
    ]);

    // Colores para las barras de progreso del Top de Categorías
    const categoriaColores = [
        Theme.colors.fixed,   // Cyan
        Theme.colors.savings, // Morado
        Theme.colors.leisure, // Ámbar
        Theme.colors.buffer,  // Esmeralda
        '#EC4899',            // Rosa
        '#6366F1',            // Índigo
        '#14B8A6',            // Teal
        '#F97316',            // Naranja
    ];

    if (loading) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
                <ActivityIndicator size="large" color={Theme.colors.fixed} />
                <Text style={styles.loadingText}>Cargando análisis financiero...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={Theme.colors.fixed}
                        colors={[Theme.colors.fixed]}
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
                        <Ionicons name="calendar-outline" size={13} color={Theme.colors.fixed} />
                        <Text style={styles.periodBadgeText}>
                            {effectiveScope === 'cycle' ? periodInfo.label : currentMonthLabel}
                        </Text>
                    </View>
                </View>

                {/* Tabs Segmentados: Solo si la frecuencia es semanal o quincenal. Si es mensual, se muestra únicamente la vista consolidada */}
                {!isMonthlyPay ? (
                    <View style={styles.temporalToggleContainer}>
                        <TouchableOpacity
                            style={[
                                styles.temporalTab,
                                effectiveScope === 'cycle' && styles.temporalTabActive,
                            ]}
                            onPress={() => setScope('cycle')}
                            activeOpacity={0.7}
                        >
                            <Ionicons
                                name="flash-outline"
                                size={14}
                                color={effectiveScope === 'cycle' ? Theme.colors.background : Theme.colors.textSecondary}
                            />
                            <Text
                                style={[
                                    styles.temporalTabText,
                                    effectiveScope === 'cycle' && styles.temporalTabTextActive,
                                ]}
                            >
                                Este Ciclo ({periodInfo.label})
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.temporalTab,
                                effectiveScope === 'month' && styles.temporalTabActive,
                            ]}
                            onPress={() => setScope('month')}
                            activeOpacity={0.7}
                        >
                            <Ionicons
                                name="calendar"
                                size={14}
                                color={effectiveScope === 'month' ? Theme.colors.background : Theme.colors.textSecondary}
                            />
                            <Text
                                style={[
                                    styles.temporalTabText,
                                    effectiveScope === 'month' && styles.temporalTabTextActive,
                                ]}
                            >
                                Mes Completo
                            </Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={styles.monthlyConsolidatedCard}>
                        <View style={styles.monthlyConsolidatedBadge}>
                            <Ionicons name="calendar" size={15} color={Theme.colors.fixed} />
                            <Text style={styles.monthlyConsolidatedTitle}>
                                Vista Consolidada: Mes Completo
                            </Text>
                        </View>
                        <Text style={styles.monthlyConsolidatedSubtitle}>
                            {currentMonthLabel}
                        </Text>
                    </View>
                )}

                {/* ─────────────────────────────────────────────────────────────
            MÓDULO 1: CABECERA Y RESUMEN GLOBAL (BALANCE DE FLUJO)
            ───────────────────────────────────────────────────────────── */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                                <Ionicons name="wallet-outline" size={18} color={Theme.colors.fixed} />
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
                                    { color: remanenteNeto >= 0 ? Theme.colors.statusSuccess : Theme.colors.statusDanger },
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
                                <Ionicons name="arrow-down-circle" size={16} color={Theme.colors.income} />
                                <Text style={styles.balanceItemLabel}>Ingresos</Text>
                            </View>
                            <Text style={[styles.balanceItemValue, { color: Theme.colors.income }]}>
                                +{formatCurrency(totalIngresos)}
                            </Text>
                            <Text style={styles.balanceItemSub}>
                                {effectiveScope === 'cycle' ? 'Sueldo ciclo + extras' : 'Sueldo mes + extras'}
                            </Text>
                        </View>

                        {/* Línea divisoria vertical */}
                        <View style={styles.verticalDivider} />

                        {/* Columna Gastos Totales */}
                        <View style={styles.balanceColumn}>
                            <View style={styles.balanceItemHeader}>
                                <Ionicons name="arrow-up-circle" size={16} color={Theme.colors.expense} />
                                <Text style={styles.balanceItemLabel}>Gastos Totales</Text>
                            </View>
                            <Text style={[styles.balanceItemValue, { color: Theme.colors.expense }]}>
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
                                <Feather name="pie-chart" size={17} color={Theme.colors.savings} />
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
                                    { flex: pctFijos, backgroundColor: Theme.colors.fixed },
                                ]}
                            />
                        )}
                        {pctAhorro > 0 && (
                            <View
                                style={[
                                    styles.segment,
                                    { flex: pctAhorro, backgroundColor: Theme.colors.savings },
                                ]}
                            />
                        )}
                        {pctOcio > 0 && (
                            <View
                                style={[
                                    styles.segment,
                                    { flex: pctOcio, backgroundColor: Theme.colors.leisure },
                                ]}
                            />
                        )}
                        {pctBuffer > 0 && (
                            <View
                                style={[
                                    styles.segment,
                                    { flex: pctBuffer, backgroundColor: Theme.colors.buffer },
                                ]}
                            />
                        )}
                        {totalMaster === 0 && (
                            <View style={[styles.segment, { flex: 1, backgroundColor: Theme.colors.border }]} />
                        )}
                    </View>

                    {/* Leyenda en Cuadrícula (Grid de 2 Columnas) */}
                    <View style={styles.legendGrid}>
                        {/* Bolsa 1: Gastos Fijos */}
                        <View style={styles.legendItem}>
                            <View style={styles.legendDotRow}>
                                <View style={[styles.legendDot, { backgroundColor: Theme.colors.fixed }]} />
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
                                <View style={[styles.legendDot, { backgroundColor: Theme.colors.savings }]} />
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
                                <View style={[styles.legendDot, { backgroundColor: Theme.colors.leisure }]} />
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
                                <View style={[styles.legendDot, { backgroundColor: Theme.colors.buffer }]} />
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
            MÓDULO: AHORRO TOTAL ACUMULADO (HISTÓRICO CONSOLIDADO)
            ───────────────────────────────────────────────────────────── */}
                <View style={styles.card}>
                    <View style={styles.cardHeader}>
                        <View style={styles.cardHeaderLeft}>
                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(168, 85, 247, 0.15)' }]}>
                                <Ionicons name="cash-outline" size={18} color={Theme.colors.savings} />
                            </View>
                            <View>
                                <Text style={styles.cardTitle}>Ahorro Total Acumulado</Text>
                                <Text style={styles.cardSubtitle}>
                                    Fondo consolidado en reserva histórica
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Visor de Monto Hero */}
                    <View style={styles.savingsHeroBox}>
                        <Text style={styles.savingsHeroLabel}>Capital en Reserva</Text>
                        <View style={styles.savingsAmountRow}>
                            <Text style={styles.savingsAmountText}>
                                {formatCurrency(ahorroAcumuladoData.totalAcumulado)}
                            </Text>
                            <Text style={styles.currencyBadge}>MXN</Text>
                        </View>

                        {/* Micro-badge contextual de aportación del periodo */}
                        <View style={styles.savingsBadgeRow}>
                            <View
                                style={[
                                    styles.savingsTrendBadge,
                                    ahorroAcumuladoData.periodoNeto > 0
                                        ? styles.savingsTrendBadgePositive
                                        : ahorroAcumuladoData.periodoNeto < 0
                                            ? styles.savingsTrendBadgeNegative
                                            : styles.savingsTrendBadgeNeutral,
                                ]}
                            >
                                <Ionicons
                                    name={
                                        ahorroAcumuladoData.periodoNeto > 0
                                            ? 'trending-up'
                                            : ahorroAcumuladoData.periodoNeto < 0
                                                ? 'trending-down'
                                                : 'remove-outline'
                                    }
                                    size={13}
                                    color={
                                        ahorroAcumuladoData.periodoNeto > 0
                                            ? Theme.colors.statusSuccess
                                            : ahorroAcumuladoData.periodoNeto < 0
                                                ? Theme.colors.statusDanger
                                                : Theme.colors.textMuted
                                    }
                                />
                                <Text
                                    style={[
                                        styles.savingsTrendText,
                                        ahorroAcumuladoData.periodoNeto > 0
                                            ? styles.savingsTrendTextPositive
                                            : ahorroAcumuladoData.periodoNeto < 0
                                                ? styles.savingsTrendTextNegative
                                                : styles.savingsTrendTextNeutral,
                                    ]}
                                >
                                    {ahorroAcumuladoData.periodoNeto > 0
                                        ? `+${formatCurrency(ahorroAcumuladoData.periodoNeto)} en este periodo`
                                        : ahorroAcumuladoData.periodoNeto < 0
                                            ? `-${formatCurrency(Math.abs(ahorroAcumuladoData.periodoNeto))} en este periodo`
                                            : 'Sin aportaciones en este periodo'}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <View style={styles.cardDivider} />

                    {/* Desglose / Comparativa de Apoyo */}
                    <View style={styles.savingsFootnoteRow}>
                        <View style={styles.savingsFootnoteItem}>
                            <Text style={styles.savingsFootnoteLabel}>Meta del Ciclo</Text>
                            <Text style={styles.savingsFootnoteValue}>
                                {formatCurrency(ahorroMaster)}
                            </Text>
                        </View>
                        <View style={styles.verticalDivider} />
                        <View style={styles.savingsFootnoteItem}>
                            <Text style={styles.savingsFootnoteLabel}>Meta Mensual</Text>
                            <Text style={styles.savingsFootnoteValue}>
                                {formatCurrency(savingsTarget)}
                            </Text>
                        </View>
                        <View style={styles.verticalDivider} />
                        <View style={styles.savingsFootnoteItem}>
                            <Text style={styles.savingsFootnoteLabel}>Aportado Histórico</Text>
                            <Text style={[styles.savingsFootnoteValue, { color: Theme.colors.savings }]}>
                                {formatCurrency(ahorroAcumuladoData.totalIngresos)}
                            </Text>
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
                                <Ionicons name="bar-chart-outline" size={18} color={Theme.colors.leisure} />
                            </View>
                            <View>
                                <Text style={styles.cardTitle}>Top de Gastos por Categoría</Text>
                                <Text style={styles.cardSubtitle}>
                                    Concentración del egreso en el periodo
                                </Text>
                            </View>
                        </View>
                    </View>

                    {topCategorias.length === 0 ? (
                        <View style={styles.emptyStateContainer}>
                            <Ionicons name="receipt-outline" size={40} color={Theme.colors.textMuted} />
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
                                <MaterialCommunityIcons name="shield-check-outline" size={18} color={Theme.colors.buffer} />
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
                                    Obligaciones esenciales del mes
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
                                            saludPresupuesto.fijos.compromisoPct >= 100 ? Theme.colors.statusSuccess : Theme.colors.fixed,
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
                                    saludPresupuesto.ocio.isLimitReached
                                        ? styles.healthBadgeDanger
                                        : saludPresupuesto.ocio.isAccelerated
                                            ? styles.healthBadgeWarning
                                            : styles.healthBadgeSuccess,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.healthBadgeText,
                                        saludPresupuesto.ocio.isLimitReached
                                            ? styles.healthTextDanger
                                            : saludPresupuesto.ocio.isAccelerated
                                                ? styles.healthTextWarning
                                                : styles.healthTextSuccess,
                                    ]}
                                >
                                    {saludPresupuesto.ocio.isLimitReached
                                        ? '⚠️ Límite alcanzado'
                                        : saludPresupuesto.ocio.isAccelerated
                                            ? '⚡ Acelerado'
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

                        {/* Leyenda de Ritmo Temporal (Pacing) */}
                        <Text style={styles.healthPacingLegend}>
                            {saludPresupuesto.ocio.pacingLegend}
                        </Text>

                        <View style={styles.healthTrackBar}>
                            <View
                                style={[
                                    styles.healthFillBar,
                                    {
                                        width: `${Math.min(100, saludPresupuesto.ocio.ocioPct)}%`,
                                        backgroundColor: saludPresupuesto.ocio.isLimitReached
                                            ? Theme.colors.statusDanger
                                            : saludPresupuesto.ocio.isAccelerated
                                                ? Theme.colors.statusWarning
                                                : Theme.colors.statusSuccess,
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
                                        : saludPresupuesto.buffer.bufferConsumido === 0 || saludPresupuesto.buffer.isBufferActiveHealthy
                                            ? styles.healthBadgeSuccess
                                            : saludPresupuesto.buffer.isBufferWarning
                                                ? styles.healthBadgeWarning
                                                : styles.healthBadgeDanger,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.healthBadgeText,
                                        saludPresupuesto.buffer.bufferTotalInicial === 0
                                            ? styles.healthTextPending
                                            : saludPresupuesto.buffer.bufferConsumido === 0 || saludPresupuesto.buffer.isBufferActiveHealthy
                                                ? styles.healthTextSuccess
                                                : saludPresupuesto.buffer.isBufferWarning
                                                    ? styles.healthTextWarning
                                                    : styles.healthTextDanger,
                                    ]}
                                >
                                    {saludPresupuesto.buffer.bufferTotalInicial === 0
                                        ? 'Sin asignar'
                                        : saludPresupuesto.buffer.bufferConsumido === 0
                                            ? '🛡️ 100% Intacto'
                                            : saludPresupuesto.buffer.isBufferActiveHealthy
                                                ? `🛡️ Reserva Activa (-${formatCurrency(saludPresupuesto.buffer.bufferConsumido)})`
                                                : saludPresupuesto.buffer.isBufferWarning
                                                    ? `⚠️ Reserva Baja (-${formatCurrency(saludPresupuesto.buffer.bufferConsumido)})`
                                                    : saludPresupuesto.buffer.bufferIntacto <= 0
                                                        ? '🚨 Agotado'
                                                        : '🔴 En Peligro'}
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
                                                ? Theme.colors.textMuted
                                                : saludPresupuesto.buffer.bufferConsumido === 0 || saludPresupuesto.buffer.isBufferActiveHealthy
                                                    ? Theme.colors.buffer
                                                    : saludPresupuesto.buffer.isBufferWarning
                                                        ? Theme.colors.statusWarning
                                                        : Theme.colors.statusDanger,
                                    },
                                ]}
                            />
                        </View>
                    </View>
                </View>
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
        backgroundColor: Theme.colors.background,
    },
    loadingContainer: {
        flex: 1,
        backgroundColor: Theme.colors.background,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
    },
    loadingText: {
        color: Theme.colors.textSecondary,
        fontSize: 14,
        fontWeight: '500',
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 110,
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
        color: Theme.colors.textPrimary,
        letterSpacing: -0.5,
    },
    screenSubtitle: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        marginTop: 2,
    },
    periodBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: Theme.colors.cardSurface,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: Theme.colors.border,
    },
    periodBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.fixed,
    },

    // Selector de Temporalidad (Pill Segmentado)
    temporalToggleContainer: {
        flexDirection: 'row',
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: 14,
        padding: 4,
        borderWidth: 1,
        borderColor: Theme.colors.border,
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
        backgroundColor: Theme.colors.fixed,
    },
    temporalTabText: {
        fontSize: 13,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    temporalTabTextActive: {
        color: Theme.colors.background,
        fontWeight: '800',
    },
    monthlyConsolidatedCard: {
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    monthlyConsolidatedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    monthlyConsolidatedTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    monthlyConsolidatedSubtitle: {
        fontSize: 12,
        fontWeight: '600',
        color: Theme.colors.fixed,
    },

    // Tarjeta Modular Base
    card: {
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: Theme.colors.border,
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
        color: Theme.colors.textPrimary,
    },
    cardSubtitle: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        marginTop: 1,
    },
    cardDivider: {
        height: 1,
        backgroundColor: Theme.colors.borderSubtle,
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
        color: Theme.colors.statusSuccess,
    },
    statusTextNegative: {
        color: Theme.colors.statusDanger,
    },
    netRemainingBox: {
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        gap: 4,
    },
    netRemainingLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
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
        color: Theme.colors.textMuted,
    },
    netRemainingExplanation: {
        fontSize: 12,
        color: Theme.colors.textMuted,
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
        color: Theme.colors.textSecondary,
    },
    balanceItemValue: {
        fontSize: 18,
        fontWeight: '800',
    },
    balanceItemSub: {
        fontSize: 11,
        color: Theme.colors.textMuted,
    },
    verticalDivider: {
        width: 1,
        backgroundColor: Theme.colors.borderSubtle,
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
        color: Theme.colors.textSecondary,
        lineHeight: 16,
    },
    footnoteHighlight: {
        color: Theme.colors.textPrimary,
        fontWeight: '700',
    },

    // Módulo 2: Distribución de Bolsas
    totalBudgetBadge: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.fixed,
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
        backgroundColor: Theme.colors.border,
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
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderRadius: 12,
        padding: 10,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
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
        color: Theme.colors.textSecondary,
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
        color: Theme.colors.textMuted,
    },
    legendAmount: {
        fontSize: 13,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
    },

    // Módulo 3: Top Gastos
    emptyStateContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 24,
        gap: 6,
    },
    emptyStateTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
        fontStyle: 'italic',
        marginTop: 6,
        textAlign: 'center',
    },
    emptyStateSubtitle: {
        fontSize: 12,
        color: Theme.colors.textMuted,
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
        flex: 1,
        marginRight: 8,
    },
    categoryNameText: {
        fontSize: 14,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
        flexShrink: 1,
    },
    categoryAmountRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    categoryAmountText: {
        fontSize: 14,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
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
        backgroundColor: Theme.colors.border,
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
        color: Theme.colors.textPrimary,
    },
    healthItemSub: {
        fontSize: 11,
        color: Theme.colors.textMuted,
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
        color: Theme.colors.statusSuccess,
    },
    healthTextProgress: {
        color: Theme.colors.fixed,
    },
    healthTextWarning: {
        color: Theme.colors.statusWarning,
    },
    healthTextDanger: {
        color: Theme.colors.statusDanger,
    },
    healthTextPending: {
        color: Theme.colors.textSecondary,
    },
    healthItemAmounts: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
    },
    healthNumbers: {
        fontSize: 15,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
    },
    healthNumbersMuted: {
        fontSize: 12,
        fontWeight: '500',
        color: Theme.colors.textMuted,
    },
    healthRemainingSub: {
        fontSize: 12,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    healthPacingLegend: {
        fontSize: 12,
        fontWeight: '500',
        color: Theme.colors.textSecondary,
        marginTop: -2,
    },
    healthTrackBar: {
        height: 8,
        borderRadius: 4,
        backgroundColor: Theme.colors.background,
        overflow: 'hidden',
    },
    healthFillBar: {
        height: '100%',
        borderRadius: 4,
    },

    // Módulo Ahorro Acumulado Histórico
    savingsHeroBox: {
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        gap: 6,
    },
    savingsHeroLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    savingsAmountRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
    },
    savingsAmountText: {
        fontSize: 30,
        fontWeight: '800',
        letterSpacing: -0.5,
        color: Theme.colors.textPrimary,
    },
    savingsBadgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    savingsTrendBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 8,
    },
    savingsTrendBadgePositive: {
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
    },
    savingsTrendBadgeNegative: {
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
    },
    savingsTrendBadgeNeutral: {
        backgroundColor: 'rgba(100, 116, 139, 0.15)',
    },
    savingsTrendText: {
        fontSize: 12,
        fontWeight: '700',
    },
    savingsTrendTextPositive: {
        color: Theme.colors.statusSuccess,
    },
    savingsTrendTextNegative: {
        color: Theme.colors.statusDanger,
    },
    savingsTrendTextNeutral: {
        color: Theme.colors.textMuted,
    },
    savingsFootnoteRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 2,
    },
    savingsFootnoteItem: {
        flex: 1,
        alignItems: 'center',
        gap: 2,
    },
    savingsFootnoteLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: Theme.colors.textMuted,
    },
    savingsFootnoteValue: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
});