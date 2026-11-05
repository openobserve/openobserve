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

<!-- AI data health strip on LLM Insights: one chip per failing check with its
     count for the current scope and window, and a drawer whose cards link each
     problem to the setting or guide that fixes it. Hidden when every check passes. -->
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { formatDistanceToNowStrict } from "date-fns";
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import type {
  DataHealthCheck,
  DataHealthCheckId,
  DataHealthResponse,
} from "@/services/gen-ai-data-health.service";
import { healthCounts, shownChecks, unpricedTotals, type TimeWindow } from "./llmDataTrust.utils";
import type { DataHealthSamples } from "./composables/useLLMDataHealth";
import { affectedPct, useDataHealthText } from "./composables/useDataHealthText";
import LLMDataHealthCheckCard from "./LLMDataHealthCheckCard.vue";

const props = defineProps<{
  health: DataHealthResponse | null;
  loading?: boolean;
  error?: boolean;
  stream: string;
  /** The window `health` was checked over; the fix links open the same window. */
  checkedWindow?: TimeWindow | null;
  /** Sample trace ids per check; null until loaded. */
  samples: DataHealthSamples | null;
  samplesLoading?: boolean;
}>();

const emit = defineEmits<{
  rerun: [];
  "load-samples": [];
  "view-trace": [traceId: string];
}>();

const { t } = useI18nTyped();
const store = useStore();
const { label } = useDataHealthText();

const drawerOpen = ref(false);
const focusedCheck = ref<DataHealthCheckId | null>(null);

const checks = computed(() =>
  shownChecks(props.health?.checks ?? [], !!store.state.zoConfig?.model_pricing_enabled),
);
const counts = computed(() => healthCounts(checks.value));
// Passing checks fold into the "N passing" link; the drawer lists them all.
const failing = computed(() => checks.value.filter((c) => c.status !== "pass"));
const visible = computed(() => !!props.health && counts.value.errors + counts.value.warnings > 0);
const checkedAgo = computed(() =>
  props.health?.checked_at
    ? formatDistanceToNowStrict(new Date(props.health.checked_at / 1000), { addSuffix: true })
    : "",
);

/** The count a chip shows: models for pricing, share for identity/session, spans otherwise. */
function chipCount(check: DataHealthCheck): string {
  switch (check.id) {
    case "unpriced_models":
      return String(unpricedTotals(check).modelCount || check.affected);
    case "missing_agent_identity":
    case "missing_session_id":
      return affectedPct(check);
    default:
      return check.affected.toLocaleString();
  }
}

function openDrawer(id: DataHealthCheckId | null) {
  focusedCheck.value = id;
  drawerOpen.value = true;
}

// Samples cost a query per failing check, so they load only while the drawer
// is open; a new scope or a re-run clears them and they load again.
watch(
  () => drawerOpen.value && props.samples === null && !props.samplesLoading,
  (needed) => {
    if (needed) emit("load-samples");
  },
);

function viewTrace(traceId: string) {
  drawerOpen.value = false;
  emit("view-trace", traceId);
}
</script>

<template>
  <div
    v-if="error && !health"
    class="text-2xs text-text-secondary mt-2.5 flex items-center gap-2"
    data-test="llm-data-health-error"
  >
    <OIcon name="error" size="xs" />
    <span>{{ t("llmDataTrust.health.loadError") }}</span>
    <OButton variant="ghost-primary" size="xs" @click="emit('rerun')">{{
      t("llmDataTrust.health.rerun")
    }}</OButton>
  </div>
  <div
    v-else-if="visible"
    class="bg-card-glass-bg rounded-default border-border-default mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border px-3 py-2 text-xs"
    data-test="llm-data-health-strip"
  >
    <span class="text-text-heading inline-flex items-center gap-1.5 font-semibold">
      <OIcon name="monitor-heart" size="sm" />
      {{ t("llmDataTrust.health.title") }}
    </span>
    <!-- The icon carries the status, so it reads without the colour. -->
    <button
      v-for="check in failing"
      :key="check.id"
      type="button"
      class="rounded-default border-border-default hover:bg-surface-subtle inline-flex items-center gap-1 border px-2 py-0.5"
      :class="check.status === 'error' ? 'text-status-error-text' : 'text-status-warning-text'"
      :data-test="`llm-data-health-chip-${check.id}`"
      @click="openDrawer(check.id)"
    >
      <OIcon :name="check.status === 'error' ? 'error' : 'warning-amber'" size="xs" />
      {{ label(check.id) }} · {{ raw(chipCount(check)) }}
    </button>
    <button
      v-if="counts.passing"
      type="button"
      class="text-text-secondary hover:text-text-heading inline-flex items-center"
      data-test="llm-data-health-passing"
      @click="openDrawer(null)"
    >
      {{ t("llmDataTrust.health.passing", { n: counts.passing }) }}
      <OIcon name="chevron-right" size="xs" />
    </button>
    <span v-if="checkedAgo" class="text-text-secondary ms-auto">{{
      t("llmDataTrust.health.checkedAgo", { ago: checkedAgo })
    }}</span>
  </div>

  <ODrawer
    v-model:open="drawerOpen"
    size="md"
    :title="t('llmDataTrust.health.drawerTitle')"
    :sub-title="t('llmDataTrust.health.drawerSubtitle', { stream })"
    :primary-button-label="t('llmDataTrust.health.rerun')"
    :primary-button-loading="loading"
    primary-button-data-test="llm-data-health-rerun"
    :secondary-button-label="t('llmDataTrust.health.close')"
    @click:primary="emit('rerun')"
    @click:secondary="drawerOpen = false"
  >
    <div class="flex flex-col gap-2.5 p-3" data-test="llm-data-health-drawer">
      <LLMDataHealthCheckCard
        v-for="check in checks"
        :key="check.id"
        :check="check"
        :stream="stream"
        :checked-window="checkedWindow"
        :samples="samples?.[check.id]"
        :focused="focusedCheck === check.id"
        @view-trace="viewTrace"
        @leave="drawerOpen = false"
      />
    </div>
  </ODrawer>
</template>
