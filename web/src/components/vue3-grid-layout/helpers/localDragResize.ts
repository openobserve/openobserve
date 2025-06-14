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
  lastX: number
  lastY: number
  startWidth: number
  startHeight: number
  aspectRatio: number | null
  gridPosition: { x: number, y: number }
  accumulatedError: { x: number, y: number }
}

interface GridOptions {
  colWidth: number
  rowHeight: number
  margin: [number, number]
  maxRows: number
  cols: number
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
    if (e.button !== 0 || shouldIgnore(e)) return
    
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

    const onMouseMove = (e: MouseEvent) => {
      if (!state.value.isDragging) return

      // Calculate movement relative to last position
      const moveX = (e.clientX - state.value.lastX)
      const moveY = (e.clientY - state.value.lastY)

      // Update position using incremental movement
      let newLeft = state.value.elementStartLeft + (moveX / scale)
      let newTop = state.value.elementStartTop + (moveY / scale)

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

      if (options.grid) {
        const snapped = snapToGrid({ x: newLeft, y: newTop })
        newLeft = snapped.x
        newTop = snapped.y
      }

      // Calculate final movement delta
      const finalDeltaX = newLeft - state.value.elementStartLeft
      const finalDeltaY = newTop - state.value.elementStartTop

      options.onDrag?.(e, { x: finalDeltaX, y: finalDeltaY })

      // Update state for next movement
      state.value.lastX = e.clientX
      state.value.lastY = e.clientY
      state.value.elementStartLeft = newLeft
      state.value.elementStartTop = newTop
    }

    const onMouseUp = (e: MouseEvent) => {
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
  let isEnabled = true
  let activeListeners: { type: string, listener: (e: MouseEvent) => void }[] = []

  const state = ref<ResizeState>({
    isResizing: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startWidth: 0,
    startHeight: 0,
    aspectRatio: null,
    gridPosition: { x: 0, y: 0 },
    accumulatedError: { x: 0, y: 0 }
  })

  function resetState() {
    state.value = {
      ...state.value,
      isResizing: false,
      gridPosition: { x: 0, y: 0 },
      accumulatedError: { x: 0, y: 0 }
    }
  }

  function removeActiveListeners() {
    activeListeners.forEach(({ type, listener }) => {
      document.removeEventListener(type, listener)
    })
    activeListeners = []
  }

  function onMouseDown(e: MouseEvent) {
    if (!isEnabled || e.button !== 0) return
    
    e.preventDefault()
    e.stopPropagation()
    
    const scale = options.scale || 1
    const rect = element.getBoundingClientRect()

    state.value = {
      isResizing: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      aspectRatio: options.preserveAspectRatio ? rect.width / rect.height : null,
      gridPosition: { x: 0, y: 0 },
      accumulatedError: { x: 0, y: 0 }
    }

    options.onStart?.(e)

    const onMouseMove = (e: MouseEvent) => {
      if (!state.value.isResizing || !isEnabled) return

      // Calculate incremental movement
      const moveX = (e.clientX - state.value.lastX)
      const moveY = (e.clientY - state.value.lastY)

      // Calculate accumulated movement from start
      const totalMoveX = (e.clientX - state.value.startX)
      const totalMoveY = (e.clientY - state.value.startY)

      // Update size based on total movement
      let newWidth = state.value.startWidth + (totalMoveX / scale)
      let newHeight = state.value.startHeight + (totalMoveY / scale)

      // Apply min/max constraints
      newWidth = Math.max(options.minWidth || 0, newWidth)
      newHeight = Math.max(options.minHeight || 0, newHeight)
      if (options.maxWidth) newWidth = Math.min(newWidth, options.maxWidth)
      if (options.maxHeight) newHeight = Math.min(newHeight, options.maxHeight)

      // Handle aspect ratio based on current movement direction
      if (state.value.aspectRatio) {
        if (Math.abs(moveX) > Math.abs(moveY)) {
          newHeight = newWidth / state.value.aspectRatio
        } else {
          newWidth = newHeight * state.value.aspectRatio
        }
      }

      if (options.grid) {
        const { colWidth, rowHeight, margin } = options.grid

        // Calculate grid sizes
        const gridWidth = (newWidth + margin[0]) / (colWidth + margin[0])
        const gridHeight = (newHeight + margin[1]) / (rowHeight + margin[1])
        
        // Track fractional changes
        const fractionalX = gridWidth - Math.floor(gridWidth)
        const fractionalY = gridHeight - Math.floor(gridHeight)
        
        state.value.accumulatedError.x += fractionalX
        state.value.accumulatedError.y += fractionalY
        
        // Snap to grid
        let finalGridWidth = Math.floor(gridWidth)
        let finalGridHeight = Math.floor(gridHeight)
        
        if (state.value.accumulatedError.x >= 0.5) {
          finalGridWidth++
          state.value.accumulatedError.x -= 1
        }
        if (state.value.accumulatedError.y >= 0.5) {
          finalGridHeight++
          state.value.accumulatedError.y -= 1
        }
        
        // Convert back to pixels
        newWidth = Math.max(colWidth, finalGridWidth * (colWidth + margin[0]) - margin[0])
        newHeight = Math.max(rowHeight, finalGridHeight * (rowHeight + margin[1]) - margin[1])
      }

      // Update for next movement and notify
      state.value.lastX = e.clientX
      state.value.lastY = e.clientY
      
      options.onResize?.(e, {
        x: newWidth - state.value.startWidth,
        y: newHeight - state.value.startHeight
      })
    }

    const onMouseUp = (e: MouseEvent) => {
      if (!state.value.isResizing) return
      
      resetState()
      state.value.isResizing = false
      options.onEnd?.(e)
      removeActiveListeners()
    }

    // Properly bind and track listeners
    const boundOnMouseMove = onMouseMove.bind(null)
    const boundOnMouseUp = onMouseUp.bind(null)
    
    document.addEventListener('mousemove', boundOnMouseMove)
    document.addEventListener('mouseup', boundOnMouseUp)
    
    activeListeners = [
      { type: 'mousemove', listener: boundOnMouseMove },
      { type: 'mouseup', listener: boundOnMouseUp }
    ]
  }

  function enable() {
    if (!isEnabled) {
      handle.addEventListener('mousedown', onMouseDown)
      isEnabled = true
    }
  }

  function disable() {
    if (isEnabled) {
      handle.removeEventListener('mousedown', onMouseDown)
      if (state.value.isResizing) {
        state.value.isResizing = false
        removeActiveListeners()
      }
      isEnabled = false
      resetState()
    }
  }

  // Initial setup
  enable()

  return {
    destroy() { disable() },
    enable() { if (!isEnabled) enable() },
    disable() { if (isEnabled) disable() },
    isEnabled() { return isEnabled }
  }
}
