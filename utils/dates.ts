/**
 * Utilidades centralizadas para extracción, normalización y formateo de fechas de transacciones.
 */

/**
 * Obtiene un objeto Date válido a partir de una transacción, soportando:
 * 1. Timestamp de Firestore (`createdAt` o `date` con método `.toDate()`)
 * 2. Instancia nativa de `Date`
 * 3. Cadena de fecha ISO o 'YYYY-MM-DD' en `tx.date`
 */
export function getTransactionDate(tx: { date?: string | any; createdAt?: any }): Date {
    if (tx.createdAt && typeof tx.createdAt.toDate === 'function') {
        return tx.createdAt.toDate();
    }
    if (tx.createdAt instanceof Date) {
        return tx.createdAt;
    }
    if (tx.date) {
        if (typeof (tx.date as any).toDate === 'function') {
            return (tx.date as any).toDate();
        }
        if (tx.date instanceof Date) {
            return tx.date;
        }
        if (typeof tx.date === 'string') {
            // Soporta 'YYYY-MM-DD' fijando mediodía local para evitar saltos de huso horario
            return new Date(tx.date.includes('T') ? tx.date : `${tx.date}T12:00:00`);
        }
    }
    return new Date();
}

/**
 * Devuelve la fecha actual o dada en formato estricto 'YYYY-MM-DD'.
 */
export function getLocalDateString(d: Date = new Date()): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
