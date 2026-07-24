<template>
  <div
    class="rich-text-input-wrapper rounded-default bg-surface-base border-border-default min-h-15 cursor-text border px-2 py-1 pb-2 transition-all duration-200 ease-in-out focus-within:border-transparent focus-within:shadow-[0_0_0_2px_var(--color-accent)]"
    :class="[
      disabled ? ['is-disabled', 'opacity-60', 'cursor-not-allowed'] : [],
      borderless
        ? ['borderless', 'p-0', 'border-0!', 'bg-transparent!', 'shadow-none!', 'rounded-none']
        : [],
    ]"
    @click="focusInput"
  >
    <div
      ref="editableDiv"
      class="rich-text-input text-text-body relative max-h-75 min-h-10 overflow-y-auto text-sm leading-[1.6] break-words whitespace-pre-wrap outline-none"
      :class="disabled ? 'cursor-not-allowed' : ''"
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
      class="chip-detail-card rounded-default bg-surface-base border-border-default fixed z-100000 flex max-h-75 max-w-75 flex-col overflow-hidden border shadow-lg"
      :style="{
        top: cardPosition.top + 'px',
        left: cardPosition.left + 'px',
        transform: cardPosition.below ? 'none' : 'translateY(-100%)',
      }"
      @click.stop
    >
      <div
        class="card-content text-2xs text-text-body max-h-75 overflow-y-auto px-2 py-1 font-mono leading-[1.5] break-words whitespace-pre-wrap"
        v-html="formatContent(detailCardContent)"
      ></div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, watch, nextTick, PropType } from "vue";

export interface ReferenceChip {
  id: string;
  filename: string;
  lineStart?: number;
  lineEnd?: number;
  preview: string; // First few chars
  fullContent: string; // Full content for backend
  charCount: number;
  type: "file" | "context"; // Different types of references
}

export default defineComponent({
  name: "RichTextInput",
  props: {
    modelValue: {
      type: String,
      default: "",
    },
    placeholder: {
      type: String,
      default: "Write your prompt",
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    theme: {
      type: String as PropType<"light" | "dark">,
      default: "light",
    },
    // References to be displayed as chips
    references: {
      type: Array as PropType<ReferenceChip[]>,
      default: () => [],
    },
    // Remove wrapper border/background (for embedding in other containers)
    borderless: {
      type: Boolean,
      default: false,
    },
  },
  emits: ["update:modelValue", "keydown", "submit", "focus", "blur", "update:references"],
  setup(props, { emit }) {
    const editableDiv = ref<HTMLDivElement | null>(null);
    const isFocused = ref(false);
    const localReferences = ref<ReferenceChip[]>([...props.references]);
    const lastEmittedValue = ref<string>(""); // Track last value we emitted

    // Detail card state
    const showDetailCard = ref(false);
    const detailCardContent = ref("");
    const cardPosition = ref({ top: 0, left: 0, below: false });

    // Helper to format JSON with syntax highlighting
    const formatContent = (content: string): string => {
      try {
        const parsed = JSON.parse(content);
        const formatted = JSON.stringify(parsed, null, 2);
        // Apply syntax highlighting
        return formatted.replace(
          /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
          (match) => {
            let cls = "json-number";
            if (/^"/.test(match)) {
              if (/:$/.test(match)) {
                cls = "json-key";
              } else {
                cls = "json-string";
              }
            } else if (/true|false/.test(match)) {
              cls = "json-boolean";
            } else if (/null/.test(match)) {
              cls = "json-null";
            }
            return `<span class="${cls}">${match}</span>`;
          },
        );
      } catch {
        // Not JSON, return plain text with line breaks preserved
        return content.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
      }
    };

    // Create chip element
    const createChipElement = (chip: ReferenceChip): HTMLElement => {
      const chipWrapper = document.createElement("span");
      chipWrapper.className = "reference-chip";
      chipWrapper.contentEditable = "false";
      chipWrapper.setAttribute("data-chip-id", chip.id);
      chipWrapper.setAttribute("data-chip-type", chip.type);

      // Preview text (first few chars + ellipsis)
      const previewSpan = document.createElement("span");
      previewSpan.className = "chip-preview";
      previewSpan.textContent = chip.preview;

      // Character count and line numbers
      const metaSpan = document.createElement("span");
      metaSpan.className = "chip-meta";
      if (chip.lineStart !== undefined && chip.lineEnd !== undefined) {
        metaSpan.textContent = `(${chip.charCount}) • ${chip.lineStart}-${chip.lineEnd}`;
      } else {
        metaSpan.textContent = `(${chip.charCount})`;
      }

      // Remove button
      const removeBtn = document.createElement("button");
      removeBtn.className = "chip-remove";
      removeBtn.innerHTML = "×";
      removeBtn.setAttribute("type", "button");
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
          let left = rect.left + rect.width / 2 - cardWidth / 2;

          // Check if there's enough space above
          // If card would go off top of screen, position below chip instead
          if (rect.top < 310) {
            // Not enough space for max 300px card + gap
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
      const spacer = document.createTextNode("\u200B");
      chipWrapper.appendChild(spacer);

      return chipWrapper;
    };

    // Insert chip at cursor position or at the end
    const insertChip = (chip: ReferenceChip) => {
      if (!editableDiv.value) return;

      localReferences.value.push(chip);
      emit("update:references", localReferences.value);

      const chipElement = createChipElement(chip);
      const selection = window.getSelection();

      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();

        // Add space before chip if needed
        const textBefore = range.startContainer.textContent || "";
        const needsSpaceBefore =
          textBefore.length > 0 && !textBefore.endsWith(" ") && !textBefore.endsWith("\n");
        if (needsSpaceBefore) {
          range.insertNode(document.createTextNode(" "));
        }

        // Insert chip
        range.insertNode(chipElement);

        // Move range after the chip
        range.setStartAfter(chipElement);
        range.setEndAfter(chipElement);

        // Add space after chip for cursor positioning
        const spaceAfter = document.createTextNode(" ");
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
        const spaceAfter = document.createTextNode(" ");
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
        localReferences.value = localReferences.value.filter((ref) => ref.id !== chipId);
        emit("update:references", localReferences.value);
        handleInput();
      }
    };

    // Get plain text content (for display/editing)
    const getPlainText = (): string => {
      if (!editableDiv.value) return "";

      let text = "";
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent || "";
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          if (element.classList.contains("reference-chip")) {
            const chipId = element.getAttribute("data-chip-id");
            const chip = localReferences.value.find((r) => r.id === chipId);
            if (chip) {
              text += `[${chip.filename}]`;
            }
          } else {
            node.childNodes.forEach(walk);
          }
        }
      };
      editableDiv.value.childNodes.forEach(walk);
      return text.replace(/\u200B/g, ""); // Remove zero-width spaces
    };

    // Get message for backend (unwrap chips with full content)
    const getMessageForBackend = (): string => {
      if (!editableDiv.value) return "";

      let message = "";
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          message += node.textContent || "";
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          if (element.classList.contains("reference-chip")) {
            const chipId = element.getAttribute("data-chip-id");
            const chip = localReferences.value.find((r) => r.id === chipId);
            if (chip) {
              message += `\n\n--- ${chip.filename} ${chip.lineStart && chip.lineEnd ? `(lines ${chip.lineStart}-${chip.lineEnd})` : ""} ---\n${chip.fullContent}\n--- end ---\n\n`;
            }
          } else {
            node.childNodes.forEach(walk);
          }
        }
      };
      editableDiv.value.childNodes.forEach(walk);
      return message.replace(/\u200B/g, "").trim();
    };

    // Handle input changes from user
    const handleInput = () => {
      const plainText = getPlainText();
      lastEmittedValue.value = plainText; // Track what we emitted
      emit("update:modelValue", plainText);

      // Update empty state for placeholder visibility
      updateEmptyState();
    };

    // Emit model update without tracking (for programmatic changes)
    const emitModelUpdate = () => {
      const plainText = getPlainText();
      lastEmittedValue.value = plainText; // Track what we emitted
      emit("update:modelValue", plainText);
      updateEmptyState();
    };

    // Update empty state class
    const updateEmptyState = () => {
      if (!editableDiv.value) return;

      const hasContent =
        editableDiv.value.textContent?.trim() || editableDiv.value.querySelector(".reference-chip");

      if (hasContent) {
        editableDiv.value.classList.remove("is-empty");
      } else {
        editableDiv.value.classList.add("is-empty");

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
      emit("keydown", e);

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        emit("submit");
      }

      // Handle backspace on chips
      if (e.key === "Backspace") {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const container = range.startContainer;

          // Check if we're right after a chip
          if (container.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
            const prevSibling = container.previousSibling;
            if (prevSibling && (prevSibling as HTMLElement).classList?.contains("reference-chip")) {
              e.preventDefault();
              const chipId = (prevSibling as HTMLElement).getAttribute("data-chip-id");
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
      const text = e.clipboardData?.getData("text/plain") || "";

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
      emit("focus");
    };

    const handleBlur = () => {
      isFocused.value = false;
      emit("blur");
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
          const isEmpty =
            !editableDiv.value.textContent?.trim() &&
            !editableDiv.value.querySelector(".reference-chip");

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
            end: start + range.toString().length,
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
              if (
                !foundStart &&
                savedSelection.start >= charCount &&
                savedSelection.start <= nextCharCount
              ) {
                range.setStart(node, savedSelection.start - charCount);
                foundStart = true;
              }
              if (
                foundStart &&
                savedSelection.end >= charCount &&
                savedSelection.end <= nextCharCount
              ) {
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
      editableDiv.value.innerHTML = "";
      localReferences.value = [];
      emit("update:references", []);
      emitModelUpdate(); // Use emitModelUpdate for programmatic clear
    };

    // Watch for external reference changes
    watch(
      () => props.references,
      (newRefs) => {
        localReferences.value = [...newRefs];
      },
      { deep: true },
    );

    // Watch for model value changes from parent
    watch(
      () => props.modelValue,
      (newValue) => {
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
      },
    );

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
        if (!target.closest(".reference-chip") && !target.closest(".chip-detail-card")) {
          showDetailCard.value = false;
        }
      };

      document.addEventListener("click", handleClickOutside);

      // Cleanup on unmount
      return () => {
        document.removeEventListener("click", handleClickOutside);
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
  },
});
</script>

<style scoped>
/* keep(generated-content) — .reference-chip and its children are built in JS with
   document.createElement() inside the contenteditable, and .json-* spans are
   injected via v-html. None of these nodes carry the scoped data-v attribute, so
   they can only be reached with :deep() and cannot be expressed as utilities.
   keep(scrollbar) — ::-webkit-scrollbar pseudo-elements have no utility form.
   keep(complex-state) — .is-empty is toggled imperatively by the input handlers,
   so the placeholder :before has no Tailwind variant. */

/* Placeholder for the empty contenteditable */
.rich-text-input.is-empty:before {
  content: attr(data-placeholder);
  color: var(--color-text-placeholder);
  pointer-events: none;
  position: absolute;
  left: 0;
  top: 0.25rem;
}

.rich-text-input::-webkit-scrollbar {
  width: 0.375rem;
}

.rich-text-input::-webkit-scrollbar-track {
  background: transparent;
}

.rich-text-input::-webkit-scrollbar-thumb {
  background: var(--color-border-strong);
  border-radius: 0.1875rem;
}

/* Reference chips — dynamically created in JS */
.rich-text-input :deep(.reference-chip) {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  margin: 0.25rem 0.125rem;
  border-radius: 0.375rem;
  font-size: var(--text-xs);
  cursor: pointer;
  user-select: none;
  vertical-align: middle;
  transition: all 0.15s ease;
  line-height: 1.4;

  background: var(--color-file-chip-bg);
  border: 0.0625rem solid var(--color-file-border);
  color: var(--color-file-chip-text);
}

.rich-text-input :deep(.reference-chip .chip-preview) {
  font-weight: 500;
  max-width: 7.5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rich-text-input :deep(.reference-chip .chip-meta) {
  font-size: var(--text-3xs);
  white-space: nowrap;
  color: var(--color-text-secondary);
}

.rich-text-input :deep(.reference-chip .chip-remove) {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  padding: 0;
  margin-left: 0.125rem;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: var(--text-base);
  line-height: 1;
  border-radius: 0.1875rem;
  transition: all 0.15s ease;
  color: var(--color-file-chip-remove);
}

.rich-text-input :deep(.reference-chip .chip-remove:hover) {
  transform: scale(1.1);
  color: var(--color-status-negative);
  background: var(--color-button-ghost-destructive-hover-bg);
}

/* Chip hover — derived from the chip tokens so it flips with the theme on its
   own (both --color-file-chip-bg and --color-file-chip-text are dark-aware),
   which replaces the former light/dark literal pair. */
.rich-text-input :deep(.reference-chip:hover) {
  background: color-mix(in srgb, var(--color-file-chip-bg) 88%, var(--color-file-chip-text) 12%);
  border-color: color-mix(in srgb, var(--color-file-border) 70%, var(--color-file-chip-text) 30%);
}

/* JSON syntax highlighting in detail card (v-html injected content) */
.chip-detail-card .card-content :deep(.json-key) {
  color: var(--color-json-key);
  font-weight: 600;
}

.chip-detail-card .card-content :deep(.json-string) {
  color: var(--color-json-string);
}

.chip-detail-card .card-content :deep(.json-number) {
  color: var(--color-json-number);
}

.chip-detail-card .card-content :deep(.json-boolean) {
  color: var(--color-json-boolean);
  font-weight: 600;
}

.chip-detail-card .card-content :deep(.json-null) {
  color: var(--color-json-null);
  font-weight: 600;
}
</style>
