import { getColorPalette } from "../colorPalette";

/**
 * Applies user-configured series-to-color mappings to the given series list and
 * ensures auto-generated colors do not conflict with configured colors.
 *
 * - Enforces configured colors for mapped series names
 * - Tracks colors already in use (configured + existing on series)
 * - Reassigns auto-generated colors that collide with configured ones to the
 *   next available color from the theme palette; if exhausted, uses an HSL fallback
 *
 * This function mutates the provided `series` array in place.
 */
export const applySeriesColorMappings = (
    series: any[],
    colorBySeries:
        | Array<{ value: string; color: string | null }>
        | undefined
        | null,
    theme: string,
): void => {
    if (!Array.isArray(series) || !colorBySeries?.length) return;

    const configuredSeriesToColor = new Map<string, string>();
    const configuredColors = new Set<string>();
    for (const mapping of colorBySeries) {
        if (mapping?.value && mapping?.color) {
            configuredSeriesToColor.set(String(mapping.value), String(mapping.color));
            configuredColors.add(String(mapping.color));
        }
    }

    if (configuredSeriesToColor.size === 0) return;

    const usedColors = new Set<string>(configuredColors);

    const getSeriesColor = (s: any): string | undefined =>
        s?.color ?? s?.itemStyle?.color;
    const setSeriesColor = (s: any, clr: string) => {
        if (!s) return;
        if (s.color !== undefined) s.color = clr;
        if (s.itemStyle?.color !== undefined) s.itemStyle.color = clr;
    };

    // Enforce configured colors and collect currently used colors
    series.forEach((s: any) => {
        const mapped = configuredSeriesToColor.get(s?.name);
        if (mapped) {
            setSeriesColor(s, mapped);
            usedColors.add(mapped);
        } else {
            const current = getSeriesColor(s);
            if (current) usedColors.add(current);
        }
    });

    // Generate a unique non-conflicting color
    const generateUniqueColor = (
        used: Set<string>,
        themeName: string,
    ): string => {
        const palette = getColorPalette(themeName);
        for (const c of palette) {
            if (!used.has(c)) return c;
        }
        const hue = (used.size * 137.508) % 360;
        const saturation = 70 + (used.size % 20);
        const lightness = 45 + (used.size % 20);
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    };

    // Reassign auto-generated colors that collide with configured colors
    series.forEach((s: any) => {
        if (configuredSeriesToColor.has(s?.name)) return;
        const current = getSeriesColor(s);
        if (current && configuredColors.has(current)) {
            const next = generateUniqueColor(usedColors, theme);
            usedColors.add(next);
            setSeriesColor(s, next);
        }
    });
};
