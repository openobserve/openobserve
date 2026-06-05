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

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createTreeVisualizationEngine, type TreeNode } from '@/utils/traces/treeVisualizationEngine'

// Mock useStore
const mockStore = {
  state: { theme: 'dark' }
}
vi.mock('vuex', () => ({
  useStore: () => mockStore
}))

describe('createTreeVisualizationEngine tooltip system', () => {
  let mockChart: any
  let mockChartDom: HTMLElement

  beforeEach(() => {
    mockChartDom = document.createElement('div')
    mockChartDom.style.width = '800px'
    mockChartDom.style.height = '600px'
    document.body.appendChild(mockChartDom)

    mockChart = {
      getDom: () => mockChartDom,
      getZr: () => ({
        on: vi.fn(),
        off: vi.fn()
      }),
      convertToPixel: vi.fn().mockReturnValue([100, 200]),
      convertFromPixel: vi.fn().mockReturnValue([50, 100]),
      getModel: () => ({
        getSeries: () => [{
          getData: () => ({
            count: () => 1,
            getItemLayout: () => ({ x: 100, y: 200 }),
            getName: () => 'test-node'
          })
        }]
      })
    }
  })

  afterEach(() => {
    document.body.removeChild(mockChartDom)
    vi.clearAllMocks()
  })

  it('should setup tooltip DOM element with correct styling', () => {
    const { setupTraceNodeTooltips } = createTreeVisualizationEngine()

    const mockData = {
      treeData: [],
      getNodeLabel: vi.fn(),
      getNodeTooltip: vi.fn().mockReturnValue('<div>Test Content</div>'),
      getNodeErrorRate: vi.fn().mockReturnValue(2.5)
    }

    const cleanup = setupTraceNodeTooltips(mockChart, mockData)

    const tooltipEl = mockChartDom.querySelector('[style*="position: absolute"]') as HTMLElement
    expect(tooltipEl).toBeTruthy()
    expect(tooltipEl?.style.display).toBe('none')
    expect(tooltipEl?.style.zIndex).toBe('9999')
    expect(tooltipEl?.style.borderRadius).toBe('8px')
    expect(tooltipEl?.style.fontSize).toBe('12px')

    cleanup()
  })

  it('should register mouse event handlers', () => {
    const { setupTraceNodeTooltips } = createTreeVisualizationEngine()

    const mockZr = mockChart.getZr()
    const mockData = {
      treeData: [],
      getNodeLabel: vi.fn(),
      getNodeTooltip: vi.fn(),
      getNodeErrorRate: vi.fn()
    }

    const cleanup = setupTraceNodeTooltips(mockChart, mockData)

    expect(mockZr.on).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(mockZr.on).toHaveBeenCalledWith('globalout', expect.any(Function))

    cleanup()

    expect(mockZr.off).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(mockZr.off).toHaveBeenCalledWith('globalout', expect.any(Function))
  })

  it('should show tooltip when node is hovered', () => {
    const { setupTraceNodeTooltips } = createTreeVisualizationEngine()

    const testNode = {
      id: 'test-node',
      name: 'Test Node',
      value: 100,
      x: 100,
      y: 200,
      children: []
    }

    const mockData = {
      treeData: [testNode],
      getNodeLabel: vi.fn(),
      getNodeTooltip: vi.fn().mockReturnValue('<div>Test Tooltip</div>'),
      getNodeErrorRate: vi.fn().mockReturnValue(1.5)
    }

    const cleanup = setupTraceNodeTooltips(mockChart, mockData)

    // Simulate mousemove event that hits the test node
    const mouseMoveHandler = mockChart.getZr().on.mock.calls.find(
      call => call[0] === 'mousemove'
    )[1]

    // Mock the node detection to return our test node
    const mockEvent = { offsetX: 100, offsetY: 200 }
    mouseMoveHandler(mockEvent)

    const tooltipEl = mockChartDom.querySelector('[style*="position: absolute"]') as HTMLElement
    expect(mockData.getNodeTooltip).toHaveBeenCalledWith(testNode)

    cleanup()
  })

  it('should hide tooltip on mouse leave', () => {
    const { setupTraceNodeTooltips } = createTreeVisualizationEngine()

    const mockData = {
      treeData: [],
      getNodeLabel: vi.fn(),
      getNodeTooltip: vi.fn(),
      getNodeErrorRate: vi.fn()
    }

    const cleanup = setupTraceNodeTooltips(mockChart, mockData)

    const mouseLeaveHandler = mockChart.getZr().on.mock.calls.find(
      call => call[0] === 'globalout'
    )[1]

    mouseLeaveHandler()

    const tooltipEl = mockChartDom.querySelector('[style*="position: absolute"]') as HTMLElement
    expect(tooltipEl?.style.display).toBe('none')

    cleanup()
  })

  it('should position tooltip correctly with edge detection', () => {
    const { setupTraceNodeTooltips } = createTreeVisualizationEngine()

    const testNode = {
      id: 'test-node',
      name: 'Test Node',
      value: 100,
      x: 750, // Near right edge
      y: 550, // Near bottom edge
      children: []
    }

    const mockData = {
      treeData: [testNode],
      getNodeLabel: vi.fn(),
      getNodeTooltip: vi.fn().mockReturnValue('<div>Edge Test</div>'),
      getNodeErrorRate: vi.fn()
    }

    const cleanup = setupTraceNodeTooltips(mockChart, mockData)

    // Get tooltip element to mock its dimensions
    const tooltipEl = mockChartDom.querySelector('[style*="position: absolute"]') as HTMLElement
    Object.defineProperty(tooltipEl, 'offsetWidth', { value: 150 })
    Object.defineProperty(tooltipEl, 'offsetHeight', { value: 80 })

    const mouseMoveHandler = mockChart.getZr().on.mock.calls.find(
      call => call[0] === 'mousemove'
    )[1]

    // Simulate mouse near edge that should trigger repositioning
    const mockEvent = { offsetX: 750, offsetY: 550 }
    mouseMoveHandler(mockEvent)

    // Should reposition to avoid overflow
    const left = parseInt(tooltipEl.style.left.replace('px', ''))
    const top = parseInt(tooltipEl.style.top.replace('px', ''))

    // Should position to the left and up when near edges
    expect(left).toBeLessThan(750) // Moved left from mouse position
    expect(top).toBeLessThan(550)  // Moved up from mouse position

    cleanup()
  })

  it('should cleanup properly', () => {
    const { setupTraceNodeTooltips } = createTreeVisualizationEngine()

    const mockData = {
      treeData: [],
      getNodeLabel: vi.fn(),
      getNodeTooltip: vi.fn(),
      getNodeErrorRate: vi.fn()
    }

    const cleanup = setupTraceNodeTooltips(mockChart, mockData)

    // Tooltip should be created
    let tooltipEl = mockChartDom.querySelector('[style*="position: absolute"]')
    expect(tooltipEl).toBeTruthy()

    cleanup()

    // Tooltip should be removed
    tooltipEl = mockChartDom.querySelector('[style*="position: absolute"]')
    expect(tooltipEl).toBeNull()

    // Event handlers should be unregistered
    expect(mockChart.getZr().off).toHaveBeenCalledTimes(2)
  })
})

describe('createTreeVisualizationEngine node detection', () => {
  let mockChart: any

  beforeEach(() => {
    mockChart = {
      convertToPixel: vi.fn(),
      getModel: () => ({
        getSeries: () => [{}] // Valid series
      })
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should find closest node within hit radius', () => {
    const engine = createTreeVisualizationEngine()
    const { findNodeAtPoint } = engine

    mockChart.convertToPixel.mockReturnValue([105, 205]) // Close to target

    const treeData = [
      {
        id: 'node1',
        name: 'Node 1',
        value: 100,
        x: 100,
        y: 200,
        children: []
      },
      {
        id: 'node2',
        name: 'Node 2',
        value: 150,
        x: 300,
        y: 400,
        children: []
      }
    ]

    const result = findNodeAtPoint(mockChart, [105, 205], treeData)
    expect(result).toBe(treeData[0]) // Should find the closest node
  })

  it('should return null when no node is within hit radius', () => {
    const engine = createTreeVisualizationEngine()
    const { findNodeAtPoint } = engine

    mockChart.convertToPixel.mockReturnValue([500, 500]) // Far from any node

    const treeData = [
      {
        id: 'node1',
        name: 'Node 1',
        value: 100,
        x: 100,
        y: 200,
        children: []
      }
    ]

    const result = findNodeAtPoint(mockChart, [500, 500], treeData)
    expect(result).toBeNull()
  })

  it('should search nested children', () => {
    const engine = createTreeVisualizationEngine()
    const { findNodeAtPoint } = engine

    mockChart.convertToPixel.mockReturnValue([155, 255]) // Close to child

    const childNode = {
      id: 'child',
      name: 'Child Node',
      value: 50,
      x: 150,
      y: 250,
      children: []
    }

    const treeData = [
      {
        id: 'parent',
        name: 'Parent Node',
        value: 100,
        x: 100,
        y: 200,
        children: [childNode]
      }
    ]

    const result = findNodeAtPoint(mockChart, [155, 255], treeData)
    expect(result).toBe(childNode) // Should find the child node
  })
})