import { Budget } from '@/types/database';

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
