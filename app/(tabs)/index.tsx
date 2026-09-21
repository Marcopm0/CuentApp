import { ThemedText } from '@/components/themed-text';
import { auth, db } from '@/services/firebase';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

interface Budget {
  id: string;
  category: string;
  limitAmount: number;
  currentSpent: number;
  isFixedExpense: boolean;
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
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [monthlyIncome, setMonthlyIncome] = useState<number>(0)
  const [savingsTarget, setSavingTarget] = useState<number>(0)

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
          if (data.monthlyIncome) setMonthlyIncome(data.monthlyIncome);
          if (data.savingsTarget) setSavingTarget(data.savingsTarget);
        }
      } catch (error) {
        console.error('Error al leer los datos del usuario:', error)
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
  // CÁLCULO DE: DISPONIBLE PARA GASTAR
  // ─────────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  // CÁLCULOS REACTIVOS: DISPONIBLE Y SEMÁFORO CON TARGET BUCKETS
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
    // 1. Ocio base y gastos fijos base del setup
    const leisureDoc = budgets.find((b) => !b.isFixedExpense);
    const leisureBase = leisureDoc ? Number(leisureDoc.limitAmount) || 0 : 0;

    const totalFixed = budgets
      .filter((b) => b.isFixedExpense)
      .reduce((acc, b) => acc + (Number(b.limitAmount) || 0), 0);

    // 2. Colchón base del setup
    const bufferBase = Math.max(
      0,
      monthlyIncome - (totalFixed + savingsTarget + leisureBase)
    );

    // 3. Filtrar ingresos extras (excluyendo el inicial)
    const validIncomes = transactions.filter(
      (t) => t.type === 'income' && t.category !== 'Ingreso Inicial'
    );

    // Reparto según la bolsa elegida por el usuario:
    const extraOcio = validIncomes
      .filter((t) => t.targetBucket === 'leisure' || !t.targetBucket)
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    const extraColchon = validIncomes
      .filter((t) => t.targetBucket === 'buffer')
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    // 4. Límites efectivos ampliados
    const effectiveLeisureLimit = leisureBase + extraOcio;
    const effectiveBufferInitial = bufferBase + extraColchon;
    const userHasBuffer = effectiveBufferInitial > 0;

    // 5. Gastos variables del día a día
    const variableExpenses = transactions
      .filter((t) => t.type === 'expense' && t.category !== 'Gasto Fijo')
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    // 6. Disponible Real para gastar hoy
    const balance = effectiveLeisureLimit + effectiveBufferInitial - variableExpenses;

    // 7. Cascada de Ocio y Colchón
    const lRemaining = Math.max(0, effectiveLeisureLimit - variableExpenses);
    const overspent = Math.max(0, variableExpenses - effectiveLeisureLimit);

    let bRemaining = 0;
    let touchingBuffer = false;
    let overdrawn = false;

    if (userHasBuffer) {
      bRemaining = Math.max(0, effectiveBufferInitial - overspent);
      touchingBuffer = overspent > 0;
      overdrawn = overspent > effectiveBufferInitial;
    } else {
      overdrawn = variableExpenses > effectiveLeisureLimit;
    }

    // 8. Semáforo dinámico
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
        const pct = effectiveLeisureLimit > 0 ? (variableExpenses / effectiveLeisureLimit) * 100 : 0;
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
      const pct = effectiveLeisureLimit > 0 ? (variableExpenses / effectiveLeisureLimit) * 100 : 0;
      progress = Math.min(100, pct);
      if (overdrawn) {
        color = '#EF4444';
        label = 'Sobregirado';
        pie = `Te has pasado de tu dinero asignado por $${(variableExpenses - effectiveLeisureLimit).toFixed(2)}.`;
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
  }, [budgets, transactions, monthlyIncome, savingsTarget]);


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

});