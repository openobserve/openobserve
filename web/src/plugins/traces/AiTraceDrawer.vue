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

<!-- Opens a trace in place so the AI page keeps its agent, version and time range. -->
<template>
  <ODrawer
    :open="open"
    side="right"
    :width="70"
    bleed
    :title="title"
    data-test="ai-trace-drawer"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <template #header-right>
      <div class="flex items-center gap-2">
        <OToggleGroup
          v-if="evaluator && trace"
          :model-value="view"
          data-test="ai-trace-drawer-view"
          @update:model-value="(v) => (view = v === 'evaluator' ? 'evaluator' : 'trace')"
        >
          <OToggleGroupItem value="trace" size="sm" data-test="ai-trace-drawer-view-trace">
            {{ t("aiTraceDrawer.trace") }}
          </OToggleGroupItem>
          <OToggleGroupItem value="evaluator" size="sm" data-test="ai-trace-drawer-view-evaluator">
            {{ t("aiTraceDrawer.evaluatorTrace") }}
          </OToggleGroupItem>
        </OToggleGroup>
        <OButton
          variant="outline"
          size="sm"
          icon-left="open-in-new"
          data-test="ai-trace-drawer-open-in-traces"
          @click="traceRef?.handleExpandToFullView()"
        >
          {{ t("traces.openInTraces") }}
        </OButton>
      </div>
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <TraceDetails
        v-if="current"
        ref="traceRef"
        :key="current.stream"
        mode="embedded"
        :trace-id-prop="current.traceId"
        :stream-name-prop="current.stream"
        :span-id-prop="current.spanId ?? ''"
        :span-list-prop="[]"
        :start-time-prop="current.startTime"
        :end-time-prop="current.endTime"
        :show-back-button="false"
        :show-timeline="true"
        :show-log-stream-selector="false"
        :show-share-button="false"
        :show-close-button="false"
        :show-expand-button="false"
        :enable-correlation-links="true"
        :initial-timeline-expanded="false"
        class="h-full! min-h-0 flex-1"
      />
    </div>

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </ODrawer>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import type { AiDrawerTrace } from "./AiTraceDrawer.types";

// Loaded on first open: the trace view is heavy, and most visits open no trace.
const TraceDetails = defineAsyncComponent(() => import("./TraceDetails.vue"));

const props = defineProps<{
  open: boolean;
  trace: AiDrawerTrace | null;
  /** The judge call that produced a score for `trace`. */
  evaluator?: AiDrawerTrace | null;
}>();
const emit = defineEmits<{ (e: "update:open", value: boolean): void }>();
/** Which of the two traces shows; it stays as the user steps through scores. */
const view = defineModel<"trace" | "evaluator">("view", { default: "trace" });

const { t } = useI18nTyped();
const traceRef = ref<{ handleExpandToFullView: () => void } | null>(null);

const current = computed(() =>
  view.value === "evaluator" && props.evaluator ? props.evaluator : props.trace,
);
const title = computed(() =>
  t("aiTraceDrawer.title", { id: (current.value?.traceId ?? "").slice(0, 8) }),
);
</script>
