// Get {x, y} positions from event.
export function getControlPosition(e: MouseEvent, element: HTMLElement) {
  const elementRect = element.getBoundingClientRect()
  const parentElement = element.parentElement || document.body
  const parentRect = parentElement.getBoundingClientRect()
  
  const scrollLeft = parentElement.scrollLeft || 0
  const scrollTop = parentElement.scrollTop || 0

  return {
    x: e.clientX - parentRect.left + scrollLeft,
    y: e.clientY - parentRect.top + scrollTop
  }
}

export interface Point {
  x: number
  y: number
}

export interface DraggableCoreData {
  deltaX: number
  deltaY: number
  lastX: number
  lastY: number
  x: number
  y: number
}

// Create an data object exposed by <DraggableCore>'s events
export function createCoreData(
  lastX: number,
  lastY: number,
  x: number,
  y: number
): DraggableCoreData {
  // State changes are often (but not always!) async. We want the latest value.
  const isStart = !isNum(lastX)

  if (isStart) {
    // If this is our first move, use the x and y as last coords.
    return {
      deltaX: 0,
      deltaY: 0,
      lastX: x,
      lastY: y,
      x,
      y
    }
  } else {
    // Otherwise calculate proper values.
    return {
      deltaX: x - lastX,
      deltaY: y - lastY,
      lastX,
      lastY,
      x,
      y
    }
  }
}

function isNum(num: number) {
  return typeof num === "number" && !isNaN(num)
}
