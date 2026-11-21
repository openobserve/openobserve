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

<!-- "AI analysis" cell of the incidents list. A click anywhere in the
     cell opens the incident on its Analysis tab; "Analyze" starts a run instead. -->
<template>
  <div
    class="group flex min-w-0 cursor-pointer flex-nowrap items-center gap-1"
    data-o-tooltip-off
    data-test="incident-ai-analysis-cell"
    @click.stop="emit('open')"
  >
    <OButton
      v-if="model.kind === 'analyze'"
      variant="ghost-primary"
      size="xs"
      icon-left="auto-awesome"
      :loading="starting"
      :title="t('alerts.incidents.aiAnalysis.analyzeTooltip')"
      data-test="incident-ai-analysis-analyze-btn"
      @click.stop="analyze"
    >
      {{ model.label }}
    </OButton>
    <template v-else>
      <OTag
        :variant="CHIP_VARIANT[model.tone]"
        size="sm"
        :dot="!model.spinner && !model.locked"
        clickable
        class="max-w-full min-w-0"
        :data-tone="model.tone"
        data-test="incident-ai-analysis-label"
        @click.stop="emit('open')"
      >
        <template v-if="model.spinner" #icon>
          <OSpinner size="xs" data-test="incident-ai-analysis-spinner" />
        </template>
        <template v-else-if="model.locked" #icon>
          <OIcon name="lock" size="xs" class="lock-chip" data-test="incident-ai-analysis-lock" />
        </template>
        <span class="min-w-0 truncate">
          {{ model.label
          }}<span v-if="model.detail" data-test="incident-ai-analysis-detail">
            · {{ model.detail }}</span
          ><span v-if="model.rerunNote" data-test="incident-ai-analysis-rerun-note">
            · {{ model.rerunNote }}</span
          >
        </span>
        <OTooltip overflow-only :content="chipText" />
      </OTag>
      <OButton
        v-if="model.showAnalyzeOnHover"
        variant="ghost-primary"
        size="xs"
        icon-left="auto-awesome"
        class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        :loading="starting"
        :title="t('alerts.incidents.aiAnalysis.analyzeTooltip')"
        data-test="incident-ai-analysis-hover-analyze-btn"
        @click.stop="analyze"
      >
        {{ t("alerts.incidents.aiAnalysis.analyze") }}
      </OButton>
      <!-- A run already exists, so the door follows it in the assistant instead of starting another. -->
      <AssistantIconButton
        v-if="followTarget"
        :icon="assistantGlyph.thread"
        :label="t('alerts.incidents.rcaRun.followInThread')"
        class="shrink-0"
        data-test="incident-ai-analysis-follow-btn"
        @click.stop="follow"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { isAxiosError } from "axios";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Incident } from "@/services/incidents";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { useRcaTrigger } from "@/composables/useRcaTrigger";
import { rcaCellModel, rcaFollowTarget, type RcaCellTone } from "@/utils/incidents/rcaCell";
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { useRcaFollow } from "@/components/ai-assistant/shell/rcaFollow";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";

const props = defineProps<{
  incident: Incident;
  /** `incidents_rca_enabled` from `/config`. */
  rcaEnabled: boolean;
  /** Epoch milliseconds; the list ticks it so elapsed labels stay current. */
  now: number;
}>();

const emit = defineEmits<{
  /** Open the incident on its Analysis tab. */
  open: [];
  /** A run started; the list refetches to show it. */
  started: [runId: string];
  /** The server answered with an error; it may have created a failed run, so the list refetches. */
  failed: [];
}>();

// One soft family per tone, the same chip style as the row's severity and status tags.
const CHIP_VARIANT: Record<RcaCellTone, BadgeVariant> = {
  muted: "default-soft",
  warn: "warning-soft",
  "warn-strong": "orange-soft",
  ok: "success-soft",
  err: "error-soft",
};

const { t } = useI18nTyped();
const store = useStore();
const { requestRca } = useRcaTrigger();
const timezone = useViewerTimezone();
const aiLock = useLicenseLock("ai_assistant");

// The list clock ticks every 30 s, too coarse for a seconds label, so a stage-less live run ticks its own.
const ownNow = ref(0);
let ownTimer: ReturnType<typeof setInterval> | undefined;
const stopOwnClock = () => {
  clearInterval(ownTimer);
  ownTimer = undefined;
};
watch(
  () => props.incident.rca?.state === "running" && !props.incident.rca.summary.stage_index,
  (ticking) => {
    stopOwnClock();
    if (!ticking) return;
    ownNow.value = Date.now();
    ownTimer = setInterval(() => (ownNow.value = Date.now()), 1000);
  },
  { immediate: true },
);
onUnmounted(stopOwnClock);

const model = computed(() =>
  rcaCellModel(props.incident, {
    rcaEnabled: props.rcaEnabled,
    lockedReason: aiLock.locked.value ? aiLock.lockedReason.value : undefined,
    now: Math.max(props.now, ownNow.value),
    timezone: timezone.value,
    namedBand: true,
  }),
);

const chipText = computed(() =>
  raw([model.value.label, model.value.detail, model.value.rerunNote].filter(Boolean).join(" · ")),
);

const starting = ref(false);

const followTarget = computed(() =>
  rcaFollowTarget(props.incident, store.state.selectedOrganization.identifier),
);
const follow = (event: MouseEvent) => {
  const target = followTarget.value;
  // The assistant runtime is built on first use, so a list that never follows a run never builds it.
  if (target) useRcaFollow().follow(target, event.currentTarget as HTMLElement | null);
};

// Spawned path (`reanalysis=true`, 202): the run continues on the server.
const analyze = async () => {
  if (starting.value) return;
  starting.value = true;
  const org: string = store.state.selectedOrganization.identifier;
  try {
    const result = await requestRca(
      org,
      props.incident.id,
      {},
      { isStillActive: () => store.state.selectedOrganization.identifier === org },
    );
    if (result.status === "unavailable") {
      toast({ variant: "error", message: result.message });
    } else if (result.status === "exhausted") {
      toast({ variant: "error", message: result.notice });
    } else if (result.status === "declined") {
      toast({ variant: "info", message: t("paidUsage.declinedNotice") });
    } else if (result.status === "started") {
      toast({ variant: "success", message: t("alerts.incidents.aiAnalysis.started") });
      emit("started", result.runId);
    }
  } catch (error: unknown) {
    const body: unknown = isAxiosError(error) ? error.response?.data : null;
    const message =
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? raw(body.message)
        : t("alerts.incidents.reanalysisStartFailed");
    toast({ variant: "error", message });
    if (isAxiosError(error) && error.response) emit("failed");
  } finally {
    starting.value = false;
  }
};
</script>
