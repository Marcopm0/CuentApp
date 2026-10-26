import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
    where,
    writeBatch,
} from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Modal,
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
import { SharedFund, SharedService, UserProfile } from '@/types/database';

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

    // ─────────────────────────────────────────────────────────────
    // FASE 2: GESTIÓN DE SERVICIOS RECURRENTES DEL HOGAR
    // ─────────────────────────────────────────────────────────────
    const currentUserUid = auth.currentUser?.uid || '';
    const partnerUid = useMemo(() => {
        if (!sharedFund || !currentUserUid) return '';
        return sharedFund.members.find((m) => m !== currentUserUid) || '';
    }, [sharedFund, currentUserUid]);

    // Suscripción reactiva a la subcolección sharedFunds/{activeFundId}/services
    const [services, setServices] = useState<SharedService[]>([]);
    const [servicesLoading, setServicesLoading] = useState<boolean>(true);

    useEffect(() => {
        if (!activeFundId || !isLinkedWithPartner) {
            setServices([]);
            setServicesLoading(false);
            return;
        }

        const servicesQuery = query(
            collection(db, 'sharedFunds', activeFundId, 'services'),
            orderBy('createdAt', 'desc')
        );

        const unsubscribeServices = onSnapshot(
            servicesQuery,
            (snapshot) => {
                const items: SharedService[] = snapshot.docs.map((docSnap) => ({
                    id: docSnap.id,
                    ...(docSnap.data() as Omit<SharedService, 'id'>),
                }));
                setServices(items);
                setServicesLoading(false);
            },
            (error) => {
                console.error('Error al escuchar servicios compartidos:', error);
                setServicesLoading(false);
            }
        );

        return () => {
            unsubscribeServices();
        };
    }, [activeFundId, isLinkedWithPartner]);

    // Métricas del hogar
    const totalHogarMonthly = useMemo(() => {
        return services.reduce((acc, s) => acc + (Number(s.totalAmount) || 0), 0);
    }, [services]);

    const myTotalSharedMonthly = useMemo(() => {
        return services.reduce((acc, s) => acc + (Number(s.split?.[currentUserUid]) || 0), 0);
    }, [services, currentUserUid]);

    // Estados del Modal de Agregar Servicio del Hogar
    const [serviceModalVisible, setServiceModalVisible] = useState<boolean>(false);
    const [serviceConcept, setServiceConcept] = useState<string>('');
    const [serviceAmount, setServiceAmount] = useState<string>('');
    const [serviceDueBlock, setServiceDueBlock] = useState<'1-10' | '11-20' | '21-end'>('1-10');
    const [serviceHolderUid, setServiceHolderUid] = useState<string>('');
    const [splitMode, setSplitMode] = useState<'50-50' | 'custom'>('50-50');
    const [customSplitA, setCustomSplitA] = useState<string>('');
    const [customSplitB, setCustomSplitB] = useState<string>('');
    const [isSubmittingService, setIsSubmittingService] = useState<boolean>(false);

    // Sanitizador numérico
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

    const handleOpenAddServiceModal = () => {
        setServiceConcept('');
        setServiceAmount('');
        setServiceDueBlock('1-10');
        setServiceHolderUid(currentUserUid);
        setSplitMode('50-50');
        setCustomSplitA('');
        setCustomSplitB('');
        setServiceModalVisible(true);
    };

    const handleAmountChange = (val: string) => {
        handleNumberInput(val, (cleaned) => {
            setServiceAmount(cleaned);
            const num = parseFloat(cleaned) || 0;
            if (num > 0 && splitMode === '50-50') {
                const half = Math.round((num / 2) * 100) / 100;
                const rest = Math.round((num - half) * 100) / 100;
                setCustomSplitA(half.toFixed(2));
                setCustomSplitB(rest.toFixed(2));
            }
        });
    };

    const handleCustomSplitAChange = (val: string) => {
        handleNumberInput(val, (cleaned) => {
            setCustomSplitA(cleaned);
            const total = parseFloat(serviceAmount) || 0;
            const a = parseFloat(cleaned) || 0;
            if (total > 0 && a <= total) {
                const b = Math.round((total - a) * 100) / 100;
                setCustomSplitB(b >= 0 ? (b % 1 === 0 ? b.toString() : b.toFixed(2)) : '0');
            }
        });
    };

    const handleCustomSplitBChange = (val: string) => {
        handleNumberInput(val, (cleaned) => {
            setCustomSplitB(cleaned);
            const total = parseFloat(serviceAmount) || 0;
            const b = parseFloat(cleaned) || 0;
            if (total > 0 && b <= total) {
                const a = Math.round((total - b) * 100) / 100;
                setCustomSplitA(a >= 0 ? (a % 1 === 0 ? a.toString() : a.toFixed(2)) : '0');
            }
        });
    };

    const handleAddService = async () => {
        const user = auth.currentUser;
        if (!user || !activeFundId || !partnerUid) {
            Alert.alert('Error', 'No se encontró un espacio compartido activo con tu pareja.');
            return;
        }

        const cleanConcept = serviceConcept.trim();
        if (!cleanConcept) {
            Alert.alert('Concepto requerido', 'Por favor ingresa el nombre del servicio (ej. Internet, Renta, Gas, Luz).');
            return;
        }

        const numericTotal = parseFloat(serviceAmount);
        if (isNaN(numericTotal) || numericTotal <= 0) {
            Alert.alert('Monto inválido', 'Por favor ingresa un monto total mensual mayor a $0.');
            return;
        }

        let splitA = 0;
        let splitB = 0;

        if (splitMode === '50-50') {
            splitA = Math.round((numericTotal / 2) * 100) / 100;
            splitB = Math.round((numericTotal - splitA) * 100) / 100;
        } else {
            splitA = parseFloat(customSplitA) || 0;
            splitB = parseFloat(customSplitB) || 0;
            if (Math.abs((splitA + splitB) - numericTotal) > 0.05) {
                Alert.alert(
                    'Cuotas desiguales',
                    `La suma de las cuotas ($${(splitA + splitB).toFixed(2)}) debe ser exactamente igual al monto mensual ($${numericTotal.toFixed(2)}).`
                );
                return;
            }
        }

        setIsSubmittingService(true);
        try {
            const now = new Date();
            const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

            await addDoc(collection(db, 'sharedFunds', activeFundId, 'services'), {
                concept: cleanConcept,
                totalAmount: numericTotal,
                dueBlock: serviceDueBlock,
                holderUid: serviceHolderUid || user.uid,
                split: {
                    [user.uid]: splitA,
                    [partnerUid]: splitB,
                },
                status: {
                    transferredBy: [],
                    paidToProvider: false,
                    lastPaidMonth: currentMonthStr,
                },
                createdAt: serverTimestamp(),
            });

            setServiceModalVisible(false);
            Alert.alert('¡Servicio Registrado!', `"${cleanConcept}" se ha agregado con éxito a los gastos del hogar.`);
        } catch (error) {
            console.error('Error al registrar servicio del hogar:', error);
            Alert.alert('Error', 'No se pudo registrar el servicio. Por favor intenta de nuevo.');
        } finally {
            setIsSubmittingService(false);
        }
    };

    const handleMarkTransferred = async (service: SharedService) => {
        const user = auth.currentUser;
        if (!user || !activeFundId) return;

        const now = new Date();
        const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        try {
            const serviceRef = doc(db, 'sharedFunds', activeFundId, 'services', service.id);
            await updateDoc(serviceRef, {
                'status.transferredBy': arrayUnion(user.uid),
                'status.lastPaidMonth': currentMonthStr,
            });
        } catch (error) {
            console.error('Error al marcar cuota transferida:', error);
            Alert.alert('Error', 'No se pudo actualizar el estado de la transferencia.');
        }
    };

    const handleMarkPaidToProvider = (service: SharedService) => {
        const user = auth.currentUser;
        if (!user || !activeFundId) return;

        const now = new Date();
        const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        Alert.alert(
            'Confirmar liquidación',
            `¿Confirmas que ya pagaste la factura oficial de "${service.concept}" ($${service.totalAmount.toFixed(2)} MXN) al proveedor?`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Confirmar pago',
                    onPress: async () => {
                        try {
                            const serviceRef = doc(db, 'sharedFunds', activeFundId, 'services', service.id);
                            await updateDoc(serviceRef, {
                                'status.paidToProvider': true,
                                'status.lastPaidMonth': currentMonthStr,
                            });
                        } catch (error) {
                            console.error('Error al marcar servicio como pagado:', error);
                            Alert.alert('Error', 'No se pudo actualizar el estado.');
                        }
                    },
                },
            ]
        );
    };

    const handleDeleteService = (service: SharedService) => {
        if (!activeFundId) return;

        Alert.alert(
            '¿Eliminar servicio compartido?',
            `¿Estás seguro de que deseas eliminar "${service.concept}"? Se quitará de la división del hogar y del disponible en Inicio de ambos.`,
            [
                { text: 'Cancelar', style: 'cancel' },
                {
                    text: 'Eliminar',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteDoc(doc(db, 'sharedFunds', activeFundId, 'services', service.id));
                        } catch (error) {
                            console.error('Error al eliminar servicio compartido:', error);
                            Alert.alert('Error', 'No se pudo eliminar el servicio.');
                        }
                    },
                },
            ]
        );
    };

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

    const getServiceIcon = (concept: string): keyof typeof Ionicons.glyphMap => {
        const lower = concept.toLowerCase();
        if (lower.includes('internet') || lower.includes('wifi') || lower.includes('teléfono') || lower.includes('telefono')) {
            return 'wifi-outline';
        }
        if (lower.includes('renta') || lower.includes('hipoteca') || lower.includes('casa') || lower.includes('depa')) {
            return 'home-outline';
        }
        if (lower.includes('luz') || lower.includes('cfe') || lower.includes('electricidad')) {
            return 'flash-outline';
        }
        if (lower.includes('agua')) {
            return 'water-outline';
        }
        if (lower.includes('gas')) {
            return 'flame-outline';
        }
        if (lower.includes('despensa') || lower.includes('super') || lower.includes('comida')) {
            return 'cart-outline';
        }
        if (lower.includes('netflix') || lower.includes('spotify') || lower.includes('streaming') || lower.includes('tv')) {
            return 'tv-outline';
        }
        return 'receipt-outline';
    };

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

                                {/* SECCIÓN FASE 2: MATRIZ DE SERVICIOS RECURRENTES DEL HOGAR */}
                                <View style={styles.servicesSectionContainer}>
                                    <View style={styles.servicesSectionHeaderRow}>
                                        <View style={styles.servicesSectionHeaderLeft}>
                                            <View style={[styles.iconCircle, { backgroundColor: 'rgba(56, 189, 248, 0.12)' }]}>
                                                <Ionicons name="receipt-outline" size={20} color={Theme.colors.borderFocus} />
                                            </View>
                                            <View>
                                                <Text style={styles.servicesSectionTitle}>Servicios del Hogar</Text>
                                                <Text style={styles.servicesSectionSubtitle}>
                                                    {services.length} {services.length === 1 ? 'servicio registrado' : 'servicios registrados'}
                                                </Text>
                                            </View>
                                        </View>

                                        <TouchableOpacity
                                            style={styles.addServiceButton}
                                            onPress={handleOpenAddServiceModal}
                                            activeOpacity={0.8}
                                        >
                                            <Ionicons name="add" size={18} color={Theme.colors.background} />
                                            <Text style={styles.addServiceButtonText}>Agregar</Text>
                                        </TouchableOpacity>
                                    </View>

                                    {/* Barra de resumen de costos si hay servicios */}
                                    {services.length > 0 && (
                                        <View style={styles.servicesSummaryCard}>
                                            <View style={styles.summaryItem}>
                                                <Text style={styles.summaryItemLabel}>Total Hogar</Text>
                                                <Text style={styles.summaryItemValue}>
                                                    ${totalHogarMonthly.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                </Text>
                                                <Text style={styles.summaryItemSub}>al mes</Text>
                                            </View>
                                            <View style={styles.summaryDivider} />
                                            <View style={styles.summaryItem}>
                                                <Text style={styles.summaryItemLabel}>Tu Aporte</Text>
                                                <Text style={[styles.summaryItemValue, { color: Theme.colors.borderFocus }]}>
                                                    ${myTotalSharedMonthly.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                </Text>
                                                <Text style={styles.summaryItemSub}>al mes</Text>
                                            </View>
                                            <View style={styles.summaryDivider} />
                                            <View style={styles.summaryItem}>
                                                <Text style={styles.summaryItemLabel}>Aporte {partnerName}</Text>
                                                <Text style={[styles.summaryItemValue, { color: Theme.colors.income }]}>
                                                    ${(totalHogarMonthly - myTotalSharedMonthly).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                </Text>
                                                <Text style={styles.summaryItemSub}>al mes</Text>
                                            </View>
                                        </View>
                                    )}

                                    {/* Lista o Estado Vacío */}
                                    {servicesLoading ? (
                                        <View style={styles.servicesLoadingBox}>
                                            <ActivityIndicator size="small" color={Theme.colors.borderFocus} />
                                            <Text style={styles.servicesLoadingText}>Cargando servicios del hogar...</Text>
                                        </View>
                                    ) : services.length === 0 ? (
                                        <View style={styles.servicesEmptyCard}>
                                            <View style={styles.servicesEmptyIconCircle}>
                                                <Ionicons name="receipt-outline" size={28} color={Theme.colors.textMuted} />
                                            </View>
                                            <Text style={styles.servicesEmptyTitle}>Sin servicios registrados aún</Text>
                                            <Text style={styles.servicesEmptySub}>
                                                Agreguen los recibos comunes (renta, internet, luz, despensa) para coordinar las cuotas y sincronizarlas con su disponible en Inicio.
                                            </Text>
                                            <TouchableOpacity
                                                style={styles.emptyAddBtn}
                                                onPress={handleOpenAddServiceModal}
                                                activeOpacity={0.8}
                                            >
                                                <Ionicons name="add-circle-outline" size={18} color={Theme.colors.borderFocus} />
                                                <Text style={styles.emptyAddBtnText}>Registrar primer servicio</Text>
                                            </TouchableOpacity>
                                        </View>
                                    ) : (
                                        <View style={styles.servicesListContainer}>
                                            {services.map((service) => {
                                                const isCurrentUserHolder = service.holderUid === currentUserUid;
                                                const myQuota = Number(service.split?.[currentUserUid]) || 0;
                                                const partnerQuota = Number(service.split?.[partnerUid]) || 0;
                                                const transferredList = Array.isArray(service.status?.transferredBy)
                                                    ? service.status.transferredBy
                                                    : [];
                                                const hasMyTransferred = transferredList.includes(currentUserUid);
                                                const hasPartnerTransferred = transferredList.includes(partnerUid);
                                                const isPaidToProvider = service.status?.paidToProvider === true;
                                                const iconName = getServiceIcon(service.concept);

                                                return (
                                                    <View key={service.id} style={styles.serviceCard}>
                                                        {/* Fila Superior: Icono, Concepto, Bloque y Borrar */}
                                                        <View style={styles.serviceCardHeader}>
                                                            <View style={styles.serviceIconCircle}>
                                                                <Ionicons name={iconName} size={20} color={Theme.colors.borderFocus} />
                                                            </View>
                                                            <View style={styles.serviceTitleGroup}>
                                                                <Text style={styles.serviceConcept} numberOfLines={1}>
                                                                    {service.concept}
                                                                </Text>
                                                                <View style={styles.serviceMetaRow}>
                                                                    <View style={styles.dueBlockBadge}>
                                                                        <Ionicons name="calendar-outline" size={12} color={Theme.colors.textSecondary} />
                                                                        <Text style={styles.dueBlockBadgeText}>
                                                                            {getDueBlockLabel(service.dueBlock)}
                                                                        </Text>
                                                                    </View>
                                                                    <View style={styles.holderPill}>
                                                                        <Ionicons
                                                                            name={isCurrentUserHolder ? 'person' : 'person-outline'}
                                                                            size={12}
                                                                            color={isCurrentUserHolder ? Theme.colors.borderFocus : Theme.colors.textMuted}
                                                                        />
                                                                        <Text style={styles.holderPillText}>
                                                                            Titular: {isCurrentUserHolder ? 'Tú' : partnerName}
                                                                        </Text>
                                                                    </View>
                                                                </View>
                                                            </View>

                                                            <TouchableOpacity
                                                                style={styles.deleteServiceBtn}
                                                                onPress={() => handleDeleteService(service)}
                                                                activeOpacity={0.7}
                                                                accessibilityLabel="Eliminar servicio"
                                                            >
                                                                <Ionicons name="trash-outline" size={18} color={Theme.colors.textMuted} />
                                                            </TouchableOpacity>
                                                        </View>

                                                        {/* Monto Total */}
                                                        <View style={styles.serviceTotalRow}>
                                                            <Text style={styles.serviceTotalLabel}>Recibo mensual:</Text>
                                                            <Text style={styles.serviceTotalAmount}>
                                                                ${service.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
                                                            </Text>
                                                        </View>

                                                        {/* Desglose de Cuotas */}
                                                        <View style={styles.splitGrid}>
                                                            <View style={[styles.splitBox, { borderColor: 'rgba(56, 189, 248, 0.25)' }]}>
                                                                <Text style={styles.splitBoxLabel}>Tú aportas</Text>
                                                                <Text style={[styles.splitBoxAmount, { color: Theme.colors.borderFocus }]}>
                                                                    ${myQuota.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                                </Text>
                                                            </View>

                                                            <View style={[styles.splitBox, { borderColor: 'rgba(52, 211, 153, 0.25)' }]}>
                                                                <Text style={styles.splitBoxLabel}>{partnerName} aporta</Text>
                                                                <Text style={[styles.splitBoxAmount, { color: Theme.colors.income }]}>
                                                                    ${partnerQuota.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                                                                </Text>
                                                            </View>
                                                        </View>

                                                        <View style={styles.serviceCardDivider} />

                                                        {/* Estatus y Acciones Semánticas */}
                                                        <View style={styles.serviceActionsContainer}>
                                                            {!isCurrentUserHolder ? (
                                                                /* CASO 1: NO ERES EL TITULAR (Pagas tu parte a la pareja) */
                                                                <View style={styles.actionColumn}>
                                                                    {hasMyTransferred ? (
                                                                        <View style={styles.transferredBadge}>
                                                                            <Ionicons name="checkmark-circle" size={16} color={Theme.colors.income} />
                                                                            <Text style={styles.transferredBadgeText}>Tu parte transferida</Text>
                                                                        </View>
                                                                    ) : (
                                                                        <TouchableOpacity
                                                                            style={styles.transferActionBtn}
                                                                            onPress={() => handleMarkTransferred(service)}
                                                                            activeOpacity={0.8}
                                                                        >
                                                                            <Ionicons name="paper-plane-outline" size={16} color={Theme.colors.background} />
                                                                            <Text style={styles.transferActionBtnText}>
                                                                                Ya transferí mi parte (${myQuota.toFixed(2)})
                                                                            </Text>
                                                                        </TouchableOpacity>
                                                                    )}

                                                                    {/* Indicador de pago oficial al proveedor */}
                                                                    <View style={styles.providerStatusRow}>
                                                                        <Ionicons
                                                                            name={isPaidToProvider ? 'shield-checkmark' : 'time-outline'}
                                                                            size={14}
                                                                            color={isPaidToProvider ? Theme.colors.income : Theme.colors.textMuted}
                                                                        />
                                                                        <Text style={[styles.providerStatusText, isPaidToProvider && { color: Theme.colors.income }]}>
                                                                            {isPaidToProvider
                                                                                ? `${partnerName} ya liquidó la factura oficial al proveedor`
                                                                                : `Pendiente que ${partnerName} liquide la factura al proveedor`}
                                                                        </Text>
                                                                    </View>
                                                                </View>
                                                            ) : (
                                                                /* CASO 2: ERES EL TITULAR (Pagas la factura oficial) */
                                                                <View style={styles.actionColumn}>
                                                                    {/* Estatus de transferencia de la contraparte */}
                                                                    <View style={styles.partnerStatusRow}>
                                                                        <Ionicons
                                                                            name={hasPartnerTransferred ? 'checkmark-circle-outline' : 'hourglass-outline'}
                                                                            size={14}
                                                                            color={hasPartnerTransferred ? Theme.colors.income : '#F59E0B'}
                                                                        />
                                                                        <Text
                                                                            style={[
                                                                                styles.partnerStatusText,
                                                                                hasPartnerTransferred && { color: Theme.colors.income },
                                                                            ]}
                                                                        >
                                                                            {hasPartnerTransferred
                                                                                ? `${partnerName} ya transfirió su parte (${partnerQuota.toFixed(2)} MXN)`
                                                                                : `Pendiente que ${partnerName} transfiera (${partnerQuota.toFixed(2)} MXN)`}
                                                                        </Text>
                                                                    </View>

                                                                    {/* Acción sobre el pago al proveedor */}
                                                                    {isPaidToProvider ? (
                                                                        <View style={styles.paidProviderBadge}>
                                                                            <Ionicons name="shield-checkmark" size={16} color={Theme.colors.income} />
                                                                            <Text style={styles.paidProviderBadgeText}>
                                                                                Servicio liquidado este mes
                                                                            </Text>
                                                                        </View>
                                                                    ) : (
                                                                        <TouchableOpacity
                                                                            style={styles.payProviderActionBtn}
                                                                            onPress={() => handleMarkPaidToProvider(service)}
                                                                            activeOpacity={0.8}
                                                                        >
                                                                            <Ionicons name="receipt" size={16} color={Theme.colors.background} />
                                                                            <Text style={styles.payProviderActionBtnText}>
                                                                                Marcar como pagado al proveedor
                                                                            </Text>
                                                                        </TouchableOpacity>
                                                                    )}
                                                                </View>
                                                            )}
                                                        </View>
                                                    </View>
                                                );
                                            })}
                                        </View>
                                    )}
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

            {/* MODAL PARA AGREGAR SERVICIO DEL HOGAR (FASE 2) */}
            <Modal
                visible={serviceModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setServiceModalVisible(false)}
            >
                <KeyboardAvoidingView
                    style={styles.modalOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <View style={styles.modalHeaderTitleGroup}>
                                <Text style={styles.modalTitle}>Nuevo Servicio del Hogar</Text>
                                <Text style={styles.modalSubtitle}>Gasto recurrente dividido en equipo</Text>
                            </View>
                            <TouchableOpacity
                                style={styles.modalCloseButton}
                                onPress={() => setServiceModalVisible(false)}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="close" size={20} color={Theme.colors.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            contentContainerStyle={styles.modalScrollContent}
                        >
                            {/* 1. Concepto */}
                            <View style={styles.modalInputBlock}>
                                <Text style={styles.modalInputLabel}>Concepto o Servicio</Text>
                                <TextInput
                                    style={styles.modalTextInput}
                                    placeholder="Ej. Internet Totalplay, Renta, Gas, Luz..."
                                    placeholderTextColor={Theme.colors.textMuted}
                                    value={serviceConcept}
                                    onChangeText={setServiceConcept}
                                    maxLength={50}
                                />
                            </View>

                            {/* 2. Monto Mensual */}
                            <View style={styles.modalInputBlock}>
                                <Text style={styles.modalInputLabel}>Monto Total del Recibo Mensual</Text>
                                <View style={styles.amountInputContainer}>
                                    <Text style={styles.currencySymbol}>$</Text>
                                    <TextInput
                                        style={styles.amountInput}
                                        placeholder="0.00"
                                        placeholderTextColor={Theme.colors.textMuted}
                                        keyboardType="numeric"
                                        value={serviceAmount}
                                        onChangeText={handleAmountChange}
                                        maxLength={10}
                                    />
                                    <Text style={styles.currencyCode}>MXN</Text>
                                </View>
                            </View>

                            {/* 3. Bloque de Vencimiento */}
                            <View style={styles.modalInputBlock}>
                                <Text style={styles.modalInputLabel}>Bloque de Vencimiento</Text>
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
                                                serviceDueBlock === b.value && styles.dueBlockChipActive,
                                            ]}
                                            onPress={() => setServiceDueBlock(b.value)}
                                            activeOpacity={0.7}
                                        >
                                            <Text
                                                style={[
                                                    styles.dueBlockChipText,
                                                    serviceDueBlock === b.value && styles.dueBlockChipTextActive,
                                                ]}
                                            >
                                                {b.label}
                                            </Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>

                            {/* 4. Selector de Titular */}
                            <View style={styles.modalInputBlock}>
                                <Text style={styles.modalInputLabel}>¿Quién paga la factura oficial al proveedor?</Text>
                                <View style={styles.holderSelectorRow}>
                                    <TouchableOpacity
                                        style={[
                                            styles.holderChip,
                                            serviceHolderUid === currentUserUid && styles.holderChipActive,
                                        ]}
                                        onPress={() => setServiceHolderUid(currentUserUid)}
                                        activeOpacity={0.7}
                                    >
                                        <Ionicons
                                            name="person"
                                            size={16}
                                            color={serviceHolderUid === currentUserUid ? Theme.colors.borderFocus : Theme.colors.textMuted}
                                        />
                                        <Text
                                            style={[
                                                styles.holderChipText,
                                                serviceHolderUid === currentUserUid && styles.holderChipTextActive,
                                            ]}
                                        >
                                            Tú ({myName})
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.holderChip,
                                            serviceHolderUid === partnerUid && styles.holderChipActive,
                                        ]}
                                        onPress={() => setServiceHolderUid(partnerUid)}
                                        activeOpacity={0.7}
                                    >
                                        <Ionicons
                                            name="person"
                                            size={16}
                                            color={serviceHolderUid === partnerUid ? Theme.colors.income : Theme.colors.textMuted}
                                        />
                                        <Text
                                            style={[
                                                styles.holderChipText,
                                                serviceHolderUid === partnerUid && styles.holderChipTextActive,
                                            ]}
                                        >
                                            {partnerName}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            </View>

                            {/* 5. División de Cuota */}
                            <View style={styles.modalInputBlock}>
                                <Text style={styles.modalInputLabel}>División de la Cuota Mensual</Text>
                                <View style={styles.splitModeRow}>
                                    <TouchableOpacity
                                        style={[
                                            styles.splitModeChip,
                                            splitMode === '50-50' && styles.splitModeChipActive,
                                        ]}
                                        onPress={() => {
                                            setSplitMode('50-50');
                                            const num = parseFloat(serviceAmount) || 0;
                                            if (num > 0) {
                                                const half = Math.round((num / 2) * 100) / 100;
                                                setCustomSplitA(half.toFixed(2));
                                                setCustomSplitB((num - half).toFixed(2));
                                            }
                                        }}
                                        activeOpacity={0.7}
                                    >
                                        <Text
                                            style={[
                                                styles.splitModeChipText,
                                                splitMode === '50-50' && styles.splitModeChipTextActive,
                                            ]}
                                        >
                                            50% / 50% (Equitativo)
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.splitModeChip,
                                            splitMode === 'custom' && styles.splitModeChipActive,
                                        ]}
                                        onPress={() => setSplitMode('custom')}
                                        activeOpacity={0.7}
                                    >
                                        <Text
                                            style={[
                                                styles.splitModeChipText,
                                                splitMode === 'custom' && styles.splitModeChipTextActive,
                                            ]}
                                        >
                                            Personalizado
                                        </Text>
                                    </TouchableOpacity>
                                </View>

                                {splitMode === '50-50' ? (
                                    <View style={styles.splitPreviewRow}>
                                        <View style={styles.splitPreviewPill}>
                                            <Text style={styles.splitPreviewName}>Tú:</Text>
                                            <Text style={styles.splitPreviewValue}>
                                                ${(parseFloat(customSplitA) || (parseFloat(serviceAmount) || 0) / 2).toFixed(2)} MXN
                                            </Text>
                                        </View>
                                        <View style={styles.splitPreviewPill}>
                                            <Text style={styles.splitPreviewName}>{partnerName}:</Text>
                                            <Text style={styles.splitPreviewValue}>
                                                ${(parseFloat(customSplitB) || (parseFloat(serviceAmount) || 0) / 2).toFixed(2)} MXN
                                            </Text>
                                        </View>
                                    </View>
                                ) : (
                                    <View style={styles.customSplitInputsRow}>
                                        <View style={styles.customSplitInputCol}>
                                            <Text style={styles.customSplitLabel}>Tu cuota</Text>
                                            <View style={styles.amountInputContainerSmall}>
                                                <Text style={styles.currencySymbolSmall}>$</Text>
                                                <TextInput
                                                    style={styles.amountInputSmall}
                                                    placeholder="0.00"
                                                    placeholderTextColor={Theme.colors.textMuted}
                                                    keyboardType="numeric"
                                                    value={customSplitA}
                                                    onChangeText={handleCustomSplitAChange}
                                                    maxLength={10}
                                                />
                                            </View>
                                        </View>

                                        <View style={styles.customSplitInputCol}>
                                            <Text style={styles.customSplitLabel}>Cuota {partnerName}</Text>
                                            <View style={styles.amountInputContainerSmall}>
                                                <Text style={styles.currencySymbolSmall}>$</Text>
                                                <TextInput
                                                    style={styles.amountInputSmall}
                                                    placeholder="0.00"
                                                    placeholderTextColor={Theme.colors.textMuted}
                                                    keyboardType="numeric"
                                                    value={customSplitB}
                                                    onChangeText={handleCustomSplitBChange}
                                                    maxLength={10}
                                                />
                                            </View>
                                        </View>
                                    </View>
                                )}
                            </View>

                            {/* Botón Guardar */}
                            <TouchableOpacity
                                style={[
                                    styles.modalSubmitButton,
                                    (!serviceConcept.trim() || !(parseFloat(serviceAmount) > 0) || isSubmittingService) &&
                                        styles.modalSubmitButtonDisabled,
                                ]}
                                onPress={handleAddService}
                                activeOpacity={0.8}
                                disabled={!serviceConcept.trim() || !(parseFloat(serviceAmount) > 0) || isSubmittingService}
                            >
                                {isSubmittingService ? (
                                    <ActivityIndicator size="small" color={Theme.colors.background} />
                                ) : (
                                    <>
                                        <Ionicons name="checkmark" size={18} color={Theme.colors.background} />
                                        <Text style={styles.modalSubmitButtonText}>Guardar Servicio del Hogar</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </ScrollView>
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
    // Estilos de la Fase 2: Servicios Recurrentes del Hogar
    servicesSectionContainer: {
        gap: 12,
        marginTop: 6,
    },
    servicesSectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    servicesSectionHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    servicesSectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    servicesSectionSubtitle: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
    },
    addServiceButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: Theme.colors.borderFocus,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: Theme.radius.full,
    },
    addServiceButtonText: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.background,
    },
    servicesSummaryCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        borderRadius: Theme.radius.md,
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    summaryItem: {
        flex: 1,
        alignItems: 'center',
    },
    summaryItemLabel: {
        fontSize: 10,
        fontWeight: '600',
        color: Theme.colors.textMuted,
        textTransform: 'uppercase',
    },
    summaryItemValue: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
        marginTop: 2,
    },
    summaryItemSub: {
        fontSize: 9,
        color: Theme.colors.textMuted,
    },
    summaryDivider: {
        width: 1,
        height: 24,
        backgroundColor: Theme.colors.borderSubtle,
    },
    servicesLoadingBox: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 20,
    },
    servicesLoadingText: {
        fontSize: 12,
        color: Theme.colors.textMuted,
    },
    servicesEmptyCard: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        borderRadius: Theme.radius.lg,
        gap: 10,
    },
    servicesEmptyIconCircle: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    servicesEmptyTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    servicesEmptySub: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
        textAlign: 'center',
        lineHeight: 18,
        maxWidth: 290,
    },
    emptyAddBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: Theme.radius.full,
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        borderWidth: 1,
        borderColor: 'rgba(56, 189, 248, 0.3)',
        marginTop: 4,
    },
    emptyAddBtnText: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.borderFocus,
    },
    servicesListContainer: {
        gap: 12,
    },
    serviceCard: {
        backgroundColor: Theme.colors.cardSurfaceSubtle,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        borderRadius: Theme.radius.lg,
        padding: 16,
        gap: 12,
    },
    serviceCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    serviceIconCircle: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    serviceTitleGroup: {
        flex: 1,
        gap: 4,
    },
    serviceConcept: {
        fontSize: 15,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    serviceMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
    },
    dueBlockBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: Theme.radius.xs,
    },
    dueBlockBadgeText: {
        fontSize: 11,
        color: Theme.colors.textSecondary,
        fontWeight: '500',
    },
    holderPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: Theme.radius.xs,
    },
    holderPillText: {
        fontSize: 11,
        color: Theme.colors.textMuted,
    },
    deleteServiceBtn: {
        padding: 6,
    },
    serviceTotalRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    serviceTotalLabel: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
    },
    serviceTotalAmount: {
        fontSize: 15,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    splitGrid: {
        flexDirection: 'row',
        gap: 10,
    },
    splitBox: {
        flex: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        borderWidth: 1,
        borderRadius: Theme.radius.md,
        padding: 10,
        alignItems: 'center',
    },
    splitBoxLabel: {
        fontSize: 11,
        color: Theme.colors.textMuted,
        fontWeight: '500',
    },
    splitBoxAmount: {
        fontSize: 14,
        fontWeight: '700',
        marginTop: 2,
    },
    serviceCardDivider: {
        height: 1,
        backgroundColor: Theme.colors.borderSubtle,
    },
    serviceActionsContainer: {
        gap: 8,
    },
    actionColumn: {
        gap: 8,
    },
    transferredBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(52, 211, 153, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(52, 211, 153, 0.3)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: Theme.radius.md,
        justifyContent: 'center',
    },
    transferredBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.income,
    },
    transferActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: Theme.colors.borderFocus,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: Theme.radius.md,
    },
    transferActionBtnText: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.background,
    },
    providerStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        justifyContent: 'center',
    },
    providerStatusText: {
        fontSize: 11,
        color: Theme.colors.textMuted,
    },
    partnerStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: Theme.radius.sm,
    },
    partnerStatusText: {
        fontSize: 11,
        color: Theme.colors.textMuted,
    },
    paidProviderBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(52, 211, 153, 0.12)',
        borderWidth: 1,
        borderColor: 'rgba(52, 211, 153, 0.3)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: Theme.radius.md,
        justifyContent: 'center',
    },
    paidProviderBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.income,
    },
    payProviderActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: Theme.colors.income,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: Theme.radius.md,
    },
    payProviderActionBtnText: {
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.background,
    },
    // Estilos del Modal
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        justifyContent: 'flex-end',
    },
    modalCard: {
        backgroundColor: '#121824',
        borderTopLeftRadius: Theme.radius.xl,
        borderTopRightRadius: Theme.radius.xl,
        borderWidth: 1,
        borderColor: Theme.colors.border,
        maxHeight: '85%',
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
        gap: 2,
    },
    modalTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    modalSubtitle: {
        fontSize: 12,
        color: Theme.colors.textSecondary,
    },
    modalCloseButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(255, 255, 255, 0.06)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalScrollContent: {
        gap: 16,
        paddingBottom: 24,
    },
    modalInputBlock: {
        gap: 6,
    },
    modalInputLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    modalTextInput: {
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderWidth: 1,
        borderColor: Theme.colors.border,
        borderRadius: Theme.radius.md,
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 14,
        color: Theme.colors.textPrimary,
    },
    dueBlockSelectorRow: {
        flexDirection: 'row',
        gap: 8,
    },
    dueBlockChip: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 6,
        borderRadius: Theme.radius.md,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        alignItems: 'center',
    },
    dueBlockChipActive: {
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
        borderColor: Theme.colors.borderFocus,
    },
    dueBlockChipText: {
        fontSize: 11,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    dueBlockChipTextActive: {
        color: Theme.colors.borderFocus,
    },
    holderSelectorRow: {
        flexDirection: 'row',
        gap: 8,
    },
    holderChip: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: Theme.radius.md,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
    holderChipActive: {
        backgroundColor: 'rgba(56, 189, 248, 0.12)',
        borderColor: Theme.colors.borderFocus,
    },
    holderChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    holderChipTextActive: {
        color: Theme.colors.textPrimary,
        fontWeight: '700',
    },
    splitModeRow: {
        flexDirection: 'row',
        gap: 8,
    },
    splitModeChip: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: Theme.radius.md,
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        alignItems: 'center',
    },
    splitModeChipActive: {
        backgroundColor: 'rgba(168, 85, 247, 0.15)',
        borderColor: Theme.colors.savings,
    },
    splitModeChipText: {
        fontSize: 11,
        fontWeight: '600',
        color: Theme.colors.textSecondary,
    },
    splitModeChipTextActive: {
        color: Theme.colors.savings,
        fontWeight: '700',
    },
    splitPreviewRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 4,
    },
    splitPreviewPill: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: Theme.radius.sm,
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderWidth: 1,
        borderColor: Theme.colors.borderSubtle,
    },
    splitPreviewName: {
        fontSize: 12,
        color: Theme.colors.textMuted,
    },
    splitPreviewValue: {
        fontSize: 12,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    customSplitInputsRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 4,
    },
    customSplitInputCol: {
        flex: 1,
        gap: 4,
    },
    customSplitLabel: {
        fontSize: 11,
        color: Theme.colors.textMuted,
    },
    amountInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderWidth: 1,
        borderColor: Theme.colors.border,
        borderRadius: Theme.radius.md,
        paddingHorizontal: 14,
    },
    currencySymbol: {
        fontSize: 16,
        fontWeight: '600',
        color: Theme.colors.borderFocus,
        marginRight: 6,
    },
    amountInput: {
        flex: 1,
        paddingVertical: 12,
        fontSize: 16,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    currencyCode: {
        fontSize: 12,
        fontWeight: '600',
        color: Theme.colors.textMuted,
    },
    amountInputContainerSmall: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        borderWidth: 1,
        borderColor: Theme.colors.border,
        borderRadius: Theme.radius.md,
        paddingHorizontal: 10,
    },
    currencySymbolSmall: {
        fontSize: 14,
        color: Theme.colors.textSecondary,
        marginRight: 4,
    },
    amountInputSmall: {
        flex: 1,
        paddingVertical: 8,
        fontSize: 13,
        fontWeight: '700',
        color: Theme.colors.textPrimary,
    },
    modalSubmitButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: Theme.colors.borderFocus,
        paddingVertical: 14,
        borderRadius: Theme.radius.md,
        marginTop: 8,
    },
    modalSubmitButtonDisabled: {
        opacity: 0.5,
    },
    modalSubmitButtonText: {
        fontSize: 14,
        fontWeight: '700',
        color: Theme.colors.background,
    },
});