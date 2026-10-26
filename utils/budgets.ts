import { Budget } from '@/types/database';

/**
 * Normaliza nombres en IDs de Firestore (sin acentos, minúsculas, espacios a guion bajo)
 */
export function sanitizeBudgetId(categoryName: string): string {
    return categoryName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_');
}

/**
 * Deduplica el catálogo de presupuestos del usuario, priorizando plantillas maestras
 * permanentes (Opción B) sobre registros históricos legados asociados a un mes.
 */
export function deduplicateBudgets(budgets: Budget[]): Budget[] {
    const uniqueMap = new Map<string, Budget>();

    budgets.forEach((budget) => {
        const key = budget.category?.trim().toLowerCase() || budget.name?.trim().toLowerCase() || budget.id || '';
        const existing = uniqueMap.get(key);

        if (!existing) {
            uniqueMap.set(key, budget);
        } else if (!(budget as any).monthYear && (existing as any).monthYear) {
            // Privilegia el presupuesto permanente sin restricción mensual
            uniqueMap.set(key, budget);
        }
    });

    return Array.from(uniqueMap.values());
}
