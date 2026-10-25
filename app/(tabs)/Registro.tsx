import { Ionicons } from '@expo/vector-icons';
import { collection, deleteDoc, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
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

import { Theme } from '@/constants/theme';
import { auth, db } from '@/services/firebase';
import { Transaction } from '@/types/database';
import { getTransactionDate } from '@/utils/dates';

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
            return getTransactionDate(b).getTime() - getTransactionDate(a).getTime();
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

    const formatFecha = (tx: Transaction) => {
        const date = getTransactionDate(tx);
        return date.toLocaleDateString('es-MX', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const handleDelete = (item: Transaction) => {
        if (!item.id) {
            Alert.alert('Error', 'No se encontró el identificador del movimiento.');
            return;
        }

        // Blindaje de integridad: Ahorro Base no puede eliminarse manualmente
        if (item.category === '🎯 Ahorro Base') {
            Alert.alert(
                'Movimiento de Sistema',
                'El aporte base de ahorro está protegido para mantener la integridad contable. Si deseas modificarlo o reducirlo a $0, hazlo desde Ajustes (icono de engrane en Inicio).'
            );
            return;
        }

        const isExpense = item.type === 'expense';
        const formattedAmount = `$${Number(item.amount || 0).toLocaleString('es-MX', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })} MXN`;
        const concept = item.description || item.category || (isExpense ? 'Gasto' : 'Ingreso');

        Alert.alert(
            '¿Eliminar movimiento?',
            `¿Estás seguro de que deseas eliminar "${concept}" por ${formattedAmount}? Esta acción no se puede deshacer.`,
            [
                {
                    text: 'Cancelar',
                    style: 'cancel',
                },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteDoc(doc(db, 'transactions', item.id!));
                        } catch (error) {
                            console.error('Error al eliminar transacción:', error);
                            Alert.alert(
                                'Error al eliminar',
                                'No se pudo eliminar el movimiento. Por favor verifica tu conexión a internet o intenta más tarde.'
                            );
                        }
                    },
                },
            ]
        );
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
                        <Text style={styles.itemDate}>{formatFecha(item)}</Text>
                    </View>

                    {item.isFixedExpense ? (
                        <View style={[styles.bucketPill, styles.bucketPillFixed]}>
                            <Text style={[styles.bucketPillText, styles.bucketPillTextFixed]}>
                                Origen: 🏠 Fijo
                            </Text>
                        </View>
                    ) : item.targetBucket ? (
                        <View
                            style={[
                                styles.bucketPill,
                                item.targetBucket === 'leisure' && styles.bucketPillLeisure,
                                item.targetBucket === 'buffer' && styles.bucketPillBuffer,
                                item.targetBucket === 'savings' && styles.bucketPillSavings,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.bucketPillText,
                                    item.targetBucket === 'leisure' && styles.bucketPillTextLeisure,
                                    item.targetBucket === 'buffer' && styles.bucketPillTextBuffer,
                                    item.targetBucket === 'savings' && styles.bucketPillTextSavings,
                                ]}
                            >
                                {isExpense ? 'Origen: ' : 'Destino: '}
                                {item.targetBucket === 'leisure'
                                    ? '🍿 Ocio'
                                    : item.targetBucket === 'buffer'
                                        ? '🛡️ Colchón'
                                        : '🐖 Ahorro'}
                            </Text>
                        </View>
                    ) : null}
                </View>

                <View style={styles.itemRight}>
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
                    {item.category === '🎯 Ahorro Base' ? (
                        <TouchableOpacity
                            style={[styles.deleteButton, styles.lockedButton]}
                            onPress={() => handleDelete(item)}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Movimiento de sistema protegido"
                        >
                            <Ionicons name="lock-closed-outline" size={16} color={Theme.colors.textMuted} />
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            style={styles.deleteButton}
                            onPress={() => handleDelete(item)}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Eliminar movimiento"
                        >
                            <Ionicons name="trash-outline" size={16} color={Theme.colors.expense} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
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
                        <Ionicons name="search" size={18} color={Theme.colors.textMuted} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Buscar gasto o categoría..."
                            placeholderTextColor={Theme.colors.textMuted}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            clearButtonMode="while-editing"
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <Ionicons name="close-circle" size={18} color={Theme.colors.textMuted} />
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
                            color={hasActiveFilters ? Theme.colors.fixed : Theme.colors.textSecondary}
                        />
                        {hasActiveFilters && <View style={styles.activeDot} />}
                    </TouchableOpacity>
                </View>

                {/* Lista o Estados Vacíos */}
                {loading ? (
                    <View style={styles.centerContainer}>
                        <ActivityIndicator size="large" color={Theme.colors.fixed} />
                    </View>
                ) : transaccionesFiltradas.length === 0 ? (
                    <View style={styles.centerContainer}>
                        <Ionicons name="search-outline" size={48} color={Theme.colors.textMuted} />
                        <Text style={styles.emptyTitle}>Sin resultados</Text>
                        <Text style={styles.emptySubtitle}>
                            No encontramos transacciones con esos criterios de búsqueda.
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        data={transaccionesFiltradas}
                        keyExtractor={(item) => item.id || ''}
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
        backgroundColor: Theme.colors.background,
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
        color: Theme.colors.textPrimary,
    },
    screenSubtitle: {
        fontSize: 13,
        color: Theme.colors.textSecondary,
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
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.lg,
        paddingHorizontal: 12,
        height: 48,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        gap: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: Theme.colors.textPrimary,
    },
    filterButton: {
        width: 48,
        height: 48,
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.lg,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    filterButtonActive: {
        borderColor: Theme.colors.fixed,
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
    },
    activeDot: {
        position: 'absolute',
        top: 10,
        right: 10,
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: Theme.colors.fixed,
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
        color: Theme.colors.textSecondary,
        marginTop: 8,
    },
    emptySubtitle: {
        fontSize: 13,
        color: Theme.colors.textMuted,
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
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.lg,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: Theme.colors.border,
    },
    itemLeft: {
        flex: 1,
        marginRight: 12,
        gap: 4,
    },
    itemDesc: {
        fontSize: 15,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    subInfoRow: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 2,
    },
    itemCat: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
    },
    bulletDot: {
        fontSize: 12,
        color: Theme.colors.textMuted,
    },
    itemDate: {
        fontSize: 12,
        color: Theme.colors.textMuted,
    },
    bucketPill: {
        alignSelf: 'flex-start',
        borderRadius: Theme.radius.xs,
        borderWidth: 1,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginTop: 2,
    },
    bucketPillLeisure: {
        borderColor: Theme.colors.leisure,
        backgroundColor: 'rgba(245, 158, 11, 0.12)',
    },
    bucketPillTextLeisure: {
        color: Theme.colors.leisure,
    },
    bucketPillBuffer: {
        borderColor: Theme.colors.buffer,
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
    },
    bucketPillTextBuffer: {
        color: Theme.colors.buffer,
    },
    bucketPillFixed: {
        borderColor: Theme.colors.fixed,
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
    },
    bucketPillTextFixed: {
        color: Theme.colors.fixed,
    },
    bucketPillSavings: {
        borderColor: Theme.colors.savings,
        backgroundColor: 'rgba(168, 85, 247, 0.12)',
    },
    bucketPillTextSavings: {
        color: Theme.colors.savings,
    },
    bucketPillText: {
        fontSize: 10,
        fontWeight: '700',
    },
    itemRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    deleteButton: {
        padding: 6,
        borderRadius: Theme.radius.sm,
        backgroundColor: 'rgba(248, 113, 113, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    lockedButton: {
        backgroundColor: 'rgba(100, 116, 139, 0.15)',
    },
    itemAmount: {
        fontSize: 16,
        fontWeight: '800',
    },
    amountExpense: {
        color: Theme.colors.expense,
    },
    amountIncome: {
        color: Theme.colors.income,
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
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.xl,
        borderWidth: 1,
        borderColor: Theme.colors.border,
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
        color: Theme.colors.textPrimary,
    },
    resetText: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.statusDanger,
    },
    filterSectionTitle: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.textSecondary,
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
        backgroundColor: Theme.colors.background,
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: Theme.colors.border,
    },
    typeChipActive: {
        borderColor: Theme.colors.fixed,
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
    },
    typeChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.textSecondary,
    },
    typeChipTextActive: {
        color: Theme.colors.fixed,
    },
    categoryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    catChip: {
        backgroundColor: Theme.colors.background,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: Theme.colors.border,
    },
    catChipActive: {
        borderColor: Theme.colors.fixed,
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
    },
    catChipText: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        fontWeight: '600',
    },
    catChipTextActive: {
        color: Theme.colors.fixed,
        fontWeight: '700',
    },
    applyButton: {
        backgroundColor: Theme.colors.fixed,
        paddingVertical: 14,
        borderRadius: Theme.radius.md,
        alignItems: 'center',
        marginTop: 10,
    },
    applyButtonText: {
        color: Theme.colors.background,
        fontSize: 15,
        fontWeight: '800',
    },
});