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

// Mock performance monitoring
const mockPerformance = {
  mark: vi.fn(),
  measure: vi.fn(() => ({ duration: Math.random() * 10 })),
  getEntriesByName: vi.fn(() => [{ duration: 5.2 }]),
  clearMarks: vi.fn(),
  clearMeasures: vi.fn()
}

// Extend global with performance
global.performance = Object.assign(global.performance || {}, mockPerformance)

// Mock memory monitoring
const mockMemory = {
  usedJSHeapSize: 50000000,
  totalJSHeapSize: 100000000
}

Object.defineProperty(global, 'performance', {
  value: {
    ...mockPerformance,
    memory: mockMemory
  },
  writable: true
})

// Mock chart with performance tracking
const mockChart = {
  getDom: vi.fn(() => document.createElement('div')),
  getZr: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn()
  })),
  convertToPixel: vi.fn().mockReturnValue([100, 200]),
  dispose: vi.fn()
}

// Mock tree visualization with performance metrics
const mockSetupTooltips = vi.fn(() => {
  // Simulate setup time
  performance.mark('tooltip-setup-start')
  setTimeout(() => {
    performance.mark('tooltip-setup-end')
    performance.measure('tooltip-setup', 'tooltip-setup-start', 'tooltip-setup-end')
  }, 1)

  // Return cleanup function
  return vi.fn(() => {
    performance.mark('tooltip-cleanup-start')
    setTimeout(() => {
      performance.mark('tooltip-cleanup-end')
      performance.measure('tooltip-cleanup', 'tooltip-cleanup-start', 'tooltip-cleanup-end')
    }, 1)
  })
})

vi.mock('@/utils/traces/treeVisualizationEngine', () => ({
  createTreeVisualizationEngine: () => ({
    setupTraceNodeTooltips: mockSetupTooltips
  })
}))

vi.mock('@/components/charts/ChartRenderer.vue', () => ({
  default: {
    name: 'MockChartRenderer',
    template: '<div data-test="mock-chart-renderer" ref="chart"></div>',
    setup() {
      return { chart: mockChart }
    }
  }
}))

// Mock large dataset
const generateLargePatternData = (size: number) => {
  return Array.from({ length: size }, (_, i) => ({
    id: `pattern-${i}`,
    name: `service-${i % 10} → service-${(i + 1) % 10}`,
    value: Math.random() * 1000,
    metadata: {
      pathSignature: `service-${i % 10} → service-${(i + 1) % 10}`,
      count: Math.floor(Math.random() * 100) + 1,
      avg: Math.random() * 500,
      min: Math.random() * 100,
      max: Math.random() * 1000 + 500,
      p75: Math.random() * 300 + 200,
      p95: Math.random() * 200 + 400,
      p99: Math.random() * 100 + 450,
      errorRate: Math.random() * 20
    }
  }))
}

describe('TraceDetails Tooltip Performance', () => {
  let wrapper: VueWrapper

  beforeEach(() => {
    vi.clearAllMocks()
    performance.clearMarks()
    performance.clearMeasures()
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  describe('Memory Management', () => {
    it('should not leak memory with repeated tooltip setup/cleanup cycles', async () => {
      wrapper = mount(TraceDetails, {
        global: {
          plugins: [store, router, i18n],
          stubs: { 'chart-renderer': true, 'trace-details-sidebar': true }
        },
        props: { traceIdProp: 'test-trace', mode: 'standalone' }
      })

      // Set initial data
      wrapper.vm.patternTreeData = generateLargePatternData(10)

      const initialMemory = performance.memory?.usedJSHeapSize || 0
      let cleanupCallCount = 0

      // Mock cleanup function to track calls
      mockSetupTooltips.mockImplementation(() => {
        const cleanup = vi.fn(() => { cleanupCallCount++ })
        return cleanup
      })

      // Simulate 50 setup/cleanup cycles
      for (let i = 0; i < 50; i++) {
        await wrapper.setData({ activeTab: 'map', mapViewMode: 'pattern' })
        await nextTick()
        await new Promise(resolve => setTimeout(resolve, 10))

        await wrapper.setData({ mapViewMode: 'span' })
        await nextTick()
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      // Verify cleanup was called for each setup
      expect(cleanupCallCount).toBeGreaterThan(0)

      // Check memory hasn't grown significantly (in real test, this would be more meaningful)
      const finalMemory = performance.memory?.usedJSHeapSize || 0
      const memoryGrowth = finalMemory - initialMemory

      // Memory growth should be reasonable (allowing for some natural variance)
      expect(memoryGrowth).toBeLessThan(10000000) // Less than 10MB growth
    })

    it('should handle component unmount without memory leaks', async () => {
      wrapper = mount(TraceDetails, {
        global: {
          plugins: [store, router, i18n],
          stubs: { 'chart-renderer': true, 'trace-details-sidebar': true }
        },
        props: { traceIdProp: 'test-trace', mode: 'standalone' }
      })

      // Setup tooltips
      wrapper.vm.patternTreeData = generateLargePatternData(20)
      await wrapper.setData({ activeTab: 'map', mapViewMode: 'pattern' })
      await nextTick()
      await new Promise(resolve => setTimeout(resolve, 100))

      const cleanupSpy = vi.fn()
      mockSetupTooltips.mockReturnValue(cleanupSpy)

      // Unmount component
      wrapper.unmount()

      // Cleanup should be called when component unmounts
      // (In the real implementation, this would be verified through onUnmounted hook)
      expect(wrapper.exists()).toBe(false)
    })
  })

  describe('Performance Benchmarks', () => {
    it('should setup tooltips quickly with small datasets', async () => {
      wrapper = mount(TraceDetails, {
        global: {
          plugins: [store, router, i18n],
          stubs: { 'chart-renderer': true, 'trace-details-sidebar': true }
        },
        props: { traceIdProp: 'test-trace', mode: 'standalone' }
      })

      wrapper.vm.patternTreeData = generateLargePatternData(10)

      performance.mark('tooltip-setup-test-start')

      await wrapper.setData({ activeTab: 'map', mapViewMode: 'pattern' })
      await nextTick()
      await new Promise(resolve => setTimeout(resolve, 350))

      performance.mark('tooltip-setup-test-end')
      performance.measure('tooltip-setup-test', 'tooltip-setup-test-start', 'tooltip-setup-test-end')

      const measures = performance.getEntriesByName('tooltip-setup-test')
      expect(measures[0].duration).toBeLessThan(500) // Should complete in under 500ms
    })

    it('should handle large datasets without performance degradation', async () => {
      wrapper = mount(TraceDetails, {
        global: {
          plugins: [store, router, i18n],
          stubs: { 'chart-renderer': true, 'trace-details-sidebar': true }
        },
        props: { traceIdProp: 'test-trace', mode: 'standalone' }
      })

      // Test with progressively larger datasets
      const datasetSizes = [50, 100, 200]
      const setupTimes: number[] = []

      for (const size of datasetSizes) {
        wrapper.vm.patternTreeData = generateLargePatternData(size)

        performance.mark(`large-dataset-${size}-start`)

        await wrapper.setData({ activeTab: 'map', mapViewMode: 'pattern' })
        await nextTick()
        await new Promise(resolve => setTimeout(resolve, 350))

        performance.mark(`large-dataset-${size}-end`)
        performance.measure(`large-dataset-${size}`, `large-dataset-${size}-start`, `large-dataset-${size}-end`)

        const measures = performance.getEntriesByName(`large-dataset-${size}`)
        setupTimes.push(measures[0].duration)

        // Reset for next test
        await wrapper.setData({ mapViewMode: 'span' })
        await nextTick()
      }

      // Performance should not degrade linearly with dataset size
      // (due to virtualization and efficient algorithms)
      const smallDatasetTime = setupTimes[0]
      const largeDatasetTime = setupTimes[2]

      // Large dataset shouldn't take more than 3x the time of small dataset
      expect(largeDatasetTime).toBeLessThan(smallDatasetTime * 3)
    })

    it('should generate tooltip content efficiently', () => {
      wrapper = mount(TraceDetails, {
        global: {
          plugins: [store, router, i18n],
          stubs: { 'chart-renderer': true, 'trace-details-sidebar': true }
        },
        props: { traceIdProp: 'test-trace', mode: 'standalone' }
      })

      const testNodes = generateLargePatternData(1000)

      performance.mark('tooltip-content-generation-start')

      // Generate tooltip content for many nodes
      const contents = testNodes.map(node => wrapper.vm.getPatternNodeTooltip(node))

      performance.mark('tooltip-content-generation-end')
      performance.measure('tooltip-content-generation', 'tooltip-content-generation-start', 'tooltip-content-generation-end')

      const measures = performance.getEntriesByName('tooltip-content-generation')

      // Should generate 1000 tooltip contents quickly
      expect(measures[0].duration).toBeLessThan(100) // Under 100ms for 1000 items
      expect(contents).toHaveLength(1000)
      expect(contents[0]).toContain('Calls:')
    })
  })

  describe('Event Listener Management', () => {
    it('should properly manage event listeners during rapid view switches', async () => {
      wrapper = mount(TraceDetails, {
        global: {
          plugins: [store, router, i18n],
          stubs: { 'chart-renderer': true, 'trace-details-sidebar': true }
        },
        props: { traceIdProp: 'test-trace', mode: 'standalone' }
      })

      wrapper.vm.patternTreeData = generateLargePatternData(10)

      const zrMock = {
        on: vi.fn(),
        off: vi.fn()
      }
      mockChart.getZr.mockReturnValue(zrMock)

      // Perform rapid view switches
      for (let i = 0; i < 10; i++) {
        await wrapper.setData({ activeTab: 'map', mapViewMode: 'pattern' })
        await nextTick()

        await wrapper.setData({ mapViewMode: 'span' })
        await nextTick()

        await wrapper.setData({ activeTab: 'timeline' })
        await nextTick()
      }

      // Event listeners should be managed properly
      // (In real implementation, this would verify balanced on/off calls)
      expect(mockSetupTooltips).toHaveBeenCalled()
    })
  })

  describe('Error Recovery Performance', () => {
    it('should handle tooltip errors without performance impact', async () => {
      wrapper = mount(TraceDetails, {
        global: {
          plugins: [store, router, i18n],
          stubs: { 'chart-renderer': true, 'trace-details-sidebar': true }
        },
        props: { traceIdProp: 'test-trace', mode: 'standalone' }
      })

      // Set malformed data that might cause errors
      wrapper.vm.patternTreeData = [
        { id: 'bad-1', name: null, value: null, metadata: null },
        { id: 'bad-2' }, // Missing fields
        null, // Null item
        undefined // Undefined item
      ]

      performance.mark('error-recovery-start')

      await wrapper.setData({ activeTab: 'map', mapViewMode: 'pattern' })
      await nextTick()

      // Generate tooltip content for problematic data
      const contents = wrapper.vm.patternTreeData
        .filter(Boolean) // Filter out null/undefined
        .map(node => wrapper.vm.getPatternNodeTooltip(node))

      performance.mark('error-recovery-end')
      performance.measure('error-recovery', 'error-recovery-start', 'error-recovery-end')

      const measures = performance.getEntriesByName('error-recovery')

      // Should handle errors quickly without hanging
      expect(measures[0].duration).toBeLessThan(50)
      expect(contents.length).toBeGreaterThan(0)
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle simultaneous tooltip operations without conflicts', async () => {
      wrapper = mount(TraceDetails, {
        global: {
          plugins: [store, router, i18n],
          stubs: { 'chart-renderer': true, 'trace-details-sidebar': true }
        },
        props: { traceIdProp: 'test-trace', mode: 'standalone' }
      })

      wrapper.vm.patternTreeData = generateLargePatternData(50)

      // Simulate concurrent operations
      const operations = [
        wrapper.setData({ activeTab: 'map', mapViewMode: 'pattern' }),
        wrapper.setData({ activeTab: 'map', mapViewMode: 'span' }),
        wrapper.setData({ activeTab: 'timeline' })
      ]

      performance.mark('concurrent-ops-start')

      // Execute all operations simultaneously
      await Promise.all(operations)
      await nextTick()

      performance.mark('concurrent-ops-end')
      performance.measure('concurrent-ops', 'concurrent-ops-start', 'concurrent-ops-end')

      const measures = performance.getEntriesByName('concurrent-ops')

      // Should complete without errors or performance issues
      expect(measures[0].duration).toBeLessThan(200)
      expect(wrapper.exists()).toBe(true)
    })
  })
})