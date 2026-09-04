import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import React from 'react';
import { SafeAreaView, StyleSheet, TouchableOpacity, View } from 'react-native';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ThemedView style={styles.container}>
        <ThemedText type='title'>Inicio</ThemedText>
        <View style={styles.headerRow}>
          <ThemedText style={styles.saludo}>Hola de nuevo XXXX</ThemedText>
          <TouchableOpacity style={styles.miniwigdet} activeOpacity={0.7}>
            <ThemedText style={styles.miniwigdettext}>23/08/2026</ThemedText>

          </TouchableOpacity>
        </View>
        <View style={styles.widget}>
          <ThemedText style={styles.widgetlabel}>Cuenta de ahorro personal</ThemedText>
          <ThemedText style={styles.widgetAmount}>$50000</ThemedText>
        </View>

        <View style={styles.widget}>
          <ThemedText style={styles.widgetlabel}>Semaforo de gastos</ThemedText>
          <ThemedText style={styles.widgetAmount}>Barra de semaforo aqui va</ThemedText>
        </View>



        <View style={styles.widget}>
          <ThemedText style={styles.widgetlabel}>Gastos</ThemedText>
          <ThemedText style={styles.widgetAmount}>XXXXXXXXXXX</ThemedText>
        </View>




      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 25,
    gap: 16,
    backgroundColor: '#0B0F17',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '90%',
  },

  saludo: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#94A3B8',
    alignSelf: 'flex-start',
    marginLeft: '7%',
  },
  miniwigdet: {
    backgroundColor: '#161F30',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#24324D',
  },
  miniwigdettext: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#94A3B8',
    alignSelf: 'flex-start',
  },
  widget: {
    width: '90%',
    backgroundColor: '#161F30',
    borderRadius: 16,
    padding: 20,
    gap: 6,


    //borde
    borderWidth: 1,
    borderColor: '#24324D',
  },
  widgetlabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#94A3B8',
    alignSelf: 'flex-start',
    marginLeft: '5%',
  },
  widgetAmount: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#ffffffff',
    alignSelf: 'flex-start',
    marginLeft: '10%',
  }
});