<template>
  <div
    class="rich-text-input-wrapper"
    :class="[theme === 'dark' ? 'dark-mode' : 'light-mode', { 'is-disabled': disabled, 'borderless': borderless }]"
    @click="focusInput"
  >
    <div
      ref="editableDiv"
      class="rich-text-input"
      contenteditable="true"
      :data-placeholder="placeholder"
      @input="handleInput"
      @keydown="handleKeyDown"
      @paste="handlePaste"
      @focus="handleFocus"
      @blur="handleBlur"
    ></div>

    <!-- Detail Card -->
    <div
      v-if="showDetailCard"
      class="chip-detail-card"
      :class="theme === 'dark' ? 'dark-mode' : 'light-mode'"
      :style="{
        top: cardPosition.top + 'px',
        left: cardPosition.left + 'px',
        transform: cardPosition.below ? 'none' : 'translateY(-100%)'
      }"
      @click.stop
    >
      <div class="card-content" v-html="formatContent(detailCardContent)"></div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, nextTick, PropType } from 'vue';

export interface ReferenceChip {
  id: string;
  filename: string;
  lineStart?: number;
  lineEnd?: number;
  preview: string; // First few chars
  fullContent: string; // Full content for backend
  charCount: number;
  type: 'file' | 'context'; // Different types of references
}

export default defineComponent({
  name: 'RichTextInput',
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    placeholder: {
      type: String,
      default: 'Write your prompt'
    },
    disabled: {
      type: Boolean,
      default: false
    },
    theme: {
      type: String as PropType<'light' | 'dark'>,
      default: 'light'
    },
    // References to be displayed as chips
    references: {
      type: Array as PropType<ReferenceChip[]>,
      default: () => []
    },
    // Remove wrapper border/background (for embedding in other containers)
    borderless: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue', 'keydown', 'submit', 'focus', 'blur', 'update:references'],
  setup(props, { emit }) {
    const editableDiv = ref<HTMLDivElement | null>(null);
    const isFocused = ref(false);
    const localReferences = ref<ReferenceChip[]>([...props.references]);
    const lastEmittedValue = ref<string>(''); // Track last value we emitted

    // Detail card state
    const showDetailCard = ref(false);
    const detailCardContent = ref('');
    const cardPosition = ref({ top: 0, left: 0, below: false });

    // Generate unique ID for chips
    const generateId = (): string => {
      return `chip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    };

    // Helper to format JSON with syntax highlighting
    const formatContent = (content: string): string => {
      try {
        const parsed = JSON.parse(content);
        const formatted = JSON.stringify(parsed, null, 2);
        // Apply syntax highlighting
        return formatted
          .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
            let cls = 'json-number';
            if (/^"/.test(match)) {
              if (/:$/.test(match)) {
                cls = 'json-key';
              } else {
                cls = 'json-string';
              }
            } else if (/true|false/.test(match)) {
              cls = 'json-boolean';
            } else if (/null/.test(match)) {
              cls = 'json-null';
            }
            return `<span class="${cls}">${match}</span>`;
          });
      } catch {
        // Not JSON, return plain text with line breaks preserved
        return content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      }
    };

    // Create chip element
    const createChipElement = (chip: ReferenceChip): HTMLElement => {
      const chipWrapper = document.createElement('span');
      chipWrapper.className = 'reference-chip';
      chipWrapper.contentEditable = 'false';
      chipWrapper.setAttribute('data-chip-id', chip.id);
      chipWrapper.setAttribute('data-chip-type', chip.type);

      // Preview text (first few chars + ellipsis)
      const previewSpan = document.createElement('span');
      previewSpan.className = 'chip-preview';
      previewSpan.textContent = chip.preview;

      // Character count and line numbers
      const metaSpan = document.createElement('span');
      metaSpan.className = 'chip-meta';
      if (chip.lineStart !== undefined && chip.lineEnd !== undefined) {
        metaSpan.textContent = `(${chip.charCount}) • ${chip.lineStart}-${chip.lineEnd}`;
      } else {
        metaSpan.textContent = `(${chip.charCount})`;
      }

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'chip-remove';
      removeBtn.innerHTML = '×';
      removeBtn.setAttribute('type', 'button');
      removeBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeChip(chip.id);
      };

      // Click handler to show detail card
      chipWrapper.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Toggle detail card
        if (showDetailCard.value && detailCardContent.value === chip.fullContent) {
          showDetailCard.value = false;
        } else {
          // Calculate position relative to chip
          const rect = chipWrapper.getBoundingClientRect();
          const cardWidth = 300; // Max width of card

          // Position card's bottom edge at chip's top edge (with gap)
          // Using transform: translateY(-100%) in CSS to shift card up by its own height
          let top = rect.top - 10; // 10px gap above chip
          let left = rect.left + (rect.width / 2) - (cardWidth / 2);

          // Check if there's enough space above
          // If card would go off top of screen, position below chip instead
          if (rect.top < 310) { // Not enough space for max 300px card + gap
            top = rect.bottom + 10; // Position below chip
            cardPosition.value = { top, left, below: true };
          } else {
            // Adjust if card would go off left edge
            if (left < 10) {
              left = 10;
            }

            // Adjust if card would go off right edge
            if (left + cardWidth > window.innerWidth - 10) {
              left = window.innerWidth - cardWidth - 10;
            }

            cardPosition.value = { top, left, below: false };
          }

          detailCardContent.value = chip.fullContent;
          showDetailCard.value = true;
        }
      };

      chipWrapper.appendChild(previewSpan);
      chipWrapper.appendChild(metaSpan);
      chipWrapper.appendChild(removeBtn);

      // Add a zero-width space after the chip to allow cursor positioning
      const spacer = document.createTextNode('\u200B');
      chipWrapper.appendChild(spacer);

      return chipWrapper;
    };

    // Insert chip at cursor position or at the end
    const insertChip = (chip: ReferenceChip) => {
      if (!editableDiv.value) return;

      localReferences.value.push(chip);
      emit('update:references', localReferences.value);

      const chipElement = createChipElement(chip);
      const selection = window.getSelection();

      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();

        // Add space before chip if needed
        const textBefore = range.startContainer.textContent || '';
        const needsSpaceBefore = textBefore.length > 0 && !textBefore.endsWith(' ') && !textBefore.endsWith('\n');
        if (needsSpaceBefore) {
          range.insertNode(document.createTextNode(' '));
        }

        // Insert chip
        range.insertNode(chipElement);

        // Move range after the chip
        range.setStartAfter(chipElement);
        range.setEndAfter(chipElement);

        // Add space after chip for cursor positioning
        const spaceAfter = document.createTextNode(' ');
        range.insertNode(spaceAfter);

        // Position cursor after the space
        range.setStartAfter(spaceAfter);
        range.setEndAfter(spaceAfter);
        range.collapse(true);

        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        // Fallback: append to end
        editableDiv.value.appendChild(chipElement);
        const spaceAfter = document.createTextNode(' ');
        editableDiv.value.appendChild(spaceAfter);

        // Position cursor at the end
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStartAfter(spaceAfter);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }

      // Focus the input
      if (editableDiv.value) {
        editableDiv.value.focus();
      }

      handleInput();
    };

    // Remove chip by ID
    const removeChip = (chipId: string) => {
      if (!editableDiv.value) return;

      const chipElement = editableDiv.value.querySelector(`[data-chip-id="${chipId}"]`);
      if (chipElement) {
        chipElement.remove();
        localReferences.value = localReferences.value.filter(ref => ref.id !== chipId);
        emit('update:references', localReferences.value);
        handleInput();
      }
    };

    // Get plain text content (for display/editing)
    const getPlainText = (): string => {
      if (!editableDiv.value) return '';

      let text = '';
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent || '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          if (element.classList.contains('reference-chip')) {
            const chipId = element.getAttribute('data-chip-id');
            const chip = localReferences.value.find(r => r.id === chipId);
            if (chip) {
              text += `[${chip.filename}]`;
            }
          } else {
            node.childNodes.forEach(walk);
          }
        }
      };
      editableDiv.value.childNodes.forEach(walk);
      return text.replace(/\u200B/g, ''); // Remove zero-width spaces
    };

    // Get message for backend (unwrap chips with full content)
    const getMessageForBackend = (): string => {
      if (!editableDiv.value) return '';

      let message = '';
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          message += node.textContent || '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          if (element.classList.contains('reference-chip')) {
            const chipId = element.getAttribute('data-chip-id');
            const chip = localReferences.value.find(r => r.id === chipId);
            if (chip) {
              message += `\n\n--- ${chip.filename} ${chip.lineStart && chip.lineEnd ? `(lines ${chip.lineStart}-${chip.lineEnd})` : ''} ---\n${chip.fullContent}\n--- end ---\n\n`;
            }
          } else {
            node.childNodes.forEach(walk);
          }
        }
      };
      editableDiv.value.childNodes.forEach(walk);
      return message.replace(/\u200B/g, '').trim();
    };

    // Handle input changes from user
    const handleInput = () => {
      const plainText = getPlainText();
      lastEmittedValue.value = plainText; // Track what we emitted
      emit('update:modelValue', plainText);

      // Update empty state for placeholder visibility
      updateEmptyState();
    };

    // Emit model update without tracking (for programmatic changes)
    const emitModelUpdate = () => {
      const plainText = getPlainText();
      lastEmittedValue.value = plainText; // Track what we emitted
      emit('update:modelValue', plainText);
      updateEmptyState();
    };

    // Update empty state class
    const updateEmptyState = () => {
      if (!editableDiv.value) return;

      const hasContent = editableDiv.value.textContent?.trim() ||
                        editableDiv.value.querySelector('.reference-chip');

      if (hasContent) {
        editableDiv.value.classList.remove('is-empty');
      } else {
        editableDiv.value.classList.add('is-empty');

        // When becoming empty, reset cursor to start position if focused
        if (isFocused.value) {
          nextTick(() => {
            if (!editableDiv.value) return;
            const selection = window.getSelection();
            if (!selection) return;

            const range = document.createRange();
            range.setStart(editableDiv.value, 0);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          });
        }
      }
    };

    // Handle keydown events
    const handleKeyDown = (e: KeyboardEvent) => {
      emit('keydown', e);

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        emit('submit');
      }

      // Handle backspace on chips
      if (e.key === 'Backspace') {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const container = range.startContainer;

          // Check if we're right after a chip
          if (container.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
            const prevSibling = container.previousSibling;
            if (prevSibling && (prevSibling as HTMLElement).classList?.contains('reference-chip')) {
              e.preventDefault();
              const chipId = (prevSibling as HTMLElement).getAttribute('data-chip-id');
              if (chipId) {
                removeChip(chipId);
              }
            }
          }
        }
      }
    };

    // Handle paste events
    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain') || '';

      // Insert as plain text
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
      }

      handleInput();
    };

    // Focus and blur handlers
    const handleFocus = () => {
      isFocused.value = true;
      emit('focus');
    };

    const handleBlur = () => {
      isFocused.value = false;
      emit('blur');
    };

    // Focus the input
    const focusInput = () => {
      if (editableDiv.value && !props.disabled) {
        // Only move cursor to end if not already focused
        // If already focused, preserve current cursor position
        const wasAlreadyFocused = isFocused.value;

        editableDiv.value.focus();

        // Only move cursor to end if we weren't already focused AND have content
        if (!wasAlreadyFocused) {
          const isEmpty = !editableDiv.value.textContent?.trim() &&
                          !editableDiv.value.querySelector('.reference-chip');

          if (!isEmpty) {
            // Has content - move cursor to end
            const range = document.createRange();
            const selection = window.getSelection();
            range.selectNodeContents(editableDiv.value);
            range.collapse(false);
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
          // If empty, just focus without moving cursor (stays at start)
        }
      }
    };

    // Set content programmatically
    const setContent = (text: string, preserveCursor = false) => {
      if (!editableDiv.value) return;

      // Save cursor position if preserving
      let savedSelection: { start: number; end: number } | null = null;
      if (preserveCursor && isFocused.value) {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const preSelectionRange = range.cloneRange();
          preSelectionRange.selectNodeContents(editableDiv.value);
          preSelectionRange.setEnd(range.startContainer, range.startOffset);
          const start = preSelectionRange.toString().length;
          savedSelection = {
            start,
            end: start + range.toString().length
          };
        }
      }

      editableDiv.value.textContent = text;
      emitModelUpdate(); // Use emitModelUpdate instead of handleInput to avoid setting isInternalUpdate flag

      // Restore cursor position if saved
      if (savedSelection && isFocused.value) {
        nextTick(() => {
          if (!editableDiv.value) return;
          const selection = window.getSelection();
          if (!selection) return;

          const range = document.createRange();
          let charCount = 0;
          let nodeStack: Node[] = [editableDiv.value];
          let node: Node | undefined;
          let foundStart = false;
          let stop = false;

          while (!stop && (node = nodeStack.pop())) {
            if (node.nodeType === Node.TEXT_NODE) {
              const nextCharCount = charCount + (node.textContent?.length || 0);
              if (!foundStart && savedSelection.start >= charCount && savedSelection.start <= nextCharCount) {
                range.setStart(node, savedSelection.start - charCount);
                foundStart = true;
              }
              if (foundStart && savedSelection.end >= charCount && savedSelection.end <= nextCharCount) {
                range.setEnd(node, savedSelection.end - charCount);
                stop = true;
              }
              charCount = nextCharCount;
            } else {
              let i = node.childNodes.length;
              while (i--) {
                nodeStack.push(node.childNodes[i]);
              }
            }
          }

          selection.removeAllRanges();
          selection.addRange(range);
        });
      }
    };

    // Clear all content
    const clear = () => {
      if (!editableDiv.value) return;
      editableDiv.value.innerHTML = '';
      localReferences.value = [];
      emit('update:references', []);
      emitModelUpdate(); // Use emitModelUpdate for programmatic clear
    };

    // Watch for external reference changes
    watch(() => props.references, (newRefs) => {
      localReferences.value = [...newRefs];
    }, { deep: true });

    // Watch for model value changes from parent
    watch(() => props.modelValue, (newValue) => {
      if (!editableDiv.value) return;

      // CRITICAL: Never update while user is focused (actively typing)
      // This is the #1 cause of cursor jumping
      if (isFocused.value) return;

      // Skip if this is the same value we just emitted (circular update from v-model)
      if (newValue === lastEmittedValue.value) return;

      const currentText = getPlainText();

      // Skip if content is already the same
      if (currentText === newValue) return;

      // Update content
      setContent(newValue, false);
    });

    onMounted(() => {
      // Initialize empty state
      updateEmptyState();

      if (props.modelValue) {
        setContent(props.modelValue);
      }

      // Add global click handler to close detail card when clicking outside
      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        // Close detail card if clicking outside of chip and card
        if (!target.closest('.reference-chip') && !target.closest('.chip-detail-card')) {
          showDetailCard.value = false;
        }
      };

      document.addEventListener('click', handleClickOutside);

      // Cleanup on unmount
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    });

    return {
      editableDiv,
      isFocused,
      handleInput,
      handleKeyDown,
      handlePaste,
      handleFocus,
      handleBlur,
      focusInput,
      insertChip,
      removeChip,
      getPlainText,
      getMessageForBackend,
      setContent,
      clear,
      showDetailCard,
      detailCardContent,
      cardPosition,
      formatContent,
    };
  }
});
</script>

<style lang="scss">
.rich-text-input-wrapper {
  padding: 4px 8px 8px 8px;
  border-radius: 12px;
  transition: all 0.2s ease;
  min-height: 60px;
  cursor: text;

  &.borderless {
    padding: 0;
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
    border-radius: 0;
  }

  &.is-disabled {
    opacity: 0.6;
    cursor: not-allowed;

    .rich-text-input {
      cursor: not-allowed;
    }
  }

  &.light-mode {
    background: #ffffff;
    border: 1px solid #e4e7ec;

    &:focus-within {
      border: 1px solid transparent;
      box-shadow: 0 0 0 2px #667eea;
    }

    .rich-text-input {
      color: #1a202c;

      &.is-empty:before {
        content: attr(data-placeholder);
        color: #a0aec0;
        pointer-events: none;
        position: absolute;
        left: 0;
        top: 10;
      }
    }

    .reference-chip {
      background: #f0f4ff;
      border: 1px solid #d0d9ff;
      color: #4a5568;

      .chip-meta {
        color: #718096;
      }

      .chip-remove {
        color: #a0aec0;

        &:hover {
          color: #e53e3e;
          background: rgba(229, 62, 62, 0.1);
        }
      }

      &:hover {
        background: #e6edff;
        border-color: #b8c5ff;
      }
    }
  }

  &.dark-mode {
    background: #191919;
    border: 1px solid #323232;

    &:focus-within {
      border: 1px solid transparent;
      box-shadow: 0 0 0 2px #5a6ec3;
    }

    .rich-text-input {
      color: #e2e8f0;

      &.is-empty:before {
        content: attr(data-placeholder);
        color: #718096;
        pointer-events: none;
        position: absolute;
        left: 0;
        top: 0;
      }
    }

    .reference-chip {
      background: #2d3748;
      border: 1px solid #4a5568;
      color: #e2e8f0;

      .chip-meta {
        color: #a0aec0;
      }

      .chip-remove {
        color: #718096;

        &:hover {
          color: #fc8181;
          background: rgba(252, 129, 129, 0.1);
        }
      }

      &:hover {
        background: #374151;
        border-color: #5a6c7d;
      }
    }
  }
}

.rich-text-input {
  position: relative;
  outline: none;
  font-size: 14px;
  line-height: 1.6;
  min-height: 40px;
  max-height: 300px;
  overflow-y: auto;
  word-wrap: break-word;
  white-space: pre-wrap;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: #cbd5e0;
    border-radius: 3px;
  }

  .dark-mode &::-webkit-scrollbar-thumb {
    background: #4a5568;
  }
}

.reference-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  margin: 4px 2px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
  transition: all 0.15s ease;
  line-height: 1.4;

  /* Default light mode colors */
  background: #f0f4ff;
  border: 1px solid #d0d9ff;
  color: #4a5568;

  .chip-preview {
    font-weight: 500;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip-meta {
    font-size: 10px;
    white-space: nowrap;
  }

  .chip-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    margin-left: 2px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    border-radius: 3px;
    transition: all 0.15s ease;
    color: #a0aec0;

    &:hover {
      transform: scale(1.1);
      color: #e53e3e;
      background: rgba(229, 62, 62, 0.1);
    }
  }

  .chip-meta {
    color: #718096;
  }

  &:hover {
    background: #e6edff;
    border-color: #b8c5ff;
  }

}

// Detail Card - Positioned above chip
.chip-detail-card {
  position: fixed;
  max-width: 300px;
  max-height: 300px;
  background: #ffffff;
  border: 1px solid #e4e7ec;
  border-radius: 8px; 
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  z-index: 100000;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &.dark-mode {
    background: #181a1b;
    border-color: #181a1b;
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid #e4e7ec;
    background: #f8fafc;

    .dark-mode & {
      background: #0f172a;
      border-bottom-color: #475569;
    }

    .card-title {
      font-size: 13px;
      font-weight: 600;
      color: #1a202c;

      .dark-mode & {
        color: #e2e8f0;
      }
    }

    .card-close {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
      border-radius: 4px;
      color: #64748b;
      transition: all 0.15s ease;

      &:hover {
        background: rgba(0, 0, 0, 0.05);
        color: #1a202c;
      }

      .dark-mode & {
        color: #94a3b8;

        &:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #e2e8f0;
        }
      }
    }
  }

  .card-content {
    overflow-y: auto;
    max-height: 300px;
    padding: 4px 8px;
    font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.5;
    color: #1a202c;
    white-space: pre-wrap;
    word-wrap: break-word;

    .dark-mode & {
      color: #e2e8f0;
    }

    // JSON syntax highlighting
    .json-key {
      color: #0066cc;
      font-weight: 600;

      .dark-mode & {
        color: #60a5fa;
      }
    }

    .json-string {
      color: #22863a;

      .dark-mode & {
        color: #86efac;
      }
    }

    .json-number {
      color: #005cc5;

      .dark-mode & {
        color: #7dd3fc;
      }
    }

    .json-boolean {
      color: #d73a49;
      font-weight: 600;

      .dark-mode & {
        color: #fca5a5;
      }
    }

    .json-null {
      color: #6f42c1;
      font-weight: 600;

      .dark-mode & {
        color: #c4b5fd;
      }
    }
  }
}

/* Dark mode chip styling */
.dark-mode .reference-chip {
  background: #2d3748;
  border: 1px solid #4a5568;
  color: #e2e8f0;

  .chip-meta {
    color: #a0aec0;
  }

  .chip-remove {
    color: #718096;

    &:hover {
      color: #fc8181;
      background: rgba(252, 129, 129, 0.1);
    }
  }

  &:hover {
    background: #374151;
    border-color: #5a6c7d;
  }
}
</style>
