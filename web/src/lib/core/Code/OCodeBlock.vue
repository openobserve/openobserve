<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  OCodeBlock — a syntax-highlighted block of code with a copy button, optional
  secret masking (Reveal/Hide), optional window chrome (terminal / editor), and
  a slot for extra toolbar actions. Copy always copies the raw `code` prop, never
  the highlighted markup or the masked variant.

  For inline / simple code chips without highlighting, use OCode.
-->
<script setup lang="ts">
import { computed, ref } from "vue";
import hljs from "highlight.js";
import { copyToClipboard } from "@/utils/clipboard";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { CodeBlockProps, CodeBlockEmits, CodeBlockSlots } from "./OCodeBlock.types";

const props = withDefaults(defineProps<CodeBlockProps>(), {
  copyable: true,
  copyMessage: "Copied to clipboard!",
  revealTooltip: "Reveal",
  hideTooltip: "Hide",
  dataTest: "code-block",
});

const emit = defineEmits<CodeBlockEmits>();
defineSlots<CodeBlockSlots>();

// Secret reveal state — only relevant when `codeMasked` is provided.
const revealed = ref(false);
const displayCode = computed(() =>
  props.codeMasked && !revealed.value ? props.codeMasked : props.code,
);

// hljs escapes its own output, so the result is safe to v-html. On any error we
// fall back to manually-escaped text (never raw, so no injection). Highlighting
// is CPU-heavy and the inputs rarely change, so results are memoized by
// language + code (highlightOne is pure for a given pair).
const highlightCache = new Map<string, string>();
const highlightOne = (code: string, lang?: string): string => {
  const key = `${lang ?? ""}\u0000${code}`;
  const cached = highlightCache.get(key);
  if (cached !== undefined) return cached;
  let out: string;
  try {
    out =
      lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;
  } catch {
    out = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  highlightCache.set(key, out);
  return out;
};
// Highlights the DISPLAYED code (masked or real) — copy still uses the real `code`.
const highlighted = computed(() => highlightOne(displayCode.value, props.lang));

const onCopy = () => {
  copyToClipboard(props.code, {
    successMessage: props.copyMessage,
    errorMessage: "Error while copying content.",
  });
  emit("copy");
};
</script>

<template>
  <div
    class="o2-code-block rounded-default border-border-default my-3 overflow-hidden border"
    :class="chrome ? `o2-chrome-${chrome}` : ''"
    :data-test="dataTest"
  >
    <div
      class="o2-code-toolbar border-border-default flex items-center justify-between border-b py-1 pr-1.5 pl-3"
    >
      <span
        v-if="chrome === 'terminal'"
        class="o2-code-head inline-flex min-w-0 items-center gap-2"
      >
        <span class="inline-flex gap-1.5" aria-hidden="true">
          <i class="bg-status-negative block size-2.5 rounded-full" />
          <i class="bg-warning block size-2.5 rounded-full" />
          <i class="bg-status-positive block size-2.5 rounded-full" />
        </span>
        <span class="o2-code-lang text-2xs font-mono tracking-wider uppercase opacity-55"
          >Terminal</span
        >
      </span>
      <span
        v-else-if="chrome === 'editor'"
        class="o2-code-head inline-flex min-w-0 items-center gap-2"
      >
        <OIcon name="code" size="xs" class="opacity-60" />
        <span class="font-mono text-xs font-semibold tracking-[0.01em] opacity-75">{{
          filename || lang || "text"
        }}</span>
      </span>
      <span v-else class="o2-code-lang text-2xs font-mono tracking-wider uppercase opacity-55">{{
        lang || "text"
      }}</span>
      <div class="flex items-center gap-1">
        <OButton
          v-if="codeMasked"
          :data-test="`${dataTest}-reveal-btn`"
          variant="ghost"
          size="icon-xs-sq"
          @click="revealed = !revealed"
        >
          <OIcon :name="revealed ? 'visibility-off' : 'visibility'" size="sm" />
          <OTooltip :content="revealed ? hideTooltip : revealTooltip" side="top" />
        </OButton>
        <!-- Extra toolbar actions (e.g. a download button) -->
        <slot name="actions" />
        <OButton
          v-if="copyable"
          :data-test="`${dataTest}-copy-btn`"
          variant="ghost"
          size="icon-xs-sq"
          @click="onCopy"
        >
          <OIcon name="content-copy" size="sm" />
          <OTooltip content="Copy" side="top" />
        </OButton>
      </div>
    </div>
    <pre class="o2-code-pre"><code class="hljs" v-html="highlighted"></code></pre>
  </div>
</template>

<style scoped lang="scss">
/* keep(generated-content): the `:deep(.hljs-*)` rules below colour highlight.js
   markup injected via v-html — those class names never appear in this template,
   so Tailwind cannot see them and no utility can reach them. The few non-:deep
   rules here are the ones whose values are unregistered tokens
   (--color-syntax-bg / --color-syntax-text have no @theme entry, so `bg-syntax-bg`
   would compile to nothing) or need color-mix over one. */
.o2-code-block {
  /* --color-syntax-* are :root-only (no @theme registration) → no utility exists.
     They flip light→dark in dark.css, so one rule set covers both themes. */
  background: var(--color-syntax-bg);
}

.o2-code-toolbar {
  background: color-mix(in srgb, var(--color-syntax-text) 4%, transparent);
}

/* editor tab: a subtle raised tab on the toolbar's left */
.o2-chrome-editor .o2-code-head {
  padding: 0.18rem 0.6rem;
  margin: -0.05rem 0;
  border-radius: 0.375rem;
  background: var(--color-theme-tab-bg);
}
/* Dark keeps a neutral white wash rather than the accent-tinted token, so the
   tab reads as a highlight on the near-black syntax surface. `.dark` is set on
   the root by utils/theme.ts (see dark.css). */
.dark .o2-chrome-editor .o2-code-head {
  background: color-mix(in srgb, var(--color-white) 6%, transparent);
}

.o2-code-pre {
  margin: 0;
  overflow-x: auto;
  background: transparent;
}

.o2-code-pre code {
  background: transparent;
  white-space: pre;
  font-size: var(--text-compact);
  line-height: 1.55;
  padding: 0;
  color: var(--color-syntax-text);
}

/* ============ CODE THEME (token-driven; tokens flip via dark.css,
   so one rule set covers both themes) ============ */
.o2-code-block {
  :deep(.hljs-doctag),
  :deep(.hljs-keyword),
  :deep(.hljs-meta .hljs-keyword),
  :deep(.hljs-template-tag),
  :deep(.hljs-template-variable),
  :deep(.hljs-type),
  :deep(.hljs-variable.language_) {
    color: var(--color-syntax-keyword);
  }
  :deep(.hljs-title),
  :deep(.hljs-title.class_),
  :deep(.hljs-title.function_) {
    color: var(--color-syntax-function);
  }
  :deep(.hljs-attr),
  :deep(.hljs-attribute),
  :deep(.hljs-literal),
  :deep(.hljs-meta),
  :deep(.hljs-number),
  :deep(.hljs-operator),
  :deep(.hljs-variable),
  :deep(.hljs-selector-attr),
  :deep(.hljs-selector-class),
  :deep(.hljs-selector-id) {
    color: var(--color-syntax-number);
  }
  :deep(.hljs-regexp),
  :deep(.hljs-string),
  :deep(.hljs-meta .hljs-string) {
    color: var(--color-syntax-string);
  }
  :deep(.hljs-built_in),
  :deep(.hljs-symbol) {
    color: var(--color-syntax-builtin);
  }
  :deep(.hljs-comment),
  :deep(.hljs-code),
  :deep(.hljs-formula) {
    color: var(--color-syntax-comment);
  }
  :deep(.hljs-name),
  :deep(.hljs-quote),
  :deep(.hljs-selector-tag),
  :deep(.hljs-selector-pseudo) {
    color: var(--color-syntax-tag);
  }
  :deep(.hljs-section) {
    color: var(--color-syntax-number);
    font-weight: 600;
  }
}
</style>
