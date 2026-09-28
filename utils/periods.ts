export type PayFrequency = 'monthly' | 'biweekly' | 'weekly';
export type DueBlock = 'start' | 'mid' | 'end'; // 1-10, 11-20, 21-31

export interface PeriodInfo {
    periodKey: string;       // Identificador único (ej. "2026-09-Q2", "2026-W39")
    label: string;           // Nombre amigable para el usuario (ej. "2da Quincena", "Semana 39")
    isPayDayOrPast: boolean; // Confirma que ya llegó la fecha para mostrar el cobro
    activeBlocks: DueBlock[];// Bloques de vencimiento de gastos fijos cubiertos en este periodo
    startDate?: Date;
    endDate?: Date;
}

/**
 * Devuelve el año y número de semana ISO-8601 (1 a 53)
 */
export const getISOWeek = (date: Date): { year: number; week: number } => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    // Convertir día: Domingo es 0, en ISO lunes es 1 y domingo es 7
    const dayNum = d.getUTCDay() || 7;
    // Ajustar al jueves más cercano: fecha actual + 4 - número de día
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week };
};

/**
 * Determina el periodo en curso según la frecuencia con la que cobra el usuario,
 * el día de la semana en que cobra (para cobro semanal) y la fecha actual del sistema.
 */
export const getPeriodInfo = (
    frequency: PayFrequency = 'biweekly',
    payDayOfWeek: number = 5 // Por defecto Viernes = 5 (0: Domingo, 1: Lunes, ..., 6: Sábado)
): PeriodInfo => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = now.getDate();
    const yearMonth = `${year}-${month}`;

    // 1. Cobro MENSUAL (se activa desde el día 1 de cada mes y cubre todo el mes)
    if (frequency === 'monthly') {
        const startDate = new Date(year, now.getMonth(), 1, 0, 0, 0, 0);
        const endDate = new Date(year, now.getMonth() + 1, 0, 23, 59, 59, 999);
        return {
            periodKey: `${yearMonth}-M`,
            label: 'Sueldo Mensual',
            isPayDayOrPast: true,
            activeBlocks: ['start', 'mid', 'end'],
            startDate,
            endDate,
        };
    }

    // 2. Cobro QUINCENAL (Días 1 al 15 = Q1 | Día 16 en adelante = Q2)
    if (frequency === 'biweekly') {
        const isFirstHalf = day <= 15;
        const startDate = isFirstHalf
            ? new Date(year, now.getMonth(), 1, 0, 0, 0, 0)
            : new Date(year, now.getMonth(), 16, 0, 0, 0, 0);
        const endDate = isFirstHalf
            ? new Date(year, now.getMonth(), 15, 23, 59, 59, 999)
            : new Date(year, now.getMonth() + 1, 0, 23, 59, 59, 999);

        return {
            periodKey: `${yearMonth}-${isFirstHalf ? 'Q1' : 'Q2'}`,
            label: isFirstHalf ? '1ra Quincena' : '2da Quincena',
            isPayDayOrPast: true,
            activeBlocks: isFirstHalf ? ['start', 'mid'] : ['end'],
            startDate,
            endDate,
        };
    }

    // 3. Cobro SEMANAL (Semanas reales móviles basadas en el día de pago del usuario)
    const targetDay = typeof payDayOfWeek === 'number' && payDayOfWeek >= 0 && payDayOfWeek <= 6
        ? payDayOfWeek
        : 5; // Default viernes = 5

    const currentDayOfWeek = now.getDay();
    // Cuántos días han pasado desde el día de cobro más reciente
    const diff = (currentDayOfWeek - targetDay + 7) % 7;

    const cycleStart = new Date(year, now.getMonth(), day - diff, 0, 0, 0, 0);
    const cycleEnd = new Date(cycleStart.getFullYear(), cycleStart.getMonth(), cycleStart.getDate() + 6, 23, 59, 59, 999);

    const { year: isoYear, week: isoWeek } = getISOWeek(cycleStart);
    const weekStr = String(isoWeek).padStart(2, '0');
    const periodKey = `${isoYear}-W${weekStr}`;
    const label = `Semana ${isoWeek}`;

    // 1. Identificar el "Mes Dominante" de la semana (el mes que concentra la mayoría de los 7 días)
    const monthCounts = new Map<string, { year: number; month: number; count: number }>();
    for (let i = 0; i < 7; i++) {
        const d = new Date(cycleStart.getFullYear(), cycleStart.getMonth(), cycleStart.getDate() + i);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        const current = monthCounts.get(key) || { year: d.getFullYear(), month: d.getMonth(), count: 0 };
        current.count++;
        monthCounts.set(key, current);
    }

    let dominant = { year: cycleStart.getFullYear(), month: cycleStart.getMonth(), count: 0 };
    for (const val of monthCounts.values()) {
        if (val.count > dominant.count) {
            dominant = val;
        }
    }

    // 2. Determinar qué bloques (start: 1-10, mid: 11-20, end: 21-31) caen en los días del mes dominante
    const activeBlocksSet = new Set<DueBlock>();
    for (let i = 0; i < 7; i++) {
        const d = new Date(cycleStart.getFullYear(), cycleStart.getMonth(), cycleStart.getDate() + i);
        if (d.getMonth() === dominant.month && d.getFullYear() === dominant.year) {
            const dom = d.getDate();
            if (dom <= 10) {
                activeBlocksSet.add('start');
            } else if (dom <= 20) {
                activeBlocksSet.add('mid');
            } else {
                activeBlocksSet.add('end');
            }
        }
    }

    // Respaldo de seguridad si el conjunto queda vacío
    if (activeBlocksSet.size === 0) {
        const dom = cycleStart.getDate();
        activeBlocksSet.add(dom <= 10 ? 'start' : dom <= 20 ? 'mid' : 'end');
    }

    const order: DueBlock[] = ['start', 'mid', 'end'];
    const activeBlocks = order.filter((b) => activeBlocksSet.has(b));

    return {
        periodKey,
        label,
        isPayDayOrPast: true,
        activeBlocks,
        startDate: cycleStart,
        endDate: cycleEnd,
    };
};