import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Modal,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { auth, db } from '@/services/firebase';

interface Transaction {
    id: string;
    type: 'income' | 'expense';
    amount: number;
    category: string;
    description?: string;
    targetBucket?: 'leisure' | 'buffer' | 'savings';
    createdAt?: any;
}

const CATEGORIAS_FILTRO = [
    'Todas',
    '🍿 Ocio',
    '🌮 Comida / Antojos',
    '🛒 Despensa',
    '🚌 Transporte',
    '💡 Servicios / Fijos',
    '💊 Salud',
    '💵 Sueldo Extra',
    '💼 Venta',
    '🎁 Regalo',
    '📦 Otro Gasto',
];

export default function HistorialScreen() {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    // Estados de Búsqueda y Filtros
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [filterModalVisible, setFilterModalVisible] = useState<boolean>(false);
    const [filterType, setFilterType] = useState<'all' | 'expense' | 'income'>('all');
    const [filterCategory, setFilterCategory] = useState<string>('Todas');

    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, 'transactions'),
            where('userId', '==', user.uid),
            where('sharedFundId', '==', null)
        );

        const unsubscribe = onSnapshot(
            q,
            (snapshot) => {
                const docs: Transaction[] = snapshot.docs.map((docSnap) => ({
                    id: docSnap.id,
                    ...(docSnap.data() as Omit<Transaction, 'id'>),
                }));
                setTransactions(docs);
                setLoading(false);
            },
            (error) => {
                console.error('Error al obtener historial:', error);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, []);

    // 1. Orden cronológico descendente
    const historialOrdenado = useMemo(() => {
        return [...transactions].sort((a, b) => {
            const timeA = a.createdAt?.toMillis
                ? a.createdAt.toMillis()
                : a.createdAt?.seconds
                    ? a.createdAt.seconds * 1000
                    : 0;
            const timeB = b.createdAt?.toMillis
                ? b.createdAt.toMillis()
                : b.createdAt?.seconds
                    ? b.createdAt.seconds * 1000
                    : 0;
            return timeB - timeA;
        });
    }, [transactions]);

    // 2. Filtrado compuesto en tiempo real
    const transaccionesFiltradas = useMemo(() => {
        const queryClean = searchQuery.trim().toLowerCase();

        return historialOrdenado.filter((item) => {
            // Coincidencia con texto de descripción o categoría
            const matchesSearch =
                !queryClean ||
                item.description?.toLowerCase().includes(queryClean) ||
                item.category?.toLowerCase().includes(queryClean);

            // Coincidencia por tipo (Todos / Gasto / Ingreso)
            const matchesType =
                filterType === 'all' ? true : item.type === filterType;

            // Coincidencia por categoría
            const matchesCategory =
                filterCategory === 'Todas' ? true : item.category === filterCategory;

            return matchesSearch && matchesType && matchesCategory;
        });
    }, [historialOrdenado, searchQuery, filterType, filterCategory]);

    const hasActiveFilters = filterType !== 'all' || filterCategory !== 'Todas';

    const formatFecha = (createdAt: any) => {
        if (!createdAt) return 'Reciente';
        const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
        return date.toLocaleDateString('es-MX', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const renderItem = ({ item }: { item: Transaction }) => {
        const isExpense = item.type === 'expense';

        return (
            <View style={styles.cardItem}>
                <View style={styles.itemLeft}>
                    <Text style={styles.itemDesc} numberOfLines={1}>
                        {item.description || (isExpense ? 'Gasto' : 'Ingreso')}
                    </Text>
                    <View style={styles.subInfoRow}>
                        <Text style={styles.itemCat}>{item.category}</Text>
                        <Text style={styles.bulletDot}>•</Text>
                        <Text style={styles.itemDate}>{formatFecha(item.createdAt)}</Text>
                    </View>

                    {!isExpense && item.targetBucket && (
                        <View style={styles.bucketPill}>
                            <Text style={styles.bucketPillText}>
                                Destino:{' '}
                                {item.targetBucket === 'leisure'
                                    ? '🍿 Ocio'
                                    : item.targetBucket === 'buffer'
                                        ? '🛡️ Colchón'
                                        : '🐖 Ahorro'}
                            </Text>
                        </View>
                    )}
                </View>

                <Text
                    style={[
                        styles.itemAmount,
                        isExpense ? styles.amountExpense : styles.amountIncome,
                    ]}
                >
                    {isExpense ? '-' : '+'}$
                    {Number(item.amount || 0).toLocaleString('es-MX', {
                        minimumFractionDigits: 2,
                    })}
                </Text>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="light-content" backgroundColor="#0B0F17" />
            <View style={styles.container}>
                {/* Encabezado */}
                <View style={styles.header}>
                    <Text style={styles.screenTitle}>Historial Completo</Text>
                    <Text style={styles.screenSubtitle}>
                        Mostrando {transaccionesFiltradas.length} de {transactions.length} movimientos
                    </Text>
                </View>

                {/* Barra de Búsqueda + Botón de Filtros */}
                <View style={styles.searchRow}>
                    <View style={styles.searchBar}>
                        <Ionicons name="search" size={18} color="#64748B" />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Buscar gasto o categoría..."
                            placeholderTextColor="#64748B"
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            clearButtonMode="while-editing"
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <Ionicons name="close-circle" size={18} color="#64748B" />
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Botón de Filtros con indicador de filtro activo */}
                    <TouchableOpacity
                        style={[
                            styles.filterButton,
                            hasActiveFilters && styles.filterButtonActive,
                        ]}
                        onPress={() => setFilterModalVisible(true)}
                        activeOpacity={0.7}
                    >
                        <Ionicons
                            name="options-outline"
                            size={20}
                            color={hasActiveFilters ? '#38BDF8' : '#94A3B8'}
                        />
                        {hasActiveFilters && <View style={styles.activeDot} />}
                    </TouchableOpacity>
                </View>

                {/* Lista o Estados Vacíos */}
                {loading ? (
                    <View style={styles.centerContainer}>
                        <ActivityIndicator size="large" color="#38BDF8" />
                    </View>
                ) : transaccionesFiltradas.length === 0 ? (
                    <View style={styles.centerContainer}>
                        <Ionicons name="search-outline" size={48} color="#475569" />
                        <Text style={styles.emptyTitle}>Sin resultados</Text>
                        <Text style={styles.emptySubtitle}>
                            No encontramos transacciones con esos criterios de búsqueda.
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        data={transaccionesFiltradas}
                        keyExtractor={(item) => item.id}
                        renderItem={renderItem}
                        contentContainerStyle={styles.listContainer}
                        showsVerticalScrollIndicator={false}
                    />
                )}

                {/* Modal de Filtros */}
                <Modal
                    visible={filterModalVisible}
                    transparent={true}
                    animationType="fade"
                    onRequestClose={() => setFilterModalVisible(false)}
                >
                    <TouchableOpacity
                        style={styles.modalOverlay}
                        activeOpacity={1}
                        onPress={() => setFilterModalVisible(false)}
                    >
                        <View style={styles.modalContent}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Filtrar Movimientos</Text>
                                <TouchableOpacity
                                    onPress={() => {
                                        setFilterType('all');
                                        setFilterCategory('Todas');
                                    }}
                                >
                                    <Text style={styles.resetText}>Limpiar</Text>
                                </TouchableOpacity>
                            </View>

                            {/* Filtro por Tipo */}
                            <Text style={styles.filterSectionTitle}>Tipo de flujo</Text>
                            <View style={styles.typeSelectorRow}>
                                <TouchableOpacity
                                    style={[
                                        styles.typeChip,
                                        filterType === 'all' && styles.typeChipActive,
                                    ]}
                                    onPress={() => setFilterType('all')}
                                >
                                    <Text
                                        style={[
                                            styles.typeChipText,
                                            filterType === 'all' && styles.typeChipTextActive,
                                        ]}
                                    >
                                        Todos
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[
                                        styles.typeChip,
                                        filterType === 'expense' && styles.typeChipActive,
                                    ]}
                                    onPress={() => setFilterType('expense')}
                                >
                                    <Text
                                        style={[
                                            styles.typeChipText,
                                            filterType === 'expense' && styles.typeChipTextActive,
                                        ]}
                                    >
                                        Solo Gastos
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[
                                        styles.typeChip,
                                        filterType === 'income' && styles.typeChipActive,
                                    ]}
                                    onPress={() => setFilterType('income')}
                                >
                                    <Text
                                        style={[
                                            styles.typeChipText,
                                            filterType === 'income' && styles.typeChipTextActive,
                                        ]}
                                    >
                                        Solo Ingresos
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {/* Filtro por Categoría */}
                            <Text style={styles.filterSectionTitle}>Categoría</Text>
                            <ScrollView
                                style={{ maxHeight: 180 }}
                                showsVerticalScrollIndicator={false}
                            >
                                <View style={styles.categoryGrid}>
                                    {CATEGORIAS_FILTRO.map((cat) => (
                                        <TouchableOpacity
                                            key={cat}
                                            style={[
                                                styles.catChip,
                                                filterCategory === cat && styles.catChipActive,
                                            ]}
                                            onPress={() => setFilterCategory(cat)}
                                        >
                                            <Text
                                                style={[
                                                    styles.catChipText,
                                                    filterCategory === cat && styles.catChipTextActive,
                                                ]}
                                            >
                                                {cat}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </ScrollView>

                            {/* Botón Aplicar */}
                            <TouchableOpacity
                                style={styles.applyButton}
                                onPress={() => setFilterModalVisible(false)}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.applyButtonText}>Listo</Text>
                            </TouchableOpacity>
                        </View>
                    </TouchableOpacity>
                </Modal>
            </View>
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
        paddingHorizontal: 20,
        paddingTop: 10,
    },
    header: {
        marginBottom: 14,
        gap: 4,
    },
    screenTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: '#FFFFFF',
    },
    screenSubtitle: {
        fontSize: 13,
        color: '#94A3B8',
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: 16,
    },
    searchBar: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#161F30',
        borderRadius: 14,
        paddingHorizontal: 12,
        height: 48,
        borderWidth: 1,
        borderColor: '#24324D',
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: '#FFFFFF',
    },
    filterButton: {
        width: 48,
        height: 48,
        backgroundColor: '#161F30',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#24324D',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    filterButtonActive: {
        borderColor: '#38BDF8',
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
    },
    activeDot: {
        position: 'absolute',
        top: 10,
        right: 10,
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: '#38BDF8',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
    },
    emptyTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#94A3B8',
        marginTop: 8,
    },
    emptySubtitle: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        paddingHorizontal: 20,
    },
    listContainer: {
        paddingBottom: 30,
        gap: 10,
    },
    cardItem: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#161F30',
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: '#24324D',
    },
    itemLeft: {
        flex: 1,
        marginRight: 12,
        gap: 4,
    },
    itemDesc: {
        fontSize: 15,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    subInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    itemCat: {
        fontSize: 12,
        color: '#94A3B8',
    },
    bulletDot: {
        fontSize: 12,
        color: '#475569',
    },
    itemDate: {
        fontSize: 12,
        color: '#64748B',
    },
    bucketPill: {
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        borderRadius: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginTop: 2,
    },
    bucketPillText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#38BDF8',
    },
    itemAmount: {
        fontSize: 16,
        fontWeight: '800',
    },
    amountExpense: {
        color: '#F87171',
    },
    amountIncome: {
        color: '#34D399',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.75)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        width: '90%',
        backgroundColor: '#161F30',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#24324D',
        padding: 20,
        gap: 12,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#FFFFFF',
    },
    resetText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#EF4444',
    },
    filterSectionTitle: {
        fontSize: 12,
        fontWeight: '700',
        color: '#94A3B8',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginTop: 6,
    },
    typeSelectorRow: {
        flexDirection: 'row',
        gap: 8,
    },
    typeChip: {
        flex: 1,
        backgroundColor: '#0B0F17',
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#24324D',
    },
    typeChipActive: {
        borderColor: '#38BDF8',
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
    },
    typeChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#94A3B8',
    },
    typeChipTextActive: {
        color: '#38BDF8',
    },
    categoryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    catChip: {
        backgroundColor: '#0B0F17',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#24324D',
    },
    catChipActive: {
        borderColor: '#38BDF8',
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
    },
    catChipText: {
        fontSize: 12,
        color: '#94A3B8',
        fontWeight: '600',
    },
    catChipTextActive: {
        color: '#38BDF8',
        fontWeight: '700',
    },
    applyButton: {
        backgroundColor: '#38BDF8',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 10,
    },
    applyButtonText: {
        color: '#0B0F17',
        fontSize: 15,
        fontWeight: '800',
    },
});