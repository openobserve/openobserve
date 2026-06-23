// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, Ref } from 'vue'
import {
  formatNumber,
  generateServiceNodeTooltipContent,
  generatePatternNodeTooltipContent
} from '@/utils/traces/treeTooltipHelpers'
import { truncateText } from '@/utils/zincutils'

// Node labels render beside chart nodes with no width cap — long service
// names would overlap the next tree level, so cap the visible name. The
// full name stays available in the hover tooltip.
const MAX_LABEL_NAME_LENGTH = 24

/**
 * Tree node interface for shared tree visualization
 */
export interface TreeNode {
  id: string
  name: string
  label?: string
  value: number // Primary metric (requests/duration)
  errorRate: number
  children?: TreeNode[]
  metadata?: Record<string, any> // Context-specific data
}

/**
 * Configuration for tree visualization formatting
 */
export interface TreeFormatterConfig {
  nodeType: 'service' | 'pattern'
  isDarkMode?: boolean
}

/**
 * Base tree visualization composable that provides shared formatting logic
 * while allowing context-specific customization through data transformers.
 *
 * This eliminates duplication between ServiceGraph tree view and TraceDetails pattern view.
 */
export function useTreeVisualization<T>(
  rawData: Ref<T>,
  dataTransformer: (data: T) => TreeNode[],
  config: TreeFormatterConfig
) {
  // Transform raw data into tree format
  const treeData = computed(() => dataTransformer(rawData.value))

  /**
   * Generate context-aware node labels
   * - Service context: Shows request counts
   * - Pattern context: Shows duration with aggregation info
   */
  const getNodeLabel = (node: TreeNode): string => {
    const displayName = truncateText(node.name, MAX_LABEL_NAME_LENGTH)
    if (config.nodeType === 'service') {
      // ServiceGraph format: service name + request count
      return `{name|${displayName}}\n{requests|${formatNumber(node.value)} req}`
    } else {
      // Pattern format: pattern name + duration (with avg for grouped patterns)
      const count = node.metadata?.count || 1
      const duration = (node.metadata?.avg || node.value).toFixed(2)

      if (count > 1) {
        // Grouped pattern: show average with call count
        return `{name|${displayName}}\n{duration|${duration}ms (avg) }`
      } else {
        // Single pattern: show duration without avg label
        return `{name|${displayName}}\n{duration|${duration}ms}`
      }
    }
  }

  /**
   * Generate context-aware tooltips
   * Delegates to appropriate tooltip generator based on node type
   */
  const getNodeTooltip = (node: TreeNode): string => {
    if (config.nodeType === 'service') {
      return generateServiceNodeTooltipContent(node.metadata)
    } else {
      return generatePatternNodeTooltipContent(node.metadata)
    }
  }

  /**
   * Extract error rate from node metadata
   * Standardized across both service and pattern contexts
   */
  const getNodeErrorRate = (node: TreeNode): number => {
    return node.metadata?.errorCount || 0
  }

  return {
    treeData,
    getNodeLabel,
    getNodeTooltip,
    getNodeErrorRate
  }
}