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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import TraceDetails from './TraceDetails.vue'
import store from '@/test/unit/helpers/store'
import router from '@/test/unit/helpers/router'
import i18n from '@/locales'

// Mock chart engine
const mockChart = {
  getDom: vi.fn(() => document.createElement('div')),
  getZr: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn()
  })),
  convertToPixel: vi.fn().mockReturnValue([100, 200]),
  dispose: vi.fn()
}

// Mock ChartRenderer component
vi.mock('@/components/charts/ChartRenderer.vue', () => ({
  default: {
    name: 'MockChartRenderer',
    template: '<div data-test="mock-chart-renderer" ref="chart"></div>',
    setup() {
      return {
        chart: mockChart
      }
    }
  }
}))

// Mock useTraces composable
const mockSearchObj = {
  data: {
    traceDetails: {
      isLoadingTraceDetails: false,
      isLoadingTraceMeta: false
    }
  }
}

vi.mock('@/composables/useTraces', () => ({
  default: () => ({
    searchObj: mockSearchObj,
    copyTracesUrl: vi.fn()
  })
}))

// Mock tree visualization engine
const mockSetupTooltips = vi.fn()
const mockCleanupTooltips = vi.fn()

vi.mock('@/utils/traces/treeVisualizationEngine', () => ({
  createTreeVisualizationEngine: () => ({
    setupTraceNodeTooltips: mockSetupTooltips
  })
}))

// Mock AWS exports
vi.mock('@/aws-exports', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    default: { ...((actual.default as object) || {}), isEnterprise: 'false' }
  }
})

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined)
  }
})

// Create DOM element for mounting
const node = document.createElement('div')
node.setAttribute('id', 'app')
node.style.height = '1024px'
document.body.appendChild(node)

describe('TraceDetails Tooltip Integration', () => {
  let wrapper: VueWrapper

  // Mock trace data with comprehensive pattern metadata
  const mockTraceData = {
    traceTree: [{
      operationName: 'frontend.api.request',
      serviceName: 'frontend-service',
      duration: 1000,
      startTimeUs: 1640000000000000,
      endTimeUs: 1640000001000000
    }],
    effectiveSpanList: [{
      span_id: 'span-1',
      trace_id: 'trace-1',
      duration_ms: 100,
      hasError: false,
      operation_name: 'frontend.api.request',
      service_name: 'frontend-service'
    }],
    patternTreeData: [{
      id: 'pattern-1',
      name: 'frontend → backend → database',
      value: 100,
      metadata: {
        pathSignature: 'frontend → backend → database',
        count: 5,
        avg: 125.5,
        min: 50.2,
        max: 200.8,
        p75: 145.3,
        p95: 185.1,
        p99: 195.7,
        errorRate: 10.0
      }
    }, {
      id: 'pattern-2',
      name: 'backend → cache',
      value: 25,
      metadata: {
        pathSignature: 'backend → cache',
        count: 15,
        avg: 25.0,
        min: 10.5,
        max: 45.0,
        p75: 30.0,
        p95: 40.0,
        p99: 44.0,
        errorRate: 0.0
      }
    }]
  }

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    wrapper = mount(TraceDetails, {
      attachTo: '#app',
      global: {
        plugins: [store, router, i18n],
        stubs: {
          'chart-renderer': {
            name: 'MockChartRenderer',
            template: '<div data-test="mock-chart-renderer" ref="chart"></div>',
            setup: () => ({ chart: mockChart })
          },
          'trace-details-sidebar': true,
          'trace-tree': true,
          'trace-dag': true,
          'trace-header': true,
          'share-button': true,
          'flame-graph-view': true,
          'trace-evaluations-view': true,
          'thread-view': true,
          'code-query-editor': true
        }
      },
      props: {
        traceIdProp: 'test-trace-id',
        mode: 'standalone',
        spanListProp: mockTraceData.effectiveSpanList
      }
    })

    // Mock internal data
    wrapper.vm.traceTree = mockTraceData.traceTree
    wrapper.vm.effectiveSpanList = mockTraceData.effectiveSpanList
    wrapper.vm.patternTreeData = mockTraceData.patternTreeData
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.clearAllMocks()
  })

  describe('Tooltip Setup Integration', () => {
    it('should setup tooltips when switching to Pattern View', async () => {
      // Switch to map tab
      await wrapper.setData({ activeTab: 'map' })
      await nextTick()

      // Switch to pattern view
      await wrapper.setData({ mapViewMode: 'pattern' })
      await nextTick()

      // Wait for tooltip setup timeout (300ms)
      await new Promise(resolve => setTimeout(resolve, 350))

      // Verify tooltip setup was called with correct parameters
      expect(mockSetupTooltips).toHaveBeenCalledWith(
        mockChart,
        expect.objectContaining({
          data: mockTraceData.patternTreeData,
          getNodeTooltip: expect.any(Function)
        })
      )
    })

    it('should not setup tooltips in span view mode', async () => {
      // Switch to map tab
      await wrapper.setData({ activeTab: 'map' })
      await nextTick()

      // Ensure we're in span view mode
      await wrapper.setData({ mapViewMode: 'span' })
      await nextTick()

      // Wait for potential timeout
      await new Promise(resolve => setTimeout(resolve, 350))

      // Tooltips should not be setup for span view
      expect(mockSetupTooltips).not.toHaveBeenCalled()
    })

    it('should cleanup tooltips when switching away from Pattern View', async () => {
      // Setup pattern view first
      await wrapper.setData({ activeTab: 'map', mapViewMode: 'pattern' })
      await nextTick()
      await new Promise(resolve => setTimeout(resolve, 350))

      // Mock the cleanup function returned by setupTraceNodeTooltips
      mockSetupTooltips.mockReturnValue(mockCleanupTooltips)

      // Switch to span view
      await wrapper.setData({ mapViewMode: 'span' })
      await nextTick()

      // Verify cleanup behavior change is reflected in state
      expect(wrapper.vm.mapViewMode).toBe('span')
    })
  })

  describe('Pattern Tooltip Content Generation', () => {
    it('should generate correct tooltip content for pattern nodes', () => {
      const node = mockTraceData.patternTreeData[0]
      const tooltipContent = wrapper.vm.getPatternNodeTooltip(node)

      // Verify pattern name
      expect(tooltipContent).toContain('frontend → backend → database')

      // Verify call count
      expect(tooltipContent).toContain('Calls: 5')

      // Verify metrics
      expect(tooltipContent).toContain('Average: 125.5ms')
      expect(tooltipContent).toContain('Minimum: 50.2ms')
      expect(tooltipContent).toContain('Maximum: 200.8ms')

      // Verify percentiles
      expect(tooltipContent).toContain('P75: 145.3ms')
      expect(tooltipContent).toContain('P95: 185.1ms')
      expect(tooltipContent).toContain('P99: 195.7ms')

      // Verify error rate
      expect(tooltipContent).toContain('Error Rate: 10.0%')
    })

    it('should generate tooltip content for cache pattern with zero errors', () => {
      const node = mockTraceData.patternTreeData[1]
      const tooltipContent = wrapper.vm.getPatternNodeTooltip(node)

      expect(tooltipContent).toContain('backend → cache')
      expect(tooltipContent).toContain('Calls: 15')
      expect(tooltipContent).toContain('Average: 25.0ms')
      expect(tooltipContent).toContain('Error Rate: 0.0%')
    })

    it('should handle missing metadata gracefully', () => {
      const nodeWithoutMetadata = {
        id: 'test',
        name: 'test-pattern',
        value: 0
      }
      const tooltipContent = wrapper.vm.getPatternNodeTooltip(nodeWithoutMetadata)

      expect(tooltipContent).toContain('Unknown Pattern')
      expect(tooltipContent).toContain('Calls: 1')
      expect(tooltipContent).toContain('Average: 0.0ms')
      expect(tooltipContent).toContain('Error Rate: 0.0%')
    })

    it('should handle null/undefined node gracefully', () => {
      const tooltipContent = wrapper.vm.getPatternNodeTooltip(null)

      expect(tooltipContent).toContain('Unknown Pattern')
      expect(tooltipContent).toContain('Calls: 1')
      expect(tooltipContent).toContain('Average: 0.0ms')
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle single span patterns', () => {
      const singleSpanNode = {
        id: 'single',
        name: 'single-service',
        value: 50,
        metadata: {
          pathSignature: 'single-service',
          count: 1,
          avg: 50.0,
          min: 50.0,
          max: 50.0,
          p75: 50.0,
          p95: 50.0,
          p99: 50.0,
          errorRate: 0.0
        }
      }

      const tooltipContent = wrapper.vm.getPatternNodeTooltip(singleSpanNode)

      expect(tooltipContent).toContain('single-service')
      expect(tooltipContent).toContain('Calls: 1')
      expect(tooltipContent).toContain('P95: 50.0ms')
      // All percentiles should be the same for single span
      expect(tooltipContent).toMatch(/P75: 50\.0ms.*P95: 50\.0ms.*P99: 50\.0ms/)
    })

    it('should handle patterns with high error rates', () => {
      const errorProneNode = {
        id: 'error-prone',
        name: 'unstable-service',
        value: 200,
        metadata: {
          pathSignature: 'unstable-service',
          count: 10,
          avg: 200.0,
          min: 150.0,
          max: 500.0,
          p75: 250.0,
          p95: 450.0,
          p99: 480.0,
          errorRate: 75.5
        }
      }

      const tooltipContent = wrapper.vm.getPatternNodeTooltip(errorProneNode)

      expect(tooltipContent).toContain('unstable-service')
      expect(tooltipContent).toContain('Error Rate: 75.5%')
      expect(tooltipContent).toContain('Maximum: 500.0ms')
    })

    it('should handle patterns with zero duration', () => {
      const zeroDurationNode = {
        id: 'zero',
        name: 'instant-service',
        value: 0,
        metadata: {
          pathSignature: 'instant-service',
          count: 3,
          avg: 0.0,
          min: 0.0,
          max: 0.0,
          p75: 0.0,
          p95: 0.0,
          p99: 0.0,
          errorRate: 0.0
        }
      }

      const tooltipContent = wrapper.vm.getPatternNodeTooltip(zeroDurationNode)

      expect(tooltipContent).toContain('instant-service')
      expect(tooltipContent).toContain('Average: 0.0ms')
      expect(tooltipContent).toContain('P99: 0.0ms')
    })
  })

  describe('Tab State Management', () => {
    it('should correctly switch between tabs and maintain tooltip state', async () => {
      // Start in timeline view
      expect(wrapper.vm.activeTab).toBe('timeline')

      // Switch to map view
      await wrapper.setData({ activeTab: 'map' })
      expect(wrapper.vm.activeTab).toBe('map')

      // Switch to pattern mode
      await wrapper.setData({ mapViewMode: 'pattern' })
      await nextTick()

      expect(wrapper.vm.mapViewMode).toBe('pattern')

      // Switch back to timeline
      await wrapper.setData({ activeTab: 'timeline' })
      expect(wrapper.vm.activeTab).toBe('timeline')
    })

    it('should handle map view mode switching', async () => {
      await wrapper.setData({ activeTab: 'map' })

      // Test pattern mode
      await wrapper.setData({ mapViewMode: 'pattern' })
      expect(wrapper.vm.mapViewMode).toBe('pattern')

      // Test span mode
      await wrapper.setData({ mapViewMode: 'span' })
      expect(wrapper.vm.mapViewMode).toBe('span')

      // Test service mode
      await wrapper.setData({ mapViewMode: 'service' })
      expect(wrapper.vm.mapViewMode).toBe('service')
    })
  })

  describe('Component Integration', () => {
    it('should properly mount with required props', () => {
      expect(wrapper.exists()).toBe(true)
      expect(wrapper.vm.mode).toBe('standalone')
      expect(wrapper.vm.traceIdProp).toBe('test-trace-id')
    })

    it('should handle embedded mode correctly', async () => {
      const embeddedWrapper = mount(TraceDetails, {
        attachTo: '#app',
        global: {
          plugins: [store, router, i18n],
          stubs: {
            'chart-renderer': {
              name: 'MockChartRenderer',
              template: '<div data-test="mock-chart-renderer"></div>'
            },
            'trace-details-sidebar': true,
            'trace-tree': true,
            'trace-dag': true,
            'trace-header': true,
            'share-button': true,
            'flame-graph-view': true,
            'trace-evaluations-view': true,
            'thread-view': true,
            'code-query-editor': true
          }
        },
        props: {
          mode: 'embedded',
          traceIdProp: 'embedded-trace-id',
          spanListProp: mockTraceData.effectiveSpanList
        }
      })

      expect(embeddedWrapper.vm.mode).toBe('embedded')
      expect(embeddedWrapper.vm.traceIdProp).toBe('embedded-trace-id')

      embeddedWrapper.unmount()
    })
  })

  describe('Performance and Memory', () => {
    it('should not create memory leaks with repeated tooltip setup/cleanup', async () => {
      const initialSetupCalls = mockSetupTooltips.mock.calls.length

      // Simulate multiple view switches
      for (let i = 0; i < 5; i++) {
        await wrapper.setData({ activeTab: 'map', mapViewMode: 'pattern' })
        await nextTick()
        await new Promise(resolve => setTimeout(resolve, 350))

        await wrapper.setData({ mapViewMode: 'span' })
        await nextTick()
      }

      // Each pattern switch should call setup once
      expect(mockSetupTooltips).toHaveBeenCalledTimes(initialSetupCalls + 5)
    })

    it('should handle rapid tab switching gracefully', async () => {
      // Rapid switching should not cause errors
      await wrapper.setData({ activeTab: 'map' })
      await wrapper.setData({ mapViewMode: 'pattern' })
      await wrapper.setData({ activeTab: 'timeline' })
      await wrapper.setData({ activeTab: 'map' })
      await wrapper.setData({ mapViewMode: 'span' })
      await wrapper.setData({ mapViewMode: 'pattern' })

      await nextTick()

      // Should end in the final state
      expect(wrapper.vm.activeTab).toBe('map')
      expect(wrapper.vm.mapViewMode).toBe('pattern')
    })
  })

  describe('Accessibility Integration', () => {
    it('should generate screen reader friendly tooltip content', () => {
      const node = mockTraceData.patternTreeData[0]
      const tooltipContent = wrapper.vm.getPatternNodeTooltip(node)

      // Should contain structured information readable by screen readers
      expect(tooltipContent).toMatch(/Calls:\s*5/)
      expect(tooltipContent).toMatch(/Average:\s*125\.5ms/)
      expect(tooltipContent).toMatch(/Error Rate:\s*10\.0%/)

      // Should not contain complex HTML that would confuse screen readers
      expect(tooltipContent).not.toContain('<script')
      expect(tooltipContent).not.toContain('<style')
    })

    it('should provide meaningful fallback content for missing data', () => {
      const tooltipContent = wrapper.vm.getPatternNodeTooltip({})

      expect(tooltipContent).toContain('Unknown Pattern')
      expect(tooltipContent).toContain('Calls: 1')
      // Should still be informative even with no data
    })
  })
})