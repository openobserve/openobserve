<script setup lang="ts">
import type { CodeProps, CodeSlots } from "./OCode.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { ref } from "vue";

withDefaults(defineProps<CodeProps>(), {
  block: false,
  copyable: false,
  truncate: false,
});

defineSlots<CodeSlots>();

// Template ref — used to extract the rendered text for clipboard copy.
// Works with any slot content (plain text, spans, syntax-highlighted nodes).
const codeRef = ref<HTMLElement | null>(null);

const copied = ref(false);
let copyTimer: ReturnType<typeof setTimeout> | null = null;

async function copy() {
  const text = codeRef.value?.textContent?.trim() ?? "";
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // Clipboard API unavailable (non-secure context) — fail silently.
    // Never alert or throw; this is a convenience feature, not critical.
  }
}
</script>

<template>
  <!-- ── Block mode: full-width scrollable pre/code ── -->
  <pre
    v-if="block"
    class="relative block w-full rounded-default border border-code-border bg-code-block-bg text-code-block-text overflow-x-auto"
  ><code
      ref="codeRef"
      class="block px-3 py-2 text-xs font-mono leading-relaxed whitespace-pre"
    ><slot /></code><button
      v-if="copyable"
      type="button"
      :aria-label="copied ? 'Copied!' : 'Copy to clipboard'"
      class="absolute top-2 right-2 rounded-default p-1 transition-colors duration-150 text-code-copy-icon hover:text-code-copy-hover-icon hover:bg-code-copy-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      @click.prevent="copy"
    ><OIcon
        :name="copied ? 'check' : 'content-copy'"
        size="xs"
        class="pointer-events-none text-inherit!"
      /></button></pre>

  <!-- ── Inline mode: pill-shaped inline chip ── -->
  <code
    v-else
    ref="codeRef"
    :class="[
      'inline-flex items-center gap-1',
      'rounded-default border border-code-border bg-code-bg text-code-text',
      'px-1 py-px',
      'text-xs font-mono leading-none',
      truncate ? 'max-w-full truncate' : '',
    ]"
  >
    <slot />
    <button
      v-if="copyable"
      type="button"
      :aria-label="copied ? 'Copied!' : 'Copy'"
      class="shrink-0 rounded-default p-px transition-colors duration-150 text-code-copy-icon hover:text-code-copy-hover-icon hover:bg-code-copy-hover-bg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-400"
      @click.prevent="copy"
    >
      <OIcon
        :name="copied ? 'check' : 'content-copy'"
        size="xs"
        class="pointer-events-none text-inherit!"
      />
    </button>
  </code>
</template>
