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

<script setup lang="ts">
import { computed, ref, type CSSProperties } from "vue";
import hljs from "./highlighter";
import { toast } from "@/lib/feedback/Toast/useToast";
import OButton from "@/lib/core/Button/OButton.vue";
import OCopyButton from "@/lib/core/CopyButton/OCopyButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { CodeBlockProps, CodeBlockEmits, CodeBlockSlots } from "./OCodeBlock.types";

const { t } = useI18nTyped();

// One number feeds both the stylesheet and the collapsed-height maths, so they cannot drift.
const CODE_LINE_HEIGHT = 1.5;

const MASK_CHAR = "•";

// A line this long overflows a typical drawer, so the head offers Wrap.
const WRAP_HINT_CHARS = 60;

const props = withDefaults(defineProps<CodeBlockProps>(), {
  sensitive: false,
  wrap: false,
  copyable: true,
  lineNumbers: false,
  maxLines: 12,
  dataTest: "code-block",
});

const emit = defineEmits<CodeBlockEmits>();
defineSlots<CodeBlockSlots>();

const revealed = ref(false);
const wrapped = ref(props.wrap);
const expanded = ref(false);

const displayCode = computed(() =>
  props.codeMasked && !revealed.value ? props.codeMasked : props.code,
);
const lines = computed(() => displayCode.value.replace(/\n$/, "").split("\n"));
const lineCount = computed(() => lines.value.length);
const canWrap = computed(() => lines.value.some((line) => line.length > WRAP_HINT_CHARS));
const collapsible = computed(() => lineCount.value > props.maxLines);
const collapsed = computed(() => collapsible.value && !expanded.value);

// hljs escapes its own output, so v-html is safe; on error the text is escaped by hand.
const highlightCache = new Map<string, string>();
const highlightOne = (code: string, lang?: string): string => {
  const key = `${lang ?? ""}\u0000${code}`;
  const cached = props.sensitive ? undefined : highlightCache.get(key);
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
  if (!props.sensitive) highlightCache.set(key, out);
  return out;
};
const highlighted = computed(() => highlightOne(displayCode.value, props.lang));

const showLineNumbers = computed(() => props.lineNumbers && !wrapped.value);
const lineNumberText = computed(() =>
  showLineNumbers.value
    ? Array.from({ length: lineCount.value }, (_, i) => String(i + 1)).join("\n")
    : "",
);

const preStyle = computed(() => {
  const style: CSSProperties & Record<string, string> = {
    "--code-line-height": String(CODE_LINE_HEIGHT),
  };
  if (collapsed.value) {
    style.maxHeight = `calc(${props.maxLines} * ${CODE_LINE_HEIGHT}em + 1.5rem)`;
  }
  return style;
});

const headName = computed(() => props.filename || props.lang || t("common.plainText"));
// Plain text is no language worth naming next to a file name.
const PLAIN_LANGS = new Set(["plaintext", "text", "txt"]);
const headLang = computed(() =>
  props.filename && props.lang && !PLAIN_LANGS.has(props.lang) ? props.lang : "",
);

const codeEl = ref<HTMLElement | null>(null);
const onNativeCopy = () => {
  const root = codeEl.value;
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const inside = root.contains(range.startContainer) && root.contains(range.endContainer);
  if (!inside) return;
  // A selection over the hidden token pastes as dots, so it is not a usable copy of the command.
  if (props.codeMasked && !revealed.value && selection.toString().includes(MASK_CHAR)) {
    toast({ variant: "warning", message: t("components.codeBlock.maskedSelectionWarning") });
    return;
  }
  emit("copy", { partial: true });
};
</script>

<template>
  <div
    class="o2-code-block rounded-default border-border-default bg-syntax-bg my-3 min-w-0 overflow-hidden border"
    :data-test="dataTest"
  >
    <div
      class="o2-code-toolbar border-border-subtle text-text-secondary flex h-9 items-center gap-2 border-b ps-3 pe-1 text-xs"
    >
      <span class="text-text-heading min-w-0 truncate font-mono" :data-test="`${dataTest}-name`">{{
        headName
      }}</span>
      <span v-if="headLang" class="shrink-0">{{ raw(headLang) }}</span>
      <span class="flex-1" />
      <OButton
        v-if="tokenName"
        :data-test="`${dataTest}-token-link`"
        variant="accent-ghost"
        size="sm"
        icon="key"
        @click="emit('token-click')"
      >
        {{ t("components.codeBlock.tokenLink", { name: tokenName }) }}
        <OTooltip :content="t('components.codeBlock.tokenLinkTooltip')" side="top" />
      </OButton>
      <OButton
        v-if="codeMasked"
        icon-only
        :icon="revealed ? 'visibility-off' : 'visibility'"
        :label="revealed ? t('common.hide') : t('common.reveal')"
        :pressed="revealed"
        :data-test="`${dataTest}-reveal-btn`"
        variant="ghost"
        size="sm"
        @click="revealed = !revealed"
      />
      <slot name="actions" />
      <OButton
        v-if="canWrap"
        icon-only
        icon="wrap-text"
        :label="t('components.codeBlock.wrapLines')"
        :pressed="wrapped"
        :data-test="`${dataTest}-wrap-btn`"
        variant="ghost"
        size="sm"
        @click="wrapped = !wrapped"
      />
      <OCopyButton
        v-if="copyable"
        :value="code"
        show-label
        size="sm"
        :data-test="`${dataTest}-copy-btn`"
        @copied="emit('copy', { partial: false })"
      />
    </div>
    <!-- `text-syntax-text!` beats the unlayered `.hljs { color }` of the global highlight.js theme.
         Tag and content stay on one line: a newline inside <pre> would indent the first line. -->
    <pre
      class="o2-code-pre p-3"
      :class="[
        wrapped ? 'o2-code-pre--wrap' : '',
        showLineNumbers ? 'o2-code-pre--numbered' : '',
        collapsed ? 'overflow-y-hidden mask-b-from-60%' : '',
      ]"
      :style="preStyle"
      :data-test="`${dataTest}-pre`"
      @copy="onNativeCopy"
    ><span
      v-if="showLineNumbers"
      class="o2-code-gutter bg-syntax-bg text-syntax-comment sticky left-0 tabular-nums select-none"
      aria-hidden="true"
      :data-test="`${dataTest}-line-numbers`"
    >{{ lineNumberText }}</span><code ref="codeEl" class="hljs text-syntax-text!" v-html="highlighted"></code></pre>
    <div v-if="collapsible" class="border-border-subtle flex justify-center border-t p-1">
      <OButton
        variant="link"
        size="sm"
        :data-test="`${dataTest}-show-all`"
        @click="expanded = !expanded"
        >{{
          expanded
            ? t("components.codeBlock.showLess")
            : t("components.codeBlock.showAll", { count: lineCount }, lineCount)
        }}</OButton
      >
    </div>
  </div>
</template>

<style scoped>
/* keep(generated-content): the :deep(.hljs-*) rules colour highlight.js markup injected
   via v-html, whose class names never appear in this template. */
.o2-code-toolbar {
  background: color-mix(in srgb, var(--color-syntax-text) 4%, transparent);
}

.o2-code-pre {
  margin: 0;
  overflow-x: auto;
  background: transparent;
  /* The size sits here so an em-based max-height resolves against the code's own type size. */
  font-size: var(--text-xs);
  line-height: var(--code-line-height, 1.5);
}

.o2-code-pre code {
  background: transparent;
  white-space: pre;
  font-size: inherit;
  line-height: inherit;
  padding: 0;
}

/* A flex row keeps the numbers off the code at any width; sticky keeps them in view on scroll. */
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

/* Break anywhere: a long SQL string can be one unbroken token. */
.o2-code-pre--wrap {
  overflow-x: hidden;
}

.o2-code-pre--wrap code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Token-driven, so one rule set covers both themes. */
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
