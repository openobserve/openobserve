/**
 * Pipelines Context Provider - Extracts context from the pipeline editor page
 * 
 * This provider extracts essential pipeline information including:
 * - Pipeline ID and name
 * - Organization context
 * - User intent (create new vs edit existing)
 * 
 * Example Usage:
 * ```typescript
 * import { createPipelinesContextProvider } from '@/composables/contextProviders/pipelinesContextProvider';
 * import { contextRegistry } from '@/composables/contextProviders';
 * 
 * // Create and register provider
 * const provider = createPipelinesContextProvider(pipelineObj, store);
 * contextRegistry.register('pipelines', provider);
 * contextRegistry.setActive('pipelines');
 * ```
 */

import type { ContextProvider, PageContext } from './types';

/**
 * Creates a pipelines context provider that extracts essential context from the pipeline editor state
 * 
 * @param pipelineObj - The pipeline object from useDragAndDrop composable
 * @param store - Vuex store instance (for organization info)
 * 
 * Example:
 * ```typescript
 * const provider = createPipelinesContextProvider(pipelineObj, store);
 * ```
 */
export const createPipelinesContextProvider = (
  pipelineObj: any,
  store: any
): ContextProvider => {
  return {
    getContext(): PageContext {
      const pipeline = pipelineObj?.currentSelectedPipeline;
      
      return {
        currentPage: 'Pipelines',
        pipelineId: pipeline?.id || '',
        pipelineName: pipeline?.name || '',
        organization_identifier: store?.state?.selectedOrganization?.identifier || '',
        user_intent: pipelineObj?.isEditPipeline ? 'edit existing pipeline' : 'create new pipeline'
      };
    }
  };
};

