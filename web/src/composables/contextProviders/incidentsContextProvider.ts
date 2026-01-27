/**
 * Incidents Context Provider - Extracts context from the incident detail page
 *
 * This provider extracts essential incident information including:
 * - Agent type (sre) for backend routing
 * - Incident ID, title, status, and severity
 * - Alert count and timestamps
 * - Stable dimensions and topology context
 * - Triggers and RCA analysis
 *
 * Example Usage:
 * ```typescript
 * import { createIncidentsContextProvider } from '@/composables/contextProviders/incidentsContextProvider';
 * import { contextRegistry } from '@/composables/contextProviders';
 *
 * // Create and register provider
 * const provider = createIncidentsContextProvider(incidentData, store);
 * contextRegistry.register('incidents', provider);
 * contextRegistry.setActive('incidents');
 * ```
 */

import type { ContextProvider, PageContext } from './types';

/**
 * Creates an incidents context provider that matches the structure expected by the SRE agent
 *
 * @param incidentData - The incident data containing incident information
 * @param store - Vuex store instance (for organization info)
 *
 * Example:
 * ```typescript
 * const provider = createIncidentsContextProvider(incidentData, store);
 * ```
 */
export const createIncidentsContextProvider = (
  incidentData: any,
  store: any
): ContextProvider => {
  return {
    getContext(): PageContext {
      // Build context matching the exact structure that SREChat sends
      const context: any = {
        agent_type: 'sre',
        org_id: store?.state?.selectedOrganization?.identifier || '',
        incident_id: incidentData?.id,
        incident_title: incidentData?.title,
        incident_status: incidentData?.status,
        incident_severity: incidentData?.severity,
        alert_count: incidentData?.alert_count,
        first_alert_at: incidentData?.first_alert_at,
        last_alert_at: incidentData?.last_alert_at,
      };

      // Add optional fields if they exist
      if (incidentData?.stable_dimensions) {
        context.stable_dimensions = incidentData.stable_dimensions;
      }
      if (incidentData?.topology_context) {
        context.topology_context = incidentData.topology_context;
      }
      if (incidentData?.triggers) {
        context.triggers = incidentData.triggers;
      }
      if (incidentData?.rca_analysis) {
        context.rca_analysis = incidentData.rca_analysis;
      }

      return context;
    }
  };
};
