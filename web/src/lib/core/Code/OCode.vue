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
    class="rounded-default border-code-border bg-code-block-bg text-code-block-text relative block w-full overflow-x-auto border"
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
      'rounded-default border-code-border bg-code-bg text-code-text border',
      'px-1 py-px',
      'font-mono text-xs leading-none',
      truncate ? 'max-w-full truncate' : '',
    ]"
  >
    <slot />
    <button
      v-if="copyable"
      type="button"
      :aria-label="copied ? 'Copied!' : 'Copy'"
      class="rounded-default text-code-copy-icon hover:text-code-copy-hover-icon hover:bg-code-copy-hover-bg focus-visible:ring-primary-400 shrink-0 p-px transition-colors duration-150 focus-visible:ring-1 focus-visible:outline-none"
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
