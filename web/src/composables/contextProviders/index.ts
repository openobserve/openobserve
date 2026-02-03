/**
 * Context Providers Module - Main export file
 * 
 * This module provides the core infrastructure for the AI Context Provider System.
 * It exports types, registry, and utilities needed to implement context providers.
 * 
 * Example Usage:
 * ```typescript
 * import { contextRegistry, type PageContext, type ContextProvider } from '@/composables/contextProviders';
 * 
 * // Create a context provider
 * const myProvider: ContextProvider = {
 *   getContext: () => ({
 *     pageType: 'logs',
 *     data: { query: 'level:error' }
 *   })
 * };
 * 
 * // Register and use
 * contextRegistry.register('logs', myProvider);
 * contextRegistry.setActive('logs');
 * ```
 */

// Export types
export type { PageContext, ContextProvider } from './types';

// Export registry
export { contextRegistry, default as registry } from './registry';

// Export context providers
export { createLogsContextProvider } from './logsContextProvider';
export { createDefaultContextProvider } from './defaultContextProvider';
export { createPipelinesContextProvider } from './pipelinesContextProvider';
export { createAlertsContextProvider } from './alertsContextProvider';
export { createDashboardsContextProvider } from './dashboardsContextProvider';
export { createIncidentsContextProvider } from './incidentsContextProvider';