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
  "Annotate" on a trace or span — queue it for human review. Picking a queue is a
  one-field decision, so it drops straight off the button: the same
  AddToQueueMenu Discovery uses, wrapped with the enqueue call and the org, so
  the trace views stay free of Annotate wiring.
-->
<template>
  <span class="inline-flex">
    <!-- Split control: the icon annotates this object now, the caret queues it
         for someone else to review later. -->
    <AddToQueueMenu
      :scope="refType"
      :queues="queues"
      :loading="loading"
      :busy="submitting"
      :variant="variant"
      :compact="compact"
      :split-action="compact"
      :action-label="t('aiObservability.annotate.button')"
      :label="t('aiObservability.traceActions.annotate.button')"
      :data-test="dataTest"
      @open="loadQueues"
      @select="enqueue"
      @action="annotateOpen = true"
    />

    <AnnotateDrawer
      :open="annotateOpen"
      :scope="refType"
      :target-id="refId"
      :trace-id="refTraceId"
      :ref-timestamp="refTraceStartTime"
      :source-stream="sourceStream"
      @update:open="(value: boolean) => (annotateOpen = value)"
      @annotated="emit('annotated-target')"
    />
  </span>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import AddToQueueMenu from "./AddToQueueMenu.vue";
import AnnotateDrawer from "./AnnotateDrawer.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import llmQueuesService, { type LlmQueue } from "@/services/llm-queues.service";
import llmDiscoveryService from "@/services/llm-discovery.service";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";

defineOptions({ name: "TraceAnnotateMenu" });

const props = withDefaults(
  defineProps<{
    refType: "trace" | "span";
    refId: string;
    /** Owning trace, required when refType is `span`. */
    refTraceId?: string;
    /** Reference start time in MICROSECONDS. */
    refTraceStartTime: number;
    /** Trace stream the reference lives in — required to record an annotation. */
    sourceStream: string;
    variant?: ButtonVariant;
    /** Compact trigger (icon + caret group) — keeps the trace action rows tight. */
    compact?: boolean;
    dataTest?: string;
  }>(),
  { refTraceId: undefined, variant: "outline", compact: false, dataTest: undefined },
);

const emit = defineEmits<{
  (_e: "annotated", _queue: LlmQueue): void;
  (_e: "annotated-target"): void;
}>();

const annotateOpen = ref(false);

const { t } = useI18nTyped();
const store = useStore();

const queues = ref<LlmQueue[]>([]);
const loading = ref(false);
const submitting = ref(false);

function orgId(): string {
  return store.state.selectedOrganization?.identifier ?? "";
}

async function loadQueues() {
  if (queues.value.length || loading.value || !orgId()) return;
  loading.value = true;
  try {
    queues.value = await llmQueuesService.list(orgId());
  } catch {
    toast({ variant: "error", message: t("aiObservability.discovery.queuesError") });
  } finally {
    loading.value = false;
  }
}

async function enqueue(queue: LlmQueue) {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await llmDiscoveryService.addToQueue(orgId(), queue.id, [
      {
        scope: props.refType,
        targetId: props.refId,
        traceId: props.refTraceId ?? null,
        refTimestamp: props.refTraceStartTime,
      },
    ]);
    toast({
      variant: "success",
      message: t("aiObservability.traceActions.annotate.success", { queue: queue.name }),
    });
    emit("annotated", queue);
  } catch {
    toast({ variant: "error", message: t("aiObservability.traceActions.annotate.error") });
  } finally {
    submitting.value = false;
  }
}
</script>
