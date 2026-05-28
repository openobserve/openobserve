<script setup lang="ts">
import type { CodeProps, CodeSlots } from "./OCode.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { ref } from "vue";

const props = withDefaults(defineProps<CodeProps>(), {
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
    class="tw:relative tw:block tw:w-full tw:rounded-md tw:border tw:border-code-border tw:bg-code-block-bg tw:text-code-block-text tw:overflow-x-auto"
  ><code
      ref="codeRef"
      class="tw:block tw:px-3 tw:py-2 tw:text-xs tw:[font-family:var(--font-mono)] tw:leading-relaxed tw:whitespace-pre"
    ><slot /></code><button
      v-if="copyable"
      type="button"
      :aria-label="copied ? 'Copied!' : 'Copy to clipboard'"
      class="tw:absolute tw:top-2 tw:right-2 tw:rounded tw:p-1 tw:transition-colors tw:duration-150 tw:text-code-copy-icon hover:tw:text-code-copy-hover-icon hover:tw:bg-code-copy-hover-bg focus-visible:tw:outline-none focus-visible:tw:ring-2 focus-visible:tw:ring-primary-400"
      @click.prevent="copy"
    ><OIcon
        :name="copied ? 'check' : 'content-copy'"
        size="xs"
        class="tw:pointer-events-none tw:text-inherit!"
      /></button></pre>

  <!-- ── Inline mode: pill-shaped inline chip ── -->
  <code
    v-else
    ref="codeRef"
    :class="[
      'tw:inline-flex tw:items-center tw:gap-1',
      'tw:rounded tw:border tw:border-code-border tw:bg-code-bg tw:text-code-text',
      'tw:px-1 tw:py-px',
      'tw:text-xs tw:[font-family:var(--font-mono)] tw:leading-none',
      truncate ? 'tw:max-w-full tw:truncate' : '',
    ]"
  >
    <slot />
    <button
      v-if="copyable"
      type="button"
      :aria-label="copied ? 'Copied!' : 'Copy'"
      class="tw:shrink-0 tw:rounded tw:p-px tw:transition-colors tw:duration-150 tw:text-code-copy-icon hover:tw:text-code-copy-hover-icon hover:tw:bg-code-copy-hover-bg focus-visible:tw:outline-none focus-visible:tw:ring-1 focus-visible:tw:ring-primary-400"
      @click.prevent="copy"
    >
      <OIcon
        :name="copied ? 'check' : 'content-copy'"
        size="xs"
        class="tw:pointer-events-none tw:text-inherit!"
      />
    </button>
  </code>
</template>
