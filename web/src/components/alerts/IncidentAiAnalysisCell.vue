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
  <!-- Wraps instead of spilling into the next column; the table's cut-text tooltip would run its parts together -->
  <div
    class="group flex min-w-0 cursor-pointer flex-wrap items-center gap-x-1.5 gap-y-0.5"
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
      <OBadge
        :variant="RCA_BADGE_VARIANT[model.tone]"
        size="sm"
        clickable
        :aria-describedby="model.detail || model.rerunNote ? detailId : undefined"
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
        {{ model.label }}
      </OBadge>
      <span
        v-if="model.detail || model.rerunNote"
        :id="detailId"
        class="text-text-secondary flex max-w-full min-w-0 gap-1 truncate text-xs"
        :title="detailTitle"
        data-test="incident-ai-analysis-detail"
      >
        <OTruncatedText v-if="model.detail">{{ model.detail }}</OTruncatedText>
        <span v-if="model.detail && model.rerunNote" aria-hidden="true">·</span>
        <!-- A newer run did not finish; the result shown is the earlier one. -->
        <span
          v-if="model.rerunNote"
          class="text-status-warning-text truncate"
          data-test="incident-ai-analysis-rerun-note"
          >{{ model.rerunNote }}</span
        >
      </span>
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
      <OButton
        v-if="followTarget"
        variant="ghost-primary"
        size="xs"
        :icon-left="assistantGlyph.thread"
        class="shrink-0"
        data-test="incident-ai-analysis-follow-btn"
        @click.stop="follow"
      >
        {{ t("alerts.incidents.rcaRun.followInThread") }}
      </OButton>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { useStore } from "vuex";
import { isAxiosError } from "axios";
import { raw, useI18nTyped } from "@/types/i18n";
import type { Incident } from "@/services/incidents";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { useRcaTrigger } from "@/composables/useRcaTrigger";
import { RCA_BADGE_VARIANT, rcaCellModel, rcaFollowTarget } from "@/utils/incidents/rcaCell";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { useRcaFollow } from "@/components/ai-assistant/shell/rcaFollow";
import { isAssistantV2 } from "@/composables/assistant/flags";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
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

const { t } = useI18nTyped();
const store = useStore();
const { requestRca } = useRcaTrigger();
const timezone = useViewerTimezone();
const aiLock = useLicenseLock("ai_assistant");

const model = computed(() =>
  rcaCellModel(props.incident, {
    rcaEnabled: props.rcaEnabled,
    lockedReason: aiLock.locked.value ? aiLock.lockedReason.value : undefined,
    now: props.now,
    timezone: timezone.value,
  }),
);

// The detail truncates in a narrow column; its full words, spaced, stay one hover away.
const detailTitle = computed(
  () => [model.value.detail, model.value.rerunNote].filter(Boolean).join(" · ") || undefined,
);

const starting = ref(false);

// Only the revamped assistant mounts a host that can follow a run.
const assistantV2 = isAssistantV2();
const followTarget = computed(() =>
  assistantV2 ? rcaFollowTarget(props.incident, store.state.selectedOrganization.identifier) : null,
);
const follow = (event: MouseEvent) => {
  const target = followTarget.value;
  // The assistant runtime is built on first use, so a list that never follows a run never builds it.
  if (target) useRcaFollow().follow(target, event.currentTarget as HTMLElement | null);
};

// The badge's accessible name is its visible label; the detail describes it.
const detailId = `${useId()}-rca-detail`;

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
