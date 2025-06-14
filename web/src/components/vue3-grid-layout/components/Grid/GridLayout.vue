<template>
  <div ref="this$refsLayout" class="vue-grid-layout" :style="mergeStyle">
    <slot></slot>
    <GridItem
      v-show="isDragging"
      ref="defaultGridItem"
      class="vue-grid-placeholder"
      :x="placeholder.x"
      :y="placeholder.y"
      :w="placeholder.w"
      :h="placeholder.h"
      :i="placeholder.i"
    ></GridItem>
  </div>
</template>
<script lang="ts">
export default {
  name: "GridLayout"
}
</script>
<script lang="ts" setup>
export interface Placeholder {
  x: number
  y: number
  w: number
  h: number
  i: number | string
}
export interface Props {
  autoSize?: boolean
  colNum?: number
  rowHeight?: number
  maxRows?: number
  margin?: Array<number>
  isDraggable?: boolean
  isResizable?: boolean
  isMirrored?: boolean
  isBounded?: boolean
  useCssTransforms?: boolean
  verticalCompact?: boolean
  restoreOnDrag?: boolean
  layout: Layout
  responsive?: boolean
  responsiveLayouts?: {[key: string]: any}
  transformScale?: number
  breakpoints?: {lg: number; md: number; sm: number; xs: number; xxs: number}
  cols?: {lg: number; md: number; sm: number; xs: number; xxs: number}
  preventCollision?: boolean
  useStyleCursor?: boolean
}
export interface LayoutData {
  width: number | null
  mergeStyle: {[key: string]: string}
  lastLayoutLength: number
  isDragging: boolean
  placeholder: Placeholder
  layouts: {[key: string]: Layout | any}
  lastBreakpoint: string | null
  originalLayout: Layout | null
  erd: elementResizeDetectorMaker.Erd | null
  positionsBeforeDrag: {[key: string]: string}
  this$refsLayout: HTMLElement
}
import {ref, onMounted, onBeforeUnmount, provide, onBeforeMount, nextTick, watch} from "vue"
import mitt, {Emitter, EventType} from "mitt"

import GridItem from "./GridItem.vue"

import elementResizeDetectorMaker from "element-resize-detector"
import {
  bottom,
  compact,
  getLayoutItem,
  moveElement,
  validateLayout,
  cloneLayout,
  getAllCollisions,
  Layout,
  LayoutItem
} from "../../helpers/utils"
import {
  getBreakpointFromWidth,
  getColsFromBreakpoint,
  findOrGenerateResponsiveLayout
} from "../../helpers/responsiveUtils"

import {addWindowEventListener, removeWindowEventListener, EventsData} from "../../helpers/DOM"
// import useCurrentInstance from "@/hooks/useInstance"

// const {proxy} = useCurrentInstance()

// Props Data
const props = withDefaults(defineProps<Props>(), {
  autoSize: true,
  colNum: 12,
  rowHeight: 100,
  maxRows: Infinity,
  margin: () => [10, 10],
  isDraggable: true,
  isResizable: true,
  isMirrored: false,
  isBounded: false,
  useCssTransforms: true,
  verticalCompact: true,
  restoreOnDrag: false,
  responsive: false,
  responsiveLayouts: () => ({}),
  transformScale: 1,
  breakpoints: () => ({lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0}),
  cols: () => ({lg: 12, md: 10, sm: 6, xs: 4, xxs: 2}),
  preventCollision: false,
  useStyleCursor: true
})

// self data
const width = ref<number | null>(null)
const mergeStyle = ref<{[key: string]: string}>({})
// console.log(mergeStyle)

const lastLayoutLength = ref<number>(0)
const isDragging = ref<boolean>(false)
const placeholder = ref<Placeholder>({x: 0, y: 0, w: 0, h: 0, i: -1})
const layouts = ref<{[key: string]: Layout | any}>({}) // array to store all layouts from different breakpoints
const lastBreakpoint = ref<string | null>(null) // store last active breakpoint
const originalLayout = ref<Layout | null>(null)
const erd = ref<elementResizeDetectorMaker.Erd | null>(null)
const positionsBeforeDrag = ref<{[key: string]: string}>()
// layout dom
const this$refsLayout = ref<HTMLElement>({} as HTMLElement)
// default grid item
const defaultGridItem = ref()
const eventBus: Emitter<{
  resizeEvent?: EventsData
  dragEvent?: EventsData
  updateWidth: number | null
  setColNum: number
  setRowHeight: number
  setDraggable: boolean
  setResizable: boolean
  setBounded: boolean
  setTransformScale: number
  setMaxRows: number
  compact: void
}> = mitt()

provide("eventBus", eventBus)
// provide("thisLayout", proxy)
// Add layoutInstance provide
const layoutInstance: Props & LayoutData = {
  autoSize: props.autoSize,
  colNum: props.colNum,
  rowHeight: props.rowHeight,
  maxRows: props.maxRows,
  margin: props.margin,
  isDraggable: props.isDraggable,
  isResizable: props.isResizable,
  isMirrored: props.isMirrored,
  isBounded: props.isBounded,
  useCssTransforms: props.useCssTransforms,
  verticalCompact: props.verticalCompact,
  restoreOnDrag: props.restoreOnDrag,
  responsive: props.responsive,
  responsiveLayouts: props.responsiveLayouts,
  transformScale: props.transformScale,
  breakpoints: props.breakpoints,
  cols: props.cols,
  preventCollision: props.preventCollision,
  useStyleCursor: props.useStyleCursor,
  layout: props.layout,
  width: width.value,
  mergeStyle: mergeStyle.value,
  lastLayoutLength: lastLayoutLength.value,
  isDragging: isDragging.value,
  placeholder: placeholder.value,
  layouts: layouts.value,
  lastBreakpoint: lastBreakpoint.value,
  originalLayout: originalLayout.value,
  erd: erd.value,
  positionsBeforeDrag: positionsBeforeDrag.value,
  this$refsLayout: this$refsLayout.value
}

provide("layoutInstance", layoutInstance)
// add listen
const emit = defineEmits<{
  (e: "layout-created", layout: Layout): void
  (e: "layout-before-mount", layout: Layout): void
  (e: "layout-mounted", layout: Layout): void
  (e: "layout-updated", layout: Layout): void
  (e: "layout-ready", layout: Layout): void
  (e: "update:layout", layout: Layout): void
  (e: "breakpoint-changed", newBreakpoint: string, layout: Layout): void
}>()

// Accessible references of functions for removing in beforeDestroy
function resizeEventHandler(data?: EventsData) {
  if (!data) {
    resizeEvent()
  } else {
    const {eventType, i, x, y, h, w} = data
    resizeEvent(eventType, i, x, y, h, w)
  }
}

function dragEventHandler(data?: EventsData) {
  if (!data) {
    dragEvent()
  } else {
    const {eventType, i, x, y, h, w} = data
    dragEvent(eventType, i, x, y, h, w)
  }
}

eventBus.on("resizeEvent", resizeEventHandler)
eventBus.on("dragEvent", dragEventHandler)
emit("layout-created", props.layout)

onBeforeUnmount(() => {
  eventBus.off("resizeEvent", resizeEventHandler)
  eventBus.off("dragEvent", dragEventHandler)
  removeWindowEventListener("resize", onWindowResize)
  
  // Properly uninstall and cleanup erd listeners
  if (erd.value && this$refsLayout.value) {
    erd.value.uninstall(this$refsLayout.value)
    erd.value = null
  }
  
  // Clean up refs 
  this$refsLayout.value = null
  originalLayout.value = null
  placeholder.value = {x: 0, y: 0, w: 0, h: 0, i: -1}
  layouts.value = {}
})

onBeforeMount(() => {
  emit("layout-before-mount", props.layout)
})
onMounted(async () => {
  try {
    emit("layout-mounted", props.layout)
    validateLayout(props.layout)

    originalLayout.value = props.layout
    await nextTick()

    if (erd.value === null) {
      erd.value = elementResizeDetectorMaker({
        strategy: "scroll",
        callOnAdd: false,
      })
    }
    
    if (!erd.value || !this$refsLayout.value) {
      throw new Error("Failed to initialize resize detector")
    }
    
    // Add resize detector with error handling
    try {
      erd.value.listenTo(
        this$refsLayout.value,
        () => {
          if (!this$refsLayout.value) return
          width.value = this$refsLayout.value.offsetWidth
        }
      )
    } catch (err) {
      console.error("Failed to add resize listener:", err)
      // Cleanup partial initialization
      if (erd.value && this$refsLayout.value) {
        erd.value.uninstall(this$refsLayout.value)
        erd.value = null
      }
      return
    }
    
    // Initial width
    width.value = this$refsLayout.value.offsetWidth
    
    // Add window resize handler
    window.addEventListener("resize", onWindowResize)
    
    compact(props.layout, props.verticalCompact)
    emit("layout-ready", props.layout)
  } catch (err) {
    console.error("Error during GridLayout initialization:", err)
  }
})

watch(width, (newVal, oldVal) => {
  nextTick(() => {
    eventBus.emit("updateWidth", newVal)
    if (oldVal === null) {
      /*
        If oldval == null is when the width has never been
        set before. That only occurs when mouting is
        finished, and onWindowResize has been called and
        this.width has been changed the first time after it
        got set to null in the constructor. It is now time
        to issue layout-ready events as the GridItems have
        their sizes configured properly.

        The reason for emitting the layout-ready events on
        the next tick is to allow for the newly-emitted
        updateWidth event (above) to have reached the
        children GridItem-s and had their effect, so we're
        sure that they have the final size before we emit
        layout-ready (for this GridLayout) and
        item-layout-ready (for the GridItem-s).

        This way any client event handlers can reliably
        invistigate stable sizes of GridItem-s.
      */
      nextTick(() => {
        emit("layout-ready", props.layout)
      })
    }
    updateHeight()
  })
})
watch(
  () => props.layout,
  () => {
    layoutUpdate()
  }
)
watch(
  () => props.layout.length,
  () => {
    layoutUpdate()
  }
)

watch(
  () => props.colNum,
  val => {
    eventBus.emit("setColNum", val)
  }
)
watch(
  () => props.rowHeight,
  val => {
    eventBus.emit("setRowHeight", val)
  }
)
watch(
  () => props.isDraggable,
  val => {
    eventBus.emit("setDraggable", val)
  }
)
watch(
  () => props.isResizable,
  val => {
    eventBus.emit("setResizable", val)
  }
)
watch(
  () => props.isBounded,
  val => {
    eventBus.emit("setBounded", val)
  }
)

watch(
  () => props.transformScale,
  val => {
    eventBus.emit("setTransformScale", val)
  }
)
watch(
  () => props.responsive,
  val => {
    if (!val) {
      emit("update:layout", originalLayout.value || [])
      eventBus.emit("setColNum", props.colNum)
    }
    onWindowResize()
  }
)
watch(
  () => props.maxRows,
  val => {
    eventBus.emit("setMaxRows", val)
  }
)
watch(
  () => props.margin,
  () => {
    updateHeight()
  }
)

// methods
function layoutUpdate() {
  if (props.layout !== undefined && originalLayout.value !== null) {
    if (props.layout.length !== originalLayout.value.length) {
      // console.log("### LAYOUT UPDATE!", this.layout.length, this.originalLayout.length);

      let diff = findDifference(props.layout, originalLayout.value)
      if (diff.length > 0) {
        // console.log(diff);
        if (props.layout.length > originalLayout.value.length) {
          originalLayout.value = originalLayout.value.concat(diff)
        } else {
          originalLayout.value = originalLayout.value.filter(obj => {
            return !diff.some(obj2 => {
              return obj.i === obj2.i
            })
          })
        }
      }

      lastLayoutLength.value = props.layout.length
      initResponsiveFeatures()
    }

    compact(props.layout, props.verticalCompact)
    eventBus.emit("updateWidth", width.value)
    updateHeight()
    emit("layout-updated", props.layout)
  }
}
function updateHeight() {
  mergeStyle.value = {
    height: containerHeight()
  }
}

function onWindowResize() {
  if (this$refsLayout.value !== null && this$refsLayout.value !== undefined) {
    width.value = this$refsLayout.value.offsetWidth
  }
  eventBus.emit("resizeEvent")
}
function containerHeight(): string {
  if (!props.autoSize) return ""
  // console.log("bottom: " + bottom(this.layout))
  // console.log("rowHeight + margins: " + (this.rowHeight + this.margin[1]) + this.margin[1])
  const containerHeight =
    bottom(props.layout) * (props.rowHeight + props.margin[1]) + props.margin[1] + "px"
  return containerHeight
}

function dragEvent(
  eventName?: EventType,
  id?: string | number,
  x?: number,
  y?: number,
  h?: number,
  w?: number
) {
  //console.log(eventName + " id=" + id + ", x=" + x + ", y=" + y);
  let l = getLayoutItem(props.layout, id)

  //GetLayoutItem sometimes returns null object
  if (l === undefined || l === null) {
    l = {x: 0, y: 0} as LayoutItem
  }

  if (eventName === "dragstart" && !props.verticalCompact) {
    positionsBeforeDrag.value = props.layout.reduce(
      (result, {i, x, y}) => ({
        ...result,
        [i]: {x, y}
      }),
      {}
    )
  }

  if (eventName === "dragmove" || eventName === "dragstart") {
    placeholder.value.i = id as string | number
    placeholder.value.x = l.x as number
    placeholder.value.y = l.y as number
    placeholder.value.w = w as number
    placeholder.value.h = h as number
    nextTick(function () {
      isDragging.value = true
    })
    //this.$broadcast("updateWidth", this.width);
    eventBus.emit("updateWidth", width.value)
  } else {
    nextTick(function () {
      isDragging.value = false
    })
  }

  // Move the element to the dragged location.
  // this.layout = moveElement(this.layout, l, x, y, true, this.preventCollision)
  const layout = moveElement(props.layout, l, x, y, true, props.preventCollision)
  emit("update:layout", layout)

  if (props.restoreOnDrag) {
    // Do not compact items more than in layout before drag
    // Set moved item as static to avoid to compact it
    l.static = true
    compact(props.layout, props.verticalCompact, positionsBeforeDrag.value)
    l.static = false
  } else {
    compact(props.layout, props.verticalCompact)
  }

  // needed because vue can't detect changes on array element properties
  eventBus.emit("compact")
  updateHeight()
  if (eventName === "dragend") {
    positionsBeforeDrag.value = undefined
    emit("layout-updated", layout)
  }
}
function resizeEvent(
  eventName?: EventType,
  id?: string | number,
  x?: number,
  y?: number,
  h?: number,
  w?: number
) {
  let l = getLayoutItem(props.layout, id)
  //GetLayoutItem sometimes return null object
  if (l === undefined || l === null) {
    l = {h: 0, w: 0} as LayoutItem
  }
  w = Number(w)
  h = Number(h)
  let hasCollisions
  if (props.preventCollision) {
    const collisions = getAllCollisions(props.layout, {...l, w, h}).filter(
      layoutItem => layoutItem.i !== l?.i
    )
    hasCollisions = collisions.length > 0

    // If we're colliding, we need adjust the placeholder.
    if (hasCollisions) {
      // adjust w && h to maximum allowed space
      let leastX = Infinity,
        leastY = Infinity
      collisions.forEach(layoutItem => {
        if (layoutItem.x > Number(l?.x)) leastX = Math.min(leastX, layoutItem.x)
        if (layoutItem.y > Number(l?.y)) leastY = Math.min(leastY, layoutItem.y)
      })

      if (Number.isFinite(leastX)) l.w = leastX - l.x
      if (Number.isFinite(leastY)) l.h = leastY - l.y
    }
  }

  if (!hasCollisions) {
    // Set new width and height.
    l.w = w
    l.h = h
  }

  if (eventName === "resizestart" || eventName === "resizemove") {
    placeholder.value.i = id as string | number
    placeholder.value.x = x as number
    placeholder.value.y = y as number
    placeholder.value.w = l.w as number
    placeholder.value.h = l.h as number
    nextTick(function () {
      isDragging.value = true
    })
    //this.$broadcast("updateWidth", this.width);
    eventBus.emit("updateWidth", width.value)
  } else {
    nextTick(function () {
      isDragging.value = false
    })
  }

  if (props.responsive) responsiveGridLayout()

  compact(props.layout, props.verticalCompact)
  eventBus.emit("compact")
  updateHeight()

  if (eventName === "resizeend") emit("layout-updated", props.layout)
}

// finds or generates new layouts for set breakpoints
function responsiveGridLayout() {
  let newBreakpoint = getBreakpointFromWidth(props.breakpoints, width.value as number)
  let newCols = getColsFromBreakpoint(newBreakpoint, props.cols)

  // save actual layout in layouts
  if (lastBreakpoint.value != null && !layouts.value[lastBreakpoint.value])
    layouts.value[lastBreakpoint.value] = cloneLayout(props.layout)

  // Find or generate a new layout.
  let layout = findOrGenerateResponsiveLayout(
    originalLayout.value as Layout,
    layouts.value,
    props.breakpoints,
    newBreakpoint,
    lastBreakpoint.value as string,
    newCols,
    props.verticalCompact
  )

  // Store the new layout.
  layouts.value[newBreakpoint] = layout

  if (lastBreakpoint.value !== newBreakpoint) {
    emit("breakpoint-changed", newBreakpoint, layout)
  }

  // new prop sync
  emit("update:layout", layout)

  lastBreakpoint.value = newBreakpoint
  eventBus.emit("setColNum", getColsFromBreakpoint(newBreakpoint, props.cols))
}
// clear all responsive layouts
function initResponsiveFeatures() {
  layouts.value = Object.assign({}, props.responsiveLayouts)
}

// find difference in layouts
function findDifference(layout: Layout, originalLayout: Layout) {
  //Find values that are in result1 but not in result2
  let uniqueResultOne = layout.filter(function (obj) {
    return !originalLayout.some(function (obj2) {
      return obj.i === obj2.i
    })
  })

  //Find values that are in result2 but not in result1
  let uniqueResultTwo = originalLayout.filter(function (obj) {
    return !layout.some(function (obj2) {
      return obj.i === obj2.i
    })
  })

  //Combine the two arrays of unique entries#
  return uniqueResultOne.concat(uniqueResultTwo)
}
//Expose some property for this
defineExpose({
  ...props,
  width,
  mergeStyle,
  lastLayoutLength,
  isDragging,
  placeholder,
  layouts,
  lastBreakpoint,
  originalLayout,
  erd,
  defaultGridItem,
  dragEvent
})
</script>

<style lang="css">
.vue-grid-layout {
  position: relative;
  transition: height 200ms ease;
}
</style>
