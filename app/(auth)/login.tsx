import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function WelcomeAuthScreen() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    const [isPasswordVisible, setIsPasswordVisible] = useState(false);


    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView
                style={styles.keyboardView}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
            >
                <ScrollView
                    contentContainerStyle={styles.scrollContainer}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}>


                    {/* Encabezado / Logo */}
                    <View style={styles.header}>
                        <Text style={styles.appTitle}>Iniciar sesion</Text>
                    </View>
                    <View style={styles.container}>

                        <View style={styles.inputGroup}>
                            <TextInput
                                style={styles.input}
                                placeholder="Correo electronico"
                                placeholderTextColor="#64748B"
                                value={email}
                                onChangeText={setEmail}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </View>
                        <View style={styles.inputGroup}>
                            <View style={styles.passwordInputWrapper}>
                                <TextInput
                                    style={styles.passwordInput}
                                    placeholder='Contraseña'
                                    placeholderTextColor="#64748B"
                                    value={password}
                                    onChangeText={setPassword}
                                    autoCapitalize="none"
                                    secureTextEntry={!isPasswordVisible}
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

                        <View style={styles.buttonContainer}>
                            <TouchableOpacity
                                style={styles.primaryButton}
                                activeOpacity={0.8}
                                onPress={() => console.log("Este va mandar a el dashboard")}
                            >
                                <Text style={styles.primaryButtonText}>Continuar</Text>

                            </TouchableOpacity>
                            <TouchableOpacity
                                activeOpacity={0.8}
                                onPress={() => console.log("Este va mandar a el recover-password")}
                            >
                                <Text style={styles.taglineolvido}>¿Olvido su contraseña?</Text>
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
        paddingHorizontal: 24,
        paddingVertical: 40,
        backgroundColor: '#0B0F17',
        gap: 36,
    },
    container: {
        width: '100%',
        gap: 20,
    },
    header: {
        alignItems: 'center',
        gap: 8,

    },
    appTitle: {
        fontSize: 34,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 0.5,

    },
    taglineolvido: {
        fontSize: 14,
        color: '#a525c5ff',
        textDecorationLine: "underline",
        alignSelf: 'flex-end',
        marginTop: 4,
    },
    buttonContainer: {
        width: '100%',
        gap: 16,
        marginTop: 8,
    },
    primaryButton: {
        backgroundColor: '#38BDF8',
        paddingVertical: 16,
        borderRadius: 14,
        alignItems: 'center',
    },
    primaryButtonText: {
        color: '#0B0F17',
        fontSize: 16,
        fontWeight: '700',
    },


    inputGroup: {
        width: "100%",
        gap: 12,
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
    eyeButton: {
        padding: 6,
    },
    passwordInputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0B0F17',
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#24324D',
    },
    passwordInput: {
        flex: 1,
        paddingVertical: 14,
        color: '#FFFFFF',
        fontSize: 15,
    }

});