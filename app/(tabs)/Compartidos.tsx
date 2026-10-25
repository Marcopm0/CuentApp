import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
    arrayRemove,
    arrayUnion,
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    where,
    writeBatch,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Theme } from '@/constants/theme';
import { auth, db } from '@/services/firebase';
import { SharedFund, UserProfile } from '@/types/database';

/**
 * Genera un código de invitación aleatorio de 6 caracteres alfanuméricos en mayúsculas,
 * excluyendo caracteres confusos o ambiguos (como 0, O, 1, I).
 */
const generateInviteCode = (): string => {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

export default function CompartidosScreen() {
    // 1. Estados de carga y datos de Firestore
    const [loading, setLoading] = useState<boolean>(true);
    const [currentUserData, setCurrentUserData] = useState<UserProfile | null>(null);
    const [activeFundId, setActiveFundId] = useState<string | null>(null);
    const [sharedFund, setSharedFund] = useState<SharedFund | null>(null);

    // 2. Estados de acciones de usuario
    const [joinCode, setJoinCode] = useState<string>('');
    const [isCreating, setIsCreating] = useState<boolean>(false);
    const [isJoining, setIsJoining] = useState<boolean>(false);
    const [isCancelling, setIsCancelling] = useState<boolean>(false);
    const [isLeaving, setIsLeaving] = useState<boolean>(false);

    // 3. Suscripción reactiva en tiempo real al usuario autenticado
    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            setLoading(false);
            return;
        }

        const userRef = doc(db, 'users', user.uid);
        const unsubscribeUser = onSnapshot(
            userRef,
            (userSnap) => {
                if (userSnap.exists()) {
                    const data = userSnap.data() as UserProfile;
                    setCurrentUserData(data);
                    setActiveFundId(data.activeSharedFundId || null);
                } else {
                    setCurrentUserData(null);
                    setActiveFundId(null);
                }
                setLoading(false);
            },
            (error) => {
                console.error('Error al escuchar usuario en Compartidos:', error);
                setLoading(false);
            }
        );

        return () => {
            unsubscribeUser();
        };
    }, []);

    // 4. Suscripción reactiva en tiempo real al fondo compartido (si activeFundId existe)
    useEffect(() => {
        if (!activeFundId) {
            setSharedFund(null);
            return;
        }

        const fundRef = doc(db, 'sharedFunds', activeFundId);
        const unsubscribeFund = onSnapshot(
            fundRef,
            (fundSnap) => {
                if (fundSnap.exists()) {
                    const data = fundSnap.data() as Omit<SharedFund, 'id'>;
                    if (data.active) {
                        setSharedFund({
                            id: fundSnap.id,
                            ...data,
                        });
                    } else {
                        // Si el fondo fue desactivado
                        setSharedFund(null);
                    }
                } else {
                    setSharedFund(null);
                }
            },
            (error) => {
                console.error('Error al escuchar fondo compartido:', error);
            }
        );

        return () => {
            unsubscribeFund();
        };
    }, [activeFundId]);

    // ─────────────────────────────────────────────────────────────
    // ACCIÓN A: CREAR NUEVO ESPACIO COMPARTIDO
    // ─────────────────────────────────────────────────────────────
    const handleCreateFund = async () => {
        const user = auth.currentUser;
        if (!user) {
            Alert.alert('Sesión requerida', 'Debes iniciar sesión para crear un espacio compartido.');
            return;
        }

        setIsCreating(true);
        try {
            // Generar código y verificar colisiones
            let code = generateInviteCode();
            let attempts = 0;
            while (attempts < 5) {
                const qCheck = query(
                    collection(db, 'sharedFunds'),
                    where('inviteCode', '==', code),
                    where('active', '==', true)
                );
                const snap = await getDocs(qCheck);
                if (snap.empty) break;
                code = generateInviteCode();
                attempts++;
            }

            const fundRef = doc(collection(db, 'sharedFunds'));
            const userRef = doc(db, 'users', user.uid);

            const displayName =
                currentUserData?.displayName ||
                user.displayName ||
                user.email?.split('@')[0] ||
                'Usuario';

            const email = currentUserData?.email || user.email || '';

            // Operación atómica con writeBatch
            const batch = writeBatch(db);

            batch.set(fundRef, {
                id: fundRef.id,
                inviteCode: code,
                createdAt: serverTimestamp(),
                members: [user.uid],
                memberDetails: {
                    [user.uid]: {
                        displayName,
                        email,
                        joinedAt: serverTimestamp(),
                    },
                },
                active: true,
                maxMembers: 2,
            });

            batch.update(userRef, {
                activeSharedFundId: fundRef.id,
                updatedAt: serverTimestamp(),
            });

            await batch.commit();

            // Mensaje de éxito
            Alert.alert(
                '¡Espacio Creado!',
                `Tu código de invitación es ${code}. Compártelo con tu pareja para vincular sus cuentas.`
            );
        } catch (error) {
            console.error('Error al crear espacio compartido:', error);
            Alert.alert('Error', 'No se pudo crear el espacio compartido. Por favor intenta de nuevo.');
        } finally {
            setIsCreating(false);
        }
    };

    // ─────────────────────────────────────────────────────────────
    // ACCIÓN B: UNIRSE A UN ESPACIO COMPARTIDO POR CÓDIGO
    // ─────────────────────────────────────────────────────────────
    const handleJoinFund = async () => {
        const user = auth.currentUser;
        if (!user) {
            Alert.alert('Sesión requerida', 'Debes iniciar sesión para unirte a un espacio compartido.');
            return;
        }

        const cleanCode = joinCode.trim().toUpperCase();
        if (cleanCode.length !== 6) {
            Alert.alert('Código incompleto', 'El código de invitación debe ser de exactamente 6 caracteres.');
            return;
        }

        setIsJoining(true);
        Keyboard.dismiss();

        try {
            const q = query(
                collection(db, 'sharedFunds'),
                where('inviteCode', '==', cleanCode),
                where('active', '==', true)
            );
            const querySnap = await getDocs(q);

            if (querySnap.empty) {
                Alert.alert('Código no válido', 'No encontramos ningún espacio activo con este código o ya expiró.');
                setIsJoining(false);
                return;
            }

            const fundDoc = querySnap.docs[0];
            const fundData = fundDoc.data() as Omit<SharedFund, 'id'>;

            // Verificar si el usuario ya es miembro de este espacio
            if (fundData.members.includes(user.uid)) {
                Alert.alert('Aviso', 'Ya eres miembro de este espacio compartido.');
                setIsJoining(false);
                return;
            }

            // Validar límite estricto de 2 miembros
            if (fundData.members.length >= (fundData.maxMembers || 2)) {
                Alert.alert(
                    'Espacio lleno',
                    'Este espacio compartido ya alcanzó el límite de 2 personas.'
                );
                setIsJoining(false);
                return;
            }

            const displayName =
                currentUserData?.displayName ||
                user.displayName ||
                user.email?.split('@')[0] ||
                'Usuario';

            const email = currentUserData?.email || user.email || '';

            // Vinculación atómica en writeBatch
            const batch = writeBatch(db);

            batch.update(fundDoc.ref, {
                members: arrayUnion(user.uid),
                [`memberDetails.${user.uid}`]: {
                    displayName,
                    email,
                    joinedAt: serverTimestamp(),
                },
                updatedAt: serverTimestamp(),
            });

            batch.update(doc(db, 'users', user.uid), {
                activeSharedFundId: fundDoc.id,
                updatedAt: serverTimestamp(),
            });

            await batch.commit();

            setJoinCode('');
            Alert.alert(
                '¡Vinculación Exitosa!',
                'Te has unido al espacio compartido. Ahora ambos podrán organizar los gastos en equipo.'
            );
        } catch (error) {
            console.error('Error al unirse al espacio compartido:', error);
            Alert.alert('Error', 'No se pudo vincular al espacio. Por favor verifica tu conexión e intenta de nuevo.');
        } finally {
            setIsJoining(false);
        }
    };

    // ─────────────────────────────────────────────────────────────
    // ACCIÓN C: CANCELAR ESPACIO EN ESPERA (1 MIEMBRO)
    // ─────────────────────────────────────────────────────────────
    const handleCancelInvitation = () => {
        const user = auth.currentUser;
        if (!user || !sharedFund) return;

        Alert.alert(
            '¿Cancelar invitación?',
            'El código generado dejará de funcionar y el espacio compartido será cancelado.',
            [
                { text: 'Mantener invitación', style: 'cancel' },
                {
                    text: 'Cancelar espacio',
                    style: 'destructive',
                    onPress: async () => {
                        setIsCancelling(true);
                        try {
                            const batch = writeBatch(db);
                            batch.update(doc(db, 'users', user.uid), {
                                activeSharedFundId: null,
                                updatedAt: serverTimestamp(),
                            });
                            batch.update(doc(db, 'sharedFunds', sharedFund.id), {
                                active: false,
                                updatedAt: serverTimestamp(),
                            });
                            await batch.commit();
                        } catch (error) {
                            console.error('Error al cancelar invitación:', error);
                            Alert.alert('Error', 'No se pudo cancelar el espacio compartido.');
                        } finally {
                            setIsCancelling(false);
                        }
                    },
                },
            ]
        );
    };

    // ─────────────────────────────────────────────────────────────
    // ACCIÓN D: ABANDONAR / DESVINCULAR ESPACIO ACTIVO (2 MIEMBROS)
    // ─────────────────────────────────────────────────────────────
    const handleLeaveFund = () => {
        const user = auth.currentUser;
        if (!user || !sharedFund) return;

        Alert.alert(
            '¿Abandonar espacio compartido?',
            'Dejarás de ver los gastos compartidos de este hogar. Los gastos personales de cada quien permanecerán intactos.',
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Abandonar',
                    style: 'destructive',
                    onPress: async () => {
                        setIsLeaving(true);
                        try {
                            const batch = writeBatch(db);

                            // Desvincular usuario
                            batch.update(doc(db, 'users', user.uid), {
                                activeSharedFundId: null,
                                updatedAt: serverTimestamp(),
                            });

                            const remainingMembers = sharedFund.members.filter((m) => m !== user.uid);

                            if (remainingMembers.length === 0) {
                                // Si queda vacío se desactiva
                                batch.update(doc(db, 'sharedFunds', sharedFund.id), {
                                    members: [],
                                    active: false,
                                    updatedAt: serverTimestamp(),
                                });
                            } else {
                                // Retirar UID del array de miembros
                                batch.update(doc(db, 'sharedFunds', sharedFund.id), {
                                    members: arrayRemove(user.uid),
                                    updatedAt: serverTimestamp(),
                                });
                            }

                            await batch.commit();
                            Alert.alert('Desvinculado', 'Has salido del espacio compartido.');
                        } catch (error) {
                            console.error('Error al abandonar espacio compartido:', error);
                            Alert.alert('Error', 'No se pudo desvincular del espacio compartido.');
                        } finally {
                            setIsLeaving(false);
                        }
                    },
                },
            ]
        );
    };

    // ─────────────────────────────────────────────────────────────
    // COPIAR CÓDIGO AL PORTAPAPELES
    // ─────────────────────────────────────────────────────────────
    const handleCopyCode = async (code: string) => {
        try {
            await Clipboard.setStringAsync(code);
            Alert.alert('¡Copiado!', `El código "${code}" ha sido copiado al portapapeles.`);
        } catch {
            Alert.alert('Código', code);
        }
    };

    // ─────────────────────────────────────────────────────────────
    // DATOS DERIVADOS DE INTEGRANTES
    // ─────────────────────────────────────────────────────────────
    const isLinkedWithPartner = useMemo(() => {
        return !!(sharedFund && sharedFund.active && sharedFund.members.length === 2);
    }, [sharedFund]);

    const isWaitingPartner = useMemo(() => {
        return !!(sharedFund && sharedFund.active && sharedFund.members.length === 1);
    }, [sharedFund]);

    const partnerName = useMemo(() => {
        if (!sharedFund || !auth.currentUser) return '';
        const partnerUid = sharedFund.members.find((m) => m !== auth.currentUser?.uid);
        if (!partnerUid) return 'Tu pareja';
        const details = sharedFund.memberDetails?.[partnerUid];
        return details?.displayName ? details.displayName.split(' ')[0] : 'Tu pareja';
    }, [sharedFund]);

    const myName = useMemo(() => {
        if (!currentUserData && !auth.currentUser) return 'Tú';
        const name = currentUserData?.displayName || auth.currentUser?.displayName || 'Tú';
        return name.split(' ')[0];
    }, [currentUserData]);

    const joinedDateFormatted = useMemo(() => {
        if (!sharedFund?.createdAt) return 'Reciente';
        try {
            const raw = sharedFund.createdAt;
            const ms = raw.toMillis ? raw.toMillis() : (raw.seconds ? raw.seconds * 1000 : null);
            if (!ms) return 'Reciente';
            const d = new Date(ms);
            return d.toLocaleDateString('es-MX', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            });
        } catch {
            return 'Reciente';
        }
    }, [sharedFund]);

    // Pantalla de carga inicial
    if (loading) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
                <View style={styles.centerContainer}>
                    <ActivityIndicator size="large" color={Theme.colors.borderFocus} />
                    <Text style={styles.loadingText}>Cargando espacio compartido...</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <StatusBar barStyle="light-content" backgroundColor={Theme.colors.background} />
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                    <ScrollView
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* ─────────────────────────────────────────────────────────────
                            ESTADO 2: VINCULADO CON PAREJA (members.length === 2)
                           ───────────────────────────────────────────────────────────── */}
                        {isLinkedWithPartner && sharedFund ? (
                            <View style={styles.stateContainer}>
                                {/* Cabecera de Hogar Vinculado */}
                                <View style={styles.linkedHeaderCard}>
                                    <View style={styles.linkedBadgeRow}>
                                        <View style={styles.statusLiveBadge}>
                                            <View style={styles.liveIndicatorDot} />
                                            <Text style={styles.statusLiveText}>Hogar Activo</Text>
                                        </View>
                                        <Text style={styles.joinedDateText}>Desde {joinedDateFormatted}</Text>
                                    </View>

                                    <View style={styles.avatarsRow}>
                                        <View style={styles.avatarGroup}>
                                            <View style={[styles.avatarCircle, { borderColor: Theme.colors.borderFocus }]}>
                                                <Ionicons name="person" size={26} color={Theme.colors.borderFocus} />
                                            </View>
                                            <Text style={styles.avatarName} numberOfLines={1}>{myName}</Text>
                                        </View>

                                        <View style={styles.heartConnector}>
                                            <Ionicons name="heart" size={24} color={Theme.colors.savings} />
                                        </View>

                                        <View style={styles.avatarGroup}>
                                            <View style={[styles.avatarCircle, { borderColor: Theme.colors.income }]}>
                                                <Ionicons name="person" size={26} color={Theme.colors.income} />
                                            </View>
                                            <Text style={styles.avatarName} numberOfLines={1}>{partnerName}</Text>
                                        </View>
                                    </View>

                                    <Text style={styles.linkedCoupleTitle}>
                                        {myName} & {partnerName}
                                    </Text>
                                    <Text style={styles.linkedCoupleSub}>
                                        Cuentas claras, gastos divididos y finanzas sin fricción en el hogar.
                                    </Text>
                                </View>

                                {/* CONTENEDORES PROVISIONALES PARA SIGUIENTES FASES */}
                                <View style={styles.sectionHeaderRow}>
                                    <Text style={styles.sectionTitle}>Módulos Compartidos</Text>
                                </View>

                                {/* Placeholder: Servicios Recurrentes (Fase 2) */}
                                <View style={styles.cardPlaceholder}>
                                    <View style={styles.cardPlaceholderHeader}>
                                        <View style={[styles.iconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.12)' }]}>
                                            <Ionicons name="receipt-outline" size={20} color={Theme.colors.borderFocus} />
                                        </View>
                                        <View style={styles.cardPlaceholderTitleGroup}>
                                            <View style={styles.titleBadgeInline}>
                                                <Text style={styles.cardPlaceholderTitle}>Servicios Recurrentes</Text>
                                                <View style={styles.phaseBadge}>
                                                    <Text style={styles.phaseBadgeText}>Próximamente</Text>
                                                </View>
                                            </View>
                                            <Text style={styles.cardPlaceholderSubtitle}>
                                                Renta, internet, luz, despensa y suscripciones divididas en equipo.
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={styles.previewDivider} />
                                    <Text style={styles.cardPlaceholderFooter}>
                                        ✨ Podrán programar quién paga cada servicio y sincronizar los recordatorios de vencimiento.
                                    </Text>
                                </View>

                                {/* Placeholder: Muro de Aportaciones (Fase 3) */}
                                <View style={styles.cardPlaceholder}>
                                    <View style={styles.cardPlaceholderHeader}>
                                        <View style={[styles.iconCircle, { backgroundColor: 'rgba(52, 211, 153, 0.12)' }]}>
                                            <Ionicons name="wallet-outline" size={20} color={Theme.colors.income} />
                                        </View>
                                        <View style={styles.cardPlaceholderTitleGroup}>
                                            <View style={styles.titleBadgeInline}>
                                                <Text style={styles.cardPlaceholderTitle}>Muro de Aportaciones</Text>
                                                <View style={styles.phaseBadge}>
                                                    <Text style={styles.phaseBadgeText}>Próximamente</Text>
                                                </View>
                                            </View>
                                            <Text style={styles.cardPlaceholderSubtitle}>
                                                Historial en vivo de aportaciones y balance proporcional de gastos.
                                            </Text>
                                        </View>
                                    </View>
                                    <View style={styles.previewDivider} />
                                    <Text style={styles.cardPlaceholderFooter}>
                                        ⚖️ Registrarán los tickets de compras comunes para mantener el saldo equilibrado sin transferencias manuales.
                                    </Text>
                                </View>

                                {/* Botón para Abandonar Espacio */}
                                <TouchableOpacity
                                    style={styles.leaveButton}
                                    onPress={handleLeaveFund}
                                    activeOpacity={0.8}
                                    disabled={isLeaving}
                                >
                                    {isLeaving ? (
                                        <ActivityIndicator size="small" color={Theme.colors.statusDanger} />
                                    ) : (
                                        <>
                                            <Ionicons name="exit-outline" size={18} color={Theme.colors.statusDanger} />
                                            <Text style={styles.leaveButtonText}>Abandonar espacio compartido</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </View>
                        ) : isWaitingPartner && sharedFund ? (
                            /* ─────────────────────────────────────────────────────────────
                                ESTADO 1.5: ESPACIO CREADO, ESPERANDO A QUE LA PAREJA SE UNA
                               ───────────────────────────────────────────────────────────── */
                            <View style={styles.stateContainer}>
                                <View style={styles.waitingCard}>
                                    <View style={styles.waitingIconCircle}>
                                        <Ionicons name="time-outline" size={32} color={Theme.colors.borderFocus} />
                                    </View>

                                    <Text style={styles.waitingTitle}>Esperando a tu pareja</Text>
                                    <Text style={styles.waitingSubtitle}>
                                        Comparte este código para que se vincule a tu espacio compartido:
                                    </Text>

                                    {/* Caja de Código Monoespaciado */}
                                    <View style={styles.codeBox}>
                                        <Text style={styles.codeText}>{sharedFund.inviteCode}</Text>
                                    </View>

                                    {/* Botón Copiar Código */}
                                    <TouchableOpacity
                                        style={styles.copyButton}
                                        onPress={() => handleCopyCode(sharedFund.inviteCode)}
                                        activeOpacity={0.8}
                                    >
                                        <Ionicons name="copy-outline" size={18} color={Theme.colors.background} />
                                        <Text style={styles.copyButtonText}>Copiar código</Text>
                                    </TouchableOpacity>

                                    <Text style={styles.waitingHelpText}>
                                        Tu pareja solo debe ingresar este código en la pestaña "Compartidos" de su aplicación.
                                    </Text>

                                    <View style={styles.previewDivider} />

                                    {/* Botón Cancelar Invitación */}
                                    <TouchableOpacity
                                        style={styles.cancelButton}
                                        onPress={handleCancelInvitation}
                                        activeOpacity={0.7}
                                        disabled={isCancelling}
                                    >
                                        {isCancelling ? (
                                            <ActivityIndicator size="small" color={Theme.colors.textMuted} />
                                        ) : (
                                            <>
                                                <Ionicons name="close-circle-outline" size={16} color={Theme.colors.textMuted} />
                                                <Text style={styles.cancelButtonText}>Cancelar invitación / Eliminar espacio</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ) : (
                            /* ─────────────────────────────────────────────────────────────
                                ESTADO 1: NO VINCULADO (INICIO / BIENVENIDA)
                               ───────────────────────────────────────────────────────────── */
                            <View style={styles.stateContainer}>
                                {/* HERO BANNER */}
                                <View style={styles.heroCard}>
                                    <View style={styles.heroIconBadge}>
                                        <Ionicons name="people" size={36} color={Theme.colors.borderFocus} />
                                    </View>
                                    <Text style={styles.heroTitle}>Espacio Compartido</Text>
                                    <Text style={styles.heroSubtitle}>
                                        Lleyen el control de gastos del hogar y servicios en equipo, con cuentas claras y sin fricciones.
                                    </Text>
                                </View>

                                {/* ACCIÓN A: CREAR HOGAR */}
                                <View style={styles.actionCard}>
                                    <View style={styles.actionCardHeader}>
                                        <View style={[styles.iconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.12)' }]}>
                                            <Ionicons name="add-circle-outline" size={20} color={Theme.colors.borderFocus} />
                                        </View>
                                        <View style={styles.actionCardTitleGroup}>
                                            <Text style={styles.actionCardTitle}>Crear nuevo espacio</Text>
                                            <Text style={styles.actionCardSub}>
                                                Genera un código único de 6 caracteres para invitar a tu pareja.
                                            </Text>
                                        </View>
                                    </View>

                                    <TouchableOpacity
                                        style={styles.createButton}
                                        onPress={handleCreateFund}
                                        activeOpacity={0.8}
                                        disabled={isCreating}
                                    >
                                        {isCreating ? (
                                            <ActivityIndicator size="small" color={Theme.colors.background} />
                                        ) : (
                                            <>
                                                <Ionicons name="sparkles" size={18} color={Theme.colors.background} />
                                                <Text style={styles.createButtonText}>Crear nuevo espacio compartido</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>

                                {/* DIVISOR INTERMEDIO */}
                                <View style={styles.orDividerRow}>
                                    <View style={styles.orDividerLine} />
                                    <Text style={styles.orDividerText}>O ÚNETE A UNO EXISTENTE</Text>
                                    <View style={styles.orDividerLine} />
                                </View>

                                {/* ACCIÓN B: UNIRSE A HOGAR */}
                                <View style={styles.actionCard}>
                                    <View style={styles.actionCardHeader}>
                                        <View style={[styles.iconCircle, { backgroundColor: 'rgba(52, 211, 153, 0.12)' }]}>
                                            <Ionicons name="enter-outline" size={20} color={Theme.colors.income} />
                                        </View>
                                        <View style={styles.actionCardTitleGroup}>
                                            <Text style={styles.actionCardTitle}>Tengo un código</Text>
                                            <Text style={styles.actionCardSub}>
                                                Ingresa el código de 6 caracteres que te compartió tu pareja.
                                            </Text>
                                        </View>
                                    </View>

                                    <View style={styles.inputRow}>
                                        <TextInput
                                            style={styles.codeInput}
                                            placeholder="K9X2P4"
                                            placeholderTextColor={Theme.colors.textMuted}
                                            autoCapitalize="characters"
                                            autoCorrect={false}
                                            maxLength={6}
                                            value={joinCode}
                                            onChangeText={(val) => setJoinCode(val.toUpperCase())}
                                        />

                                        <TouchableOpacity
                                            style={[
                                                styles.joinButton,
                                                (joinCode.trim().length !== 6 || isJoining) && styles.joinButtonDisabled,
                                            ]}
                                            onPress={handleJoinFund}
                                            activeOpacity={0.8}
                                            disabled={joinCode.trim().length !== 6 || isJoining}
                                        >
                                            {isJoining ? (
                                                <ActivityIndicator size="small" color={Theme.colors.background} />
                                            ) : (
                                                <Text style={styles.joinButtonText}>Vincularme</Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>
                        )}
                    </ScrollView>
                </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: Theme.colors.background,
    },
    flex: {
        flex: 1,
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        backgroundColor: Theme.colors.background,
    },
    loadingText: {
        fontSize: 14,
        color: Theme.colors.textSecondary,
        fontWeight: '600',
    },
    scrollContent: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 40,
    },
    stateContainer: {
        gap: 16,
    },
    // Hero Banner
    heroCard: {
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.lg,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        padding: 24,
        alignItems: 'center',
        textAlign: 'center',
        gap: 10,
    },
    heroIconBadge: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.25)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 4,
    },
    heroTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
        letterSpacing: -0.3,
    },
    heroSubtitle: {
        fontSize: 13,
        color: Theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 19,
    },
    // Cards de Acciones
    actionCard: {
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.lg,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        padding: 16,
        gap: 14,
    },
    actionCardHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    iconCircle: {
        width: 36,
        height: 36,
        borderRadius: Theme.radius.sm,
        justifyContent: 'center',
        alignItems: 'center',
    },
    actionCardTitleGroup: {
        flex: 1,
    },
    actionCardTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    actionCardSub: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        marginTop: 2,
        lineHeight: 16,
    },
    createButton: {
        backgroundColor: Theme.colors.borderFocus,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 13,
        borderRadius: Theme.radius.md,
        gap: 8,
    },
    createButtonText: {
        fontSize: 14,
        fontWeight: '800',
        color: Theme.colors.background,
    },
    orDividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 4,
    },
    orDividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: Theme.colors.borderSubtle,
    },
    orDividerText: {
        fontSize: 11,
        fontWeight: '700',
        color: Theme.colors.textMuted,
        letterSpacing: 0.5,
    },
    inputRow: {
        flexDirection: 'row',
        gap: 10,
        alignItems: 'center',
    },
    codeInput: {
        flex: 1,
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderWidth: 1.5,
        borderColor: Theme.colors.borderSubtle,
        borderRadius: Theme.radius.md,
        paddingVertical: 10,
        paddingHorizontal: 16,
        fontSize: 18,
        fontWeight: '800',
        letterSpacing: 3,
        color: Theme.colors.textPrimary,
        textAlign: 'center',
    },
    joinButton: {
        backgroundColor: Theme.colors.income,
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: Theme.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    joinButtonDisabled: {
        opacity: 0.45,
    },
    joinButtonText: {
        fontSize: 14,
        fontWeight: '800',
        color: Theme.colors.background,
    },
    // Estado en Espera (Waiting Card)
    waitingCard: {
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.lg,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        padding: 24,
        alignItems: 'center',
        gap: 14,
    },
    waitingIconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.3)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    waitingTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
    },
    waitingSubtitle: {
        fontSize: 13,
        color: Theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 18,
    },
    codeBox: {
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderWidth: 2,
        borderColor: Theme.colors.borderFocus,
        borderRadius: Theme.radius.md,
        paddingVertical: 14,
        paddingHorizontal: 32,
        marginVertical: 4,
    },
    codeText: {
        fontSize: 32,
        fontWeight: '900',
        letterSpacing: 6,
        color: Theme.colors.borderFocus,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    copyButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: Theme.colors.borderFocus,
        paddingVertical: 12,
        paddingHorizontal: 28,
        borderRadius: Theme.radius.md,
    },
    copyButtonText: {
        fontSize: 14,
        fontWeight: '800',
        color: Theme.colors.background,
    },
    waitingHelpText: {
        fontSize: 12,
        color: Theme.colors.textMuted,
        textAlign: 'center',
        lineHeight: 16,
        paddingHorizontal: 12,
    },
    cancelButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 14,
    },
    cancelButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: Theme.colors.textMuted,
    },
    // Estado Vinculado (Linked State)
    linkedHeaderCard: {
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.lg,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        padding: 20,
        alignItems: 'center',
        gap: 14,
    },
    linkedBadgeRow: {
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    statusLiveBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        borderColor: 'rgba(16, 185, 129, 0.3)',
        borderWidth: 1,
        paddingVertical: 3,
        paddingHorizontal: 8,
        borderRadius: Theme.radius.sm,
    },
    liveIndicatorDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: Theme.colors.income,
    },
    statusLiveText: {
        fontSize: 11,
        fontWeight: '800',
        color: Theme.colors.income,
    },
    joinedDateText: {
        fontSize: 11,
        color: Theme.colors.textMuted,
        fontWeight: '600',
    },
    avatarsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        marginTop: 6,
    },
    avatarGroup: {
        alignItems: 'center',
        gap: 6,
        width: 80,
    },
    avatarCircle: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderWidth: 2,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarName: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
        textAlign: 'center',
    },
    heartConnector: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(168, 85, 247, 0.15)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    linkedCoupleTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
        letterSpacing: -0.3,
    },
    linkedCoupleSub: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 17,
        paddingHorizontal: 12,
    },
    sectionHeaderRow: {
        marginTop: 4,
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: Theme.colors.textPrimary,
    },
    // Placeholders Fases 2 y 3
    cardPlaceholder: {
        backgroundColor: Theme.colors.cardSurface,
        borderRadius: Theme.radius.lg,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        padding: 16,
        gap: 12,
    },
    cardPlaceholderHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    cardPlaceholderTitleGroup: {
        flex: 1,
        gap: 3,
    },
    titleBadgeInline: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    cardPlaceholderTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    phaseBadge: {
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: Theme.radius.xs,
    },
    phaseBadgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: Theme.colors.borderFocus,
    },
    cardPlaceholderSubtitle: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        lineHeight: 16,
    },
    previewDivider: {
        height: 1,
        backgroundColor: Theme.colors.borderSubtle,
        width: '100%',
    },
    cardPlaceholderFooter: {
        fontSize: 11,
        color: Theme.colors.textMuted,
        lineHeight: 15,
        fontStyle: 'italic',
    },
    leaveButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        borderRadius: Theme.radius.md,
        backgroundColor: 'rgba(239, 68, 68, 0.08)',
        borderWidth: 1,
        borderColor: 'rgba(239, 68, 68, 0.25)',
        marginTop: 8,
    },
    leaveButtonText: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.statusDanger,
    },
});