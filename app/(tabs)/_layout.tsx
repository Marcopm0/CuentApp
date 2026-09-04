import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import Feather from '@expo/vector-icons/Feather';
import Fontisto from '@expo/vector-icons/Fontisto';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />file
      <Tabs.Screen
        name="Registro"
        options={{
          title: 'Historial',
          tabBarIcon: ({ color }) => <MaterialCommunityIcons size={28} name="file-document-multiple" color={color} />,
        }}
      />
      <Tabs.Screen
        name="AgregarRegistro"
        options={{
          title: 'Agregar',
          tabBarIcon: ({ color }) => <Fontisto size={28} name="plus-a" color={color} />,
        }}
      />
      <Tabs.Screen
        name="Compartidos"
        options={{
          title: 'Compartidos',
          tabBarIcon: ({ color }) => <Feather size={28} name="users" color={color} />,
        }}
      />
      <Tabs.Screen
        name="Graficas"
        options={{
          title: 'Graficas',
          tabBarIcon: ({ color }) => <Feather size={28} name="pie-chart" color={color} />,
        }}
      />
    </Tabs>
  );
}
