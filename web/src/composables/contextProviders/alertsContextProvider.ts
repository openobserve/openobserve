/**
 * Alerts Context Provider - Extracts context from the alert creation/editing page
 * 
 * This provider extracts essential alert information including:
 * - Alert ID and name
 * - Organization context
 * - User intent (create new vs edit existing)
 * 
 * Example Usage:
 * ```typescript
 * import { createAlertsContextProvider } from '@/composables/contextProviders/alertsContextProvider';
 * import { contextRegistry } from '@/composables/contextProviders';
 * 
 * // Create and register provider
 * const provider = createAlertsContextProvider(formData, store, isUpdated);
 * contextRegistry.register('alerts', provider);
 * contextRegistry.setActive('alerts');
 * ```
 */

import type { ContextProvider, PageContext } from './types';

/**
 * Creates an alerts context provider that extracts essential context from the alert editor state
 * 
 * @param formData - The alert form data containing alert information
 * @param store - Vuex store instance (for organization info)
 * @param isUpdated - Boolean indicating if this is an update operation
 * 
 * Example:
 * ```typescript
 * const provider = createAlertsContextProvider(formData, store, isUpdated);
 * ```
 */
export const createAlertsContextProvider = (
  formData: any,
  store: any,
  isUpdated: boolean
): ContextProvider => {
  return {
    getContext(): PageContext {
      return {
        currentPage: 'Alerts',
        alertId: formData?.value?.id || '',
        alertName: formData?.value?.name || '',
        isRealTime: formData?.value?.type === 'realtime',
        organization_identifier: store?.state?.selectedOrganization?.identifier || '',
        user_intent: isUpdated ? 'edit existing alert' : 'create new alert'
      };
    }
  };
};