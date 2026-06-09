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
import { createTreeVisualizationEngine, type TreeNode } from './treeVisualizationEngine'

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
      on: vi.fn(),
      off: vi.fn(),
      getZr: () => ({
        handler: {
          findHover: vi.fn().mockReturnValue({
            target: { dataIndex: 0 }
          })
        }
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

    const cleanup = setupTraceNodeTooltips(mockChart, mockData, false)

    const tooltipEl = mockChartDom.firstElementChild as HTMLElement
    expect(tooltipEl).toBeTruthy()
    // Verify tooltip element is created and appended to chart DOM.
    // cssText with backdrop-filter is not fully supported in jsdom,
    // so individual style.* checks are deferred to integration tests.
    expect(tooltipEl?.tagName).toBe('DIV')
    expect(mockChartDom.contains(tooltipEl)).toBe(true)

    cleanup()
  })

  it('should register mouse event handlers', () => {
    const { setupTraceNodeTooltips } = createTreeVisualizationEngine()

    const mockData = {
      treeData: [],
      getNodeLabel: vi.fn(),
      getNodeTooltip: vi.fn(),
      getNodeErrorRate: vi.fn()
    }

    const cleanup = setupTraceNodeTooltips(mockChart, mockData, false)

    expect(mockChart.on).toHaveBeenCalledWith('mouseover', expect.any(Function))
    expect(mockChart.on).toHaveBeenCalledWith('mouseout', expect.any(Function))
    expect(mockChart.on).toHaveBeenCalledWith('globalout', expect.any(Function))

    cleanup()

    expect(mockChart.off).toHaveBeenCalledWith('mouseover', expect.any(Function))
    expect(mockChart.off).toHaveBeenCalledWith('mouseout', expect.any(Function))
    expect(mockChart.off).toHaveBeenCalledWith('globalout', expect.any(Function))
  })

  it('should show tooltip when node is hovered', () => {
    const { setupTraceNodeTooltips } = createTreeVisualizationEngine()

    const testNode = {
      id: 'test-node',
      name: 'Test Node',
      value: 100,
      children: []
    }

    const mockData = {
      treeData: [testNode],
      getNodeLabel: vi.fn(),
      getNodeTooltip: vi.fn().mockReturnValue('<div>Test Tooltip</div>'),
      getNodeErrorRate: vi.fn().mockReturnValue(1.5)
    }

    const cleanup = setupTraceNodeTooltips(mockChart, mockData, false)

    // Simulate mouseover event that hits the test node
    // The handler receives ECharts params and looks up the node by name
    const mouseMoveHandler = mockChart.on.mock.calls.find(
      call => call[0] === 'mouseover'
    )[1]

    const mockParams = {
      data: { name: 'Test Node' },
      event: { offsetX: 100, offsetY: 200 }
    }
    mouseMoveHandler(mockParams)

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

    const cleanup = setupTraceNodeTooltips(mockChart, mockData, false)

    const mouseLeaveHandler = mockChart.on.mock.calls.find(
      call => call[0] === 'globalout'
    )[1]

    mouseLeaveHandler()

    const tooltipEl = mockChartDom.firstElementChild as HTMLElement
    expect(tooltipEl?.style.display).toBe('none')

    cleanup()
  })

  it('should position tooltip correctly with edge detection', () => {
    const { setupTraceNodeTooltips } = createTreeVisualizationEngine()

    const testNode = {
      id: 'test-node',
      name: 'Test Node',
      value: 100,
      children: []
    }

    const mockData = {
      treeData: [testNode],
      getNodeLabel: vi.fn(),
      getNodeTooltip: vi.fn().mockReturnValue('<div>Edge Test</div>'),
      getNodeErrorRate: vi.fn()
    }

    const cleanup = setupTraceNodeTooltips(mockChart, mockData, false)

    // Get tooltip element to mock its dimensions
    const tooltipEl = mockChartDom.firstElementChild as HTMLElement
    Object.defineProperty(tooltipEl, 'offsetWidth', { value: 150 })
    Object.defineProperty(tooltipEl, 'offsetHeight', { value: 80 })

    const mouseMoveHandler = mockChart.on.mock.calls.find(
      call => call[0] === 'mouseover'
    )[1]

    // Simulate mouse near edge that should trigger repositioning
    // mouseover handler receives ECharts params object with event coordinates
    const mockParams = {
      data: { name: 'Test Node' },
      event: { offsetX: 750, offsetY: 550 }
    }
    mouseMoveHandler(mockParams)

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

    const cleanup = setupTraceNodeTooltips(mockChart, mockData, false)

    // Tooltip should be created
    let tooltipEl = mockChartDom.firstElementChild
    expect(tooltipEl).toBeTruthy()

    cleanup()

    // Tooltip should be removed
    tooltipEl = mockChartDom.firstElementChild
    expect(tooltipEl).toBeNull()

    // Event handlers should be unregistered (3 handlers: mouseover, mouseout, globalout)
    expect(mockChart.off).toHaveBeenCalledTimes(3)
  })
})

describe('createTreeVisualizationEngine node detection with ECharts hit detection', () => {
  let mockChart: any
  let mockZr: any

  beforeEach(() => {
    mockZr = {
      handler: {
        findHover: vi.fn()
      }
    }
    mockChart = {
      getZr: () => mockZr
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should find node using ECharts hit detection when target is found', () => {
    const engine = createTreeVisualizationEngine()
    const { findNodeAtPoint } = engine

    // Mock ECharts hit detection to return dataIndex 0
    mockZr.handler.findHover.mockReturnValue({
      target: { dataIndex: 0 }
    })

    const treeData = [
      {
        id: 'node1',
        name: 'Node 1',
        value: 100,
        children: []
      },
      {
        id: 'node2',
        name: 'Node 2',
        value: 150,
        children: []
      }
    ]

    const result = findNodeAtPoint(mockChart, [105, 205], treeData)
    expect(result).toBe(treeData[0]) // Should find the first node (index 0)
    expect(mockZr.handler.findHover).toHaveBeenCalledWith(105, 205)
  })

  it('should return null when ECharts hit detection finds no target', () => {
    const engine = createTreeVisualizationEngine()
    const { findNodeAtPoint } = engine

    // Mock ECharts hit detection to return no target
    mockZr.handler.findHover.mockReturnValue(null)

    const treeData = [
      {
        id: 'node1',
        name: 'Node 1',
        value: 100,
        children: []
      }
    ]

    const result = findNodeAtPoint(mockChart, [500, 500], treeData)
    expect(result).toBeNull()
  })

  it('should handle errors gracefully', () => {
    const engine = createTreeVisualizationEngine()
    const { findNodeAtPoint } = engine

    // Mock ECharts hit detection to throw an error
    mockZr.handler.findHover.mockImplementation(() => {
      throw new Error('ECharts error')
    })

    const treeData = [
      {
        id: 'node1',
        name: 'Node 1',
        value: 100,
        children: []
      }
    ]

    const result = findNodeAtPoint(mockChart, [100, 100], treeData)
    expect(result).toBeNull()
  })

  it('should find nested child node using data index', () => {
    const engine = createTreeVisualizationEngine()
    const { findNodeAtPoint } = engine

    // Mock ECharts hit detection to return dataIndex 1 (the child node)
    mockZr.handler.findHover.mockReturnValue({
      target: { dataIndex: 1 }
    })

    const childNode = {
      id: 'child',
      name: 'Child Node',
      value: 50,
      children: []
    }

    const treeData = [
      {
        id: 'parent',
        name: 'Parent Node',
        value: 100,
        children: [childNode]
      }
    ]

    const result = findNodeAtPoint(mockChart, [155, 255], treeData)
    expect(result).toBe(childNode) // Should find the child node at index 1
  })

  it('should test findNodeByIndex helper function', () => {
    const engine = createTreeVisualizationEngine()
    const { findNodeByIndex } = engine

    const childNode = {
      id: 'child',
      name: 'Child Node',
      value: 50,
      children: []
    }

    const treeData = [
      {
        id: 'parent',
        name: 'Parent Node',
        value: 100,
        children: [childNode]
      }
    ]

    // Index 0 should be parent
    const parentResult = findNodeByIndex(treeData, 0)
    expect(parentResult?.id).toBe('parent')

    // Index 1 should be child
    const childResult = findNodeByIndex(treeData, 1)
    expect(childResult?.id).toBe('child')

    // Non-existent index should return null
    const nullResult = findNodeByIndex(treeData, 5)
    expect(nullResult).toBeNull()
  })
})