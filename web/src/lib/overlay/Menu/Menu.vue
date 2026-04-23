<script setup lang="ts">
import type { MenuProps, MenuEmits, MenuPosition } from './Menu.types'
import {
  ref,
  computed,
  watch,
  onUnmounted,
  nextTick,
  type StyleValue,
} from 'vue'

const props = withDefaults(defineProps<MenuProps>(), {
  modelValue: false,
  anchor: 'bottom left',
  self: 'top left',
  offset: () => [0, 4],
  persistent: false,
  submenu: false,
})

const emit = defineEmits<MenuEmits>()

// --- State ---

const isOpen = ref(props.modelValue)
const panelRef = ref<HTMLElement | null>(null)
const triggerEl = ref<Element | null>(null)

// Tracks pending close for submenu hover-out debounce
let submenuCloseTimer: ReturnType<typeof setTimeout> | null = null

const panelStyle = ref<StyleValue>({
  position: 'fixed',
  top: '0px',
  left: '0px',
})

// --- v-model sync ---

watch(
  () => props.modelValue,
  (val) => {
    if (val === isOpen.value) return
    isOpen.value = val
    if (val) nextTick(updatePosition)
  },
)

// --- Positioning ---

// Normalise 'start'/'end' to 'left'/'right' (RTL aliases)
function resolveH(h: string): 'left' | 'middle' | 'right' {
  if (h === 'start') return 'left'
  if (h === 'end') return 'right'
  return h as 'left' | 'middle' | 'right'
}

function parsePosition(pos: MenuPosition) {
  const [v, h] = pos.split(' ')
  return { v: v as 'top' | 'bottom' | 'center', h: resolveH(h) }
}

function updatePosition() {
  if (!triggerEl.value || !panelRef.value) return
  const rect = triggerEl.value.getBoundingClientRect()
  const panel = panelRef.value.getBoundingClientRect()

  const anchor = parsePosition(props.anchor)
  const self = parsePosition(props.self)
  const [ox, oy] = props.offset

  let anchorX = anchor.h === 'left' ? rect.left : anchor.h === 'right' ? rect.right : rect.left + rect.width / 2
  let anchorY = anchor.v === 'top' ? rect.top : anchor.v === 'bottom' ? rect.bottom : rect.top + rect.height / 2

  anchorX += ox
  anchorY += oy

  const selfX = self.h === 'left' ? 0 : self.h === 'right' ? panel.width : panel.width / 2
  const selfY = self.v === 'top' ? 0 : self.v === 'bottom' ? panel.height : panel.height / 2

  let top = anchorY - selfY
  let left = anchorX - selfX

  // Viewport clamp
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (left + panel.width > vw) left = vw - panel.width - 8
  if (left < 0) left = 8
  if (top + panel.height > vh) top = vh - panel.height - 8
  if (top < 0) top = 8

  panelStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
  }
}

// --- Open / Close ---

function open(trigger: Element) {
  triggerEl.value = trigger
  isOpen.value = true
  emit('update:modelValue', true)
  nextTick(() => {
    updatePosition()
    emit('show')
  })
}

function close() {
  isOpen.value = false
  emit('update:modelValue', false)
  emit('hide')
}

function toggle(event: MouseEvent) {
  const target = event.currentTarget as Element
  if (isOpen.value) {
    close()
  } else {
    open(target)
  }
}

// --- Submenu hover handlers ---
// A short 80 ms grace period prevents flicker when the pointer moves
// from the trigger row into the panel.

function onTriggerMouseenter(event: MouseEvent) {
  if (!props.submenu) return
  if (submenuCloseTimer) { clearTimeout(submenuCloseTimer); submenuCloseTimer = null }
  if (!isOpen.value) open(event.currentTarget as Element)
}

function onTriggerMouseleave() {
  if (!props.submenu) return
  submenuCloseTimer = setTimeout(() => { if (isOpen.value) close() }, 80)
}

function onPanelMouseenter() {
  if (!props.submenu) return
  if (submenuCloseTimer) { clearTimeout(submenuCloseTimer); submenuCloseTimer = null }
}

function onPanelMouseleave() {
  if (!props.submenu) return
  submenuCloseTimer = setTimeout(() => { if (isOpen.value) close() }, 80)
}

// --- Click-outside (disabled for submenu mode — hover controls lifecycle) ---

function onClickOutside(event: MouseEvent) {
  if (!isOpen.value || props.persistent || props.submenu) return
  const target = event.target as Node
  if (panelRef.value && panelRef.value.contains(target)) return
  if (triggerEl.value && triggerEl.value.contains(target)) return
  close()
}

watch(isOpen, (val) => {
  if (val) {
    if (!props.submenu) document.addEventListener('click', onClickOutside, { capture: true })
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
  } else {
    document.removeEventListener('click', onClickOutside, { capture: true })
    window.removeEventListener('resize', updatePosition)
    window.removeEventListener('scroll', updatePosition, true)
  }
})

onUnmounted(() => {
  if (submenuCloseTimer) clearTimeout(submenuCloseTimer)
  document.removeEventListener('click', onClickOutside, { capture: true })
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})

// --- Keyboard ---

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen.value) {
    close()
    ;(triggerEl.value as HTMLElement | null)?.focus()
  }
}

// --- Merged panel style ---

const mergedStyle = computed<StyleValue>(() => {
  if (!props.contentStyle) return panelStyle.value as StyleValue
  return [panelStyle.value, props.contentStyle] as StyleValue
})

defineExpose({ open, close, toggle })
</script>

<template>
  <!--
    Wrapped in a single root so Vue's slot compiler resolves scoped-slot
    props correctly when callers use <template #default="{ toggle }"> alongside
    <template #content>. Without this wrapper (fragment root), the compiler
    emits slot props as undefined at runtime.
  -->
  <div style="display: contents">
    <slot
      :toggle="toggle"
      :open="open"
      :close="close"
      :isOpen="isOpen"
      :onMouseenter="onTriggerMouseenter"
      :onMouseleave="onTriggerMouseleave"
    />

    <Teleport to="body">
      <Transition
        enter-active-class="tw:transition-opacity tw:duration-100"
        enter-from-class="tw:opacity-0"
        enter-to-class="tw:opacity-100"
        leave-active-class="tw:transition-opacity tw:duration-75"
        leave-from-class="tw:opacity-100"
        leave-to-class="tw:opacity-0"
      >
        <div
          v-if="isOpen"
          ref="panelRef"
          :style="mergedStyle"
          role="menu"
          :aria-hidden="!isOpen"
          class="tw:z-[9999] tw:bg-menu-bg tw:border tw:border-menu-border tw:rounded-md tw:shadow-menu tw:overflow-auto"
          @keydown="onKeydown"
          @mouseenter="onPanelMouseenter"
          @mouseleave="onPanelMouseleave"
        >
          <slot name="content" :close="close" :open="open" :toggle="toggle" :isOpen="isOpen" />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
