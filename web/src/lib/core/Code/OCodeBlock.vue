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
import { useStore } from "vuex";
import hljs from "highlight.js";
import { copyToClipboard } from "@/utils/clipboard";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type {
  CodeBlockProps,
  CodeBlockEmits,
  CodeBlockSlots,
} from "./OCodeBlock.types";

const props = withDefaults(defineProps<CodeBlockProps>(), {
  copyable: true,
  copyMessage: "Copied to clipboard!",
  revealTooltip: "Reveal",
  hideTooltip: "Hide",
  dataTest: "code-block",
});

const emit = defineEmits<CodeBlockEmits>();
defineSlots<CodeBlockSlots>();

const store = useStore();
const isDark = computed(() => store.state?.theme === "dark");

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
    out = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
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
    class="o2-code-block"
    :class="[isDark ? 'o2-dark' : 'o2-light', chrome ? `o2-chrome-${chrome}` : '']"
    :data-test="dataTest"
  >
    <div class="o2-code-toolbar">
      <span v-if="chrome === 'terminal'" class="o2-code-head">
        <span class="o2-win-dots" aria-hidden="true"><i /><i /><i /></span>
        <span class="o2-code-lang">Terminal</span>
      </span>
      <span v-else-if="chrome === 'editor'" class="o2-code-head">
        <OIcon name="code" size="xs" class="o2-code-file-ico" />
        <span class="o2-code-file">{{ filename || lang || "text" }}</span>
      </span>
      <span v-else class="o2-code-lang">{{ lang || "text" }}</span>
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
.o2-code-block {
  border-radius: 8px;
  overflow: hidden;
  margin: 0.75rem 0;
  border: 1px solid;
}

.o2-code-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0.4rem 0.25rem 0.75rem;
  border-bottom: 1px solid;
}

.o2-code-lang {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.55;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* window chrome (terminal / editor) */
.o2-code-head {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.o2-win-dots {
  display: inline-flex;
  gap: 5px;
}
.o2-win-dots i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: block;
}
.o2-win-dots i:nth-child(1) {
  background: #ec6a5e;
}
.o2-win-dots i:nth-child(2) {
  background: #f4bf4f;
}
.o2-win-dots i:nth-child(3) {
  background: #61c454;
}
.o2-code-file {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  opacity: 0.75;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.o2-code-file-ico {
  opacity: 0.6;
}
/* editor tab: a subtle raised tab on the toolbar's left */
.o2-chrome-editor .o2-code-head {
  padding: 0.18rem 0.6rem;
  margin: -0.05rem 0;
  border-radius: 6px;
  background: var(--o2-tab-bg, rgba(0, 0, 0, 0.05));
}
.o2-dark.o2-chrome-editor .o2-code-head {
  --o2-tab-bg: rgba(255, 255, 255, 0.06);
}

.o2-code-pre {
  margin: 0;
  overflow-x: auto;
  background: transparent;
}

.o2-code-pre code {
  background: transparent;
  white-space: pre;
  font-size: 0.8125rem;
  line-height: 1.55;
  padding: 0;
}

/* ===================== LIGHT THEME ===================== */
.o2-light {
  background: #f6f8fa;
  border-color: rgba(0, 0, 0, 0.1);

  .o2-code-toolbar {
    background: rgba(0, 0, 0, 0.03);
    border-bottom-color: rgba(0, 0, 0, 0.08);
  }
  .o2-code-pre code {
    color: #24292e;
  }
  // github (light) token palette
  :deep(.hljs-doctag),
  :deep(.hljs-keyword),
  :deep(.hljs-meta .hljs-keyword),
  :deep(.hljs-template-tag),
  :deep(.hljs-template-variable),
  :deep(.hljs-type),
  :deep(.hljs-variable.language_) {
    color: #d73a49;
  }
  :deep(.hljs-title),
  :deep(.hljs-title.class_),
  :deep(.hljs-title.function_) {
    color: #6f42c1;
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
    color: #005cc5;
  }
  :deep(.hljs-regexp),
  :deep(.hljs-string),
  :deep(.hljs-meta .hljs-string) {
    color: #032f62;
  }
  :deep(.hljs-built_in),
  :deep(.hljs-symbol) {
    color: #e36209;
  }
  :deep(.hljs-comment),
  :deep(.hljs-code),
  :deep(.hljs-formula) {
    color: #6a737d;
  }
  :deep(.hljs-name),
  :deep(.hljs-quote),
  :deep(.hljs-selector-tag),
  :deep(.hljs-selector-pseudo) {
    color: #22863a;
  }
  :deep(.hljs-section) {
    color: #005cc5;
    font-weight: 600;
  }
}

/* ===================== DARK THEME ===================== */
.o2-dark {
  background: #0d1117;
  border-color: rgba(255, 255, 255, 0.08);

  .o2-code-toolbar {
    background: rgba(255, 255, 255, 0.04);
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }
  .o2-code-pre code {
    color: #c9d1d9;
  }
  // github-dark token palette
  :deep(.hljs-doctag),
  :deep(.hljs-keyword),
  :deep(.hljs-meta .hljs-keyword),
  :deep(.hljs-template-tag),
  :deep(.hljs-template-variable),
  :deep(.hljs-type),
  :deep(.hljs-variable.language_) {
    color: #ff7b72;
  }
  :deep(.hljs-title),
  :deep(.hljs-title.class_),
  :deep(.hljs-title.function_) {
    color: #d2a8ff;
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
    color: #79c0ff;
  }
  :deep(.hljs-regexp),
  :deep(.hljs-string),
  :deep(.hljs-meta .hljs-string) {
    color: #a5d6ff;
  }
  :deep(.hljs-built_in),
  :deep(.hljs-symbol) {
    color: #ffa657;
  }
  :deep(.hljs-comment),
  :deep(.hljs-code),
  :deep(.hljs-formula) {
    color: #8b949e;
  }
  :deep(.hljs-name),
  :deep(.hljs-quote),
  :deep(.hljs-selector-tag),
  :deep(.hljs-selector-pseudo) {
    color: #7ee787;
  }
  :deep(.hljs-section) {
    color: #1f6feb;
    font-weight: 600;
  }
}
</style>
