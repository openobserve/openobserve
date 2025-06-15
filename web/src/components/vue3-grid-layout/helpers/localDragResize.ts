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
  console.log('[DEBUG] createResizeHandler called', {
    element,
    handle,
    elementType: element?.constructor?.name,
    handleType: handle?.constructor?.name,
    options
  })
  
  // Validate that we have valid DOM elements
  if (!(element instanceof HTMLElement) || !(handle instanceof HTMLElement)) {
    console.error('[DEBUG] createResizeHandler: Invalid element or handle provided', { element, handle })
    return {
      destroy() { console.log('[DEBUG] destroy called (no-op)') },
      enable() { console.log('[DEBUG] enable called (no-op)') },
      disable() { console.log('[DEBUG] disable called (no-op)') },
      isEnabled() { return false }
    }
  }

  let isResizing = false
  let startX = 0
  let startY = 0
  let startWidth = 0
  let startHeight = 0
    function onMouseDown(e: MouseEvent) {
    console.log('[DEBUG] resize onMouseDown', {
      button: e.button,
      isResizing,
      target: e.target,
      handle: handle
    })
    
    if (e.button !== 0 || isResizing) {
      console.log('[DEBUG] resize onMouseDown ignored', { button: e.button, isResizing })
      return
    }
    
    e.preventDefault()
    e.stopPropagation()
    
    isResizing = true
    startX = e.clientX
    startY = e.clientY
    
    const rect = element.getBoundingClientRect()
    startWidth = rect.width
    startHeight = rect.height
    
    console.log('[DEBUG] resize started', {
      startX,
      startY,
      startWidth,
      startHeight,
      isResizing
    })
    
    options.onStart?.(e)
      // Use capture: true to ensure we get the events even if they happen outside the element
    document.addEventListener('mousemove', onMouseMove, { passive: false, capture: true })
    document.addEventListener('mouseup', onMouseUp, { passive: false, capture: true })
    // Also listen for mouseleave on document to handle case where mouse leaves the window
    document.addEventListener('mouseleave', onMouseUp, { passive: false, capture: true })
    // Listen for visibility change to handle tab switching
    document.addEventListener('visibilitychange', onMouseUp, { passive: false, capture: true })
    // Listen for blur to handle window losing focus
    window.addEventListener('blur', onMouseUp, { passive: false, capture: true })
    
    // Prevent text selection during resize  
    document.body.style.userSelect = 'none'
    document.body.style.pointerEvents = 'none'
    handle.style.pointerEvents = 'auto'
    element.style.pointerEvents = 'auto'
  }
  function onMouseMove(e: MouseEvent) {
    if (!isResizing) {
      console.log('[DEBUG] resize onMouseMove ignored - not resizing')
      return
    }
    
    console.log('[DEBUG] resize onMouseMove', {
      clientX: e.clientX,
      clientY: e.clientY,
      startX,
      startY,
      isResizing
    })
    
    e.preventDefault()
    e.stopPropagation()
    
    const deltaX = e.clientX - startX
    const deltaY = e.clientY - startY
    
    let newWidth = startWidth + deltaX
    let newHeight = startHeight + deltaY
    
    console.log('[DEBUG] resize calculated size', {
      deltaX,
      deltaY,
      newWidth,
      newHeight,
      minWidth: options.minWidth,
      minHeight: options.minHeight
    })
    
    // Apply minimum constraints
    newWidth = Math.max(options.minWidth || 50, newWidth)
    newHeight = Math.max(options.minHeight || 50, newHeight)
    
    // Apply maximum constraints
    if (options.maxWidth && options.maxWidth !== Infinity) {
      newWidth = Math.min(newWidth, options.maxWidth)
    }
    if (options.maxHeight && options.maxHeight !== Infinity) {
      newHeight = Math.min(newHeight, options.maxHeight)
    }
    
    // Apply aspect ratio if needed
    if (options.preserveAspectRatio) {
      const aspectRatio = startWidth / startHeight
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        newHeight = newWidth / aspectRatio
      } else {
        newWidth = newHeight * aspectRatio
      }    }
    
    console.log('[DEBUG] resize final size', {
      newWidth,
      newHeight
    })
    
    // Apply the new size to the element immediately
    element.style.width = newWidth + 'px'
    element.style.height = newHeight + 'px'
    
    // Notify of the resize
    options.onResize?.(e, {
      x: newWidth - startWidth,
      y: newHeight - startHeight
    })
  }

  function onMouseUp(e: MouseEvent) {
    console.log('[DEBUG] resize onMouseUp', {
      isResizing,
      target: e.target
    })
    
    if (!isResizing) {
      console.log('[DEBUG] resize onMouseUp ignored - not resizing')
      return
    }
    
    console.log('[DEBUG] resize ending, cleaning up event listeners')
    isResizing = false
      // Remove all event listeners with capture: true
    document.removeEventListener('mousemove', onMouseMove, { capture: true })
    document.removeEventListener('mouseup', onMouseUp, { capture: true })
    document.removeEventListener('mouseleave', onMouseUp, { capture: true })
    document.removeEventListener('visibilitychange', onMouseUp, { capture: true })
    window.removeEventListener('blur', onMouseUp, { capture: true })
      // Restore default styles
    document.body.style.userSelect = ''
    document.body.style.pointerEvents = ''
    handle.style.pointerEvents = ''
    element.style.pointerEvents = ''
    
    options.onEnd?.(e)
    
    console.log('[DEBUG] resize completed')
  }
  
  // Add the mousedown listener to the handle
  console.log('[DEBUG] Adding mousedown listener to handle')
  handle.addEventListener('mousedown', onMouseDown)
    return {
    destroy() {
      console.log('[DEBUG] destroy called - removing event listeners')
      handle.removeEventListener('mousedown', onMouseDown)
      if (isResizing) {
        console.log('[DEBUG] destroy called while resizing - cleaning up')
        document.removeEventListener('mousemove', onMouseMove, { capture: true })
        document.removeEventListener('mouseup', onMouseUp, { capture: true })
        document.removeEventListener('mouseleave', onMouseUp, { capture: true })
        document.removeEventListener('visibilitychange', onMouseUp, { capture: true })
        window.removeEventListener('blur', onMouseUp, { capture: true })
        isResizing = false
        // Restore styles if interrupted
        document.body.style.userSelect = ''
        document.body.style.pointerEvents = ''
        handle.style.pointerEvents = ''
        element.style.pointerEvents = ''
      }
    },    enable() {
      console.log('[DEBUG] enable called')
      handle.addEventListener('mousedown', onMouseDown)
    },
    disable() {
      console.log('[DEBUG] disable called')
      handle.removeEventListener('mousedown', onMouseDown)
      if (isResizing) {
        console.log('[DEBUG] disable called while resizing - cleaning up')
        document.removeEventListener('mousemove', onMouseMove, { capture: true })
        document.removeEventListener('mouseup', onMouseUp, { capture: true })
        document.removeEventListener('mouseleave', onMouseUp, { capture: true })
        document.removeEventListener('visibilitychange', onMouseUp, { capture: true })
        window.removeEventListener('blur', onMouseUp, { capture: true })
        isResizing = false
        document.body.style.userSelect = ''
        document.body.style.pointerEvents = ''
        handle.style.pointerEvents = ''
        element.style.pointerEvents = ''
      }
    },
    isEnabled() { return true }
  }
}
