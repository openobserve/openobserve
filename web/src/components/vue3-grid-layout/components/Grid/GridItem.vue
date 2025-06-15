<template>
  <div ref="this$refsItem" class="vue-grid-item" :class="classObj" :style="styleObj">
    <slot :style="styleObj"></slot>
    <span v-if="resizableAndNotStatic" ref="handle" :class="resizableHandleClass"></span>
    <span v-if="showDragHandle" class="vue-draggable-handle"></span>
  </div>
</template>
<script lang="ts" setup>
import {ref, inject, computed, watch, onBeforeUnmount, onMounted, useSlots, nextTick} from "vue"
import {setTopLeft, setTopRight, setTransformRtl, setTransform, Layout} from "../../helpers/utils"
import {getControlPosition, createCoreData} from "../../helpers/draggableUtils"
import {getColsFromBreakpoint, Breakpoints} from "../../helpers/responsiveUtils"
import {getDocumentDir, EventsData} from "../../helpers/DOM"
import {createDragHandler, createResizeHandler} from "../../helpers/localDragResize"
import {Emitter} from "mitt"
import {Props, LayoutData} from "./GridLayout.vue"

import useCurrentInstance from "../../hooks/useInstance"

// Add event interface for our synthetic events
interface SyntheticEvent extends MouseEvent {
  type: string;
  dx?: number;
  dy?: number;
}

const {proxy} = useCurrentInstance()

// for parent's instance
// const thisLayout: (Props & LayoutData) | undefined = inject("thisLayout")
type Ins = (Props & LayoutData) | undefined
const thisLayout = inject('layoutInstance') as Ins
// console.log(thisLayout)

// eventBus
const eventBus = inject("eventBus") as Emitter<{
  resizeEvent?: EventsData
  dragEvent?: EventsData
  updateWidth: number
  setColNum: number
  setRowHeight: number
  setDraggable: boolean
  setResizable: boolean
  setBounded: boolean
  setTransformScale: number
  setMaxRows: number
  compact?: undefined
  directionchange: undefined
}>
// console.log(thisLayout, eventBus)

const emit = defineEmits<{
  (
    e: "container-resized",
    i: number | string,
    h: number,
    w: number,
    height: number,
    width: number
  ): void
  (e: "resize", i: number | string, h: number, w: number, height: number, width: number): void
  (e: "resized", i: number | string, h: number, w: number, height: number, width: number): void
  (e: "move", i: number | string, x: number, y: number): void
  (e: "moved", i: number | string, x: number, y: number): void
  (e: "dragging", event: MouseEvent, i: number | string): void
  (e: "dragend", event: MouseEvent, i: number | string): void
}>()

interface PropsChild {
  isDraggable?: boolean | null
  isResizable?: boolean | null
  isBounded?: boolean | null
  static?: boolean
  minH?: number
  minW?: number
  maxH?: number
  maxW?: number
  x: number
  y: number
  w: number
  h: number
  i: string | number
  dragIgnoreFrom?: string
  dragAllowFrom?: string | null
  resizeIgnoreFrom?: string
  preserveAspectRatio?: boolean
  dragOption?: {[key: string]: any}
  resizeOption?: {[key: string]: any}
}
interface Pos {
  left?: number
  right?: number
  top: number
  width: number
  height: number
}
interface WH {
  width: number
  height: number
}
// interface Placeholder {
//   x: number
//   y: number
//   w: number
//   h: number
//   i: number | string
// }

// Props Data
const props = withDefaults(defineProps<PropsChild>(), {
  isDraggable: null,
  isResizable: null,
  isBounded: null,
  static: false,
  minH: 1,
  minW: 1,
  maxH: Infinity,
  maxW: Infinity,
  dragIgnoreFrom: "a, button",
  dragAllowFrom: null,
  resizeIgnoreFrom: "a, button",
  preserveAspectRatio: false,
  dragOption: () => ({}),
  resizeOption: () => ({})
})

// item dom
const this$refsItem = ref<HTMLElement>({} as HTMLElement)
const handle = ref<HTMLElement | null>(null)

// self data
const cols = ref<number>(1)
const containerWidth = ref<number>(100)
const rowHeight = ref<number>(30)
const margin = ref<[number, number]>([10, 10])
const maxRows = ref<number>(Infinity)
const draggable = ref<boolean | null>(null)
const resizable = ref<boolean | null>(null)
const transformScale = ref<number>(1)
const useCssTransforms = ref<boolean>(true)
const useStyleCursor = ref<boolean>(true)

const isDragging = ref(false)
const dragging = ref<Pos | null>(null)
const isResizing = ref(false)
const resizing = ref<WH | null>(null)
const lastX = ref(NaN)
const lastY = ref(NaN)
const lastW = ref(NaN)
const lastH = ref(NaN)

// Global mouse event tracking
const globalMouseEventHandler = (e: MouseEvent | FocusEvent) => {
  if (isResizing.value) {
    console.log(`[GLOBAL-${props.i}] Mouse/Focus event during resize:`, {
      type: e.type,
      button: 'button' in e ? e.button : 'N/A',
      buttons: 'buttons' in e ? e.buttons : 'N/A',
      target: (e.target as HTMLElement)?.tagName,
      className: (e.target as HTMLElement)?.className,
      timeStamp: e.timeStamp,
      isTrusted: e.isTrusted,
      clientX: 'clientX' in e ? e.clientX : 'N/A',
      clientY: 'clientY' in e ? e.clientY : 'N/A',
      relatedTarget: 'relatedTarget' in e ? (e.relatedTarget as HTMLElement)?.tagName : 'N/A'
    });
    
    // Special logging for blur events
    if (e.type === 'blur') {
      console.warn(`[GLOBAL-${props.i}] BLUR event during resize - this might cause premature resize end!`, {
        target: (e.target as HTMLElement)?.tagName,
        className: (e.target as HTMLElement)?.className,
        relatedTarget: 'relatedTarget' in e ? (e.relatedTarget as HTMLElement)?.tagName : 'N/A'
      });
    }
  }
};
const styleObj = ref({} as any)
const rtl = ref(false)

const dragEventSet = ref(false)
const resizeEventSet = ref(false)

// Destructors for cleanup
const dragDestructor = ref<(() => void) | null>(null)
const resizeTimeoutId = ref<NodeJS.Timeout | null>(null)
const resizeSessionId = ref<number>(0)
const safetyTimeoutActive = ref<boolean>(false)
// Debounce timeout for tryMakeResizable to prevent excessive handler recreation
const makeResizableTimeoutId = ref<NodeJS.Timeout | null>(null)
// Debounced emission of final resize events to prevent rapid saves
const resizedEventTimeoutId = ref<NodeJS.Timeout | null>(null)
const resizeDestructor = ref<(() => void) | null>(null)

const previousW = ref<number | null>(null)
const previousH = ref<number | null>(null)
const previousX = ref<number | null>(null)
const previousY = ref<number | null>(null)
const innerX = ref<number>(props.x)
const innerY = ref<number>(props.y)
const innerW = ref<number>(props.w)
const innerH = ref<number>(props.h)

const bounded = ref<boolean | null>(null)

// computed

const resizableAndNotStatic = computed(() => {
  return resizable.value && !props.static
})
const draggableOrResizableAndNotStatic = computed(() => {
  return (draggable.value || resizable.value) && !props.static
})
const isAndroid = computed(() => {
  return navigator.userAgent.toLowerCase().indexOf("android") !== -1
})
const renderRtl = computed(() => {
  return thisLayout?.isMirrored ? !rtl.value : rtl.value
})
const showDragHandle = computed(() => {
  return draggable.value && !props.static && !props.dragAllowFrom
})
const classObj = computed(() => {
  return {
    "vue-resizable": resizableAndNotStatic.value,
    static: props.static,
    resizing: isResizing.value,
    "vue-draggable-dragging": isDragging.value,
    cssTransforms: useCssTransforms.value,
    "render-rtl": renderRtl.value,
    "disable-userselect": isDragging.value,
    "no-touch": isAndroid.value && draggableOrResizableAndNotStatic.value
  }
})

const resizableHandleClass = computed(() => {
  if (renderRtl.value) {
    return "vue-resizable-handle vue-rtl-resizable-handle"
  } else {
    return "vue-resizable-handle"
  }
})

// watch
watch(
  () => props.isDraggable,
  val => {
    draggable.value = val
  }
)
watch(
  () => props.static,  () => {
    try {
      tryMakeDraggable()
      debouncedTryMakeResizable()
    } catch (error) {
      console.error('Error in static watcher:', error)
    }
  }
)
watch(draggable, () => {
  try {
    tryMakeDraggable()
  } catch (error) {
    console.error('Error in draggable watcher:', error)
  }
})
watch(
  () => props.isResizable,
  val => {
    resizable.value = val
  }
)
watch(
  () => props.isBounded,
  val => {
    bounded.value = val
  }
)
watch([resizable, this$refsItem], async (newValues, oldValues) => {
  try {    const [newResizable, newItem] = newValues
    const [oldResizable] = oldValues || [null]
    
    console.log(`[DEBUG] Resizable watcher triggered for item ${props.i}`, {
      resizable: newResizable,
      oldResizable,
      hasItem: !!newItem,
      isResizing: isResizing.value,
      safetyTimeoutActive: safetyTimeoutActive.value,
      timeStamp: Date.now(),
      stackTrace: new Error().stack?.split('\n').slice(0, 8).join('\n')
    })

    // Skip handler recreation if safety timeout is active
    if (safetyTimeoutActive.value) {
      console.log(`[DEBUG] Skipping resizable watcher actions - safety timeout active for item ${props.i}`)
      return
    }

    // If resizing was disabled while in progress, don't force end it
    // Let the resize complete naturally to avoid conflicts with the drag handler
    if (oldResizable === true && newResizable === false && isResizing.value) {
      console.log(`[DEBUG] Resizing disabled during resize operation for item ${props.i} - will skip handler recreation`)
      // Don't call forceEndResize() - let the resize finish naturally
      // Just skip recreation of the handler since resizable is now false
      return
    }
      // Use nextTick to ensure DOM is updated
    await nextTick()
    debouncedTryMakeResizable()
  } catch (error) {
    console.error(`[DEBUG] Error in resizable watcher for item ${props.i}:`, error)
  }
})

// Watch for when the handle becomes available
watch(handle, async (newHandle, oldHandle) => {
  try {
    console.log(`[DEBUG] Handle watcher triggered for item ${props.i}`, {
      handle: newHandle,
      oldHandle,
      resizable: resizable.value,
      isResizing: isResizing.value
    })
      // If we have a new handle and resizing is enabled, set up handlers
    if (resizable.value && newHandle && !isResizing.value) {
      await nextTick()
      debouncedTryMakeResizable()
    }
  } catch (error) {
    console.error(`[DEBUG] Error in handle watcher for item ${props.i}:`, error)
  }
})
watch(rowHeight, () => {
  try {
    createStyle()
    emitContainerResized()
  } catch (error) {
    console.error('Error in rowHeight watcher:', error)
  }
})
watch(cols, () => {
  try {
    debouncedTryMakeResizable()
    createStyle()
    emitContainerResized()
  } catch (error) {
    console.error('Error in cols watcher:', error)
  }
})
watch(containerWidth, () => {
  try {
    debouncedTryMakeResizable()
    createStyle()
    emitContainerResized()
  } catch (error) {
    console.error('Error in containerWidth watcher:', error)
  }
})
watch(
  () => props.x,
  newVal => {
    innerX.value = newVal
    createStyle()
  }
)
watch(
  () => props.y,
  newVal => {
    innerY.value = newVal
    createStyle()
  }
)
watch(
  () => props.h,
  newVal => {
    innerH.value = newVal
    createStyle()
    // this.emitContainerResized();
  }
)
watch(
  () => props.w,
  newVal => {
    innerW.value = newVal
    createStyle()
    // wthis.emitContainerResized();
  }
)
watch(renderRtl, () => {
  // console.log("### renderRtl");
  try {
    debouncedTryMakeResizable()
    createStyle()
  } catch (error) {
    console.error('Error in renderRtl watcher:', error)
  }
})
watch(  () => props.minH,
  () => {
    try {
      debouncedTryMakeResizable()
    } catch (error) {
      console.error('Error in minH watcher:', error)
    }
  }
)
watch(
  () => props.maxH,  () => {
    try {
      debouncedTryMakeResizable()
    } catch (error) {
      console.error('Error in maxH watcher:', error)
    }
  }
)
watch(
  () => props.minW,
  () => {    try {
      debouncedTryMakeResizable()
    } catch (error) {
      console.error('Error in minW watcher:', error)
    }
  }
)
watch(
  () => props.maxW,
  () => {
    try {      debouncedTryMakeResizable()
    } catch (error) {
      console.error('Error in maxW watcher:', error)
    }
  }
)
watch(
  () => thisLayout?.margin,
  newMargin => {
    if (!newMargin || (newMargin[0] == margin.value[0] && newMargin[1] == margin.value[1])) {
      return
    }
    margin.value = [Number(newMargin[0]), Number(newMargin[1])]
    createStyle()
    emitContainerResized()
  }
)

//
function updateWidthHandler(width: number) {
  updateWidth(width)
}
function compactHandler(layout?: Layout) {
  selfCompact(layout)
}
function setDraggableHandler(isDraggable: boolean) {
  if (props.isDraggable === null) {
    draggable.value = isDraggable
  }
}

function setResizableHandler(isResizable: boolean) {
  if (props.isResizable === null) {
    resizable.value = isResizable
  }
}
function setBoundedHandler(isBounded: boolean) {
  if (props.isBounded === null) {
    bounded.value = isBounded
  }
}

function setTransformScaleHandler(tScale: number) {
  transformScale.value = tScale
}

function setRowHeightHandler(rHeight: number) {
  rowHeight.value = rHeight
}

function setMaxRowsHandler(mRows: number) {
  maxRows.value = mRows
}

function directionchangeHandler() {
  rtl.value = getDocumentDir() === "rtl"
  selfCompact()
}

function setColNum(colNum: number) {
  const col = colNum.toString()
  cols.value = parseInt(col)
}

// eventbus
eventBus.on("updateWidth", updateWidthHandler)
eventBus.on("compact", compactHandler)
eventBus.on("setDraggable", setDraggableHandler)
eventBus.on("setResizable", setResizableHandler)
eventBus.on("setBounded", setBoundedHandler)
eventBus.on("setTransformScale", setTransformScaleHandler)
eventBus.on("setRowHeight", setRowHeightHandler)
eventBus.on("setMaxRows", setMaxRowsHandler)
eventBus.on("directionchange", directionchangeHandler)
eventBus.on("setColNum", setColNum)

rtl.value = getDocumentDir() === "rtl"

onBeforeUnmount(() => {
  //Remove listeners
  eventBus.off("updateWidth", updateWidthHandler)
  eventBus.off("compact", compactHandler)
  eventBus.off("setDraggable", setDraggableHandler)
  eventBus.off("setResizable", setResizableHandler)
  eventBus.off("setBounded", setBoundedHandler)
  eventBus.off("setTransformScale", setTransformScaleHandler)
  eventBus.off("setRowHeight", setRowHeightHandler)
  eventBus.off("setMaxRows", setMaxRowsHandler)
  eventBus.off("directionchange", directionchangeHandler)
  eventBus.off("setColNum", setColNum)
  
  // Force end any ongoing operations
  if (isResizing.value) {
    forceEndResize()
  }
  
  if (isDragging.value) {
    isDragging.value = false
    dragging.value = null
  }
    // Clean up drag and resize handlers
  if (dragDestructor.value) {
    dragDestructor.value()
    dragDestructor.value = null
  }
  if (resizeDestructor.value) {
    resizeDestructor.value()
    resizeDestructor.value = null
  }
    // Clean up debounce timeout
  if (makeResizableTimeoutId.value) {
    clearTimeout(makeResizableTimeoutId.value)
    makeResizableTimeoutId.value = null  }  // Clean up resized event timeout
  if (resizedEventTimeoutId.value) {
    clearTimeout(resizedEventTimeoutId.value)
    resizedEventTimeoutId.value = null
  }
  
  // Clear safety timeout flag
  safetyTimeoutActive.value = false
  
  // Clean up global mouse event listeners
  document.removeEventListener('mousedown', globalMouseEventHandler);
  document.removeEventListener('mousemove', globalMouseEventHandler);
  document.removeEventListener('mouseup', globalMouseEventHandler);
  document.removeEventListener('blur', globalMouseEventHandler as EventListener);
  window.removeEventListener('blur', globalMouseEventHandler as EventListener);
  
  console.log(`[DEBUG] Removed global mouse event listeners for item ${props.i}`);
})

onMounted(() => {
  if (thisLayout?.responsive && thisLayout.lastBreakpoint) {
    cols.value = getColsFromBreakpoint(thisLayout.lastBreakpoint, thisLayout?.cols as Breakpoints)
  } else {
    cols.value = thisLayout?.colNum as number
  }
  rowHeight.value = thisLayout?.rowHeight as number
  containerWidth.value = thisLayout?.width !== null ? (thisLayout?.width as number) : 100
  margin.value = thisLayout?.margin !== undefined 
    ? [thisLayout.margin[0], thisLayout.margin[1]]
    : [10, 10]
  maxRows.value = thisLayout?.maxRows as number
  if (props.isDraggable === null) {
    draggable.value = thisLayout?.isDraggable as boolean
  } else {
    draggable.value = props.isDraggable
  }

  if (props.isResizable === null) {
    resizable.value = thisLayout?.isResizable as boolean
  } else {
    resizable.value = props.isResizable
  }  if (props.isBounded === null) {
    bounded.value = thisLayout?.isBounded as boolean
  } else {
    bounded.value = props.isBounded
  }
  transformScale.value = thisLayout?.transformScale as number
  useCssTransforms.value = thisLayout?.useCssTransforms as boolean
  useStyleCursor.value = thisLayout?.useStyleCursor as boolean
  createStyle()
    // Initialize drag and resize handlers after DOM is ready
  nextTick(() => {    tryMakeDraggable()
    debouncedTryMakeResizable()
  })
    // Add global mouse event listeners for debugging
  document.addEventListener('mousedown', globalMouseEventHandler);
  document.addEventListener('mousemove', globalMouseEventHandler);  
  document.addEventListener('mouseup', globalMouseEventHandler);
  document.addEventListener('blur', globalMouseEventHandler as EventListener);
  window.addEventListener('blur', globalMouseEventHandler as EventListener);
  
  console.log(`[DEBUG] Added global mouse event listeners for item ${props.i}`);
})
// methods
function createStyle() {
  if (props.x + props.w > cols.value) {
    innerX.value = 0
    innerW.value = props.w > cols.value ? cols.value : props.w
  } else {
    innerX.value = props.x
    innerW.value = props.w
  }
  let pos = calcPosition(innerX.value, innerY.value, innerW.value, innerH.value)

  if (isDragging.value) {
    pos.top = dragging.value?.top as number
    //                    Add rtl support
    if (renderRtl.value) {
      pos.right = dragging.value?.left as number
    } else {
      pos.left = dragging.value?.left as number
    }
  }
  if (isResizing.value) {
    pos.width = resizing.value?.width as number
    pos.height = resizing.value?.height as number
  }

  let sty
  // CSS Transforms support (default)
  if (useCssTransforms.value) {
    //                    Add rtl support
    if (renderRtl.value) {
      sty = setTransformRtl(pos.top, pos.right as number, pos.width, pos.height)
    } else {
      sty = setTransform(pos.top, pos.left as number, pos.width, pos.height)
    }
  } else {
    // top,left (slow)
    //                    Add rtl support
    if (renderRtl.value) {
      sty = setTopRight(pos.top, pos.right as number, pos.width, pos.height)
    } else {
      sty = setTopLeft(pos.top, pos.left as number, pos.width, pos.height)
    }
  }
  styleObj.value = sty
}
function emitContainerResized() {
  // this.style has width and height with trailing 'px'. The
  // resized event is without them
  let styleProps = {} as WH
  for (let prop of ["width", "height"]) {
    let val = styleObj.value[prop]
    let matches = val.match(/^(\d+)px$/)
    if (!matches) return
    styleProps[prop] = matches[1]
  }
  emit("container-resized", props.i, props.h, props.w, styleProps.height, styleProps.width)
}

function handleResize(event: SyntheticEvent) {
  console.log(`[DEBUG] handleResize called for item ${props.i}`, {
    type: event.type,
    static: props.static,
    isResizing: isResizing.value
  })
  
  if (props.static) return
  
  const newSize = {width: 0, height: 0}
  let pos
  
  switch (event.type) {    case "resizestart": {
      console.log(`[DEBUG] Resize start handler for item ${props.i}`)
        // Clear any existing timeout
      if (resizeTimeoutId.value) {
        clearTimeout(resizeTimeoutId.value)
        resizeTimeoutId.value = null
      }
      
      // Clear any pending resized event emission from previous resize
      if (resizedEventTimeoutId.value) {
        clearTimeout(resizedEventTimeoutId.value)
        resizedEventTimeoutId.value = null
        console.log(`[DEBUG] Cancelled pending resized event for item ${props.i} - new resize started`)
      }
      
      // Create new resize session
      resizeSessionId.value = Date.now()
      const currentSessionId = resizeSessionId.value
      
      previousW.value = innerW.value
      previousH.value = innerH.value
      
      pos = calcPosition(innerX.value, innerY.value, innerW.value, innerH.value)
      newSize.width = pos.width
      newSize.height = pos.height
      resizing.value = newSize
      isResizing.value = true
      
      console.log(`[DEBUG] Resize state set for item ${props.i}`, {
        isResizing: isResizing.value,
        sessionId: currentSessionId,
        newSize
      })        // Safety timeout to prevent stuck resize state (10 seconds instead of 3)
      resizeTimeoutId.value = setTimeout(() => {
        if (isResizing.value && resizeSessionId.value === currentSessionId) {
          console.warn(`[DEBUG] Safety timeout triggered for item ${props.i} - clearing stuck resize state after 10 seconds`)
          
          // Set flag to indicate safety timeout is active
          safetyTimeoutActive.value = true
          
          // Force end the resize cleanly
          isResizing.value = false
          resizing.value = null
          resizeTimeoutId.value = null
          
          // Emit a resize end event to clean up any listeners in localDragResize
          if (resizeDestructor.value) {
            try {
              resizeDestructor.value()
              resizeDestructor.value = null
            } catch (error) {
              console.error(`[DEBUG] Error cleaning up resize handler for item ${props.i}:`, error)
            }
          }
          
          // Don't emit the resized event immediately to avoid save cascade
          // The timeout cleanup should not trigger saves
          console.log(`[DEBUG] Safety timeout cleanup complete for item ${props.i} - skipping save emission`)
          
          // Clear the safety timeout flag after a brief delay
          setTimeout(() => {
            safetyTimeoutActive.value = false
          }, 100)
        }
      }, 10000) // Increased to 10 seconds
      break
    }    case "resizemove": {
      console.log(`[DEBUG] Resize move handler for item ${props.i}`, {
        isResizing: isResizing.value,
        resizable: resizable.value,
        hasItemRef: !!this$refsItem.value
      })
      
      if (!isResizing.value) {
        console.log(`[DEBUG] Resize move ignored - not in resize state for item ${props.i}`)
        return
      }
      
      // Log if we're continuing resize while resizable is false (expected during saves)
      if (!resizable.value) {
        console.log(`[DEBUG] Continuing resize despite resizable=false for item ${props.i} (expected during saves)`)
      }
      
      // Get current element size from the DOM
      const rect = this$refsItem.value.getBoundingClientRect()
      newSize.width = rect.width
      newSize.height = rect.height
      
      console.log(`[DEBUG] Current element size for item ${props.i}:`, {
        width: newSize.width,
        height: newSize.height
      })
      
      resizing.value = newSize
      
      // Convert to grid units and emit resize event
      pos = calcWH(newSize.height, newSize.width)
      pos.w = Math.max(props.minW, Math.min(pos.w, props.maxW, cols.value - innerX.value))
      pos.h = Math.max(props.minH, Math.min(pos.h, props.maxH))
      
      console.log(`[DEBUG] Grid position calculated for item ${props.i}:`, pos)
      
      // Only emit if dimensions actually changed
      if (innerW.value !== pos.w || innerH.value !== pos.h) {
        console.log(`[DEBUG] Emitting resize event for item ${props.i}`, {
          from: { w: innerW.value, h: innerH.value },
          to: { w: pos.w, h: pos.h }
        })
        
        emit("resize", props.i, pos.h, pos.w, newSize.height, newSize.width)
        
        eventBus.emit("resizeEvent", {
          eventType: event.type,
          i: props.i,
          x: innerX.value,
          y: innerY.value,
          h: pos.h,
          w: pos.w
        })
      }
      break
    }    case "resizeend": {
      console.log(`[DEBUG] Resize end handler for item ${props.i}`, {
        isResizing: isResizing.value,
        hasItemRef: !!this$refsItem.value
      })
      
      if (!isResizing.value) {
        console.log(`[DEBUG] Resize end ignored - not in resize state for item ${props.i}`)
        return
      }
      
      // Get final size from the DOM
      const rect = this$refsItem.value.getBoundingClientRect()
      newSize.width = rect.width
      newSize.height = rect.height
      
      console.log(`[DEBUG] Final element size for item ${props.i}:`, {
        width: newSize.width,
        height: newSize.height
      })
      
      // Convert pixel size to grid units
      pos = calcWH(newSize.height, newSize.width)
      
      // Apply constraints
      pos.w = Math.max(props.minW, Math.min(pos.w, props.maxW, cols.value - innerX.value))
      pos.h = Math.max(props.minH, Math.min(pos.h, props.maxH))
      
      console.log(`[DEBUG] Final grid position for item ${props.i}:`, pos)
      
      // Update internal state
      innerW.value = pos.w
      innerH.value = pos.h
        // Clear resize state and timeout
      resizing.value = null
      isResizing.value = false
      
      // Clear safety timeout if it exists
      if (resizeTimeoutId.value) {
        clearTimeout(resizeTimeoutId.value)
        resizeTimeoutId.value = null
      }
        console.log(`[DEBUG] Resize state cleared for item ${props.i}`)
      
      // Emit immediate resize event for layout updates
      emit("resize", props.i, pos.h, pos.w, newSize.height, newSize.width)
      
      // Debounce the final "resized" event to prevent immediate saves
      // This gives the user time to continue resizing if they want to
      if (resizedEventTimeoutId.value) {
        clearTimeout(resizedEventTimeoutId.value)
      }
        resizedEventTimeoutId.value = setTimeout(() => {
        console.log(`[DEBUG] Emitting delayed resized event for item ${props.i}`, {
          timeStamp: Date.now(),
          isResizing: isResizing.value,
          resizable: resizable.value,
          stackTrace: new Error().stack?.split('\n').slice(0, 5).join('\n')
        })
        emit("resized", props.i, pos.h, pos.w, newSize.height, newSize.width)
        resizedEventTimeoutId.value = null
      }, 500) // 500ms delay before triggering save

      // Update layout via event bus (immediate for visual feedback)
      eventBus.emit("resizeEvent", {
        eventType: event.type,
        i: props.i,
        x: innerX.value,
        y: innerY.value,
        h: pos.h,
        w: pos.w
      })      // Update styles to reflect new grid position
      createStyle()
      
      console.log(`[DEBUG] Resize end complete for item ${props.i}`)
      break
    }
  }
}

function handleDrag(event: SyntheticEvent) {
  if (props.static) return
  if (isResizing.value) return

  const position = getControlPosition(event, this$refsItem.value)
  if (!position) return

  const {x, y} = position
  let newPosition = {top: 0, left: 0}
  
  switch (event.type) {
    case "dragstart": {
      previousX.value = innerX.value
      previousY.value = innerY.value

      const rect = this$refsItem.value.getBoundingClientRect()
      const parentRect = (this$refsItem.value.parentElement || document.body).getBoundingClientRect()

      if (renderRtl.value) {
        newPosition.left = (rect.right - parentRect.right) * -1
      } else {
        newPosition.left = rect.left - parentRect.left
      }
      newPosition.top = rect.top - parentRect.top
      dragging.value = newPosition as Pos
      isDragging.value = true
      break
    }
    case "dragend": {
      if (!isDragging.value) return
      emit("dragend", event, props.i)

      const rect = this$refsItem.value.getBoundingClientRect()
      const parentRect = (this$refsItem.value.parentElement || document.body).getBoundingClientRect()

      if (renderRtl.value) {
        newPosition.left = (rect.right - parentRect.right) * -1
      } else {
        newPosition.left = rect.left - parentRect.left
      }
      newPosition.top = rect.top - parentRect.top
      dragging.value = null
      isDragging.value = false
      break
    }
    case "dragmove": {
      emit("dragging", event, props.i)
      const coreEvent = createCoreData(lastX.value, lastY.value, x, y)
      if (renderRtl.value) {
        newPosition.left = Number(dragging.value?.left) - coreEvent.deltaX / transformScale.value
      } else {
        newPosition.left = Number(dragging.value?.left) + coreEvent.deltaX / transformScale.value
      }
      newPosition.top = Number(dragging.value?.top) + coreEvent.deltaY / transformScale.value
      if (bounded.value) {
        const parentElement = this$refsItem.value.parentElement as HTMLElement
        const bottomBoundary =
          parentElement.clientHeight - calcGridItemWHPx(props.h, rowHeight.value, margin.value[1])
        newPosition.top = clamp(newPosition.top, 0, bottomBoundary)
        const colWidth = calcColWidth()
        const rightBoundary =
          containerWidth.value - calcGridItemWHPx(props.w, colWidth, margin.value[0])
        newPosition.left = clamp(newPosition.left, 0, rightBoundary)
      }
      dragging.value = newPosition as Pos
      break
    }
  }

  // Get new XY
  let pos
  if (renderRtl.value) {
    pos = calcXY(newPosition.top, newPosition.left)
  } else {
    pos = calcXY(newPosition.top, newPosition.left)
  }

  lastX.value = x
  lastY.value = y

  if (innerX.value !== pos.x || innerY.value !== pos.y) {
    emit("move", props.i, pos.x, pos.y)
  }
  if (
    event.type === "dragend" &&
    (previousX.value !== innerX.value || previousY.value !== innerY.value)
  ) {
    emit("moved", props.i, pos.x, pos.y)
  }
  const data = {
    eventType: event.type,
    i: props.i,
    x: pos.x,
    y: pos.y,
    h: innerH.value,
    w: innerW.value
  }
  eventBus.emit("dragEvent", data)
}
function calcPosition(x: number, y: number, w: number, h: number): Pos {
  const colWidth = calcColWidth()
  // add rtl support
  let out
  if (renderRtl.value) {
    out = {
      right: Math.round(colWidth * x + (x + 1) * margin.value[0]),
      top: Math.round(rowHeight.value * y + (y + 1) * margin.value[1]),
      // 0 * Infinity === NaN, which causes problems with resize constriants;
      // Fix this if it occurs.
      // Note we do it here rather than later because Math.round(Infinity) causes deopt
      width: w === Infinity ? w : Math.round(colWidth * w + Math.max(0, w - 1) * margin.value[0]),
      height:
        h === Infinity ? h : Math.round(rowHeight.value * h + Math.max(0, h - 1) * margin.value[1])
    }
  } else {
    out = {
      left: Math.round(colWidth * x + (x + 1) * margin.value[0]),
      top: Math.round(rowHeight.value * y + (y + 1) * margin.value[1]),
      // 0 * Infinity === NaN, which causes problems with resize constriants;
      // Fix this if it occurs.
      // Note we do it here rather than later because Math.round(Infinity) causes deopt
      width: w === Infinity ? w : Math.round(colWidth * w + Math.max(0, w - 1) * margin.value[0]),
      height:
        h === Infinity ? h : Math.round(rowHeight.value * h + Math.max(0, h - 1) * margin.value[1])
    }
  }

  return out
}
/**
 * Translate x and y coordinates from pixels to grid units.
 * @param  {Number} top  Top position (relative to parent) in pixels.
 * @param  {Number} left Left position (relative to parent) in pixels.
 * @return {Object} x and y in grid units.
 */
// TODO check if this function needs change in order to support rtl.
function calcXY(top: number, left: number) {
  const colWidth = calcColWidth()

  // left = colWidth * x + margin * (x + 1)
  // l = cx + m(x+1)
  // l = cx + mx + m
  // l - m = cx + mx
  // l - m = x(c + m)
  // (l - m) / (c + m) = x
  // x = (left - margin) / (coldWidth + margin)
  let x = Math.round((left - margin.value[0]) / (colWidth + margin.value[0]))
  let y = Math.round((top - margin.value[1]) / (rowHeight.value + margin.value[1]))

  // Capping
  x = Math.max(Math.min(x, cols.value - innerW.value), 0)
  y = Math.max(Math.min(y, maxRows.value - innerH.value), 0)

  return {x, y}
}

// Helper for generating column width
function calcColWidth() {
  const colWidth = (containerWidth.value - margin.value[0] * (cols.value + 1)) / cols.value
  // console.log("### COLS=" + this.cols + " COL WIDTH=" + colWidth + " MARGIN " + this.margin[0]);
  return colWidth
}
// This can either be called:
// calcGridItemWHPx(w, colWidth, margin[0])
// or
// calcGridItemWHPx(h, rowHeight, margin[1])
function calcGridItemWHPx(gridUnits: number, colOrRowSize: number, marginPx: number) {
  if (!Number.isFinite(gridUnits)) return gridUnits
  return Math.round(colOrRowSize * gridUnits + Math.max(0, gridUnits - 1) * marginPx)
}
// Similar to _.clamp
function clamp(num: number, lowerBound: number, upperBound: number) {
  return Math.max(Math.min(num, upperBound), lowerBound)
}
/**
 * Given a height and width in pixel values, calculate grid units.
 * @param  {Number} height Height in pixels.
 * @param  {Number} width  Width in pixels.
 * @param  {Boolean} autoSizeFlag  function autoSize identifier.
 * @return {Object} w, h as grid units.
 */
function calcWH(height: number, width: number, autoSizeFlag = false): {w: number; h: number} {
  const colWidth = calcColWidth()

  // width = colWidth * w - (margin * (w - 1))
  // ...
  // w = (width + margin) / (colWidth + margin)
  let w = Math.round((width + margin.value[0]) / (colWidth + margin.value[0]))
  let h = 0
  if (!autoSizeFlag) {
    h = Math.round((height + margin.value[1]) / (rowHeight.value + margin.value[1]))
  } else {
    h = Math.ceil((height + margin.value[1]) / (rowHeight.value + margin.value[1]))
  }

  // Capping
  w = Math.max(Math.min(w, cols.value - innerX.value), 0)
  h = Math.max(Math.min(h, maxRows.value - innerY.value), 0)
  return {w, h}
}
function updateWidth(width: number, colNum?: number) {
  containerWidth.value = width
  if (colNum !== undefined && colNum !== null) {
    cols.value = colNum
  }
}
function selfCompact(layout?: Layout) {
  const a = layout
  createStyle()
}

function tryMakeDraggable() {
  if (draggable.value && !props.static && this$refsItem.value) {
    if (typeof dragDestructor.value === 'function') {
      dragDestructor.value()
    }

    dragDestructor.value = createDragHandler(this$refsItem.value, {
      onStart: (e: MouseEvent) => {
        handleDrag({...e, type: 'dragstart'} as SyntheticEvent)
      },
      onDrag: (e: MouseEvent, delta: {x: number, y: number}) => {
        const syntheticEvent = {
          ...e,
          type: 'dragmove',
          clientX: e.clientX + delta.x,
          clientY: e.clientY + delta.y
        } as SyntheticEvent
        handleDrag(syntheticEvent)
      },
      onEnd: (e: MouseEvent) => {
        handleDrag({...e, type: 'dragend'} as SyntheticEvent)
      },
      bounds: props.isBounded && this$refsItem.value?.parentElement ? this$refsItem.value.parentElement : undefined,
      scale: transformScale.value,
      ignoreFrom: props.dragIgnoreFrom,
      allowFrom: props.dragAllowFrom || '.vue-draggable-handle', // Default to draggable handle if not specified
      grid: {
        colWidth: calcColWidth(),
        rowHeight: rowHeight.value,
        margin: [margin.value[0], margin.value[1]],
        maxRows: maxRows.value,
        cols: cols.value
      }
    }).destroy
  } else if (typeof dragDestructor.value === 'function') {
    dragDestructor.value()
    dragDestructor.value = null
  }
}

function observeForHandle(retryCount: number) {
  console.log(`[DEBUG] Starting aggressive handle search for item ${props.i}`);
  
  let attempts = 0;
  const maxAttempts = 20;
  
  const waitForHandle = () => {
    attempts++;
    console.log(`[DEBUG] Handle search attempt ${attempts}/${maxAttempts} for item ${props.i}`);
    
    // Use nextTick to ensure we're checking after any Vue renders
    nextTick(() => {
      let foundHandle: HTMLElement | null = null;
      
      // Strategy 1: Check the ref directly
      if (handle.value && handle.value instanceof HTMLElement) {
        foundHandle = handle.value;
        console.log(`[DEBUG] Found handle via ref on attempt ${attempts} for item ${props.i}`);
      }
      
      // Strategy 2: Query selector on the item element
      if (!foundHandle && this$refsItem.value) {
        const selector = '.' + resizableHandleClass.value.split(' ').join('.');
        foundHandle = this$refsItem.value.querySelector(selector) as HTMLElement;
        if (foundHandle) {
          console.log(`[DEBUG] Found handle via querySelector on attempt ${attempts} for item ${props.i}`);
        }
      }
        // Strategy 3: Global search with item matching (fallback)
      if (!foundHandle && this$refsItem.value) {
        const handleSelector = '.' + resizableHandleClass.value.split(' ').join('.');
        const allHandles = document.querySelectorAll(handleSelector);
        Array.from(allHandles).forEach(handleEl => {
          const gridItem = handleEl.closest('.vue-grid-item');
          if (gridItem === this$refsItem.value && !foundHandle) {
            foundHandle = handleEl as HTMLElement;
            console.log(`[DEBUG] Found handle via global search on attempt ${attempts} for item ${props.i}`);
          }
        });
      }
      
      if (foundHandle) {
        console.log(`[DEBUG] Handle found! Retrying makeResizable for item ${props.i}`);
        // Direct call to create the resize handler instead of recursive tryMakeResizable
        if (resizable.value && !props.static && this$refsItem.value) {
          const maximum = calcPosition(0, 0, props.maxW, props.maxH);
          const minimum = calcPosition(0, 0, props.minW, props.minH);
          
          try {            resizeDestructor.value = createResizeHandler(this$refsItem.value, foundHandle, {              onStart: (e: MouseEvent) => {
                console.log(`[DEBUG] Resize start triggered for item ${props.i}`, {
                  eventType: e.type,
                  button: e.button,
                  buttons: e.buttons,
                  target: e.target,
                  timeStamp: e.timeStamp,
                  isTrusted: e.isTrusted,
                  resizable: resizable.value
                });
                if (!resizable.value) {
                  console.log(`[DEBUG] Resize start cancelled - resizing disabled for item ${props.i}`);
                  return;
                }
                handleResize({...e, type: 'resizestart'} as SyntheticEvent);
              },              onResize: (e: MouseEvent, delta: {x: number, y: number}) => {
                // Once resize starts, only check isResizing.value, not resizable.value
                // This prevents external changes to resizable (e.g., from saves) from interrupting an active resize
                if (!isResizing.value) {
                  console.log(`[DEBUG] Resize move cancelled - not in resize state for item ${props.i}`, {
                    eventType: e.type,
                    button: e.button,
                    buttons: e.buttons,
                    timeStamp: e.timeStamp
                  });
                  return;
                }
                
                // Log every 10th move to avoid spam but capture issues
                if (Math.random() < 0.1) {
                  console.log(`[DEBUG] Resize move for item ${props.i}`, {
                    eventType: e.type,
                    button: e.button,
                    buttons: e.buttons,
                    deltaX: delta.x,
                    deltaY: delta.y,
                    timeStamp: e.timeStamp,
                    resizable: resizable.value,
                    isResizing: isResizing.value
                  });
                }
                
                handleResize({
                  ...e,
                  type: 'resizemove',
                  clientX: e.clientX,
                  clientY: e.clientY
                } as SyntheticEvent);
              },              onEnd: (e: MouseEvent) => {
                console.log(`[DEBUG] Resize END triggered for item ${props.i}`, {
                  eventType: e.type,
                  button: e.button,
                  buttons: e.buttons,
                  target: (e.target as HTMLElement)?.tagName,
                  className: (e.target as HTMLElement)?.className,
                  timeStamp: e.timeStamp,
                  isTrusted: e.isTrusted,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  resizable: resizable.value,
                  isResizing: isResizing.value,
                  stackTrace: new Error().stack?.split('\n').slice(0, 5).join('\n')
                });
                handleResize({...e, type: 'resizeend'} as SyntheticEvent);
              },
              minWidth: minimum.width,
              minHeight: minimum.height,
              maxWidth: maximum.width,
              maxHeight: maximum.height,
              preserveAspectRatio: props.preserveAspectRatio,
              scale: transformScale.value,
              grid: {
                colWidth: calcColWidth(),
                rowHeight: rowHeight.value,
                margin: [margin.value[0], margin.value[1]],
                maxRows: maxRows.value,
                cols: cols.value
              }
            }).destroy;
            
            console.log(`[DEBUG] Resize handler created successfully via observer for item ${props.i}`);
          } catch (error) {
            console.error(`[DEBUG] Error creating resize handler for item ${props.i}:`, error);
          }
        }
      } else if (attempts < maxAttempts) {
        // Continue trying with exponential backoff
        const delay = Math.min(50 * Math.pow(1.2, attempts), 500);
        setTimeout(waitForHandle, delay);
      } else {
        console.warn(`[DEBUG] Failed to find handle after ${maxAttempts} attempts for item ${props.i}`);
      }
    });
  };
  
  waitForHandle();
}

function forceEndResize() {
  if (isResizing.value) {
    console.log(`[DEBUG] Force ending resize for item ${props.i}`, {
      stackTrace: new Error().stack?.split('\n').slice(0, 10).join('\n'),
      timeStamp: Date.now(),
      resizeSessionId: resizeSessionId.value
    })
    
    // Clear resize state immediately
    isResizing.value = false
    resizing.value = null
    
    // Clear safety timeout if it exists
    if (resizeTimeoutId.value) {
      clearTimeout(resizeTimeoutId.value)
      resizeTimeoutId.value = null
    }
    
    // Emit final events if needed
    emit("resized", props.i, innerH.value, innerW.value, 0, 0)
    
    eventBus.emit("resizeEvent", {
      eventType: "resizeend",
      i: props.i,
      x: innerX.value,
      y: innerY.value,
      h: innerH.value,
      w: innerW.value
    })
    
    // Update styles to ensure clean state
    createStyle()
  }
}

// Debounced wrapper to prevent excessive handler recreation
function debouncedTryMakeResizable(retryCount = 0) {
  // Clear any existing timeout
  if (makeResizableTimeoutId.value) {
    clearTimeout(makeResizableTimeoutId.value)
  }
  
  // Set a new timeout to debounce the calls
  makeResizableTimeoutId.value = setTimeout(() => {
    makeResizableTimeoutId.value = null
    tryMakeResizable(retryCount)
  }, 10) // 10ms debounce delay
}

function tryMakeResizable(retryCount = 0) {
  console.log(`[DEBUG] tryMakeResizable called for item ${props.i}`, {
    resizable: resizable.value,
    static: props.static,
    hasItem: !!this$refsItem.value,
    retry: retryCount,
    isResizing: isResizing.value,
    safetyTimeoutActive: safetyTimeoutActive.value
  })
  
  // Skip if safety timeout is active
  if (safetyTimeoutActive.value) {
    console.log(`[DEBUG] Skipping tryMakeResizable - safety timeout active for item ${props.i}`)
    return
  }
  
  try {
    // Clean up existing handler first
    if (resizeDestructor.value) {
      resizeDestructor.value()
      resizeDestructor.value = null
    }

    // Don't create new handlers if we're in the middle of a resize operation
    // This prevents conflicts with existing handlers from localDragResize
    if (isResizing.value) {
      console.log(`[DEBUG] Skipping handler creation - resize operation in progress for item ${props.i}`)
      return
    }

    // Only create new handler if resizing is enabled and we have the required elements
    if (resizable.value && !props.static && this$refsItem.value) {
      // Get the handle element - prioritize the direct ref first
      let handleElement: HTMLElement | null = null
      
      // Try to get from ref first
      if (handle.value && handle.value instanceof HTMLElement) {
        handleElement = handle.value
      } else {
        // If not available, try querySelector as fallback
        const selector = '.' + resizableHandleClass.value.split(' ').join('.')
        handleElement = this$refsItem.value.querySelector(selector) as HTMLElement
      }      
      // Ensure we have a valid DOM element
      if (!handleElement || !(handleElement instanceof HTMLElement)) {
        // If handle not found and we haven't retried much, wait and retry
        if (retryCount < 5) { // Increased retry count for better reliability
          console.log(`[DEBUG] Handle not found for item ${props.i}, retrying in 100ms... (attempt ${retryCount + 1})`)
          setTimeout(() => {
            tryMakeResizable(retryCount + 1)
          }, 100)
          return
        }
        
        // If all retries failed, try to observe DOM changes
        if (retryCount < 10) {
          console.log(`[DEBUG] Setting up DOM observer for item ${props.i}`)
          observeForHandle(retryCount + 1)
          return
        }
          console.warn(`[DEBUG] Could not find valid resize handle element for item ${props.i} after ${retryCount} retries`)
        return
      }
      
      const maximum = calcPosition(0, 0, props.maxW, props.maxH)
      const minimum = calcPosition(0, 0, props.minW, props.minH)
        resizeDestructor.value = createResizeHandler(this$refsItem.value, handleElement, {
        onStart: (e: MouseEvent) => {
          console.log(`Resize start for item ${props.i}`)
          // Check if resizing is still enabled before starting
          if (!resizable.value) {
            console.log(`[DEBUG] Resize start cancelled - resizing disabled for item ${props.i}`)
            return
          }
          handleResize({...e, type: 'resizestart'} as SyntheticEvent)
        },
        onResize: (e: MouseEvent, delta: {x: number, y: number}) => {
          // Only check if we're in resize state - don't check resizable.value during active resize
          // as it can be temporarily disabled by saves or other operations
          if (!isResizing.value) {
            console.log(`[DEBUG] Resize move cancelled - not in resize state for item ${props.i}`)
            return
          }
          
          console.log(`[DEBUG] Processing resize move for item ${props.i}`, {
            isResizing: isResizing.value,
            resizable: resizable.value,
            deltaX: delta.x,
            deltaY: delta.y
          })
          
          handleResize({
            ...e,
            type: 'resizemove',
            clientX: e.clientX,
            clientY: e.clientY
          } as SyntheticEvent)
        },        onEnd: (e: MouseEvent) => {
          console.log(`[DEBUG] Resize end triggered for item ${props.i}`, {
            isResizing: isResizing.value,
            resizable: resizable.value,
            eventType: e.type,
            button: e.button,
            buttons: e.buttons,
            target: e.target,
            timeStamp: e.timeStamp,
            isTrusted: e.isTrusted,
            bubbles: e.bubbles,
            defaultPrevented: e.defaultPrevented
          })
          
          // Only process resize end if we were actually resizing
          if (isResizing.value) {
            handleResize({...e, type: 'resizeend'} as SyntheticEvent)
          } else {
            console.log(`[DEBUG] Resize end ignored - not in resize state for item ${props.i}`)
          }
        },
        minWidth: minimum.width,
        minHeight: minimum.height,
        maxWidth: maximum.width,
        maxHeight: maximum.height,        preserveAspectRatio: props.preserveAspectRatio,
        scale: transformScale.value,
        grid: {
          colWidth: calcColWidth(),
          rowHeight: rowHeight.value,
          margin: [margin.value[0], margin.value[1]],
          maxRows: maxRows.value,
          cols: cols.value
        }
      }).destroy
      
      console.log(`Resize handler created successfully for item ${props.i}`)
    }
  } catch (error) {
    console.error(`Error in tryMakeResizable for item ${props.i}:`, error)
  }
}

const $slots = useSlots()
function autoSize() {
  // ok here we want to calculate if a resize is needed
  previousW.value = innerW.value
  previousH.value = innerH.value

  // @ts-ignore
  let newSize = $slots?.default[0].elm.getBoundingClientRect()
  let pos = calcWH(newSize.height, newSize.width, true)
  if (pos.w < props.minW) {
    pos.w = props.minW
  }
  if (pos.w > props.maxW) {
    pos.w = props.maxW
  }
  if (pos.h < props.minH) {
    pos.h = props.minH
  }
  if (pos.h > props.maxH) {
    pos.h = props.maxH
  }

  if (pos.h < 1) {
    pos.h = 1
  }
  if (pos.w < 1) {
    pos.w = 1
  }

  // this.lastW = x; // basically, this is copied from resizehandler, but shouldn't be needed
  // this.lastH = y;

  if (innerW.value !== pos.w || innerH.value !== pos.h) {
    emit("resize", props.i, pos.h, pos.w, newSize.height, newSize.width)
  }
  if (previousW.value !== pos.w || previousH.value !== pos.h) {
    emit("resized", props.i, pos.h, pos.w, newSize.height, newSize.width)
    const data = {
      eventType: "resizeend",
      i: props.i,
      x: innerX.value,
      y: innerY.value,
      h: pos.h,
      w: pos.w
    }
    eventBus.emit("resizeEvent", data)
  }
}

defineExpose({
  autoSize,
  calcXY,
  dragging,
  ...props
})
</script>
<style>
.vue-grid-item {
  transition: all 200ms ease;
  transition-property: left, top, right;
  /* add right for rtl */
}

.vue-grid-item.no-touch {
  -ms-touch-action: none;
  touch-action: none;
}

.vue-grid-item.cssTransforms {
  transition-property: transform;
  left: 0;
  right: auto;
}

.vue-grid-item.cssTransforms.render-rtl {
  left: auto;
  right: 0;
}

.vue-grid-item.resizing {
  opacity: 0.6;
  z-index: 3;
}

.vue-grid-item.resizing > .vue-resizable-handle {
  z-index: 1000;
  border: 2px solid #007bff;
  background-color: rgba(0, 123, 255, 0.2);
}

.vue-grid-item.vue-draggable-dragging {
  transition: none;
  z-index: 3;
}

.vue-grid-item.vue-grid-placeholder {
  background: red;
  opacity: 0.2;
  transition-duration: 100ms;
  z-index: 2;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  -o-user-select: none;
  user-select: none;
}

.vue-grid-item > .vue-resizable-handle {
  position: absolute;
  width: 20px;
  height: 20px;
  bottom: 0;
  right: 0;
  background: url("data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBzdGFuZGFsb25lPSJubyI/Pg08IS0tIEdlbmVyYXRvcjogQWRvYmUgRmlyZXdvcmtzIENTNiwgRXhwb3J0IFNWRyBFeHRlbnNpb24gYnkgQVFyb24gQmVhbGwgKGh0dHA6Ly9maXJld29ya3MuYWJlYWxsLmNvbSkgLiBWZXJzaW9uOiAwLjYuMSAgLS0+DTwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+DTxzdmcgaWQ9IlVudGl0bGVkLVBhZ2UlMjAxIiB2aWV3Qm94PSIwIDAgNiA2IiBzdHlsZT0iYmFja2dyb3VuZC1jb2xvcjojZmZmZmZmMDAiIHZlcnNpb249IjEuMSINCXhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHhtbDpzcGFjZT0icHJlc2VydmUiDQl4PSIwcHgiIHk9IjBweCIgd2lkdGg9IjZweCIgaGVpZ2h0PSI2cHgiDT4NCTxnIG9wYWNpdHk9IjAuMzAyIj4NCQk8cGF0aCBkPSJNIDYgNiBMIDAgNiBMIDAgNC4yIEwgNCA0LjIgTCA0LjIgNC4yIEwgNC4yIDAgTCA2IDAgTCA2IDYgTCA2IDYgWiIgZmlsbD0iIzAwMDAwMCIvPg0JPC9nPg08L3N2Zz4=");
  background-position: bottom right;
  padding: 0 3px 3px 0;
  background-repeat: no-repeat;
  background-origin: content-box;
  box-sizing: border-box;
  cursor: se-resize;
  z-index: 10;
  border: 2px solid transparent;
  /* Make handle more visible */
  background-color: rgba(0, 0, 0, 0.05);
  border-radius: 3px;
  transition: all 0.2s ease;
}

.vue-grid-item > .vue-resizable-handle:hover {
  border: 2px solid #007bff;
  background-color: rgba(0, 123, 255, 0.1);
  transform: scale(1.1);
}

.vue-grid-item > .vue-rtl-resizable-handle {
  bottom: 0;
  left: 0;
  background: url(data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAuMDAwMDAwMDAwMDAwMDAyIiBoZWlnaHQ9IjEwLjAwMDAwMDAwMDAwMDAwMiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KIDwhLS0gQ3JlYXRlZCB3aXRoIE1ldGhvZCBEcmF3IC0gaHR0cDovL2dpdGh1Yi5jb20vZHVvcGl4ZWwvTWV0aG9kLURyYXcvIC0tPgogPGc+CiAgPHRpdGxlPmJhY2tncm91bmQ8L3RpdGxlPgogIDxyZWN0IGZpbGw9Im5vbmUiIGlkPSJjYW52YXNfYmFja2dyb3VuZCIgaGVpZ2h0PSIxMiIgd2lkdGg9IjEyIiB5PSItMSIgeD0iLTEiLz4KICA8ZyBkaXNwbGF5PSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgeT0iMCIgeD0iMCIgaGVpZ2h0PSIxMDAlIiB3aWR0aD0iMTAwJSIgaWQ9ImNhbnZhc0dyaWQiPgogICA8cmVjdCBmaWxsPSJ1cmwoI2dyaWRwYXR0ZXJuKSIgc3Ryb2tlLXdpZHRoPSIwIiB5PSIwIiB4PSIwIiBoZWlnaHQ9IjEwMCUiIHdpZHRoPSIxMDAlIi8+CiAgPC9nPgogPC9nPgogPGc+CiAgPHRpdGxlPkxheWVyIDE8L3RpdGxlPgogIDxsaW5lIGNhbnZhcz0iI2ZmZmZmZiIgY2FudmFzLW9wYWNpdHk9IjEiIHN0cm9rZS1saW5lY2FwPSJ1bmRlZmluZWQiIHN0cm9rZS1saW5lam9pbj0idW5kZWZpbmVkIiBpZD0ic3ZnXzEiIHkyPSItNzAuMTc4NDA3IiB4Mj0iMTI0LjQ2NDE3NSIgeTE9Ii0zOC4zOTI3MzciIHgxPSIxNDQuODIxMjg5IiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlPSIjMDAwIiBmaWxsPSJub25lIi8+CiAgPGxpbmUgc3Ryb2tlPSIjNjY2NjY2IiBzdHJva2UtbGluZWNhcD0idW5kZWZpbmVkIiBzdHJva2UtbGluZWpvaW49InVuZGVmaW5lZCIgaWQ9InN2Z181IiB5Mj0iOS4xMDY5NTciIHgyPSIwLjk0NzI0NyIgeTE9Ii0wLjAxODEyOCIgeDE9IjAuOTQ3MjQ3IiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz4KICA8bGluZSBzdHJva2UtbGluZWNhcD0idW5kZWZpbmVkIiBzdHJva2UtbGluZWpvaW49InVuZGVmaW5lZCIgaWQ9InN2Z183IiB5Mj0iOSIgeDI9IjEwLjA3MzUyOSIgeTE9IjkiIHgxPSItMC42NTU2NCIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2U9IiM2NjY2NjYiIGZpbGw9Im5vbmUiLz4KIDwvZz4KPC9zdmc+);
  background-position: bottom left;
  padding-left: 3px;
  background-repeat: no-repeat;
  background-origin: content-box;
  cursor: sw-resize;
  right: auto;
}

.vue-grid-item.disable-userselect {
  user-select: none;
}

.vue-draggable-handle {
  position: absolute;
  top: 0;
  left: 0;
  width: 20px;
  height: 20px;
  background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5" fill="#999999"/></svg>') no-repeat;
  background-position: bottom right;
  padding: 0 8px 8px 0;
  background-repeat: no-repeat;
  background-origin: content-box;
  box-sizing: border-box;
  cursor: move;
  z-index: 1;
}
</style>
