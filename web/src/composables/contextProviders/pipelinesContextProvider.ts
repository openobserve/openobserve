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
 * @param streamName - Name of the stream being queried (optional, for query nodes)
 * @param streamType - Type of stream: 'logs', 'metrics', or 'traces' (optional, for query nodes)
 * @param queryType - Type of query: 'sql' or 'promql' (optional, for query nodes)
 *
 * Example:
 * ```typescript
 * const provider = createPipelinesContextProvider(pipelineObj, store, 'my-stream', 'logs', 'sql');
 * ```
 */
export const createPipelinesContextProvider = (
  pipelineObj: any,
  store: any,
  streamName?: string,
  streamType?: string,
  queryType?: string
): ContextProvider => {
  return {
    getContext(): PageContext {
      const pipeline = pipelineObj?.currentSelectedPipeline;
      const isEditNode = pipelineObj?.isEditNode;

      return {
        currentPage: 'Pipelines',
        pipelineId: pipeline?.pipeline_id || '',
        pipelineName: pipeline?.name || '',
        organization_identifier: store?.state?.selectedOrganization?.identifier || '',
        user_intent: isEditNode
          ? 'edit existing pipeline query node'
          : pipelineObj?.isEditPipeline
            ? 'edit existing pipeline'
            : 'create new pipeline query node',
        // Current timestamp when request is fired (microseconds) for AI agent time calculations
        request_timestamp: Date.now() * 1000,
        // Stream context for query nodes
        selectedStreams: streamName ? [streamName] : ['default'],
        streamType: streamType || 'logs',
        queryType: queryType || 'sql',
        pipelineNodeType: 'query',
      };
    }
  };
};

