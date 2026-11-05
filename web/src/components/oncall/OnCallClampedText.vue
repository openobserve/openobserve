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

<!-- A long timeline line held to three lines, with the rest one click away. -->
<template>
  <span class="flex basis-full flex-col items-start gap-0.5" data-test="oncall-clamped-text">
    <span
      ref="textRef"
      class="text-text-body text-sm"
      :class="expanded ? '' : 'line-clamp-3'"
      data-test="oncall-clamped-text-body"
      v-html="html"
    />
    <OButton
      v-if="overflows || expanded"
      variant="ghost"
      size="xs"
      :icon-left="expanded ? 'expand-less' : 'expand-more'"
      data-test="oncall-clamped-text-toggle"
      @click="expanded = !expanded"
    >
      {{ expanded ? t("oncall.activityShowLess") : t("oncall.activityShowMore") }}
    </OButton>
  </span>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  /** Already sanitised markup. */
  html: string;
}>();

const { t } = useI18nTyped();
const textRef = ref<HTMLElement | null>(null);
const expanded = ref(false);
const overflows = ref(false);

/// Measured only while clamped: an expanded line always fits, which would hide the way back.
function measure() {
  const el = textRef.value;
  if (!el || expanded.value) return;
  overflows.value = el.scrollHeight > el.clientHeight + 1;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined" && textRef.value) {
    observer = new ResizeObserver(measure);
    observer.observe(textRef.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => props.html,
  async () => {
    await nextTick();
    measure();
  },
);

defineExpose({ measure });
</script>
