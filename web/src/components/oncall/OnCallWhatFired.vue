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
  What fired, and the three places a responder goes next.

  Everything here already existed in the product and none of it was on this
  screen: the rule's condition was an unclickable id, the value that crossed
  the threshold lived on the alert's own history page, and `runbook_url` — a
  field the API hoists onto the record precisely so this screen can show it —
  was read by nothing in `web/src`.
-->
<template>
  <OCard data-test="oncall-what-fired">
    <OCardSection>
      <span class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <OText variant="panel-title">{{ t("oncall.whatFired") }}</OText>
        <router-link
          v-if="alertRoute"
          class="text-accent text-sm"
          :to="alertRoute"
          data-test="oncall-what-fired-open-alert"
        >
          {{ t("oncall.openAlertRule") }}
        </router-link>
      </span>

      <OCode block data-test="oncall-what-fired-condition">{{ conditionLine }}</OCode>

      <!-- The number that crossed the line, beside the line it crossed. The
           record stores neither — this is the alert's own last evaluation, so
           it is withheld rather than guessed when the history is unavailable. -->
      <p
        v-if="observedLine"
        class="text-text-body mt-2 text-sm"
        data-test="oncall-what-fired-observed"
      >
        {{ t("oncall.whatFiredObserved", { value: observedLine }) }}
        <span v-if="observedAgo" class="text-text-muted">{{ observedAgo }}</span>
      </p>

      <span class="mt-3 flex flex-wrap items-center gap-2">
        <OButton
          v-if="logsRoute"
          variant="outline"
          size="sm"
          icon-left="search"
          as="router-link"
          :to="logsRoute"
          data-test="oncall-what-fired-logs"
        >
          {{ t("oncall.whatFiredOpenStream", { stream: raw(alert?.stream_name ?? "") }) }}
        </OButton>

        <!-- An external URL somebody wrote on the alert. It opens in a new tab
             because losing the page you are triaging to follow a wiki link is
             a real way to lose a page. -->
        <a
          v-if="runbookUrl"
          class="text-accent inline-flex items-center gap-1 text-sm"
          :href="runbookUrl"
          target="_blank"
          rel="noopener noreferrer"
          data-test="oncall-what-fired-runbook"
        >
          <OIcon name="menu-book" size="xs" />
          {{ t("oncall.whatFiredRunbook") }}
        </a>
        <span v-else class="text-text-muted text-xs" data-test="oncall-what-fired-no-runbook">
          {{ t("oncall.whatFiredNoRunbook") }}
        </span>
      </span>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";

import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OCode from "@/lib/core/Code/OCode.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { SubjectType } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped } from "@/types/i18n";
import { useOnCallClock } from "@/composables/useOnCallClock";
import { alertConditionText, alertPeriodMinutes } from "@/utils/alerts/alertCondition";
import { conditionSummary } from "@/utils/alerts/runOutcome";
import { formatMicrosDuration } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    orgId: string;
    subjectType: SubjectType;
    /** The rule id the record points at. */
    sourceId: string;
    /** The alert as the API returns it, or `null` when it has been deleted. */
    alert?: Record<string, any> | null;
    /** Hoisted onto the record by the API for exactly this row. */
    runbookUrl?: string | null;
    /** The alert's most recent evaluation, from `GET /alerts/history`. */
    observed?: Record<string, unknown> | null;
    /** Micros — the record's `opened_at`, the anchor for the log window. */
    openedAt: number;
  }>(),
  { alert: null, runbookUrl: null, observed: null },
);

const { t } = useI18nTyped();
const nowMicros = useOnCallClock();

const MINUTE_MICROS = 60 * 1_000_000;

/// A minute either side of the evaluation window, because the interesting log
/// line is rarely inside the exact window that tripped the threshold.
const windowMicros = computed(() => (alertPeriodMinutes(props.alert) ?? 15) * MINUTE_MICROS);

const conditionLine = computed(() => {
  const condition = alertConditionText(props.alert);
  const period = alertPeriodMinutes(props.alert);
  return period ? t("oncall.whatFiredOver", { condition, minutes: period }) : condition;
});

/// `conditionSummary` is the alert history's own formatter — the same "112 >=
/// 100" a reader sees on the alert screen, rather than a second spelling.
const observedLine = computed(() => {
  if (!props.observed) return "";
  const said = conditionSummary(props.observed);
  return said === "—" ? "" : said;
});

const observedAgo = computed(() => {
  const at = Number(props.observed?.timestamp ?? props.observed?.start_time);
  if (!Number.isFinite(at) || at <= 0) return "";
  return t("oncall.whatFiredAgo", { duration: formatMicrosDuration(nowMicros.value - at) });
});

const alertRoute = computed<RouteLocationRaw | null>(() =>
  props.subjectType === "alert" && props.sourceId
    ? {
        name: "alertDetail",
        params: { alert_id: props.sourceId },
        query: { org_identifier: props.orgId },
      }
    : null,
);

/// The stream explorer, framed on the firing rather than on "the last 15
/// minutes" — by the time somebody opens this, now is not when it happened.
const logsRoute = computed<RouteLocationRaw | null>(() => {
  const stream = props.alert?.stream_name;
  if (!stream) return null;
  return {
    name: "logs",
    query: {
      stream_type: props.alert?.stream_type || "logs",
      stream,
      refresh: "0",
      query: "",
      type: "stream_explorer",
      from: props.openedAt - windowMicros.value,
      to: props.openedAt + MINUTE_MICROS,
      org_identifier: props.orgId,
    },
  };
});
</script>
