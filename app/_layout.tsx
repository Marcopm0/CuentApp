import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(auth)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <>
      <Stack
        screenOptions={{
          contentStyle: {
            backgroundColor: '#0B0F17',
          },
        }}
      >
        {/* 1. Flujo de autenticacion */}
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        {/* 2. Flujo de pestañas */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* 3. Modal */}
        <Stack.Screen
          name="modal"
          options={{ presentation: 'modal', title: 'Modal' }}
        />
      </Stack>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'auto'} />
    </>
  );
}