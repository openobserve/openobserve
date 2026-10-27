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
  a slot for extra toolbar actions. The Copy button copies the raw `code` prop;
  a text selection copies only what is shown, so a masked token stays masked.

  For inline / simple code chips without highlighting, use OCode.
-->
<script setup lang="ts">
import { computed, ref, type CSSProperties } from "vue";
import hljs from "./highlighter";
import { copyToClipboard } from "@/utils/clipboard";
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";
import type { CodeBlockProps, CodeBlockEmits, CodeBlockSlots } from "./OCodeBlock.types";

const { t } = useI18nTyped();

/**
 * Single source of truth for the code line-height: the stylesheet reads it via
 * the custom property below, and the max-height maths multiplies it. Declaring
 * it twice would let the visible line count drift from the actual leading.
 */
const CODE_LINE_HEIGHT = 1.55;

const CODE_INSET = "0.75rem";

const MASK_CHAR = "\u2022";

const props = withDefaults(defineProps<CodeBlockProps>(), {
  wrap: false,
  copyable: true,
  highlight: true,
  toolbar: true,
  lineNumbers: false,
  padded: false,
  inset: false,
  dataTest: "code-block",
  highlightedHtml: undefined,
  highlightMaxChars: undefined,
  scrollLabel: undefined,
  copyButtonClass: undefined,
  contrast: "default",
});

// Not `withDefaults` defaults: those are evaluated once at module scope, which
// would freeze these tooltips in the boot locale.
const revealTooltipText = computed(() => props.revealTooltip ?? t("common.reveal"));
const hideTooltipText = computed(() => props.hideTooltip ?? t("common.hide"));

/**
 * The line-height is published as a custom property so the stylesheet and the
 * max-height maths below share one number, and the cap is expressed in `em` so
 * it tracks the code font size rather than assuming a pixel value.
 */
const preStyle = computed(() => {
  // Record<string, string> widens CSSProperties enough to carry the custom
  // property, which Vue's typing does not model.
  const style: CSSProperties & Record<string, string> = {
    "--code-line-height": String(CODE_LINE_HEIGHT),
  };

  if (props.inset) style.padding = CODE_INSET;

  if (props.maxLines) {
    // The inset sits inside the capped box, so it is added on top of the line budget.
    const inset = props.inset ? ` + 2 * ${CODE_INSET}` : "";
    style.maxHeight = `calc(${props.maxLines} * ${CODE_LINE_HEIGHT}em${inset})`;
    style.overflowY = "auto";
  }

  return style;
});

const emit = defineEmits<CodeBlockEmits>();
defineSlots<CodeBlockSlots>();

// Secret reveal state — only relevant when `codeMasked` is provided.
const revealed = ref(false);
const displayCode = computed(() =>
  props.codeMasked && !revealed.value ? props.codeMasked : props.code,
);

// Bounded: a block whose code keeps changing would otherwise keep every version it ever showed.
const HIGHLIGHT_CACHE_LIMIT = 50;
// hljs escapes its own output, so the result is safe to v-html. On any error we
// fall back to manually-escaped text (never raw, so no injection). Highlighting
// is CPU-heavy and the inputs rarely change, so results are memoized by
// language + code (highlightOne is pure for a given pair).
const highlightCache = new Map<string, string>();
const escapeCode = (code: string) =>
  code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const highlightOne = (code: string, lang: string | undefined): string => {
  const known = !!lang && !!hljs.getLanguage(lang);
  const key = `${lang ?? ""}\u0000${code}`;
  const cached = highlightCache.get(key);
  if (cached !== undefined) {
    highlightCache.delete(key);
    highlightCache.set(key, cached);
    return cached;
  }
  let out: string;
  try {
    out = known ? hljs.highlight(code, { language: lang! }).value : hljs.highlightAuto(code).value;
  } catch {
    out = escapeCode(code);
  }
  highlightCache.set(key, out);
  if (highlightCache.size > HIGHLIGHT_CACHE_LIMIT)
    highlightCache.delete(highlightCache.keys().next().value as string);
  return out;
};
// Highlights the DISPLAYED code (masked or real) — copy still uses the real `code`.
const highlighted = computed(() => {
  if (props.highlightedHtml !== undefined && !props.codeMasked) return props.highlightedHtml;
  const code = displayCode.value;
  const tooLong = props.highlightMaxChars !== undefined && code.length > props.highlightMaxChars;
  return props.highlight && !tooLong ? highlightOne(code, props.lang) : escapeCode(code);
});

const langLabelClass = computed(() =>
  props.contrast === "aa" ? "text-syntax-text" : "opacity-55",
);

// Wrapping breaks the one-number-per-row assumption a gutter rests on, so the
// two features are exclusive rather than quietly misaligned.
const showLineNumbers = computed(() => props.lineNumbers && !props.wrap);

// One number per visible line, as a single pre-formatted string: the gutter is
// then one text node the browser lays out on the same leading as the code, with
// no per-line wrapper elements to keep in sync with the highlighted markup.
// A trailing newline gets no number — it is the end of the last line, not a line.
const lineNumberText = computed(() => {
  if (!showLineNumbers.value) return "";
  const lines = displayCode.value.replace(/\n$/, "").split("\n").length;
  return Array.from({ length: lines }, (_, i) => String(i + 1)).join("\n");
});

const copySuccessMessage = computed(() =>
  props.tokenName
    ? t("components.codeBlock.copiedWithToken", { name: props.tokenName })
    : (props.copyMessage ?? t("common.copySuccess")),
);

const onCopy = () => {
  copyToClipboard(props.code, t, {
    successMessage: copySuccessMessage.value,
    errorMessage: t("common.copyContentError"),
  }).then((copied) => {
    if (copied) emit("copy", { partial: false });
  });
};

const codeEl = ref<HTMLElement | null>(null);
const onNativeCopy = () => {
  const root = codeEl.value;
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const inside = root.contains(range.startContainer) && root.contains(range.endContainer);
  if (!inside) return;
  // a selection over the hidden token pastes as dots, so it is not a usable copy of the command
  if (props.codeMasked && !revealed.value && selection.toString().includes(MASK_CHAR)) {
    toast({ variant: "warning", message: t("components.codeBlock.maskedSelectionWarning") });
    return;
  }
  emit("copy", { partial: true });
};
</script>

<template>
  <div
    class="o2-code-block rounded-default border-border-default bg-syntax-bg my-3 overflow-hidden border"
    :class="[chrome ? `o2-chrome-${chrome}` : '', contrast === 'aa' ? 'o2-code-block--aa' : '']"
    :data-test="dataTest"
  >
    <div
      v-if="toolbar"
      class="o2-code-toolbar border-border-default flex items-center justify-between border-b py-1 ps-3 pe-1.5"
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
        <span class="o2-code-lang text-2xs font-mono opacity-55">{{
          t("components.codeBlock.terminal")
        }}</span>
      </span>
      <span
        v-else-if="chrome === 'editor'"
        class="o2-code-head bg-theme-tab-bg inline-flex min-w-0 items-center gap-2"
      >
        <OIcon name="code" size="xs" class="opacity-60" />
        <span class="font-mono text-xs font-semibold tracking-[0.01em] opacity-75">{{
          filename || lang || t("common.plainText")
        }}</span>
      </span>
      <span v-else class="o2-code-lang text-2xs font-mono" :class="langLabelClass">{{
        lang || t("common.plainText")
      }}</span>
      <div class="flex items-center gap-1">
        <OButton
          v-if="tokenName"
          :data-test="`${dataTest}-token-link`"
          variant="ghost-primary"
          size="xs"
          icon-left="key"
          @click="emit('token-click')"
        >
          {{ t("components.codeBlock.tokenLink", { name: tokenName }) }}
          <OTooltip :content="t('components.codeBlock.tokenLinkTooltip')" side="top" />
        </OButton>
        <OButton
          v-if="codeMasked"
          :data-test="`${dataTest}-reveal-btn`"
          variant="ghost"
          size="icon-xs-sq"
          @click="revealed = !revealed"
        >
          <OIcon :name="revealed ? 'visibility-off' : 'visibility'" size="sm" />
          <OTooltip :content="revealed ? hideTooltipText : revealTooltipText" side="top" />
        </OButton>
        <!-- Extra toolbar actions (e.g. a download button) -->
        <slot name="actions" />
        <OButton
          v-if="copyable"
          :data-test="`${dataTest}-copy-btn`"
          variant="ghost"
          size="icon-xs-sq"
          :class="copyButtonClass"
          :aria-label="t('common.copy')"
          @click="onCopy"
        >
          <OIcon name="content-copy" size="sm" />
          <OTooltip :content="t('common.copy')" side="top" />
        </OButton>
      </div>
    </div>
    <!-- `text-syntax-text!` — the `!` is load-bearing.
         `highlight.js/styles/github-dark.css` is imported globally (by O2AIChat)
         and its unlayered `.hljs { color }` beats anything in @layer utilities,
         so without it every token hljs leaves unclassed renders in the dark
         theme's pale grey, unreadable on the light syntax surface.
         Tag and content stay on one line: Vue preserves whitespace inside
         <pre>, so a newline here would indent the first line of code. -->
    <pre
      class="o2-code-pre"
      :class="[
        wrap ? 'o2-code-pre--wrap' : '',
        showLineNumbers ? 'o2-code-pre--numbered' : '',
        padded ? 'px-3 py-2' : '',
        scrollLabel ? 'focus-visible:ring-border-strong outline-none focus-visible:ring-2' : '',
      ]"
      :style="preStyle"
      :tabindex="scrollLabel ? 0 : undefined"
      :role="scrollLabel ? 'region' : undefined"
      :aria-label="scrollLabel"
      :data-test="`${dataTest}-pre`"
      @copy="onNativeCopy"
    ><span
      v-if="showLineNumbers"
      class="o2-code-gutter bg-syntax-bg text-syntax-comment sticky left-0 tabular-nums select-none"
      aria-hidden="true"
      :data-test="`${dataTest}-line-numbers`"
    >{{ lineNumberText }}</span><code ref="codeEl" class="hljs text-syntax-text!" :class="scrollLabel ? 'overflow-visible!' : ''" v-html="highlighted"></code></pre>
  </div>
</template>

<style scoped>
/* keep(generated-content): the `:deep(.hljs-*)` rules below colour highlight.js
   markup injected via v-html — those class names never appear in this template,
   so Tailwind cannot see them and no utility can reach them. The few non-:deep
   rules here are the ones whose values are unregistered tokens
   (--color-syntax-bg / --color-syntax-text have no @theme entry, so `bg-syntax-bg`
   would compile to nothing) or need color-mix over one. */
.o2-code-toolbar {
  background: color-mix(in srgb, var(--color-syntax-text) 4%, transparent);
}

/* editor tab: a subtle raised tab on the toolbar's left */
.o2-chrome-editor .o2-code-head {
  padding: 0.18rem 0.6rem;
  margin: -0.05rem 0;
  border-radius: 0.375rem;
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
  /* Font size lives here as well as on `code` so an em-based max-height set on
     this element resolves against the code's own type size. */
  font-size: var(--text-compact);
  line-height: var(--code-line-height, 1.55);
}

.o2-code-pre code {
  background: transparent;
  white-space: pre;
  font-size: inherit;
  line-height: inherit;
  padding: 0;
}

/* Line-number gutter. A flex row rather than a floated or absolutely-placed
   column, so the numbers cannot overlap the code at any width, and `sticky` keeps
   them in view while a long line scrolls sideways underneath — which is also why
   the gutter carries the block's own background. */
.o2-code-pre--numbered {
  display: flex;
}

.o2-code-gutter {
  flex: none;
  padding-right: 1rem;
  text-align: right;
  /* Muted rather than hidden: the numbers are for reference, not for reading. */
  opacity: 0.65;
}

/* Wrapped mode: break anywhere, because a long SQL string can be one
   unbroken token and would otherwise still overflow sideways. */
.o2-code-pre--wrap {
  overflow-x: hidden;
}

.o2-code-pre--wrap code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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

.o2-code-block--aa {
  :deep(.hljs-keyword),
  :deep(.hljs-doctag),
  :deep(.hljs-type) {
    color: color-mix(in srgb, var(--color-syntax-keyword) 80%, var(--color-syntax-text));
  }
  :deep(.hljs-built_in),
  :deep(.hljs-symbol) {
    color: color-mix(in srgb, var(--color-syntax-builtin) 70%, var(--color-syntax-text));
  }
  :deep(.hljs-name),
  :deep(.hljs-quote),
  :deep(.hljs-selector-tag) {
    color: color-mix(in srgb, var(--color-syntax-tag) 80%, var(--color-syntax-text));
  }
}
</style>
