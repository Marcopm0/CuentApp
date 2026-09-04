import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function WelcomeAuthScreen() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}>
                <ScrollView contentContainerStyle={styles.scrollContainer}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false} >

                    <View style={styles.cardContainer}>


                        {/* Encabezado / Logo */}
                        <View style={styles.header}>
                            <Text style={styles.appTitle}>Bienvenido</Text>
                            <Text style={styles.tagline}>Vamos a Crear</Text>
                            <Text style={styles.tagline}>una cuenta!!</Text>
                        </View>

                        {/* Acciones centradas y separadas */}
                        <View style={styles.buttonContainer}>

                            <View style={styles.inputGroup}>
                                <Text style={styles.Label}>Correo electronico</Text>
                                <TextInput
                                    style={styles.input}
                                    placeholder="ejemplo@correo.com"
                                    placeholderTextColor="#64748B"
                                    value={email}
                                    onChangeText={setEmail}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.Label}>Contraseña</Text>
                                <View style={styles.passwordInputWrapper}>
                                    <TextInput
                                        style={styles.passwordInput}
                                        placeholder="**********"
                                        placeholderTextColor="#64748B"
                                        value={password}
                                        onChangeText={setPassword}
                                        secureTextEntry={!isPasswordVisible}
                                        autoCapitalize='none'
                                    />
                                    <TouchableOpacity
                                        style={styles.eyeButton}
                                        onPress={() => setIsPasswordVisible(!isPasswordVisible)}
                                        activeOpacity={0.8}
                                    >
                                        <Ionicons
                                            name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                                            size={20}
                                            color="#94A3B8"
                                        />
                                    </TouchableOpacity>
                                </View>
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.Label}>Confirmar contraseña</Text>
                                <View style={styles.passwordInputWrapper}>
                                    <TextInput
                                        style={styles.passwordInput}
                                        placeholder="**********"
                                        placeholderTextColor="#64748B"
                                        value={confirmPassword}
                                        onChangeText={setConfirmPassword}
                                        secureTextEntry={!isConfirmPasswordVisible}
                                        autoCapitalize='none'
                                        autoCorrect={false}
                                    />
                                    <TouchableOpacity
                                        style={styles.eyeButton}
                                        onPress={() => setIsConfirmPasswordVisible(!isConfirmPasswordVisible)}
                                        activeOpacity={0.8}
                                    >
                                        <Ionicons
                                            name={isConfirmPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
                                            size={20}
                                            color="#94A3B8"
                                        />
                                    </TouchableOpacity>
                                </View>
                            </View>
                            <TouchableOpacity
                                style={styles.primaryButton}
                                activeOpacity={0.8}
                                onPress={() => { console.log("Aun nada"); }}
                            >
                                <Text style={styles.primaryButtonText}>Registrarme</Text>
                            </TouchableOpacity>


                            <TouchableOpacity
                                activeOpacity={0.8}
                                onPress={() => router.push('/(auth)/login')}
                            >
                                <Text style={styles.footerButtonText}>¿YA TIENES UNA CUENTA? INICIAR SESION</Text>
                            </TouchableOpacity>
                        </View>


                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#0B0F17',
    },
    keyboardView: {
        flex: 1,
    },
    scrollContainer: {
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 30,
        backgroundColor: '#0B0F17',
    },

    cardContainer: {
        width: '100%',
        backgroundColor: '#161F30',
        borderRadius: 24,
        paddingHorizontal: 24,
        paddingVertical: 36,
        borderColor: '#24324D',
        borderWidth: 1,
        gap: 24,
    },
    header: {
        alignItems: 'center',
        gap: 8,

    },
    appTitle: {
        fontSize: 32,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 0.5,
    },
    tagline: {
        fontSize: 15,
        color: '#94A3B8',
        textAlign: 'center',
        lineHeight: 20,
    },
    eyeButton: {
        padding: 6,

    },
    passwordInput: {
        flex: 1,
        paddingVertical: 14,
        color: '#ffffff',
        fontSize: 15,
    },

    buttonContainer: {

        justifyContent: 'center',
        width: '100%',
        gap: 24,
    },
    primaryButton: {
        width: "100%",
        backgroundColor: '#38BDF8',
        paddingVertical: 15,
        borderRadius: 14,
        alignItems: 'center',
        marginTop: 6,
    },
    primaryButtonText: {
        color: '#0B0F17',
        fontSize: 16,
        fontWeight: '700',
    },
    footerButtonText: {
        marginTop: 8,
        color: '#38BDF8',
        textDecorationLine: 'underline',
        textAlign: 'center',
        fontSize: 16,
        fontWeight: '600',
    },
    inputGroup: {
        width: "100%",
        gap: 16,
    },
    Label: {
        fontSize: 14,
        color: '#94A3B8',
        fontWeight: '600',
    },
    input: {
        backgroundColor: '#0B0F17',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        color: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#24324D',
        fontSize: 15,
    },
    passwordInputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0B0F17',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#24324D',
        paddingHorizontal: 16,
    },

});