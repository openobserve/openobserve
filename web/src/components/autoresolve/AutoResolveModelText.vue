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

<template>
  <div class="autoresolve-model-text text-text-body min-w-0 wrap-anywhere" v-html="html" />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { processHtmlBlock, renderMarkdown } from "@/components/O2AIChat.content";

const props = defineProps<{
  /** Markdown the agent wrote. */
  text: string;
}>();

// Every viewer of the run sees the agent's text, so it takes the chat's read-only sanitizer.
const html = computed(() => processHtmlBlock(renderMarkdown(props.text) as string, true));
</script>

<style scoped>
/* keep(generated-content): the sanitized markdown arrives through v-html, so its nodes carry no
   scope attribute or classes; :deep() element selectors are the only way to reach them. */
.autoresolve-model-text :deep(p),
.autoresolve-model-text :deep(ul),
.autoresolve-model-text :deep(ol) {
  margin: 0 0 0.5rem;
}
/* The base paragraph rule fixes its own size and colour; the text takes the host's. */
.autoresolve-model-text :deep(p),
.autoresolve-model-text :deep(li) {
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}
.autoresolve-model-text :deep(> :last-child) {
  margin-bottom: 0;
}
.autoresolve-model-text :deep(ul),
.autoresolve-model-text :deep(ol) {
  padding-left: 1.25rem;
}
.autoresolve-model-text :deep(ul) {
  list-style-type: disc;
}
.autoresolve-model-text :deep(ol) {
  list-style-type: decimal;
}
.autoresolve-model-text :deep(li) {
  margin: 0.15rem 0;
}
.autoresolve-model-text :deep(strong) {
  font-weight: 600;
}
.autoresolve-model-text :deep(a) {
  color: var(--color-text-link);
}
.autoresolve-model-text :deep(code) {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  background: color-mix(in srgb, var(--color-text-body) 8%, transparent);
  padding: 0.1rem 0.3rem;
  border-radius: 0.1875rem;
}
.autoresolve-model-text :deep(.generated-code-block) {
  display: block;
  white-space: pre-wrap;
  margin: 0 0 0.5rem;
  padding: 0.5rem 0.625rem;
  border-radius: 0.25rem;
  background: color-mix(in srgb, var(--color-text-body) 5%, transparent);
}
.autoresolve-model-text :deep(.generated-code-block code) {
  background: transparent;
  padding: 0;
}
</style>
