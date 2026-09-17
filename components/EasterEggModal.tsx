// components/EasterEggModal.tsx
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    Image,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    View,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Sprites
const PIGGY_SPRITE = require('@/assets/images/piggy_sprite.png');
const COIN_SPRITE = require('@/assets/images/coin_sprite.png');

// Secuencia de aleteo natural (ida y vuelta continuo)
const PIGGY_CYCLE = [0, 1, 2, 3, 4, 3, 2, 1];
const PIGGY_WIDTH = 46;
const PIGGY_HEIGHT = 40;

// Especificaciones Moneda Agrandada (8 frames)
const COIN_FRAMES = 8;
const COIN_WIDTH = 34;
const COIN_HEIGHT = 34;

// FÍSICAS LIGERAS
const GRAVITY = 0.18;
const JUMP_IMPULSE = -4.8;
const MAX_FALL_SPEED = 4.8;
const PIPE_SPEED = 2.2;
const PIPE_WIDTH = 55;
const PIPE_GAP = 200;

interface EasterEggModalProps {
    visible: boolean;
    onClose: () => void;
}

export default function EasterEggModal({ visible, onClose }: EasterEggModalProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [gameOver, setGameOver] = useState(false);
    const [score, setScore] = useState(0);

    // Estados de animación
    const [piggyCycleIndex, setPiggyCycleIndex] = useState(0);
    const [coinFrame, setCoinFrame] = useState(0);

    // Posiciones de juego
    const [birdY, setBirdY] = useState(SCREEN_HEIGHT / 2.5);
    const [birdRotation, setBirdRotation] = useState(0);
    const [pipeX, setPipeX] = useState(SCREEN_WIDTH);
    const [pipeTopHeight, setPipeTopHeight] = useState(150);

    // Estado de la moneda
    const [coinCollected, setCoinCollected] = useState(false);

    const birdVelocity = useRef(0);
    const smoothRotation = useRef(0);
    const gameLoopRef = useRef<number | null>(null);

    // 1. Aleteo fluido del cochinito a 60ms por cuadro
    useEffect(() => {
        if (!visible) return;
        const animTimer = setInterval(() => {
            setPiggyCycleIndex((prev) => (prev + 1) % PIGGY_CYCLE.length);
        }, 60);
        return () => clearInterval(animTimer);
    }, [visible]);

    // 2. Giro continuo de la moneda
    useEffect(() => {
        if (!visible) return;
        const coinTimer = setInterval(() => {
            setCoinFrame((prev) => (prev + 1) % COIN_FRAMES);
        }, 80);
        return () => clearInterval(coinTimer);
    }, [visible]);

    const resetGame = () => {
        setBirdY(SCREEN_HEIGHT / 2.5);
        birdVelocity.current = 0;
        smoothRotation.current = 0;
        setBirdRotation(0);
        setPipeX(SCREEN_WIDTH + 40);
        const randomHeight = Math.floor(Math.random() * (SCREEN_HEIGHT - PIPE_GAP - 250)) + 60;
        setPipeTopHeight(randomHeight);
        setCoinCollected(false);
        setScore(0);
        setGameOver(false);
        setIsPlaying(true);
    };

    const handleJump = () => {
        if (!isPlaying || gameOver) {
            resetGame();
            return;
        }
        birdVelocity.current = JUMP_IMPULSE;
    };

    // Loop de físicas a 60 FPS
    useEffect(() => {
        if (!isPlaying || gameOver) {
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
            return;
        }

        const loop = () => {
            // Gravedad suave con límite terminal
            birdVelocity.current = Math.min(birdVelocity.current + GRAVITY, MAX_FALL_SPEED);

            setBirdY((prevY) => {
                const nextY = prevY + birdVelocity.current;
                if (nextY <= 0 || nextY >= SCREEN_HEIGHT - PIGGY_HEIGHT - 30) {
                    setGameOver(true);
                }
                return nextY;
            });

            // Suavizado cinemático de inclinación (Lerp)
            const targetAngle = Math.min(
                Math.max((birdVelocity.current / MAX_FALL_SPEED) * 35, -20),
                38
            );
            smoothRotation.current += (targetAngle - smoothRotation.current) * 0.14;
            setBirdRotation(smoothRotation.current);

            // Desplazamiento de tuberías
            setPipeX((prevX) => {
                if (prevX <= -PIPE_WIDTH) {
                    const newHeight = Math.floor(Math.random() * (SCREEN_HEIGHT - PIPE_GAP - 250)) + 60;
                    setPipeTopHeight(newHeight);
                    setCoinCollected(false);
                    return SCREEN_WIDTH;
                }
                return prevX - PIPE_SPEED;
            });

            // Colisión con tuberías
            const birdLeft = 70;
            const birdTop = birdY;
            const birdRight = birdLeft + PIGGY_WIDTH;
            const birdBottom = birdTop + PIGGY_HEIGHT;

            const collidesHorizontally = birdRight > pipeX && birdLeft < pipeX + PIPE_WIDTH;
            const collidesTop = birdTop < pipeTopHeight;
            const collidesBottom = birdBottom > pipeTopHeight + PIPE_GAP;

            if (collidesHorizontally && (collidesTop || collidesBottom)) {
                setGameOver(true);
            }

            // Recolección de la moneda
            if (!coinCollected) {
                const coinX = pipeX + PIPE_WIDTH / 2 - COIN_WIDTH / 2;
                const coinY = pipeTopHeight + PIPE_GAP / 2 - COIN_HEIGHT / 2;

                const touchesCoinX = birdRight > coinX && birdLeft < coinX + COIN_WIDTH;
                const touchesCoinY = birdBottom > coinY && birdTop < coinY + COIN_HEIGHT;

                if (touchesCoinX && touchesCoinY) {
                    setCoinCollected(true);
                    setScore((s) => s + 1);
                }
            }

            gameLoopRef.current = requestAnimationFrame(loop);
        };

        gameLoopRef.current = requestAnimationFrame(loop);

        return () => {
            if (gameLoopRef.current) cancelAnimationFrame(gameLoopRef.current);
        };
    }, [isPlaying, gameOver, birdY, pipeX, pipeTopHeight, coinCollected]);

    const currentFrame = PIGGY_CYCLE[piggyCycleIndex];
    const coinYPosition = pipeTopHeight + PIPE_GAP / 2 - COIN_HEIGHT / 2;
    const coinXPosition = pipeX + PIPE_WIDTH / 2 - COIN_WIDTH / 2;

    return (
        <Modal visible={visible} animationType="slide" transparent>
            <View style={styles.backdrop}>
                {/* Botón Salir */}
                <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.7}>
                    <Ionicons name="close" size={26} color="#38BDF8" />
                </TouchableOpacity>

                <TouchableWithoutFeedback onPress={handleJump}>
                    <View style={styles.gameArea}>
                        {/* FONDO: Créditos del autor */}
                        <View style={styles.creditsContainer} pointerEvents="none">
                            <Text style={styles.creditsHeader}>CUENTAPP</Text>
                            <Text style={styles.creditsRole}>DISEÑO & DESARROLLO</Text>
                            <Text style={styles.creditsName}>Marcopm0</Text>
                            <Text style={styles.creditsYear}>© 2026 • Ingeniero de Software</Text>
                            <Text style={styles.creditsQuote}>
                                "Cada peso ahorrado es un obstáculo superado"
                            </Text>
                        </View>

                        {/* ELEMENTOS DEL JUEGO */}
                        {isPlaying && (
                            <>
                                {/* Tubo Superior */}
                                <View
                                    style={[
                                        styles.pipe,
                                        styles.pipeTop,
                                        { left: pipeX, height: pipeTopHeight },
                                    ]}
                                >
                                    <Text style={styles.pipeLabel}>DEUDA</Text>
                                </View>

                                {/* Tubo Inferior */}
                                <View
                                    style={[
                                        styles.pipe,
                                        styles.pipeBottom,
                                        {
                                            left: pipeX,
                                            top: pipeTopHeight + PIPE_GAP,
                                            height: SCREEN_HEIGHT - (pipeTopHeight + PIPE_GAP),
                                        },
                                    ]}
                                >
                                    <Text style={styles.pipeLabel}>GASTOS</Text>
                                </View>

                                {/* Moneda Coleccionable Grande */}
                                {!coinCollected && (
                                    <View
                                        style={[
                                            styles.coinContainer,
                                            {
                                                left: coinXPosition,
                                                top: coinYPosition,
                                            },
                                        ]}
                                    >
                                        <Image
                                            source={COIN_SPRITE}
                                            style={[
                                                styles.coinSpriteSheet,
                                                {
                                                    top: -(coinFrame * COIN_HEIGHT),
                                                },
                                            ]}
                                            resizeMode="stretch"
                                        />
                                    </View>
                                )}

                                {/* Cochinito con aleteo fluido y rotación suave */}
                                <View
                                    style={[
                                        styles.piggyContainer,
                                        {
                                            top: birdY,
                                            transform: [{ rotate: `${birdRotation}deg` }],
                                        },
                                    ]}
                                >
                                    <Image
                                        source={PIGGY_SPRITE}
                                        style={[
                                            styles.piggySpriteSheet,
                                            {
                                                top: -(currentFrame * PIGGY_HEIGHT),
                                            },
                                        ]}
                                        resizeMode="stretch"
                                    />
                                </View>
                            </>
                        )}

                        {/* Marcador */}
                        <View style={styles.scoreContainer}>
                            <Text style={styles.scoreText}>${score}.00 MXN</Text>
                            <Text style={styles.scoreSub}>Monedas recolectadas</Text>
                        </View>

                        {/* Mensajes de Inicio */}
                        {!isPlaying && (
                            <View style={styles.overlayMessage}>
                                <Text style={styles.overlayTitle}>🐷 FLAPPY COCHINITO 🐷</Text>
                                <Text style={styles.overlaySubtitle}>
                                    Esquiva las deudas y atrapa las monedas para inflar tu alcancía.
                                </Text>
                                <Text style={styles.tapToStart}>[ Toca la pantalla para jugar ]</Text>
                            </View>
                        )}

                        {/* Game Over */}
                        {gameOver && (
                            <View style={styles.overlayMessage}>
                                <Text style={[styles.overlayTitle, { color: '#F87171' }]}>¡SE ROMPIÓ EL COCHINITO!</Text>
                                <Text style={styles.overlaySubtitle}>
                                    Recaudaste ${score}.00 MXN en monedas antes del impacto.
                                </Text>
                                <Text style={styles.tapToStart}>[ Toca para intentar de nuevo ]</Text>
                            </View>
                        )}
                    </View>
                </TouchableWithoutFeedback>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: '#070A10',
    },
    closeButton: {
        position: 'absolute',
        top: 50,
        right: 20,
        zIndex: 99,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(56, 189, 248, 0.15)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#38BDF8',
    },
    gameArea: {
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
    },
    creditsContainer: {
        position: 'absolute',
        width: '100%',
        top: '26%',
        alignItems: 'center',
        gap: 8,
        opacity: 0.32,
    },
    creditsHeader: {
        color: '#38BDF8',
        fontSize: 28,
        fontWeight: '900',
        letterSpacing: 4,
    },
    creditsRole: {
        color: '#94A3B8',
        fontSize: 12,
        letterSpacing: 2,
        fontWeight: '700',
    },
    creditsName: {
        color: '#FFFFFF',
        fontSize: 24,
        fontWeight: '800',
    },
    creditsYear: {
        color: '#64748B',
        fontSize: 13,
        marginTop: 4,
    },
    creditsQuote: {
        color: '#F472B6',
        fontStyle: 'italic',
        fontSize: 13,
        marginTop: 8,
    },
    /* Cochinito */
    piggyContainer: {
        position: 'absolute',
        left: 70,
        width: PIGGY_WIDTH,
        height: PIGGY_HEIGHT,
        overflow: 'hidden',
        zIndex: 15,
    },
    piggySpriteSheet: {
        position: 'absolute',
        left: 0,
        width: PIGGY_WIDTH,
        height: PIGGY_HEIGHT * 5, // 40 * 5 = 200px
    },
    /* Moneda Grande */
    coinContainer: {
        position: 'absolute',
        width: COIN_WIDTH,
        height: COIN_HEIGHT,
        overflow: 'hidden',
        zIndex: 12,
    },
    coinSpriteSheet: {
        position: 'absolute',
        left: 0,
        width: COIN_WIDTH,
        height: COIN_HEIGHT * COIN_FRAMES, // 34 * 8 = 272px
    },
    /* Tuberías */
    pipe: {
        position: 'absolute',
        width: PIPE_WIDTH,
        backgroundColor: '#161F30',
        borderColor: '#F43F5E',
        borderWidth: 2,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 5,
        shadowColor: '#F43F5E',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.65,
        shadowRadius: 10,
    },
    pipeTop: {
        top: 0,
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    pipeBottom: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    pipeLabel: {
        color: '#F43F5E',
        fontSize: 11,
        fontWeight: '900',
        letterSpacing: 1.5,
        transform: [{ rotate: '-90deg' }],
    },
    scoreContainer: {
        position: 'absolute',
        top: 60,
        left: 24,
        zIndex: 20,
    },
    scoreText: {
        fontSize: 26,
        fontWeight: '900',
        color: '#38BDF8',
    },
    scoreSub: {
        fontSize: 12,
        color: '#64748B',
        fontWeight: '600',
    },
    overlayMessage: {
        position: 'absolute',
        top: '42%',
        width: '100%',
        alignItems: 'center',
        paddingHorizontal: 24,
        gap: 10,
        zIndex: 30,
    },
    overlayTitle: {
        fontSize: 22,
        fontWeight: '900',
        color: '#F472B6',
        textAlign: 'center',
        letterSpacing: 1,
    },
    overlaySubtitle: {
        fontSize: 13,
        color: '#94A3B8',
        textAlign: 'center',
        lineHeight: 18,
    },
    tapToStart: {
        fontSize: 14,
        fontWeight: '700',
        color: '#FFFFFF',
        marginTop: 12,
        letterSpacing: 1,
    },
});