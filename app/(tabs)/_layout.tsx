import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import Feather from '@expo/vector-icons/Feather';
import Fontisto from '@expo/vector-icons/Fontisto';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 10);
  const barHeight = (Platform.OS === 'ios' ? 56 : 60) + bottomPadding;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,

        // Colores de iconos y títulos
        tabBarActiveTintColor: '#38BDF8',    // Celeste vibrante activo
        tabBarInactiveTintColor: '#64748B',  // Gris azulado inactivo

        // COLOR Y FORMA DE LA BARRA INFERIOR
        tabBarStyle: {
          backgroundColor: '#0B0F17',        // Mismo fondo oscuro de tu app
          borderTopColor: '#24324D',         // Borde superior sutil que combina con tus tarjetas
          borderTopWidth: 1,
          height: barHeight,
          paddingBottom: bottomPadding,
          paddingTop: 8,
          elevation: 0,                      // Elimina el brillo/sombra blanca nativa de Android
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="Registro"
        options={{
          title: 'Historial',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons size={26} name="file-document-multiple" color={color} />,
        }}
      />
      <Tabs.Screen
        name="AgregarRegistro"
        options={{
          title: 'Agregar',
          tabBarIcon: ({ color }) => <Fontisto size={22} name="plus-a" color={color} />,
        }}
      />
      <Tabs.Screen
        name="Compartidos"
        options={{
          title: 'Compartidos',
          tabBarIcon: ({ color }) => <Feather size={24} name="users" color={color} />,
        }}
      />
      <Tabs.Screen
        name="Graficas"
        options={{
          title: 'Gráficas',
          tabBarIcon: ({ color }) => <Feather size={24} name="pie-chart" color={color} />,
        }}
      />
    </Tabs>
  );
}