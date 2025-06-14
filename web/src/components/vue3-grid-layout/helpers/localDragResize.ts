import { ref } from 'vue'

interface Point {
  x: number
  y: number
}

interface DragState {
  isDragging: boolean
  startX: number
  startY: number
  lastX: number
  lastY: number
  elementStartLeft: number
  elementStartTop: number
}

interface ResizeState {
  isResizing: boolean
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  aspectRatio: number | null
}

interface GridOptions {
  colWidth: number
  rowHeight: number
  margin: [number, number]
  maxRows: number
  cols: number
}

function getElementPosition(element: HTMLElement): { left: number; top: number } {
  const rect = element.getBoundingClientRect()
  const parentRect = (element.parentElement || document.body).getBoundingClientRect()
  
  return {
    left: rect.left - parentRect.left,
    top: rect.top - parentRect.top
  }
}

export function createDragHandler(element: HTMLElement, options: {
  onStart?: (e: MouseEvent) => void
  onDrag?: (e: MouseEvent, delta: Point) => void
  onEnd?: (e: MouseEvent) => void
  bounds?: HTMLElement
  scale?: number
  ignoreFrom?: string
  allowFrom?: string | null
  grid?: GridOptions
}) {
  const state = ref<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    elementStartLeft: 0,
    elementStartTop: 0
  })

  function shouldIgnore(e: MouseEvent): boolean {
    if (!options.ignoreFrom && !options.allowFrom) return false
    
    const target = e.target as HTMLElement
    
    // If allowFrom is specified, only allow dragging from matching elements
    if (options.allowFrom) {
      return !target.closest(options.allowFrom)
    }
    
    // Otherwise check ignoreFrom
    if (options.ignoreFrom) {
      return !!target.closest(options.ignoreFrom)
    }
    
    return false
  }

  function snapToGrid(position: Point): Point {
    if (!options.grid) return position

    const { colWidth, rowHeight, margin, maxRows, cols } = options.grid
    
    // Calculate grid position
    const gridX = Math.round((position.x - margin[0]) / (colWidth + margin[0]))
    const gridY = Math.round((position.y - margin[1]) / (rowHeight + margin[1]))
    
    // Clamp to grid bounds
    const snappedX = Math.max(0, Math.min(gridX, cols - 1))
    const snappedY = Math.max(0, Math.min(gridY, maxRows - 1))
    
    // Convert back to pixels
    return {
      x: snappedX * (colWidth + margin[0]) + margin[0],
      y: snappedY * (rowHeight + margin[1]) + margin[1]
    }
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0 || shouldIgnore(e)) return // Only handle left mouse button
    
    e.preventDefault()
    const scale = options.scale || 1
    const position = getElementPosition(element)

    state.value = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      elementStartLeft: position.left,
      elementStartTop: position.top
    }

    options.onStart?.(e)

    function onMouseMove(e: MouseEvent) {
      if (!state.value.isDragging) return

      const rawDeltaX = (e.clientX - state.value.lastX) / scale
      const rawDeltaY = (e.clientY - state.value.lastY) / scale

      let newLeft = state.value.elementStartLeft + (e.clientX - state.value.startX) / scale
      let newTop = state.value.elementStartTop + (e.clientY - state.value.startY) / scale

      if (options.bounds) {
        const bounds = options.bounds.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        
        if (newLeft < 0) newLeft = 0
        if (newTop < 0) newTop = 0
        if (newLeft + elementRect.width > bounds.width) {
          newLeft = bounds.width - elementRect.width
        }
        if (newTop + elementRect.height > bounds.height) {
          newTop = bounds.height - elementRect.height
        }
      }

      // Snap to grid if grid options provided
      if (options.grid) {
        const snapped = snapToGrid({ x: newLeft, y: newTop })
        newLeft = snapped.x
        newTop = snapped.y
      }

      const deltaX = newLeft - state.value.elementStartLeft
      const deltaY = newTop - state.value.elementStartTop

      options.onDrag?.(e, { x: deltaX, y: deltaY })
      
      state.value.lastX = e.clientX
      state.value.lastY = e.clientY
      state.value.elementStartLeft = newLeft
      state.value.elementStartTop = newTop
    }

    function onMouseUp(e: MouseEvent) {
      if (!state.value.isDragging) return
      
      state.value.isDragging = false
      options.onEnd?.(e)
      
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  element.addEventListener('mousedown', onMouseDown)

  return {
    destroy() {
      element.removeEventListener('mousedown', onMouseDown)
    }
  }
}

export function createResizeHandler(element: HTMLElement, handle: HTMLElement, options: {
  onStart?: (e: MouseEvent) => void
  onResize?: (e: MouseEvent, delta: Point) => void
  onEnd?: (e: MouseEvent) => void
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  preserveAspectRatio?: boolean
  scale?: number
  grid?: GridOptions
}) {
  const state = ref<ResizeState>({
    isResizing: false,
    startX: 0,
    startY: 0,
    startWidth: 0,
    startHeight: 0,
    aspectRatio: null
  })

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return // Only handle left mouse button
    
    e.preventDefault()
    e.stopPropagation() // Prevent drag handler from activating
    
    const scale = options.scale || 1
    const rect = element.getBoundingClientRect()
    
    state.value = {
      isResizing: true,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      aspectRatio: options.preserveAspectRatio ? rect.width / rect.height : null
    }

    options.onStart?.(e)

    function onMouseMove(e: MouseEvent) {
      if (!state.value.isResizing) return

      const deltaX = (e.clientX - state.value.startX) / scale
      const deltaY = (e.clientY - state.value.startY) / scale

      let newWidth = state.value.startWidth + deltaX
      let newHeight = state.value.startHeight + deltaY

      // Apply min/max constraints
      newWidth = Math.max(options.minWidth || 0, newWidth)
      newHeight = Math.max(options.minHeight || 0, newHeight)
      if (options.maxWidth) newWidth = Math.min(newWidth, options.maxWidth)
      if (options.maxHeight) newHeight = Math.min(newHeight, options.maxHeight)

      // Handle aspect ratio
      if (state.value.aspectRatio) {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          newHeight = newWidth / state.value.aspectRatio
        } else {
          newWidth = newHeight * state.value.aspectRatio
        }
      }

      // Snap to grid if grid options provided
      if (options.grid) {
        const { colWidth, rowHeight, margin } = options.grid
        
        // Calculate grid units
        const gridW = Math.round((newWidth + margin[0]) / (colWidth + margin[0]))
        const gridH = Math.round((newHeight + margin[1]) / (rowHeight + margin[1]))
        
        // Convert back to pixels
        newWidth = gridW * (colWidth + margin[0]) - margin[0]
        newHeight = gridH * (rowHeight + margin[1]) - margin[1]
      }

      options.onResize?.(e, {
        x: newWidth - state.value.startWidth,
        y: newHeight - state.value.startHeight
      })
    }

    function onMouseUp(e: MouseEvent) {
      if (!state.value.isResizing) return
      
      state.value.isResizing = false
      options.onEnd?.(e)
      
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  handle.addEventListener('mousedown', onMouseDown)

  return {
    destroy() {
      handle.removeEventListener('mousedown', onMouseDown)
    }
  }
}

export function createCoreData(lastX: number, lastY: number, x: number, y: number) {
  const isStart = !isFinite(lastX)
  
  if (isStart) {
    return {
      deltaX: 0,
      deltaY: 0,
      lastX: x,
      lastY: y,
      x,
      y
    }
  }
  
  return {
    deltaX: x - lastX,
    deltaY: y - lastY,
    lastX,
    lastY,
    x,
    y
  }
}
