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
  <div data-test="rca-analysis-container" class="flex flex-1 flex-col overflow-hidden">
    <!-- Stale (02 TH40 N): the server flagged a live run with no update past the
         stale threshold. It can still be cancelled (01 RR-19). -->
    <OBanner
      v-if="live && stale"
      data-test="rca-stale-banner"
      variant="warning"
      icon="warning"
      inline-actions
      class="mb-2 flex-shrink-0"
    >
      <p data-test="rca-stale-message" class="text-banner-warning-text mb-0 text-sm">
        {{ t("alerts.incidents.rcaRun.stale", { time: staleSinceLabel }) }}
      </p>
      <p
        v-if="reportRun"
        data-test="rca-earlier-report-note"
        class="text-banner-warning-text mt-0.5 mb-0 text-xs"
      >
        {{ earlierReportNote }}
      </p>
      <template #actions>
        <OButton
          data-test="rca-cancel-btn"
          variant="outline"
          size="sm"
          :disabled="cancelling"
          @click="$emit('cancel-rca')"
        >
          {{ cancelling ? t("alerts.incidents.rcaCancelling") : t("alerts.incidents.rcaCancel") }}
        </OButton>
      </template>
    </OBanner>

    <!-- Live run. With an earlier completed run (02 TH40 M) the banner names the
         re-run's mode and the earlier report stays readable below. -->
    <OBanner
      v-else-if="live"
      data-test="rca-inflight-container"
      variant="info"
      inline-actions
      class="mb-2 flex-shrink-0"
    >
      <template #icon>
        <OSpinner variant="dots" size="xs" />
      </template>

      <div class="flex items-center gap-2">
        <p data-test="rca-inflight-message" class="text-banner-info-text mb-0 text-sm font-medium">
          {{ liveMessage }}
        </p>
        <span
          v-if="elapsedLabel"
          data-test="rca-elapsed"
          class="text-banner-info-text text-xs whitespace-nowrap"
        >
          {{ t("alerts.incidents.rcaStartedAgo", { time: elapsedLabel }) }}
        </span>
      </div>
      <p class="text-banner-info-text mt-0.5 mb-0 text-xs">
        {{ reportRun ? earlierReportNote : t("alerts.incidents.rcaAnalyzingHint") }}
      </p>

      <template #actions>
        <OButton
          data-test="rca-cancel-btn"
          variant="outline"
          size="sm"
          :disabled="cancelling"
          @click="$emit('cancel-rca')"
        >
          {{ cancelling ? t("alerts.incidents.rcaCancelling") : t("alerts.incidents.rcaCancel") }}
        </OButton>
      </template>
    </OBanner>

    <!-- Latest run failed (02 TH40 L, 01 RR-47): the reason is the heading, the
         details stay collapsed, and any earlier report stays readable below. -->
    <OBanner
      v-else-if="error"
      data-test="rca-error-banner"
      variant="error"
      icon="error-outline"
      class="mb-2 flex-shrink-0"
    >
      <p data-test="rca-error-reason" class="text-banner-error-text mb-0 font-medium">
        {{ error.reason || t("alerts.incidents.rcaFailed") }}
      </p>
      <p
        v-if="reportRun"
        data-test="rca-earlier-report-note"
        class="text-banner-error-text mt-0.5 mb-0 text-xs"
      >
        {{ earlierReportNote }}
      </p>
      <template v-if="error.details">
        <button
          type="button"
          data-test="rca-error-details-toggle"
          class="text-banner-error-text mt-1 cursor-pointer self-start border-none bg-transparent p-0 text-xs underline"
          :aria-expanded="showErrorDetails"
          @click="showErrorDetails = !showErrorDetails"
        >
          {{
            showErrorDetails
              ? t("alerts.incidents.rcaRun.hideDetails")
              : t("alerts.incidents.rcaRun.showDetails")
          }}
        </button>
        <p
          v-if="showErrorDetails"
          data-test="rca-error-details"
          class="text-banner-error-text mt-1 mb-0 text-xs break-words whitespace-pre-wrap"
        >
          {{ error.details }}
        </p>
      </template>
      <template #actions>
        <!-- With a report to build on, Retry offers both modes, the failed run's first.
             `banner-dismiss` inherits the banner's white text, so the action keeps
             AA contrast on the solid error fill in both themes (01 RR-47). -->
        <ODropdown v-if="reportRun" align="end">
          <template #trigger>
            <OButton
              data-test="rca-retry-btn"
              variant="banner-dismiss"
              size="sm"
              :loading="triggering"
            >
              <OIcon name="refresh" size="sm" class="me-1" />
              {{ t("alerts.incidents.rcaRetry") }}
              <OIcon name="keyboard-arrow-down" size="xs" class="ms-1" />
            </OButton>
          </template>
          <ODropdownItem
            v-for="option in retryOptions"
            :key="option.dataTest"
            :data-test="option.dataTest"
            @select="$emit('trigger-rca', { buildOnPrevious: option.buildOnPrevious })"
          >
            {{ option.label }}
          </ODropdownItem>
        </ODropdown>
        <OButton
          v-else
          data-test="rca-retry-btn"
          variant="banner-dismiss"
          size="sm"
          :loading="triggering"
          @click="$emit('trigger-rca', { buildOnPrevious: false })"
        >
          <OIcon name="refresh" size="sm" class="me-1" />
          {{ t("alerts.incidents.rcaRetry") }}
        </OButton>
      </template>
    </OBanner>

    <!-- Latest run cancelled (02 TH40 E, Phase 1 form). -->
    <OBanner
      v-else-if="state === 'cancelled'"
      data-test="rca-cancelled-banner"
      variant="default"
      icon="cancel"
      class="mb-2 flex-shrink-0"
    >
      <p data-test="rca-cancelled-message" class="text-banner-default-text mb-0 text-sm">
        {{ cancelledMessage }}
      </p>
      <p
        v-if="reportRun"
        data-test="rca-earlier-report-note"
        class="text-banner-default-text mt-0.5 mb-0 text-xs"
      >
        {{ earlierReportNote }}
      </p>
    </OBanner>

    <!-- Nothing to show yet and nothing running: offer the first run. -->
    <div
      v-if="!reportRun && !live && !error"
      data-test="rca-trigger-section"
      class="mb-2 flex-shrink-0"
    >
      <OButton
        data-test="trigger-rca-btn"
        variant="outline"
        size="sm"
        :loading="triggering"
        @click="$emit('trigger-rca', { buildOnPrevious: false })"
      >
        {{ t("alerts.incidents.rcaAnalyzeIncident") }}
      </OButton>
    </div>

    <!-- Report toolbar: which run, and what you can do with its report. -->
    <div
      v-if="reportRun"
      data-test="rca-toolbar"
      class="mb-2 flex flex-shrink-0 flex-wrap items-center gap-2"
    >
      <span
        v-if="analyzedAgoLabel"
        data-test="rca-analyzed-ago"
        class="text-text-secondary text-xs"
      >
        {{ t("alerts.incidents.rcaAnalyzedAgo", { time: analyzedAgoLabel }) }}
      </span>

      <!-- Run picker (01 §12.3): every run by trigger and start time; only
           completed runs open a report. -->
      <ODropdown v-if="history.length > 1" align="start">
        <template #trigger>
          <OButton data-test="rca-history-btn" variant="ghost-muted" size="sm">
            <OIcon name="history" size="sm" class="me-1" />
            {{ t("alerts.incidents.rcaHistory") }}
            <OIcon name="keyboard-arrow-down" size="xs" class="ms-1" />
          </OButton>
        </template>

        <ODropdownItem
          v-for="(item, idx) in historyItems"
          :key="item.runId"
          :data-test="`rca-history-item-${idx}`"
          :disabled="!item.openable || item.displayed"
          @select="$emit('view-run', item.isReportRun ? null : item.runId)"
        >
          <span class="flex flex-col">
            <span data-test="rca-history-item-label">{{ item.label }}</span>
            <span class="text-text-secondary text-xs">
              {{ item.startedAt }}
              <template v-if="item.stateLabel"> · {{ item.stateLabel }}</template>
            </span>
          </span>
        </ODropdownItem>
      </ODropdown>

      <div class="flex-1" />

      <OButton
        data-test="rca-copy-btn"
        variant="ghost-muted"
        size="sm"
        @click="$emit('copy-report')"
      >
        <OIcon name="content-copy" size="sm" class="me-1" />
        {{ t("alerts.incidents.rcaCopy") }}
      </OButton>
      <OButton
        data-test="rca-download-btn"
        variant="ghost-muted"
        size="sm"
        @click="$emit('download-report')"
      >
        <OIcon name="download" size="sm" class="me-1" />
        {{ t("alerts.incidents.rcaDownload") }}
      </OButton>

      <!-- Re-run. Fresh is the default; continuity is the deliberate choice. -->
      <ODropdown v-if="!live && !error" align="end">
        <template #trigger>
          <OButton data-test="rca-reanalyze-btn" variant="outline" size="sm" :loading="triggering">
            <OIcon name="refresh" size="sm" class="me-1" />
            {{ t("alerts.incidents.rcaReanalyze") }}
            <OIcon name="keyboard-arrow-down" size="xs" class="ms-1" />
          </OButton>
        </template>

        <ODropdownItem
          data-test="rca-reanalyze-fresh"
          @select="$emit('trigger-rca', { buildOnPrevious: false })"
        >
          <span class="flex flex-col">
            <span>{{ t("alerts.incidents.rcaFreshAnalysis") }}</span>
            <span class="text-text-secondary text-xs">
              {{ t("alerts.incidents.rcaFreshAnalysisHint") }}
            </span>
          </span>
        </ODropdownItem>
        <ODropdownItem
          data-test="rca-reanalyze-build"
          @select="$emit('trigger-rca', { buildOnPrevious: true })"
        >
          <span class="flex flex-col">
            <span>{{ t("alerts.incidents.rcaBuildOnPrevious") }}</span>
            <span class="text-text-secondary text-xs">
              {{ t("alerts.incidents.rcaBuildOnPreviousHint") }}
            </span>
          </span>
        </ODropdownItem>
      </ODropdown>
    </div>

    <!-- Viewing an earlier run's report: make it unmistakable this is not the newest. -->
    <OBanner
      v-if="viewedRun"
      data-test="rca-archived-banner"
      variant="warning"
      icon="history"
      dense
      inline-actions
      class="mb-2 flex-shrink-0"
    >
      <p class="text-banner-warning-text mb-0">
        {{ t("alerts.incidents.rcaViewingArchived") }}
      </p>
      <template #actions>
        <OButton
          data-test="rca-back-to-current-btn"
          variant="outline"
          size="sm"
          @click="$emit('view-run', null)"
        >
          {{ t("alerts.incidents.rcaBackToCurrent") }}
        </OButton>
      </template>
    </OBanner>

    <div
      v-if="reportRun && reportLoading && !formattedRcaContent"
      data-test="rca-report-loading"
      class="text-text-secondary flex items-center gap-2 p-3 text-sm"
    >
      <OSpinner variant="dots" size="xs" />
      {{ t("alerts.incidents.rcaRun.loadingReport") }}
    </div>

    <!-- The newest completed report (or the picked earlier one). It stays mounted
         while a re-run is live, failed or cancelled. -->
    <div
      v-else-if="reportRun"
      data-test="rca-existing-container"
      class="rca-container rounded-default bg-surface-base border-border-default flex-1 overflow-auto border p-3"
    >
      <div
        data-test="rca-existing-content"
        class="rca-content text-sm whitespace-pre-wrap"
        v-html="formattedRcaContent"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch, onUnmounted, type PropType } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { formatTimestamp, formatTimestampInTimezone, formatToTimeCompact } from "@/utils/date";
import { humanizeElapsed, isLiveRca, userLocalPart } from "@/utils/incidents/rcaCell";
import type { RcaRunError, RcaRunItem, RcaSummary } from "@/services/incidents";

export default defineComponent({
  name: "IncidentRCAAnalysis",
  components: { OBanner, OButton, ODropdown, ODropdownItem, OIcon, OSpinner },
  props: {
    /** Run summary of the latest run with the detail fields, or null when none ran. */
    rca: {
      type: Object as PropType<RcaSummary | null>,
      default: null,
    },
    /** Newest completed run; its report shows unless an earlier one is picked. */
    reportRun: {
      type: Object as PropType<RcaRunItem | null>,
      default: null,
    },
    /** An earlier completed run picked from the history, or null. */
    viewedRun: {
      type: Object as PropType<RcaRunItem | null>,
      default: null,
    },
    /** Runs of this incident, newest first. */
    history: {
      type: Array as PropType<RcaRunItem[]>,
      default: () => [],
    },
    /** Server flag: the live run has had no update past the stale threshold. */
    stale: {
      type: Boolean,
      default: false,
    },
    /** The latest run's failure, or null when it did not fail. */
    error: {
      type: Object as PropType<RcaRunError | null>,
      default: null,
    },
    formattedRcaContent: {
      type: String,
      default: "",
    },
    reportLoading: {
      type: Boolean,
      default: false,
    },
    triggering: {
      type: Boolean,
      default: false,
    },
    cancelling: {
      type: Boolean,
      default: false,
    },
    isDarkMode: {
      type: Boolean,
      required: true,
    },
  },
  emits: ["trigger-rca", "cancel-rca", "view-run", "copy-report", "download-report"],
  setup(props) {
    const { t } = useI18nTyped();

    const state = computed(() => props.rca?.state ?? null);
    const live = computed(() => isLiveRca(props.rca));
    const currentRun = computed(() => props.rca?.current_run ?? null);

    // Ticks once a second while a run is live so "Started X ago" stays current.
    const now = ref(Date.now());
    let tickTimer: number | null = null;
    watch(
      live,
      (isLive) => {
        if (isLive && tickTimer === null) {
          now.value = Date.now();
          tickTimer = window.setInterval(() => (now.value = Date.now()), 1000);
        } else if (!isLive && tickTimer !== null) {
          clearInterval(tickTimer);
          tickTimer = null;
        }
      },
      { immediate: true },
    );
    onUnmounted(() => {
      if (tickTimer !== null) clearInterval(tickTimer);
    });

    const elapsedLabel = computed(() => {
      if (!live.value || !props.rca) return "";
      const elapsed = now.value - props.rca.started_at / 1000;
      return elapsed < 0 ? "" : humanizeElapsed(elapsed);
    });

    const liveMessage = computed(() => {
      if (!props.reportRun) return t("alerts.incidents.rcaAnalyzing");
      return currentRun.value?.mode === "build_on_previous"
        ? t("alerts.incidents.rcaRun.reanalyzingBuildOnPrevious")
        : t("alerts.incidents.rcaRun.reanalyzingFresh");
    });

    // Names the report shown below: a picked earlier run, else the newest one.
    const earlierReportNote = computed(() => {
      const shown = props.viewedRun ?? props.reportRun;
      return shown
        ? t("alerts.incidents.rcaRun.earlierReportBelow", {
            time: formatTimestamp(shown.started_at, "HH:mm"),
          })
        : "";
    });

    const staleSinceLabel = computed(() =>
      props.rca ? formatTimestamp(props.rca.updated_at, "HH:mm:ss") : "",
    );

    const cancelledMessage = computed(() => {
      const rca = props.rca;
      if (!rca) return "";
      const run = currentRun.value;
      const endedAt = run?.ended_at ?? rca.updated_at;
      const durationMs = run?.stats?.duration_ms ?? (endedAt - rca.started_at) / 1000;
      const time = formatTimestampInTimezone(endedAt, "HH:mm:ss", "UTC");
      const duration = humanizeElapsed(Math.max(durationMs, 0));
      const user = run?.cancelled_by ?? rca.summary.cancelled_by;
      return user
        ? t("alerts.incidents.rcaRun.cancelledBy", { user: userLocalPart(user), time, duration })
        : t("alerts.incidents.rcaRun.cancelledAt", { time, duration });
    });

    // Details stay collapsed for every new failure (01 RR-47).
    const showErrorDetails = ref(false);
    watch(
      () => props.rca?.run_id,
      () => (showErrorDetails.value = false),
    );

    const retryOptions = computed(() => {
      const fresh = {
        buildOnPrevious: false,
        dataTest: "rca-retry-fresh",
        label: t("alerts.incidents.rcaFreshAnalysis"),
      };
      const build = {
        buildOnPrevious: true,
        dataTest: "rca-retry-build",
        label: t("alerts.incidents.rcaBuildOnPrevious"),
      };
      return currentRun.value?.mode === "build_on_previous" ? [build, fresh] : [fresh, build];
    });

    const triggerLabel = (run: RcaRunItem): string => {
      const user = userLocalPart(run.started_by);
      switch (run.trigger) {
        case "auto_new_incident":
          return t("alerts.incidents.rcaRun.trigger.autoNewIncident");
        case "auto_new_alert_type":
          return t("alerts.incidents.rcaRun.trigger.autoNewAlertType");
        case "auto_reopen":
          return t("alerts.incidents.rcaRun.trigger.autoReopen");
        case "manual":
          return t("alerts.incidents.rcaRun.trigger.manual", { user });
        case "reanalyze":
          return t("alerts.incidents.rcaRun.trigger.reanalyze", { user });
        case "oncall_page":
          return t("alerts.incidents.rcaRun.trigger.oncallPage");
        case "resume":
          return t("alerts.incidents.rcaRun.trigger.resume", { user });
        case "legacy":
          return t("alerts.incidents.rcaRun.trigger.legacy");
      }
    };

    const historyItems = computed(() => {
      const displayedId = props.viewedRun?.run_id ?? props.reportRun?.run_id ?? null;
      return props.history.map((run) => ({
        runId: run.run_id,
        label: triggerLabel(run),
        startedAt: formatToTimeCompact(run.started_at),
        stateLabel:
          run.state === "failed"
            ? t("alerts.incidents.rcaRun.state.failed")
            : run.state === "cancelled"
              ? t("alerts.incidents.rcaRun.state.cancelled")
              : "",
        openable: run.state === "completed",
        displayed: run.run_id === displayedId,
        isReportRun: run.run_id === props.reportRun?.run_id,
      }));
    });

    const analyzedAgoLabel = computed(() => {
      const endedAt = (props.viewedRun ?? props.reportRun)?.ended_at;
      if (!endedAt) return "";
      // Timestamps arrive as microseconds since epoch.
      const elapsed = now.value - endedAt / 1000;
      return elapsed < 0 ? "" : humanizeElapsed(elapsed);
    });

    return {
      t,
      state,
      live,
      elapsedLabel,
      liveMessage,
      earlierReportNote,
      staleSinceLabel,
      cancelledMessage,
      showErrorDetails,
      retryOptions,
      historyItems,
      analyzedAgoLabel,
    };
  },
});
</script>

<style scoped>
/* keep(generated-content): the RCA report is markdown rendered through
   `v-html="formattedRcaContent"` above — the .rca-report-content wrapper and all
   of its children are built and sanitized as an HTML string by renderRcaReport in
   utils/incidents/rcaReportMarkdown.ts, so there is no template to hang Tailwind utilities on. This
   is ladder step 5 of O2_STYLE_MIGRATION_PLAN.md §3.1.

   Moved out of the token layer (W1.a, F9), tokenised in W2.c. `:deep()` is required
   and deliberate: v-html children never receive the scope id, so a plain scoped
   selector would not match them. The private --rca-* vocabulary now aliases global
   tokens; entries whose token already flips in dark mode carry no dark override.
   Judgment mappings (near-identical values, flagged for the §7.4 eyeball pass):
   slate text → neutral text tokens; inline-code pink (rose-700) → status-error-text. */
:deep(.rca-report-content) {
  --rca-bg-primary: var(--color-blue-50);
  --rca-bg-secondary: var(--color-blue-50);
  --rca-bg-code: var(--color-surface-subtle);
  --rca-bg-table-even: var(--color-blue-50);
  --rca-bg-table-hover: var(--color-blue-100);
  --rca-bg-section: color-mix(in srgb, var(--color-blue-600) 5%, transparent);
  --rca-bg-blockquote: var(--color-blue-50);

  --rca-text-primary: var(--color-text-heading);
  --rca-text-secondary: var(--color-text-body);
  --rca-text-tertiary: var(--color-text-secondary);
  --rca-text-heading: var(--color-blue-600);
  --rca-text-code: var(--color-status-error-text);
  --rca-text-blockquote: var(--color-blue-800);
  --rca-text-em: var(--color-text-secondary);
  --rca-text-list: var(--color-text-body);

  --rca-border-primary: var(--color-border-strong);
  --rca-border-secondary: var(--color-blue-200);
  --rca-border-tertiary: var(--color-border-default);
  --rca-border-table: var(--color-blue-200);
  --rca-border-accent: var(--color-blue-500);

  --rca-icon-color: var(--color-text-body);
  --rca-shadow: var(--shadow-md);

  font-family: var(--font-sans);
  line-height: 1.6;
  color: var(--rca-text-secondary);
}

/* `.dark` lives on <html>, which never carries this component's scope id, so
   `.dark :deep(.rca-report-content)` would compile to `.dark[data-v] .rca-report-content`
   and never match — dark mode would silently fall back to the light blue-50 washes.
   Anchoring on `.rca-content` (a real element in this template, and a descendant of
   html.dark) puts the scope id where it belongs: `.dark .rca-content[data-v] .rca-report-content`. */
.dark .rca-content :deep(.rca-report-content) {
  /* Only the entries whose dark value differs from what the aliased token flips
     to on its own: the info-blue washes go neutral/deep-blue, accents brighten. */
  --rca-bg-primary: var(--color-surface-panel);
  --rca-bg-secondary: var(--color-surface-subtle);
  --rca-bg-table-even: color-mix(in srgb, var(--color-blue-900) 35%, var(--color-surface-base));
  --rca-bg-table-hover: color-mix(in srgb, var(--color-blue-800) 30%, var(--color-surface-panel));
  --rca-bg-section: color-mix(in srgb, var(--color-blue-400) 8%, transparent);
  --rca-bg-blockquote: var(--color-blue-900);

  --rca-text-heading: var(--color-blue-400);
  --rca-text-blockquote: var(--color-blue-400);

  --rca-border-secondary: var(--color-border-default);
  --rca-border-table: var(--color-border-default);
  --rca-border-accent: var(--color-blue-400);

  --rca-shadow: var(--shadow-lg);
}

:deep(.rca-report-content) {
  .rca-h1 {
    color: var(--rca-text-primary);
    border-bottom-color: var(--rca-border-primary);
  }

  .rca-h2 {
    color: var(--rca-text-heading);
    border-left-color: var(--rca-text-heading);
  }

  .rca-section-bg {
    background-color: var(--rca-bg-section);
  }

  .rca-h3 {
    color: var(--rca-text-secondary);
    position: relative;
    padding-left: 1rem;

    &::before {
      content: "»";
      position: absolute;
      left: 0rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--rca-icon-color);
      font-size: var(--text-xl);
      line-height: 1;
    }
  }

  .rca-h4 {
    color: var(--rca-text-tertiary);
  }

  .rca-ul,
  .rca-ol {
    list-style-position: outside;
  }

  .rca-ul {
    list-style-type: disc;
  }

  .rca-list-item {
    color: var(--rca-text-list);
  }

  .rca-ol-item {
    color: var(--rca-text-list);
  }

  .rca-code-block {
    background-color: var(--rca-bg-code);
    border-color: var(--rca-border-tertiary);

    pre {
      color: var(--rca-text-list);
    }
  }

  .rca-inline-code {
    background-color: var(--rca-bg-code);
    color: var(--rca-text-code);
  }

  .rca-table-wrapper {
    border-radius: var(--radius-surface);
    overflow: hidden;
    box-shadow: var(--rca-shadow);
  }

  .rca-table {
    border-collapse: separate;
    border-spacing: 0;
    background-color: var(--rca-bg-primary);
    /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel table border must not scale with text or it smears at fractional zoom */
    border: 1px solid var(--rca-border-secondary);

    thead {
      background: linear-gradient(
        to bottom,
        var(--rca-bg-secondary) 0%,
        var(--rca-bg-secondary) 100%
      );
      border-bottom: 0.125rem solid var(--rca-border-primary);
    }

    th {
      padding: 0.5rem 0.75rem;
      color: var(--rca-text-primary);
      font-weight: 700;
      font-size: var(--text-3xs);
      letter-spacing: 0.08em;
      text-align: left;
      /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel table border must not scale with text or it smears at fractional zoom */
      border-right: 1px solid var(--rca-border-secondary);

      &:last-child {
        border-right: none;
      }
    }

    td {
      padding: 0.5rem 0.75rem;
      /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel table border must not scale with text or it smears at fractional zoom */
      border-bottom: 1px solid var(--rca-border-table);
      /* eslint-disable-next-line local/no-hardcoded-px -- hairline: a 1-device-pixel table border must not scale with text or it smears at fractional zoom */
      border-right: 1px solid var(--rca-border-table);
      color: var(--rca-text-secondary);
      font-size: var(--text-compact);
      line-height: 1.6;
      vertical-align: top;

      &:last-child {
        border-right: none;
      }
    }

    tbody {
      tr {
        &:last-child td {
          border-bottom: none;
        }

        &:hover {
          background-color: var(--rca-bg-table-hover);
        }
      }
    }

    td:first-child,
    td.rca-first-cell {
      font-weight: 600;
      color: var(--rca-text-tertiary);
      white-space: nowrap;
      background-color: var(--rca-bg-secondary);
      min-width: 10rem;
    }

    tbody tr:hover td:first-child,
    tbody tr:hover td.rca-first-cell {
      background-color: var(--rca-bg-table-hover);
    }
  }

  .rca-blockquote {
    background-color: var(--rca-bg-blockquote);
    border-left-color: var(--rca-border-accent);
    color: var(--rca-text-blockquote);
  }

  hr {
    border-top-color: var(--rca-border-tertiary);
  }

  /* Emphasis, not a link: same colour as the prose around it. */
  strong {
    color: var(--rca-text-secondary);
  }

  em {
    color: var(--rca-text-em);
  }

  p {
    color: var(--rca-text-secondary);
  }
}
</style>
