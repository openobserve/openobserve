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

import { ref, Ref, watch, nextTick, readonly } from 'vue'
import { ECharts } from 'echarts'

/**
 * Selected node information
 */
export interface SelectedNodeInfo {
  id: string
  name: string
  metadata?: any
}

/**
 * Composable for shared tree node selection and hover interactions
 * Provides consistent selection persistence and hover behavior across ServiceGraph and TraceDetails
 */
export function useTreeNodeSelection() {
  const selectedNode = ref<SelectedNodeInfo | null>(null)

  /**
   * Select a node in the tree with persistent visual state
   */
  const selectNode = (chart: ECharts, nodeInfo: SelectedNodeInfo) => {
    selectedNode.value = nodeInfo

    // Use ECharts dispatchAction to select the node with persistent styling
    chart.dispatchAction({
      type: "select",
      seriesIndex: 0,
      name: nodeInfo.name,
    })
  }

  /**
   * Unselect the currently selected node
   */
  const unselectNode = (chart: ECharts) => {
    if (selectedNode.value) {
      chart.dispatchAction({
        type: "unselect",
        seriesIndex: 0,
        name: selectedNode.value.name,
      })
    }
    selectedNode.value = null
  }

  /**
   * Clear selection without dispatching chart actions
   * Useful for cleanup when chart is being destroyed
   */
  const clearSelection = () => {
    selectedNode.value = null
  }

  /**
   * Set up selection persistence across theme changes and chart recreation
   */
  const setupSelectionPersistence = (
    chart: Ref<ECharts | null>,
    chartKey: Ref<number>
  ) => {
    // Watch for selected node changes and apply to chart
    watch(
      () => selectedNode.value?.id,
      async (newId, oldId) => {
        const chartInstance = chart.value
        if (!chartInstance) return

        // Unselect previous node
        if (oldId && selectedNode.value?.name) {
          chartInstance.dispatchAction({
            type: "unselect",
            seriesIndex: 0,
            name: selectedNode.value.name,
          })
        }

        // Select new node
        if (newId && selectedNode.value?.name) {
          await nextTick()
          chartInstance.dispatchAction({
            type: "select",
            seriesIndex: 0,
            name: selectedNode.value.name,
          })
        }
      }
    )

    // Restore selection after chart recreation (theme change, etc.)
    watch(chartKey, async () => {
      if (selectedNode.value && chart.value) {
        // Wait for chart to be ready after recreation
        await nextTick()
        setTimeout(() => {
          if (chart.value && selectedNode.value) {
            chart.value.dispatchAction({
              type: "select",
              seriesIndex: 0,
              name: selectedNode.value.name,
            })
          }
        }, 500) // Delay to ensure chart is fully rendered
      }
    })
  }

  return {
    selectedNode: readonly(selectedNode),
    selectNode,
    unselectNode,
    clearSelection,
    setupSelectionPersistence
  }
}

/**
 * Composable for tree node hover interactions
 * Handles emphasis effects and edge dimming on hover
 */
export function useTreeNodeHover() {
  const hoveredNode = ref<string | null>(null)

  /**
   * Set up hover effects for the tree chart
   * Configures emphasis behavior and edge dimming
   */
  const setupHoverEffects = (chart: Ref<ECharts | null>) => {
    // The hover effects are primarily handled by ECharts configuration:
    // emphasis: { focus: "relative" } - dims non-adjacent nodes
    // blur: { itemStyle: { opacity: 0.15 } } - dims non-related elements

    // Additional hover logic can be added here if needed
    // For example, custom tooltip positioning or external state updates
  }

  /**
   * Handle hover state changes
   * Can be used for external state management or custom effects
   */
  const setHoveredNode = (nodeId: string | null) => {
    hoveredNode.value = nodeId
  }

  return {
    hoveredNode: readonly(hoveredNode),
    setHoveredNode,
    setupHoverEffects
  }
}

/**
 * Composable for theme change handling
 * Manages chart recreation and state preservation during theme transitions
 */
export function useTreeThemeHandling() {
  const chartKey = ref(0)
  const previousTheme = ref<boolean | null>(null)

  /**
   * Handle theme changes by incrementing chart key to force recreation
   * Preserves selection state across theme transitions
   */
  const handleThemeChange = (isDarkMode: boolean) => {
    if (previousTheme.value !== null && previousTheme.value !== isDarkMode) {
      // Theme actually changed, force chart recreation
      chartKey.value += 1
    }
    previousTheme.value = isDarkMode
  }

  return {
    chartKey: readonly(chartKey),
    handleThemeChange
  }
}

/**
 * Complete tree interaction composable
 * Combines selection, hover, and theme handling for full tree interaction management
 */
export function useTreeInteraction() {
  const selection = useTreeNodeSelection()
  const hover = useTreeNodeHover()
  const theme = useTreeThemeHandling()

  /**
   * Set up all tree interactions for a chart
   */
  const setupTreeInteractions = (
    chart: Ref<ECharts | null>,
    isDarkMode: Ref<boolean>
  ) => {
    // Set up selection persistence
    selection.setupSelectionPersistence(chart, theme.chartKey)

    // Set up hover effects
    hover.setupHoverEffects(chart)

    // Watch for theme changes
    watch(isDarkMode, (newTheme) => {
      theme.handleThemeChange(newTheme)
    }, { immediate: true })
  }

  return {
    // Selection
    selectedNode: selection.selectedNode,
    selectNode: selection.selectNode,
    unselectNode: selection.unselectNode,
    clearSelection: selection.clearSelection,

    // Hover
    hoveredNode: hover.hoveredNode,
    setHoveredNode: hover.setHoveredNode,

    // Theme
    chartKey: theme.chartKey,
    handleThemeChange: theme.handleThemeChange,

    // Setup
    setupTreeInteractions
  }
}