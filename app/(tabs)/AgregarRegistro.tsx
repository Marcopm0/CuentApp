import React, { useState } from 'react';
import {
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

// 1. Tipado de Props (si el componente recibe propiedades)
interface MiPantallaProps {
    titulo?: string;
    onPressAction?: () => void;
}

// 2. Componente funcional con TypeScript
export const MiPantalla: React.FC<MiPantallaProps> = ({
    titulo = 'Agregar Registro',
    onPressAction
}) => {
    // Estado tipado de ejemplo
    const [contador, setContador] = useState<number>(0);

    const handleIncrement = () => {
        setContador(prev => prev + 1);
        if (onPressAction) onPressAction();
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" backgroundColor="#F4F5F7" />
            <View style={styles.container}>
                <Text style={styles.title}>{titulo}</Text>
                <Text style={styles.subtitle}>Contador actual: {contador}</Text>

                <TouchableOpacity
                    style={styles.button}
                    onPress={handleIncrement}
                    activeOpacity={0.8}
                >
                    <Text style={styles.buttonText}>Presionar botón</Text>
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
};

// 3. Estilos estructurados
const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#2c66daff',
    },
    container: {
        flex: 1,
        padding: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        color: '#1E293B',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#64748B',
        marginBottom: 24,
    },
    button: {
        backgroundColor: '#25eb67ff',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
        elevation: 2, // Sombra Android
        shadowColor: '#000', // Sombra iOS
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default MiPantalla;