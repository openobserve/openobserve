import {
    calculateChartDimensions,
    calculatePieChartRadius,
    generateChartAlignmentProperties,
    getChartDimensions,
    shouldApplyChartAlignment,
} from "../legendConfiguration";

/**
 * Calculates chart container properties for pie/donut charts based on legend position and chart alignment
 * @param {any} panelSchema - The panel schema containing configuration
 * @param {number} chartWidth - Width of the chart container
 * @param {number} chartHeight - Height of the chart container
 * @param {any[]} seriesData - Series data for legend calculations
 * @returns {object} Object containing grid properties and available dimensions
 */
export const calculatePieChartContainer = (
    panelSchema: any,
    chartWidth: number,
    chartHeight: number,
    seriesData: any[] = [],
) => {
    const chartAlign = panelSchema.config?.chart_align;
    const legendPosition = panelSchema.config?.legends_position;

    // Calculate available space using our centralized helper function
    const dimensions = calculateChartDimensions(
        panelSchema,
        chartWidth,
        chartHeight,
        seriesData,
    );

    // Determine if chart alignment should be applied
    const shouldApplyAlignment = shouldApplyChartAlignment(
        panelSchema,
        seriesData,
    );

    // Generate CSS grid properties for chart alignment
    const gridProperties = generateChartAlignmentProperties(
        chartAlign,
        legendPosition,
        shouldApplyAlignment,
    );

    return {
        gridProperties,
        availableWidth: dimensions.availableWidth,
        availableHeight: dimensions.availableHeight,
        shouldUseGridAlignment: shouldApplyAlignment,
    };
};

/**
 * Returns the pie chart radius that accounts for legend space
 * @param {any} chartPanelRef - The reference to the chart panel
 * @param {any} panelSchema - The panel schema
 * @param {any[]} seriesData - The series data for legend calculation
 * @returns {number} - the radius percentage
 */
export const getPieChartRadius = (chartPanelRef: any, panelSchema: any, seriesData: any[] = []) => {
    // Get chart dimensions from chartPanelRef
    const dimensions = getChartDimensions(chartPanelRef);

    // Calculate available dimensions using our centralized helper function
    const chartDimensions = calculateChartDimensions(
        panelSchema,
        dimensions.chartWidth,
        dimensions.chartHeight,
        seriesData,
    );

    // Use the optimized pie chart radius calculation
    const radius = calculatePieChartRadius(
        panelSchema,
        chartDimensions.availableWidth,
        chartDimensions.availableHeight,
        dimensions.chartWidth,
        dimensions.chartHeight,
    );

    return radius;
};
