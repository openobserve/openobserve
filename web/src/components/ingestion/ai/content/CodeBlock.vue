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
// A single highlighted code block for the AI integration cards. Uses the same
// copy affordance as the rest of ingestion (OButton ghost + OIcon content-copy
// + tooltip, as in CopyContent.vue), but adds highlight.js syntax colouring.
// Copy always copies the RAW `code` prop, never the highlighted markup.
import { computed, ref } from "vue";
import { useStore } from "vuex";
import hljs from "highlight.js";
import { copyToClipboard } from "@/utils/clipboard";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

const props = defineProps<{
  /** Raw (already token-substituted) code to display and copy. */
  code: string;
  /** Fence language, e.g. "bash" / "python"; "" when unspecified. */
  lang?: string;
  /**
   * Optional masked variant of `code` (e.g. the install command with the token
   * hidden). When set, the block shows it by default and exposes a Reveal/Hide
   * toggle; copy always copies the real `code`, never the mask.
   */
  codeMasked?: string;
  /** When true, show a ".env" button that emits `download-env`. */
  downloadEnv?: boolean;
  /**
   * Optional window chrome. "terminal" → macOS-style traffic-light dots + a
   * "Terminal" label (signals "run this in a shell"). "editor" → a filename tab
   * (signals "edit your source"). Omitted → the plain language label (default;
   * unchanged for the markdown cards).
   */
  chrome?: "terminal" | "editor";
  /** Filename shown in the "editor" chrome tab (falls back to the language). */
  filename?: string;
}>();

const emit = defineEmits<{
  (e: "copy"): void;
  (e: "download-env"): void;
}>();

const store = useStore();
const isDark = computed(() => store.state?.theme === "dark");

// Token reveal state — only relevant when `codeMasked` is provided.
const revealed = ref(false);
const displayCode = computed(() =>
  props.codeMasked && !revealed.value ? props.codeMasked : props.code,
);

// hljs escapes its own output, so the result is safe to v-html. On any error we
// fall back to manually-escaped text (never raw, so no injection). Highlights
// the DISPLAYED code (masked or real) — copy still uses the real `code`.
const highlighted = computed(() => {
  const code = displayCode.value;
  const { lang } = props;
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
});

const onCopy = () => {
  copyToClipboard(props.code, {
    successMessage: "Copied to clipboard!",
    errorMessage: "Error while copying content.",
  });
  emit("copy");
};
</script>

<template>
  <div
    class="o2-code-block"
    :class="[isDark ? 'o2-dark' : 'o2-light', chrome ? `o2-chrome-${chrome}` : '']"
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
      <div class="tw:flex tw:items-center tw:gap-1">
        <OButton
          v-if="codeMasked"
          data-test="ai-code-reveal-btn"
          variant="ghost"
          size="icon-xs-sq"
          @click="revealed = !revealed"
        >
          <OIcon :name="revealed ? 'visibility-off' : 'visibility'" size="sm" />
          <OTooltip :content="revealed ? 'Hide Token' : 'Reveal Token'" side="top" />
        </OButton>
        <OButton
          v-if="downloadEnv"
          data-test="ai-code-env-btn"
          variant="ghost"
          size="icon-xs-sq"
          @click="emit('download-env')"
        >
          <OIcon name="download" size="sm" />
          <OTooltip content="Download .env" side="top" />
        </OButton>
        <OButton
          data-test="ai-code-copy-btn"
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
  padding: 0.85rem 1rem;
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
