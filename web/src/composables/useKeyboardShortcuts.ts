// Copyright 2026 OpenObserve Inc.

import { onMounted, onUnmounted } from 'vue'

export interface Shortcut {
  key: string
  ctrlOrMeta?: boolean
  shift?: boolean
  handler: (e: KeyboardEvent) => void
  description?: string
}

const useKeyboardShortcuts = (shortcuts: Shortcut[]) => {
  const handleKeydown = (e: KeyboardEvent) => {
    for (const shortcut of shortcuts) {
      const ctrlMatch = shortcut.ctrlOrMeta ? (e.ctrlKey || e.metaKey) : true
      const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey
      const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()

      if (ctrlMatch && shiftMatch && keyMatch) {
        e.preventDefault()
        shortcut.handler(e)
        return
      }
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handleKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown)
  })
}

export default useKeyboardShortcuts
