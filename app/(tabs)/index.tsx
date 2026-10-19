import { ThemedText } from '@/components/themed-text';
import { Theme } from '@/constants/theme';
import { auth, db } from '@/services/firebase';
import { Budget, Transaction } from '@/types/database';
import { deduplicateBudgets } from '@/utils/budgets';
import { getLocalDateString, getTransactionDate } from '@/utils/dates';
import { DueBlock, getNextCycleBlocks, getPeriodInfo, PayFrequency } from '@/utils/periods';
import { Ionicons } from '@expo/vector-icons';
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const [userName, setUserName] = useState<string>('Usuario');
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [savingsTarget, setSavingTarget] = useState<number>(0);
  // Estados para periodicidad de pago
  const [payFrequency, setPayFrequency] = useState<PayFrequency>('biweekly');
  const [payDayOfWeek, setPayDayOfWeek] = useState<number>(5);
  const [amountPerPeriod, setAmountPerPeriod] = useState<number>(0);
  const [isAbonando, setIsAbonando] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState<{
    hasPreSavedNextCycle?: boolean;
    firstPeriodKey?: string;
    createdAt?: any;
  }>({ hasPreSavedNextCycle: true });

  //Para el registro de gastos
  const ultimosMovimientos = useMemo(() => {
    return [...transactions]
      .sort((a, b) => getTransactionDate(b).getTime() - getTransactionDate(a).getTime())
      .slice(0, 5); // Solo los primeros 5
  }, [transactions]);


  //Fecha actual dinamica
  const todayFormatted = useMemo(() => {
    const d = new Date();
    return d.toLocaleString('es-MX', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }, []);

  //mes actual 
  const currentMonthYear = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    //intentar obtener el nombre primero de Auth es mas rapido
    if (user.displayName) {
      const primerNombre = user.displayName.split(' ')[0];
      setUserName(primerNombre);
    }

    // 2. Leer datos del usuario en Firestore (Ingreso mensual y Meta de Ahorro del setup)
    const fetchUserData = async () => {
      try {
        const userDocSnap = await getDoc(doc(db, 'users', user.uid));
        if (userDocSnap.exists()) {
          const data = userDocSnap.data();
          const nombre = data.displayName || data.name;
          if (nombre) setUserName(nombre.split(' ')[0]);
          const ingresoTotal = Number(data.monthlyIncome) || 0;
          if (data.savingsTarget) setSavingTarget(Number(data.savingsTarget) || 0);

          // Frecuencia de cobro (quincenal por defecto)
          const freq = (data.payFrequency as PayFrequency) || 'biweekly';
          setPayFrequency(freq);
          if (data.payDayOfWeek !== undefined) {
            setPayDayOfWeek(Number(data.payDayOfWeek));
          }

          // Si ya tiene guardado amountPerPeriod úsalo; si no, calcula según su periodicidad
          const periodAmount = data.amountPerPeriod
            ? Number(data.amountPerPeriod)
            : freq === 'biweekly'
              ? ingresoTotal / 2
              : freq === 'weekly'
                ? ingresoTotal / 4
                : ingresoTotal;

          setAmountPerPeriod(periodAmount);

          // Estado del perfil para cálculo de apartado de próximo ciclo
          setUserProfile({
            hasPreSavedNextCycle: data.hasPreSavedNextCycle !== undefined ? data.hasPreSavedNextCycle : true,
            firstPeriodKey: data.firstPeriodKey,
            createdAt: data.createdAt,
          });
        }
      } catch (error) {
        console.error('Error al leer los datos del usuario:', error);
      }
    };
    fetchUserData();

    // 3. Suscripción en tiempo real a los presupuestos maestros permanentes
    const budgetsQuery = query(
      collection(db, 'budgets'),
      where('userId', '==', user.uid)
    );

    const unsubscribeBudgets = onSnapshot(budgetsQuery, (snapshot) => {
      const rawDocs: Budget[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Budget, 'id'>),
      }));
      // Deduplicar presupuestos por categoría (priorizando presupuestos permanentes)
      setBudgets(deduplicateBudgets(rawDocs));
    });
    // 4. Suscripción en tiempo real a transacciones personales
    const txQuery = query(
      collection(db, 'transactions'),
      where('userId', '==', user.uid),
      where('sharedFundId', '==', null)
    );

    const unsubscribeTx = onSnapshot(txQuery, (snapshot) => {
      const txs: Transaction[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Transaction, 'id'>),
      }));
      setTransactions(txs);
    });
    return () => {
      unsubscribeBudgets();
      unsubscribeTx();
    };
  }, [currentMonthYear]);

  // ─────────────────────────────────────────────────────────────
  // DETERMINAR PERIODO ACTIVO (Quincenas, Mes, Semanas reales móviles)
  // ─────────────────────────────────────────────────────────────
  const periodInfo = useMemo(
    () => getPeriodInfo(payFrequency, payDayOfWeek),
    [payFrequency, payDayOfWeek]
  );

  // ─────────────────────────────────────────────────────────────
  // DETERMINAR SI ES EL PRIMER CICLO DEL USUARIO
  // ─────────────────────────────────────────────────────────────
  const isFirstCycle = useMemo(() => {
    if (userProfile.firstPeriodKey) {
      return userProfile.firstPeriodKey === periodInfo.periodKey;
    }
    if (userProfile.createdAt && periodInfo.startDate && periodInfo.endDate) {
      const createdMs = userProfile.createdAt?.toMillis
        ? userProfile.createdAt.toMillis()
        : (userProfile.createdAt?.seconds ? userProfile.createdAt.seconds * 1000 : null);
      if (createdMs) {
        const d = new Date(createdMs);
        return d >= periodInfo.startDate && d <= periodInfo.endDate;
      }
    }
    return false;
  }, [userProfile, periodInfo]);

  // ─────────────────────────────────────────────────────────────
  // CÁLCULO DEL DISPONIBLE POR PERIODO Y FLUJO DE EFECTIVO REAL
  // ─────────────────────────────────────────────────────────────
  const {
    totalAvailable,
    isBufferActiveHealthy,
    isBufferWarning,
    isBufferCritical,
    isOverdrawn,
    leisureLimit,
    leisureRemaining,
    bufferInitial,
    bufferRemaining,
    hasBuffer,
    statusColor,
    statusLabel,
    progressPercentage,
    mensajePie,
  } = useMemo(() => {
    // 1. Divisor proporcional para apartados mensuales según periodicidad
    const divisor = payFrequency === 'weekly' ? 4 : payFrequency === 'biweekly' ? 2 : 1;

    // 2. Gastos fijos del periodo
    let fijosDelPeriodo = 0;
    if (userProfile.hasPreSavedNextCycle === false && isFirstCycle) {
      // Retener del ingreso de este ciclo los gastos que vencen en el ciclo entrante más los del ciclo activo
      const nextCycleBlocks = getNextCycleBlocks(payFrequency, payDayOfWeek);
      const relevantBlocks = new Set([...periodInfo.activeBlocks, ...nextCycleBlocks]);
      fijosDelPeriodo = budgets
        .filter((b) => b.isFixedExpense && b.dueBlock && relevantBlocks.has(b.dueBlock))
        .reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);
    } else {
      // En ciclo normal o si hasPreSavedNextCycle === true: Aplicar el prorrateo parejo estándar
      const totalFijosMensuales = budgets
        .filter((b) => b.isFixedExpense)
        .reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);

      fijosDelPeriodo = totalFijosMensuales / divisor; // divisor: weekly=4, biweekly=2, monthly=1
    }

    // 3. Cuota proporcional de ahorro
    const cuotaAhorro = (savingsTarget || 0) / divisor;

    // 4. Ocio asignado para este periodo
    const leisureDoc = budgets.find((b) => !b.isFixedExpense);
    const leisureBudget = leisureDoc ? Number(leisureDoc.limitAmount) || 0 : 0;
    const ocioPeriodo = leisureBudget / divisor;

    // 5. Colchón del periodo es lo que resta del cobro de este ciclo tras fijos, ahorro y ocio:
    const periodBuffer = Math.max(0, amountPerPeriod - (fijosDelPeriodo + cuotaAhorro + ocioPeriodo));

    // Determina si una transacción pertenece al ciclo activo
    const isTxInCurrentPeriod = (t: Transaction): boolean => {
      if ((t as any).periodKey) {
        return (t as any).periodKey === periodInfo.periodKey;
      }
      if (periodInfo.startDate && periodInfo.endDate) {
        const txDate = getTransactionDate(t);
        return txDate >= periodInfo.startDate && txDate <= periodInfo.endDate;
      }
      return (t as any).monthYear === currentMonthYear;
    };

    // 6. Ingresos extraordinarios del ciclo (excluyendo el cobro regular base y el ingreso inicial)
    const periodIncomes = transactions.filter(
      (t) => t.type === 'income' && t.category !== 'Ingreso Inicial' && isTxInCurrentPeriod(t)
    );

    const extraOcio = periodIncomes
      .filter((t) => t.category !== '💵 Sueldo' && (t.targetBucket === 'leisure' || !t.targetBucket))
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    const extraColchon = periodIncomes
      .filter((t) => t.targetBucket === 'buffer')
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    // 7. Límites efectivos del periodo
    const effectiveLeisureLimit = ocioPeriodo + extraOcio;
    const effectiveBufferInitial = periodBuffer + extraColchon;
    const userHasBuffer = effectiveBufferInitial > 0;

    // 8. Gastos variables del periodo (clasificados según la bolsa origen seleccionada)
    const transaccionesVariables = transactions.filter(
      (t) => t.type === 'expense' && !t.isFixedExpense && t.category !== 'Gasto Fijo' && isTxInCurrentPeriod(t)
    );

    // Gastos que se descuentan de la bolsa de ocio (por defecto o si targetBucket !== 'buffer')
    const gastosOcio = transaccionesVariables
      .filter((t) => t.targetBucket !== 'buffer')
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    // Gastos que se descuentan directamente del colchón de imprevistos
    const gastosBufferDirectos = transaccionesVariables
      .filter((t) => t.targetBucket === 'buffer')
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    const gastosVariablesDelPeriodo = gastosOcio + gastosBufferDirectos;

    // 9. Disponible real del periodo que refleja fielmente la liquidez
    const balance = effectiveLeisureLimit + effectiveBufferInitial - gastosVariablesDelPeriodo;

    // 10. Descuento de Ocio y Colchón
    // Ocio disponible descontando únicamente los gastos de ocio
    const lRemaining = Math.max(0, effectiveLeisureLimit - gastosOcio);
    // Si los gastos de ocio superan el límite de ocio, el exceso se desborda hacia el colchón
    const overspentOcio = Math.max(0, gastosOcio - effectiveLeisureLimit);
    const hasOcioDeficit = overspentOcio > 0;

    // El colchón se descuenta por gastos de emergencia directos + el desbordamiento de ocio
    const totalConsumoBuffer = gastosBufferDirectos + overspentOcio;

    let bRemaining = 0;
    let overdrawn = false;
    let bufferPctRemaining = 100;

    if (userHasBuffer) {
      bRemaining = Math.max(0, effectiveBufferInitial - totalConsumoBuffer);
      overdrawn = totalConsumoBuffer > effectiveBufferInitial;
      bufferPctRemaining = effectiveBufferInitial > 0 ? (bRemaining / effectiveBufferInitial) * 100 : 0;
    } else {
      overdrawn = hasOcioDeficit || gastosBufferDirectos > 0;
    }

    // Punto 3: Suavizar estados del colchón.
    // Estado Crítico (Rojo): Sobregiro total, o colchón cae por debajo del 15% o déficit real en ocio
    const isBufferCritical = overdrawn || (userHasBuffer && (bufferPctRemaining < 15 || hasOcioDeficit));
    // Estado Advertencia (Naranja): Colchón consumido entre 15% y 25% restante (sin déficit de ocio y sin crítico)
    const isBufferWarning = !isBufferCritical && userHasBuffer && totalConsumoBuffer > 0 && bufferPctRemaining < 25;
    // Estado Activo Saludable (Verde/Neutro): Colchón conserva >= 25% y ocio no tiene déficit
    const isBufferActiveHealthy = !isBufferCritical && !isBufferWarning && userHasBuffer && totalConsumoBuffer > 0 && bufferPctRemaining >= 25 && !hasOcioDeficit;

    // 11. Semáforo dinámico
    let color: string = Theme.colors.statusSuccess;
    let label = '• Ritmo Saludable';
    let progress = 0;
    let pie = '';

    if (userHasBuffer) {
      if (isBufferCritical) {
        color = Theme.colors.statusDanger;
        label = overdrawn ? '🔴 Sobregirado' : '🔴 En Peligro';
        progress = Math.min(100, (totalConsumoBuffer / effectiveBufferInitial) * 100);
        pie = overdrawn
          ? `¡Cuidado! Te pasaste por $${(totalConsumoBuffer - effectiveBufferInitial).toFixed(2)} de tu colchón.`
          : `Alerta: Reserva crítica (${bufferPctRemaining.toFixed(0)}% restante). Modera tus salidas de dinero.`;
      } else if (isBufferWarning) {
        color = Theme.colors.statusWarning;
        label = 'Precaución';
        progress = Math.min(100, (totalConsumoBuffer / effectiveBufferInitial) * 100);
        pie = `Has consumido el ${(100 - bufferPctRemaining).toFixed(0)}% de tu reserva. Te quedan $${bRemaining.toFixed(2)}.`;
      } else if (isBufferActiveHealthy) {
        color = Theme.colors.statusSuccess;
        label = '🛡️ Reserva Activa';
        progress = Math.min(100, (totalConsumoBuffer / effectiveBufferInitial) * 100);
        pie = `Uso previsto de reserva: saldo saludable ($${bRemaining.toFixed(2)} restantes en colchón).`;
      } else {
        // Colchón al 100% intacto (totalConsumoBuffer === 0)
        const pct = effectiveLeisureLimit > 0 ? (gastosOcio / effectiveLeisureLimit) * 100 : 0;
        progress = Math.min(100, pct);
        if (pct > 65) {
          color = Theme.colors.statusWarning;
          label = 'Precaución';
          pie = `Has gastado el ${pct.toFixed(0)}% de tu ocio. Te quedan $${lRemaining.toFixed(2)}.`;
        } else {
          color = Theme.colors.statusSuccess;
          label = '• Ritmo Saludable';
          pie = `Ritmo saludable: te quedan $${lRemaining.toFixed(2)} para gastar en ocio.`;
        }
      }
    } else {
      const pct = effectiveLeisureLimit > 0 ? (gastosOcio / effectiveLeisureLimit) * 100 : 0;
      progress = Math.min(100, pct);
      if (overdrawn) {
        color = Theme.colors.statusDanger;
        label = 'Sobregirado';
        pie = `Te has pasado de tu dinero asignado por $${(gastosVariablesDelPeriodo - effectiveLeisureLimit).toFixed(2)}.`;
      } else if (pct > 70) {
        color = Theme.colors.statusWarning;
        label = 'Precaución';
        pie = `Has gastado el ${pct.toFixed(0)}% de tu dinero libre.`;
      } else {
        color = Theme.colors.statusSuccess;
        label = 'Bajo Control';
        pie = `Todo en orden: llevas el ${pct.toFixed(0)}% de tu dinero libre consumido.`;
      }
    }

    return {
      totalAvailable: balance,
      isBufferActiveHealthy,
      isBufferWarning,
      isBufferCritical,
      isOverdrawn: overdrawn,
      leisureLimit: effectiveLeisureLimit,
      leisureRemaining: lRemaining,
      bufferInitial: effectiveBufferInitial,
      bufferRemaining: bRemaining,
      hasBuffer: userHasBuffer,
      statusColor: color,
      statusLabel: label,
      progressPercentage: progress,
      mensajePie: pie,
    };
  }, [budgets, transactions, payFrequency, payDayOfWeek, savingsTarget, amountPerPeriod, periodInfo, currentMonthYear, userProfile, isFirstCycle]);

  // ─────────────────────────────────────────────────────────────
  // COMPROMISOS Y GASTOS FIJOS (TARJETA DE SEGUIMIENTO MENSUAL - OPCIÓN B)
  // ─────────────────────────────────────────────────────────────
  const presupuestosFijos = useMemo(() => {
    return budgets.filter((b) => b.isFixedExpense);
  }, [budgets]);

  const totalFijosMes = useMemo(() => {
    return presupuestosFijos.reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);
  }, [presupuestosFijos]);

  // Transacciones del mes en curso (obtenido del reloj local)
  const monthlyTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (tx.monthYear) {
        return tx.monthYear === currentMonthYear;
      }
      const d = getTransactionDate(tx);
      const my = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return my === currentMonthYear;
    });
  }, [transactions, currentMonthYear]);

  // Cálculo reactivo y dinámico de fijos pagados y saldo restante
  const fixedExpensesStatus = useMemo(() => {
    return presupuestosFijos.map((budget) => {
      const spentThisMonth = monthlyTransactions
        .filter(
          (tx) =>
            tx.type === 'expense' &&
            tx.isFixedExpense === true &&
            (tx.budgetId === budget.id || tx.category === budget.category)
        )
        .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

      const limitAmount = Number(budget.limitAmount) || 0;
      const isPaid = spentThisMonth >= limitAmount && limitAmount > 0;
      const remainingBalance = Math.max(0, limitAmount - spentThisMonth);

      return {
        ...budget,
        spentThisMonth,
        isPaid,
        remainingBalance,
      };
    });
  }, [presupuestosFijos, monthlyTransactions]);

  const totalPagado = useMemo(() => {
    return fixedExpensesStatus.reduce((acc, b) => acc + b.spentThisMonth, 0);
  }, [fixedExpensesStatus]);

  const progresoFijos = useMemo(() => {
    if (totalFijosMes <= 0) return 0;
    return Math.min(100, (totalPagado / totalFijosMes) * 100);
  }, [totalPagado, totalFijosMes]);

  const getDueBlockLabel = (block?: DueBlock) => {
    switch (block) {
      case 'start':
        return '1-10 (Principio)';
      case 'mid':
        return '11-20 (Mediados)';
      case 'end':
        return '21-31 (Fin)';
      default:
        return '1-31 (Mes)';
    }
  };

  // ─────────────────────────────────────────────────────────────
  // VALIDACIÓN Y ACCIÓN DE ABONO DE NÓMINA CON GESTIÓN DE SOBRANTE
  // ─────────────────────────────────────────────────────────────
  // Revisa si en las transacciones del mes ya se cobró este periodo
  const yaCobrado = useMemo(() => {
    return transactions.some(
      (t) => t.type === 'income' && (t as any).periodKey === periodInfo.periodKey && t.category === '💵 Sueldo'
    );
  }, [transactions, periodInfo]);

  const handleAbonar = async (surplus: number = 0, targetBucket?: 'savings' | 'buffer') => {
    const user = auth.currentUser;
    if (!user || amountPerPeriod <= 0 || isAbonando) return;

    setIsAbonando(true);
    try {
      const batch = writeBatch(db);
      const todayStr = getLocalDateString(new Date());

      // 1. Abono de sueldo del nuevo periodo
      const sueldoRef = doc(collection(db, 'transactions'));
      batch.set(sueldoRef, {
        id: sueldoRef.id,
        userId: user.uid,
        type: 'income',
        amount: amountPerPeriod,
        category: '💵 Sueldo',
        description: `Cobro ${periodInfo.label}`,
        targetBucket: 'leisure',
        periodKey: periodInfo.periodKey,
        monthYear: currentMonthYear,
        date: todayStr,
        createdAt: serverTimestamp(),
        isShared: false,
        sharedFundId: null,
      });

      // 2. Si hay remanente positivo a favor del ciclo anterior, aplicar según decisión
      if (surplus > 0 && targetBucket) {
        const surplusRef = doc(collection(db, 'transactions'));
        const isSavings = targetBucket === 'savings';
        batch.set(surplusRef, {
          id: surplusRef.id,
          userId: user.uid,
          type: 'income',
          amount: surplus,
          category: isSavings ? '🎯 Ahorro' : '🛡️ Colchón',
          description: isSavings
            ? 'Sobrante ciclo anterior -> Meta de Ahorro'
            : 'Sobrante ciclo anterior -> Colchón Extra',
          targetBucket: targetBucket,
          periodKey: periodInfo.periodKey,
          monthYear: currentMonthYear,
          date: todayStr,
          createdAt: serverTimestamp(),
          isShared: false,
          sharedFundId: null,
        });
      }

      await batch.commit();
    } catch (error) {
      console.error('Error al abonar sueldo:', error);
      Alert.alert('Error', 'No se pudo procesar el cobro del periodo.');
    } finally {
      setIsAbonando(false);
    }
  };


  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <ThemedText type='title'>Inicio</ThemedText>
        <View style={styles.headerRow}>
          <ThemedText style={styles.saludo}>Hola de nuevo, {userName}</ThemedText>
          <TouchableOpacity style={styles.miniwigdet} activeOpacity={0.7}>
            <ThemedText style={styles.miniwigdettext}>{todayFormatted}</ThemedText>
          </TouchableOpacity>
        </View>
        {/************************* Banner de Abono de Nómina y Gestión del Sobrante ****************************/}
        {!yaCobrado && amountPerPeriod > 0 && (
          <View style={styles.bannerCobro}>
            <View style={styles.bannerHeaderRow}>
              <View style={styles.bannerInfo}>
                <ThemedText style={styles.bannerTitulo}>
                  💵 ¡Llegó tu {periodInfo.label}!
                </ThemedText>
                <ThemedText style={styles.bannerMonto}>
                  ${amountPerPeriod.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
                </ThemedText>
              </View>

              {totalAvailable <= 0 && (
                <TouchableOpacity
                  style={[styles.bannerBtn, isAbonando && styles.buttonDisabled]}
                  onPress={() => handleAbonar(0)}
                  disabled={isAbonando}
                  activeOpacity={0.8}
                >
                  {isAbonando ? (
                    <ActivityIndicator size="small" color={Theme.colors.background} />
                  ) : (
                    <ThemedText style={styles.bannerBtnText}>Abonar</ThemedText>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {totalAvailable > 0 && (
              <View style={styles.bannerSobranteSection}>
                <View style={styles.bannerSobranteDivider} />
                <View style={styles.bannerSobranteBadge}>
                  <Ionicons name="sparkles" size={15} color={Theme.colors.income} />
                  <ThemedText style={styles.bannerSobranteText}>
                    Sobrante a favor del ciclo anterior:{' '}
                    <ThemedText style={styles.bannerSobranteHighlight}>
                      +${totalAvailable.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
                    </ThemedText>
                  </ThemedText>
                </View>
                <ThemedText style={styles.bannerSobrantePregunta}>
                  ¿Qué deseas hacer con tu saldo remanente?
                </ThemedText>

                <View style={styles.bannerSobranteActions}>
                  <TouchableOpacity
                    style={[styles.bannerChoiceBtnSavings, isAbonando && styles.buttonDisabled]}
                    onPress={() => handleAbonar(totalAvailable, 'savings')}
                    disabled={isAbonando}
                    activeOpacity={0.8}
                  >
                    {isAbonando ? (
                      <ActivityIndicator size="small" color={Theme.colors.background} />
                    ) : (
                      <>
                        <Ionicons name="save-outline" size={16} color={Theme.colors.background} />
                        <ThemedText style={styles.bannerChoiceBtnText}>
                          Mandar a Ahorro
                        </ThemedText>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.bannerChoiceBtnBuffer, isAbonando && styles.buttonDisabled]}
                    onPress={() => handleAbonar(totalAvailable, 'buffer')}
                    disabled={isAbonando}
                    activeOpacity={0.8}
                  >
                    {isAbonando ? (
                      <ActivityIndicator size="small" color={Theme.colors.background} />
                    ) : (
                      <>
                        <Ionicons name="shield-checkmark-outline" size={16} color={Theme.colors.background} />
                        <ThemedText style={styles.bannerChoiceBtnText}>
                          Colchón Extra
                        </ThemedText>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {/***************Tarjeta de gastos disponibles **********************/}
        <View style={[
          styles.widget,
          isBufferWarning && styles.widgetWarning,
          (isBufferCritical || isOverdrawn) && styles.widgetDanger,
        ]}>
          <View style={styles.widgetHeader}>
            <ThemedText style={styles.widgetlabel}>Disponible para gastar</ThemedText>
            {isOverdrawn && (
              <ThemedText style={styles.statusBadgeDanger}>!!Sobregiro</ThemedText>
            )}
            {!isOverdrawn && isBufferCritical && (
              <ThemedText style={styles.statusBadgeDanger}>🔴 En Peligro</ThemedText>
            )}
            {!isOverdrawn && isBufferWarning && (
              <ThemedText style={styles.statusBadgeWarning}>⚠️ Reserva Baja</ThemedText>
            )}
            {!isOverdrawn && isBufferActiveHealthy && (
              <ThemedText style={styles.statusBadgeHealthy}>🛡️ Reserva Activa</ThemedText>
            )}
          </View>
          <ThemedText
            style={[
              styles.widgetAmount,
              (isBufferCritical || isOverdrawn) && { color: Theme.colors.statusDanger },
            ]}
          >
            ${totalAvailable.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            <ThemedText style={styles.currencyCode}> MXN</ThemedText>
          </ThemedText>
        </View>


        {/*************************Semaforo de gastos****************************/}
        <View style={styles.widget}>
          {/* Header del semáforo con la etiqueta de estado */}
          <View style={styles.widgetHeader}>
            <ThemedText style={styles.widgetlabel}>Semáforo de Gastos</ThemedText>

            <View
              style={[
                styles.statusBadge,
                { backgroundColor: `${statusColor}20` },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: statusColor }]}
              />
              <ThemedText
                style={[
                  styles.statusBadgeText,
                  { color: statusColor },
                ]}
              >
                {statusLabel}
              </ThemedText>
            </View>
          </View>

          {/* Desglose de las dos bolsas (Ocio y Colchón) */}
          <View style={styles.semaphoreBucketsRow}>
            {/* Bolsa Ocio */}
            <View style={styles.semaphoreBucket}>
              <ThemedText style={styles.bucketTitle}>🍿 Ocio</ThemedText>
              <ThemedText
                style={[
                  styles.bucketValue,
                  leisureRemaining === 0 && styles.bucketValueMuted,
                ]}
              >
                ${leisureRemaining.toFixed(2)}
                <ThemedText style={styles.bucketLimitText}>
                  {' '}
                  / ${leisureLimit.toFixed(0)}
                </ThemedText>
              </ThemedText>
            </View>

            {/* Bolsa Colchón (Dinámica: solo si existe colchón) */}
            {hasBuffer ? (
              <View style={styles.semaphoreBucket}>
                <ThemedText style={styles.bucketTitle}>🛡️ Colchón</ThemedText>
                <ThemedText
                  style={[
                    styles.bucketValue,
                    isBufferCritical
                      ? styles.bucketValueDanger
                      : isBufferWarning
                        ? styles.bucketValueWarning
                        : styles.bucketValueSafe,
                  ]}
                >
                  ${bufferRemaining.toFixed(2)}
                  <ThemedText style={styles.bucketLimitText}>
                    {' '}
                    / ${bufferInitial.toFixed(0)}
                  </ThemedText>
                </ThemedText>
              </View>
            ) : (
              <View style={styles.semaphoreBucket}>
                <ThemedText style={styles.bucketTitle}>🎯 Asignación</ThemedText>
                <ThemedText style={styles.assignedBadge}>100% Asignado</ThemedText>
              </View>
            )}
          </View>

          {/* Barra de Progreso del Semáforo */}
          <View style={styles.trackBar}>
            <View
              style={[
                styles.fillBar,
                {
                  width: `${progressPercentage}%`,
                  backgroundColor: statusColor,
                },
              ]}
            />
          </View>

          {/* Mensaje al pie de la barra */}
          <ThemedText style={styles.semaphoreFootnote}>
            {mensajePie}
          </ThemedText>
        </View>

        {/************************* Compromisos y Gastos Fijos ****************************/}
        <View style={styles.fixedCard}>
          <View style={styles.fixedCardHeader}>
            <View style={styles.fixedTitleRow}>
              <ThemedText style={styles.widgetlabel}>Compromisos y Gastos Fijos</ThemedText>
            </View>
            <ThemedText style={styles.fixedCardSummary}>
              ${totalPagado.toLocaleString('es-MX', { minimumFractionDigits: 2 })} / ${totalFijosMes.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
            </ThemedText>
          </View>

          {/* Barra de progreso visual */}
          <View style={styles.trackBar}>
            <View
              style={[
                styles.fillBar,
                {
                  width: `${progresoFijos}%`,
                  backgroundColor: progresoFijos >= 100 ? Theme.colors.statusSuccess : Theme.colors.fixed,
                },
              ]}
            />
          </View>

          {/* Lista de elementos fijos */}
          {presupuestosFijos.length === 0 ? (
            <ThemedText style={styles.emptyStateText}>
              No hay compromisos fijos registrados este mes.
            </ThemedText>
          ) : (
            <View style={styles.fixedListContainer}>
              {fixedExpensesStatus.map((b) => {
                const pagado = b.isPaid;
                return (
                  <View key={b.id} style={styles.fixedItemRow}>
                    <View style={styles.fixedItemLeft}>
                      <ThemedText style={styles.fixedItemName} numberOfLines={1}>
                        {b.category}
                      </ThemedText>
                      <ThemedText style={styles.fixedItemBlock}>
                        {getDueBlockLabel(b.dueBlock)}
                      </ThemedText>
                    </View>

                    <View style={styles.fixedItemRight}>
                      <ThemedText style={styles.fixedItemAmount}>
                        ${Number(b.limitAmount).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </ThemedText>
                      <View
                        style={[
                          styles.fixedStatusBadge,
                          pagado ? styles.fixedStatusPaidBadge : styles.fixedStatusPendingBadge,
                        ]}
                      >
                        <ThemedText
                          style={[
                            styles.fixedStatusBadgeText,
                            pagado ? styles.fixedStatusPaidText : styles.fixedStatusPendingText,
                          ]}
                        >
                          {pagado ? '✅ Pagado' : '⏳ Pendiente'}
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/*************************Registro de gastos****************************/}
        <View style={styles.widget}>
          <View style={styles.widgetHeader}>
            <ThemedText style={styles.widgetlabel}>Ultimos gastos</ThemedText>
          </View>

          {/* Por si esta limpia */}
          {transactions.length === 0 ? (
            <ThemedText style={styles.emptyStateText}>
              No hay registros de gastos este mes.
            </ThemedText>
          ) : (
            /* Para Mapear los ultimos 5 movimientos*/
            <View style={styles.listaMovimientos}>
              {ultimosMovimientos.map((item) => {
                const esGasto = item.type === 'expense';
                return (
                  <View key={item.id} style={styles.movimientoRow}>
                    {/*Lado Izquierdo: Descripcion y categoria */}
                    <View style={styles.movimientoTextos}>
                      <ThemedText style={styles.movimientoDesc} numberOfLines={1}>
                        {item.description || (esGasto ? "Gasto" : "Ingreso")}
                      </ThemedText>
                      <ThemedText style={styles.movimientoCat}>
                        {item.category}
                      </ThemedText>
                    </View>

                    {/*Lado derecho: Monto con color segun el tipo */}
                    <ThemedText style={[styles.movimientoMonto, esGasto ? styles.montoGasto : styles.montoIngreso]}>
                      {(esGasto ? "-" : "+")}$
                      {Number(item.amount).toLocaleString('es-MX', {
                        minimumFractionDigits: 2,
                      })}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  scrollContainer: {
    flexGrow: 1,
    alignItems: 'center',
    paddingBottom: 40,
    paddingTop: 25,
    gap: 16,
    backgroundColor: Theme.colors.background,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '90%',
  },

  saludo: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Theme.colors.textSecondary,
    alignSelf: 'flex-start',
    marginLeft: '7%',
  },
  miniwigdet: {
    backgroundColor: Theme.colors.cardSurface,
    borderRadius: Theme.radius.xl,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  miniwigdettext: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Theme.colors.textSecondary,
    alignSelf: 'flex-start',
  },
  widget: {
    width: '90%',
    backgroundColor: Theme.colors.cardSurface,
    borderRadius: Theme.radius.lg,
    padding: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  widgetlabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Theme.colors.textSecondary,
    alignSelf: 'flex-start',
    marginLeft: '5%',
  },
  widgetAmount: {
    fontSize: 26,
    fontWeight: 'bold',
    color: Theme.colors.textPrimary,
    alignSelf: 'flex-start',
    marginLeft: '10%',
  },

  //tarjeta de gastos
  widgetWarning: {
    borderColor: 'rgba(245, 158, 11, 0.5)',
    backgroundColor: Theme.colors.cardSurface,
  },
  widgetDanger: {
    borderColor: 'rgba(239, 68, 68, 0.5)',
    backgroundColor: Theme.colors.cardSurface,
  },
  widgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadgeWarning: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.statusWarning,
  },
  statusBadgeDanger: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.statusDanger,
  },
  statusBadgeHealthy: {
    fontSize: 12,
    fontWeight: '700',
    color: Theme.colors.statusSuccess,
  },
  currencyCode: {
    fontSize: 16,
    fontWeight: '600',
    color: Theme.colors.textMuted,
  },

  emptyStateText: {
    fontSize: 13,
    color: Theme.colors.textMuted,
    fontStyle: 'italic',
    marginVertical: 8,
  },
  movimientoTextos: {
    flex: 1,
    marginRight: 10,
    gap: 2,
  },
  listaMovimientos: {
    gap: 12,
    marginTop: 6,
  },
  movimientoDesc: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
  },
  movimientoCat: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
  },
  movimientoMonto: {
    fontSize: 15,
    fontWeight: '800',
  },
  montoGasto: {
    color: Theme.colors.expense,
  },
  montoIngreso: {
    color: Theme.colors.income,
  },
  movimientoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.borderSubtle,
  },
  // Estilos del Semáforo
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Theme.radius.md,
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  semaphoreBucketsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 12,
  },
  semaphoreBucket: {
    flex: 1,
    gap: 2,
  },
  bucketTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.textSecondary,
  },
  bucketValue: {
    fontSize: 16,
    fontWeight: '800',
    color: Theme.colors.textPrimary,
  },
  bucketLimitText: {
    fontSize: 12,
    fontWeight: '500',
    color: Theme.colors.textMuted,
  },
  bucketValueMuted: {
    color: Theme.colors.textMuted,
  },
  bucketValueSafe: {
    color: Theme.colors.buffer,
  },
  bucketValueWarning: {
    color: Theme.colors.statusWarning,
  },
  bucketValueDanger: {
    color: Theme.colors.statusDanger,
  },
  assignedBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.statusSuccess,
    marginTop: 2,
  },
  trackBar: {
    height: 8,
    backgroundColor: Theme.colors.cardSurfaceSubtle,
    borderRadius: Theme.radius.xs,
    overflow: 'hidden',
    marginTop: 6,
  },
  fillBar: {
    height: '100%',
    borderRadius: Theme.radius.xs,
  },
  semaphoreFootnote: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  bannerCobro: {
    width: '90%',
    backgroundColor: Theme.colors.cardSurface,
    borderRadius: Theme.radius.lg,
    padding: 16,
    borderWidth: 1.5,
    borderColor: Theme.colors.income,
    gap: 12,
  },
  bannerHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  bannerInfo: {
    flex: 1,
    gap: 4,
  },
  bannerTitulo: {
    fontSize: 13,
    fontWeight: '700',
    color: Theme.colors.income,
    textTransform: 'uppercase',
  },
  bannerMonto: {
    fontSize: 18,
    fontWeight: '800',
    color: Theme.colors.textPrimary,
  },
  bannerBtn: {
    backgroundColor: Theme.colors.income,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: Theme.radius.md,
  },
  bannerBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: Theme.colors.background,
  },
  bannerSobranteSection: {
    width: '100%',
    gap: 8,
  },
  bannerSobranteDivider: {
    height: 1,
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    width: '100%',
  },
  bannerSobranteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(52, 211, 153, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Theme.radius.sm,
  },
  bannerSobranteText: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
    flex: 1,
  },
  bannerSobranteHighlight: {
    color: Theme.colors.income,
    fontWeight: '700',
  },
  bannerSobrantePregunta: {
    fontSize: 12,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
  },
  bannerSobranteActions: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  bannerChoiceBtnSavings: {
    flex: 1,
    backgroundColor: Theme.colors.savings,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: Theme.radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bannerChoiceBtnBuffer: {
    flex: 1,
    backgroundColor: Theme.colors.buffer,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: Theme.radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bannerChoiceBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: Theme.colors.background,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  // Tarjeta de Compromisos y Gastos Fijos
  fixedCard: {
    width: '90%',
    backgroundColor: Theme.colors.cardSurface,
    borderRadius: Theme.radius.xl,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  fixedCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  fixedTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },

  fixedCardSummary: {
    fontSize: 14,
    fontWeight: '700',
    color: Theme.colors.fixed,
  },
  fixedListContainer: {
    gap: 10,
    marginTop: 4,
  },
  fixedItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.borderSubtle,
  },
  fixedItemLeft: {
    flex: 1,
    marginRight: 10,
    gap: 2,
  },
  fixedItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: Theme.colors.textPrimary,
  },
  fixedItemBlock: {
    fontSize: 12,
    color: Theme.colors.textSecondary,
  },
  fixedItemRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  fixedItemAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: Theme.colors.textPrimary,
  },
  fixedStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Theme.radius.sm,
  },
  fixedStatusPaidBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  fixedStatusPendingBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  fixedStatusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  fixedStatusPaidText: {
    color: Theme.colors.statusSuccess,
  },
  fixedStatusPendingText: {
    color: Theme.colors.statusWarning,
  },
});