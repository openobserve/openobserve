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
    class="o2-code-block rounded-default border-border-default bg-syntax-bg my-3 overflow-hidden border"
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
        class="o2-code-head bg-theme-tab-bg inline-flex min-w-0 items-center gap-2"
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
    <pre class="o2-code-pre"><code class="hljs text-syntax-text" v-html="highlighted"></code></pre>
  </div>
</template>

<style scoped>
/* keep(generated-content): the `:deep(.hljs-*)` rules below colour highlight.js
   markup injected via v-html — those class names never appear in this template,
   so Tailwind cannot see them and no utility can reach them. Everything else
   whose value is a token is a utility in the template: the block surface is
   `bg-syntax-bg`, the code text `text-syntax-text`, the editor tab
   `bg-theme-tab-bg`. What stays here either mixes a token (color-mix) or sets a
   non-colour property. */
.o2-code-toolbar {
  background: color-mix(in srgb, var(--color-syntax-text) 4%, transparent);
}

/* editor tab: a subtle raised tab on the toolbar's left (its fill is
   `bg-theme-tab-bg` on the element; only the geometry is here) */
.o2-chrome-editor .o2-code-head {
  padding: 0.18rem 0.6rem;
  margin: -0.05rem 0;
  border-radius: var(--radius-default);
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
}

/* ============ CODE THEME (token-driven; tokens flip via dark.css,
   so one rule set covers both themes) ============ */
.o2-code-block :deep(.hljs-doctag),
.o2-code-block :deep(.hljs-keyword),
.o2-code-block :deep(.hljs-meta .hljs-keyword),
.o2-code-block :deep(.hljs-template-tag),
.o2-code-block :deep(.hljs-template-variable),
.o2-code-block :deep(.hljs-type),
.o2-code-block :deep(.hljs-variable.language_) {
  color: var(--color-syntax-keyword);
}

.o2-code-block :deep(.hljs-title),
.o2-code-block :deep(.hljs-title.class_),
.o2-code-block :deep(.hljs-title.function_) {
  color: var(--color-syntax-function);
}

.o2-code-block :deep(.hljs-attr),
.o2-code-block :deep(.hljs-attribute),
.o2-code-block :deep(.hljs-literal),
.o2-code-block :deep(.hljs-meta),
.o2-code-block :deep(.hljs-number),
.o2-code-block :deep(.hljs-operator),
.o2-code-block :deep(.hljs-variable),
.o2-code-block :deep(.hljs-selector-attr),
.o2-code-block :deep(.hljs-selector-class),
.o2-code-block :deep(.hljs-selector-id) {
  color: var(--color-syntax-number);
}

.o2-code-block :deep(.hljs-regexp),
.o2-code-block :deep(.hljs-string),
.o2-code-block :deep(.hljs-meta .hljs-string) {
  color: var(--color-syntax-string);
}

.o2-code-block :deep(.hljs-built_in),
.o2-code-block :deep(.hljs-symbol) {
  color: var(--color-syntax-builtin);
}

.o2-code-block :deep(.hljs-comment),
.o2-code-block :deep(.hljs-code),
.o2-code-block :deep(.hljs-formula) {
  color: var(--color-syntax-comment);
}

.o2-code-block :deep(.hljs-name),
.o2-code-block :deep(.hljs-quote),
.o2-code-block :deep(.hljs-selector-tag),
.o2-code-block :deep(.hljs-selector-pseudo) {
  color: var(--color-syntax-tag);
}

.o2-code-block :deep(.hljs-section) {
  color: var(--color-syntax-number);
  font-weight: 600;
}
</style>
