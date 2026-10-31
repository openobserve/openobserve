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
  <div
    class="bg-surface-base border-border-default flex h-10 shrink-0 items-center gap-2.5 border-b px-4 text-xs"
    data-test="query-plan-analyze-bar"
  >
    <OBadge size="sm" variant="success-soft" class="shrink-0">
      <OIcon name="check-circle" size="xs" />
      {{ command }}
    </OBadge>
    <OTruncatedText class="text-text-secondary flex-1" data-test="query-plan-analyze-bar-summary">{{
      summary
    }}</OTruncatedText>
    <OButton
      variant="outline"
      size="sm"
      icon-left="refresh"
      :disabled="busy"
      data-test="query-plan-analyze-rerun"
      @click="emit('rerun')"
      >{{ t("search.queryProfile.rerun") }}</OButton
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  ranAt: string;
  took: string | null;
  nodes: number;
  busy: boolean;
}>();

const emit = defineEmits<{ rerun: [] }>();

const { t } = useI18nTyped();

const command = raw("EXPLAIN ANALYZE");

const summary = computed(() => {
  const parts: string[] = [t("search.queryProfile.ranAt", { time: props.ranAt })];
  if (props.took) parts.push(t("search.queryProfile.tookValue", { took: props.took }));
  if (props.nodes > 0) {
    parts.push(t("search.queryProfile.nodesCount", { count: props.nodes }, props.nodes));
  }
  return raw(parts.join(" · "));
});
</script>
