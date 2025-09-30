/**
 * Core interfaces for the AI Context Provider System
 * 
 * Example Usage:
 * ```typescript
 * const logsContext: PageContext = {
 *   pageType: 'logs',
 *   data: {
 *     currentQuery: 'level:error',
 *     timeRange: { from: '2024-01-01', to: '2024-01-02' }
 *   }
 * };
 * ```
 */

export interface PageContext {
  pageType: 'logs' | 'metrics' | 'dashboard';
  data: Record<string, any>;
}

/**
 * Context provider interface that each page must implement
 * 
 * Example Implementation:
 * ```typescript
 * const logsProvider: ContextProvider = {
 *   getContext: async () => ({
 *     pageType: 'logs',
 *     data: { query: searchObj.query, schema: await getStreamSchema() }
 *   })
 * };
 * ```
 */
export interface ContextProvider {
  getContext(): PageContext | Promise<PageContext>;
}