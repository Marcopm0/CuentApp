/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0a7ea4';
const tintColorDark = '#fff';

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: tintColorLight,
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});

export const Theme = {
  colors: {
    // Lienzo y Superficies
    background: '#0B0F17',
    cardSurface: '#161F30',
    cardSurfaceSubtle: '#0E1420',
    
    // Bordes y Divisores
    border: '#24324D',
    borderSubtle: '#1E293B',
    borderFocus: '#38BDF8',

    // Tipografía y Textos
    textPrimary: '#FFFFFF',
    textSecondary: '#94A3B8',
    textMuted: '#64748B', // Unificado para placeholders y notas

    // Identidad de las 4 Bolsas Financieras
    fixed: '#38BDF8',     // Cyan: Compromisos Fijos
    savings: '#A855F7',   // Púrpura: Metas de Ahorro
    leisure: '#F59E0B',   // Ámbar: Dinero Libre / Ocio
    buffer: '#10B981',    // Verde Esmeralda: Colchón de Imprevistos (Base saludable)

    // Flujo Contable (Transacciones)
    income: '#34D399',    // Menta suave: Dinero entrante
    expense: '#F87171',   // Coral suave: Dinero saliente

    // Semáforo de Alertas y Estados Dinámicos
    statusSuccess: '#10B981',
    statusWarning: '#F59E0B',
    statusDanger: '#EF4444',
  },
  radius: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    full: 9999,
  },
} as const;

export type AppTheme = typeof Theme;
