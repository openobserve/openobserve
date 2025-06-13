<template>
  <div class="example_1">
    <div id="layoutLeft" class="left">
      <GridLayout
        ref="refLayout1"
        v-model:layout="exampleData"
        :responsive="responsive"
        :col-num="12"
        :row-height="30"
        :vertical-compact="true"
        :use-css-transforms="true"
      >
        <grid-item
          v-for="item in exampleData"
          :key="item.i"
          class="test"
          :x="item.x"
          :y="item.y"
          :w="item.w"
          :h="item.h"
          :i="item.i"
          :min-h="3"
          :min-w="3"
          @dragging="onDraggingLeftItem"
          @dragend="onDragendLeft"
        >
          <!--<custom-drag-element :text="item.i"></custom-drag-element>-->
          <div>
            {{ item.i }}
            <!-- {{ style }} -->
          </div>
          <!--<button @click="clicked">CLICK ME!</button>-->
        </grid-item>
      </GridLayout>
    </div>
    <div class="right">
      <GridLayout
        ref="refLayout2"
        v-model:layout="exampleData2"
        :responsive="responsive"
        :col-num="12"
        :row-height="30"
        :vertical-compact="true"
        :use-css-transforms="true"
      >
        <grid-item
          v-for="item in exampleData2"
          :ref="el => set$Children(el)"
          :key="item.i"
          class="test"
          :x="item.x"
          :y="item.y"
          :w="item.w"
          :h="item.h"
          :i="item.i"
          :min-h="3"
          :min-w="3"
        >
          <!--<custom-drag-element :text="item.i"></custom-drag-element>-->
          <div>
            {{ item.i }}
            <!-- {{ style }} -->
          </div>
          <!--<button @click="clicked">CLICK ME!</button>-->
        </grid-item>
      </GridLayout>
    </div>
  </div>
</template>
<script lang="ts" setup>
import {ref, reactive, toRefs, onMounted, nextTick} from "vue"
import GridLayout from "../components/Grid/GridLayout.vue"
import GridItem from "../components/Grid/GridItem.vue"

const responsive = ref<boolean>(true)
const colNum = ref<number>(12)
const exampleData = ref([
  {x: 0, y: 0, w: 2, h: 2, i: "0"},
  {x: 2, y: 0, w: 2, h: 4, i: "1"}
])

const exampleData2 = ref([
  {x: 0, y: 0, w: 2, h: 2, i: "0"},
  {x: 2, y: 0, w: 2, h: 4, i: "1"}
])

let mouseXY = {x: 0, y: 0}
let DragPos = {x: 0, y: 0, w: 1, h: 1, i: ""}

const refLayout1 = ref()
const refLayout2 = ref()

const isDraggingLeft = ref(false)
const curDragLeftId = ref("")
const isDraggingRight = ref(false)
const curDragRightId = ref("")

const mapCacheRight: Map<string, any> = new Map()

function set$Children(vm: any) {
  if (vm && vm.i) {
    mapCacheRight.set(vm.i, vm)
  }
}

function onDraggingLeftItem(event: MouseEvent, i: number | string) {
  if (isDraggingLeft.value) {
    onOverRightLayout()
    return
  }
  curDragLeftId.value = i as string
  isDraggingLeft.value = true
}

function onDragendLeft() {
  isDraggingLeft.value = false
  curDragLeftId.value = ""
  const t = refLayout2.value.$el as HTMLDivElement
  let parentRect = t.getBoundingClientRect()
  let mouseInGrid = false
  if (
    mouseXY.x > parentRect.left &&
    mouseXY.x < parentRect.right &&
    mouseXY.y > parentRect.top &&
    mouseXY.y < parentRect.bottom
  ) {
    mouseInGrid = true
  }
  console.log(DragPos, mouseInGrid)
  if (mouseInGrid) {
    refLayout2.value.dragEvent("dragend", "drop", DragPos.x, DragPos.y, 3, 4)
    exampleData2.value = exampleData2.value.filter(obj => obj.i !== "drop")
    // UNCOMMENT below if you want to add a grid-item
    nextTick(() => {
      exampleData2.value.push({
        x: DragPos.x,
        y: DragPos.y,
        w: 3,
        h: 4,
        i: DragPos.i
      })

      refLayout2.value.dragEvent("dragend", DragPos.i, DragPos.x, DragPos.y, 3, 4)
      mapCacheRight.delete("drop")
    })
  }
}

function onOverRightLayout() {
  const t = refLayout2.value.$el as HTMLDivElement
  let parentRect = t.getBoundingClientRect()
  let mouseInGrid = false
  if (
    mouseXY.x > parentRect.left &&
    mouseXY.x < parentRect.right &&
    mouseXY.y > parentRect.top &&
    mouseXY.y < parentRect.bottom
  ) {
    mouseInGrid = true
    console.log("in layout 2")
  }
  if (mouseInGrid && exampleData2.value.findIndex(item => item.i === "drop") === -1) {
    exampleData2.value.push({
      x: (exampleData2.value.length * 2) % colNum.value,
      y: exampleData2.value.length + colNum.value, // puts it at the bottom
      w: 3,
      h: 4,
      i: "drop"
    })
  }

  let index = exampleData2.value.findIndex(item => item.i === "drop")

  if (index !== -1) {
    try {
      refLayout2.value.defaultGridItem.$el.style.display = "none"
    } catch {}
    let el = mapCacheRight.get("drop")
    if (!el) return
    // console.log("jjj")

    el.dragging = {top: mouseXY.y - parentRect.top, left: mouseXY.x - parentRect.left}
    let new_pos = el.calcXY(mouseXY.y - parentRect.top, mouseXY.x - parentRect.left)
    if (mouseInGrid) {
      refLayout2.value.dragEvent("dragstart", "drop", new_pos.x, new_pos.y, 3, 4)
      DragPos.i = String(index)
      // console.log(DragPos)
      DragPos.x = exampleData2.value[index].x
      DragPos.y = exampleData2.value[index].y
    }
    if (!mouseInGrid) {
      refLayout2.value.dragEvent("dragend", "drop", new_pos.x, new_pos.y, 3, 4)
      exampleData2.value = exampleData2.value.filter(obj => obj.i !== "drop")
    }
  }
}

function addMouseMoveEvent(e: MouseEvent) {
  mouseXY.x = e.clientX
  mouseXY.y = e.clientY
  // console.log(mouseXY)
}
onMounted(() => {
  document.addEventListener("mousemove", addMouseMoveEvent)
})
</script>
<style scoped>
.example_1 {
  margin-top: 30px;
  display: flex;
}
.left,
.right {
  flex: 1;
  background-color: #ccc;
}
.left {
  margin-right: 10px;
  background-color: #999;
}
.left .test {
  background-color: yellowgreen;
}

.right .test {
  background: skyblue;
}
</style>
