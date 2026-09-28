import { ThemedText } from '@/components/themed-text';
import { auth, db } from '@/services/firebase';
import { DueBlock, getPeriodInfo, PayFrequency } from '@/utils/periods';
import { Ionicons } from '@expo/vector-icons';
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';


interface Budget {
  id: string;
  category: string;
  limitAmount: number;
  currentSpent: number;
  isFixedExpense: boolean;
  dueBlock?: DueBlock;
}

interface Transaction {
  description: string;
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  createdAt?: any;
  targetBucket?: 'leisure' | 'buffer' | 'savings';
}

export default function HomeScreen() {
  const [userName, setUserName] = useState<string>('Usuario');
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [monthlyIncome, setMonthlyIncome] = useState<number>(0);
  const [savingsTarget, setSavingTarget] = useState<number>(0);
  // Estados para periodicidad de pago
  const [payFrequency, setPayFrequency] = useState<PayFrequency>('biweekly');
  const [payDayOfWeek, setPayDayOfWeek] = useState<number>(5);
  const [amountPerPeriod, setAmountPerPeriod] = useState<number>(0);
  const [isAbonando, setIsAbonando] = useState<boolean>(false);

  //Para el registro de gastos
  const ultimosMovimientos = useMemo(() => {
    return [...transactions]
      .sort((a, b) => {
        // Obtenemos los milisegundos del Timestamp de Firestore
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
        return timeB - timeA; // El más reciente (mayor timestamp) va primero
      })
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
          if (ingresoTotal) setMonthlyIncome(ingresoTotal);
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
        }
      } catch (error) {
        console.error('Error al leer los datos del usuario:', error);
      }
    };
    fetchUserData();

    //3. suscripcion en tiempo real a los presupuestos
    const budgetsQuery = query(
      collection(db, 'budgets'),
      where('userId', '==', user.uid),
      where('monthYear', '==', currentMonthYear)
    );

    const unsubscribeBudgets = onSnapshot(budgetsQuery, (snapshot) => {
      const docs: Budget[] = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Budget, 'id'>),
      }));
      setBudgets(docs);
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
  // CÁLCULO DEL DISPONIBLE POR PERIODO Y FLUJO DE EFECTIVO REAL
  // ─────────────────────────────────────────────────────────────
  const {
    totalAvailable,
    isTouchingBuffer,
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

    // 2. Gastos fijos que vencen en este periodo según activeBlocks (start: 1-10, mid: 11-20, end: 21-31)
    const fijosDelPeriodo = budgets
      .filter((b) => b.isFixedExpense && b.dueBlock && periodInfo.activeBlocks.includes(b.dueBlock))
      .reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);

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
        const time = t.createdAt?.toMillis
          ? t.createdAt.toMillis()
          : (t.createdAt?.seconds ? t.createdAt.seconds * 1000 : null);
        if (time) {
          const txDate = new Date(time);
          return txDate >= periodInfo.startDate && txDate <= periodInfo.endDate;
        }
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

    // 8. Gastos variables del periodo (excluyendo fijos ya descontados de la nómina)
    const gastosVariablesDelPeriodo = transactions
      .filter((t) => t.type === 'expense' && t.category !== 'Gasto Fijo' && isTxInCurrentPeriod(t))
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    // 9. Disponible real del periodo que refleja fielmente la liquidez
    const balance = effectiveLeisureLimit + effectiveBufferInitial - gastosVariablesDelPeriodo;

    // 10. Cascada de Ocio y Colchón
    const lRemaining = Math.max(0, effectiveLeisureLimit - gastosVariablesDelPeriodo);
    const overspent = Math.max(0, gastosVariablesDelPeriodo - effectiveLeisureLimit);

    let bRemaining = 0;
    let touchingBuffer = false;
    let overdrawn = false;

    if (userHasBuffer) {
      bRemaining = Math.max(0, effectiveBufferInitial - overspent);
      touchingBuffer = overspent > 0;
      overdrawn = overspent > effectiveBufferInitial;
    } else {
      overdrawn = gastosVariablesDelPeriodo > effectiveLeisureLimit;
    }

    // 11. Semáforo dinámico
    let color = '#10B981';
    let label = 'Bajo Control';
    let progress = 0;
    let pie = '';

    if (userHasBuffer) {
      if (touchingBuffer) {
        color = '#EF4444';
        label = overdrawn ? 'Sobregirado' : 'En Reserva';
        progress = Math.min(100, (overspent / effectiveBufferInitial) * 100);
        pie = overdrawn
          ? `¡Cuidado! Te pasaste por $${(overspent - effectiveBufferInitial).toFixed(2)} de tu colchón.`
          : `Has consumido $${overspent.toFixed(2)} de tu reserva de imprevistos.`;
      } else {
        const pct = effectiveLeisureLimit > 0 ? (gastosVariablesDelPeriodo / effectiveLeisureLimit) * 100 : 0;
        progress = Math.min(100, pct);
        if (pct > 65) {
          color = '#F59E0B';
          label = 'Precaución';
          pie = `Has gastado el ${pct.toFixed(0)}% de tu ocio. Te quedan $${lRemaining.toFixed(2)}.`;
        } else {
          pie = `Ritmo saludable: te quedan $${lRemaining.toFixed(2)} para gastar en ocio.`;
        }
      }
    } else {
      const pct = effectiveLeisureLimit > 0 ? (gastosVariablesDelPeriodo / effectiveLeisureLimit) * 100 : 0;
      progress = Math.min(100, pct);
      if (overdrawn) {
        color = '#EF4444';
        label = 'Sobregirado';
        pie = `Te has pasado de tu dinero asignado por $${(gastosVariablesDelPeriodo - effectiveLeisureLimit).toFixed(2)}.`;
      } else if (pct > 70) {
        color = '#F59E0B';
        label = 'Precaución';
        pie = `Has gastado el ${pct.toFixed(0)}% de tu dinero libre.`;
      } else {
        pie = `Todo en orden: llevas el ${pct.toFixed(0)}% de tu dinero libre consumido.`;
      }
    }

    return {
      totalAvailable: balance,
      isTouchingBuffer: touchingBuffer,
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
  }, [budgets, transactions, payFrequency, savingsTarget, amountPerPeriod, periodInfo, currentMonthYear]);

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
        date: serverTimestamp(),
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
          date: serverTimestamp(),
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
    <SafeAreaView style={styles.safeArea}>
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
                    <ActivityIndicator size="small" color="#0B0F17" />
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
                  <Ionicons name="sparkles" size={15} color="#34D399" />
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
                      <ActivityIndicator size="small" color="#0B0F17" />
                    ) : (
                      <>
                        <Ionicons name="save-outline" size={16} color="#0B0F17" />
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
                      <ActivityIndicator size="small" color="#0B0F17" />
                    ) : (
                      <>
                        <Ionicons name="shield-checkmark-outline" size={16} color="#0B0F17" />
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
        <View style={[styles.widget, isTouchingBuffer && styles.widgetWarning, isOverdrawn && styles.widgetDanger]}>
          <View style={styles.widgetHeader}>
            <ThemedText style={styles.widgetlabel}>Disponible para gastar</ThemedText>
            {isTouchingBuffer && !isOverdrawn && (
              <ThemedText style={styles.statusBadgeWarning}>⚠️ Tocando reserva</ThemedText>
            )}
            {isOverdrawn && (
              <ThemedText style={styles.statusBadgeDanger}>!!Sobregiro</ThemedText>
            )}
          </View>
          <ThemedText
            style={[
              styles.widgetAmount,
              isOverdrawn && { color: '#EF4444' },
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
                    isTouchingBuffer
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
    backgroundColor: '#0B0F17',
  },
  scrollContainer: {
    flexGrow: 1,
    alignItems: 'center',
    paddingBottom: 40,
    paddingTop: 25,
    gap: 16,
    backgroundColor: '#0B0F17',
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
    color: '#94A3B8',
    alignSelf: 'flex-start',
    marginLeft: '7%',
  },
  miniwigdet: {
    backgroundColor: '#161F30',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#24324D',
  },
  miniwigdettext: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#94A3B8',
    alignSelf: 'flex-start',
  },
  widget: {
    width: '90%',
    backgroundColor: '#161F30',
    borderRadius: 16,
    padding: 20,
    gap: 6,


    //borde
    borderWidth: 1,
    borderColor: '#24324D',
  },
  widgetlabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#94A3B8',
    alignSelf: 'flex-start',
    marginLeft: '5%',
  },
  widgetAmount: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#ffffffff',
    alignSelf: 'flex-start',
    marginLeft: '10%',
  },

  //tarjeta de gastos
  widgetWarning: {
    borderColor: 'rgba(245, 158, 11, 0.5)',
    backgroundColor: '#1C1E2A',
  },
  widgetDanger: {
    borderColor: 'rgba(239, 68, 68, 0.5)',
    backgroundColor: '#20161C',
  },
  widgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadgeWarning: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F59E0B',
  },
  statusBadgeDanger: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
  },
  currencyCode: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748B',
  },

  //registro
  TotalGastadoLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
  },
  emptyStateText: {
    fontSize: 13,
    color: '#64748B',
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
    fontWeight: 700,
    color: '#94A3B8',
  },
  movimientoCat: {
    fontSize: 12,
    color: '#94A3B8',
  },
  movimientoMonto: {
    fontSize: 15,
    fontWeight: '800',
  },
  montoGasto: {
    color: '#F87171', // Rojo suave
  },
  montoIngreso: {
    color: '#34D399', // Verde esmeralda
  },
  movimientoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  // Estilos del Semáforo
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
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
    color: '#94A3B8',
  },
  bucketValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  bucketLimitText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
  bucketValueMuted: {
    color: '#64748B',
  },
  bucketValueSafe: {
    color: '#38BDF8',
  },
  bucketValueWarning: {
    color: '#F59E0B',
  },
  assignedBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: '#10B981',
    marginTop: 2,
  },
  trackBar: {
    height: 8,
    backgroundColor: '#0B0F17',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 6,
  },
  fillBar: {
    height: '100%',
    borderRadius: 4,
  },
  semaphoreFootnote: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  bannerCobro: {
    width: '90%',
    backgroundColor: '#161F30',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#10B981',
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
    color: '#10B981',
    textTransform: 'uppercase',
  },
  bannerMonto: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  bannerBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  bannerBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0B0F17',
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
    borderRadius: 8,
  },
  bannerSobranteText: {
    fontSize: 12,
    color: '#94A3B8',
    flex: 1,
  },
  bannerSobranteHighlight: {
    color: '#34D399',
    fontWeight: '700',
  },
  bannerSobrantePregunta: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  bannerSobranteActions: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
  bannerChoiceBtnSavings: {
    flex: 1,
    backgroundColor: '#38BDF8',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bannerChoiceBtnBuffer: {
    flex: 1,
    backgroundColor: '#34D399',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  bannerChoiceBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0B0F17',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});