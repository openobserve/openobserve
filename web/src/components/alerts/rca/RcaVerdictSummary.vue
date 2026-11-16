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

<!-- A graded run's answer first: verdict chips, the AI sentence, then five facts. -->
<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <RcaPill data-test="rca-verdict-state" :tone="outcomePill.tone" :icon="outcomePill.icon">
        {{ t(outcomePill.key) }}
      </RcaPill>

      <OButton
        v-if="openFindings.length > 0"
        data-test="rca-verdict-open-finding"
        variant="ghost-warning"
        size="xs"
        icon-left="warning-amber"
        @click="$emit('open-hypothesis', openFindings[0].id)"
        >{{ openFindingsLabel
        }}<OTooltip :content="t('alerts.incidents.rcaLight.openFindingsHint')"
      /></OButton>

      <span class="text-text-heading inline-flex items-center gap-1.5 text-sm font-semibold">
        <span class="inline-flex h-3 items-end gap-0.5" aria-hidden="true">
          <span
            v-for="bar in 3"
            :key="bar"
            class="w-1 rounded-xs"
            :class="[
              BAR_HEIGHT[bar - 1],
              bar <= rcaBandLevel(card.band) ? 'bg-accent' : 'bg-border-default',
            ]"
          />
        </span>
        <span data-test="rca-verdict-band" :data-band="card.band ?? 'none'">{{ bandText }}</span>
        <OPopover
          v-if="breakdown"
          side="bottom"
          align="start"
          :aria-label="t('alerts.incidents.rcaLight.whyConfidence')"
        >
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="info-outline"
              data-test="rca-verdict-band-info"
              :aria-label="t('alerts.incidents.rcaLight.whyConfidence')"
            />
          </template>
          <div
            data-test="rca-verdict-confidence-why"
            class="flex w-96 max-w-[calc(100vw-1.5rem)] flex-col gap-2 p-3"
          >
            <span class="text-text-heading text-sm font-semibold">
              {{ t("alerts.incidents.rcaLight.whyBand", { band: bandWord(card.band) }) }}
            </span>
            <dl class="text-compact m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
              <dt class="text-text-secondary">
                {{ t("alerts.incidents.rcaSummary.confidenceClaimed") }}
              </dt>
              <dd data-test="rca-confidence-claimed" class="text-text-heading m-0 font-semibold">
                {{ bandWord(breakdown.claimed) }}
              </dd>
              <dt class="text-text-secondary">
                {{ t("alerts.incidents.rcaSummary.confidenceEvidence") }}
              </dt>
              <dd data-test="rca-confidence-evidence" class="text-text-body m-0">
                <span class="text-text-heading font-semibold">{{
                  bandWord(breakdown.evidence)
                }}</span>
                · {{ breakdown.evidence_reason }}
              </dd>
              <template v-if="breakdown.next_level">
                <dt class="text-text-secondary">{{ t("alerts.incidents.rcaLight.nextLevel") }}</dt>
                <dd class="text-text-body m-0">{{ breakdown.next_level }}</dd>
              </template>
              <template v-if="breakdown.caps.length > 0">
                <dt class="text-text-secondary">
                  {{
                    t("alerts.incidents.rcaSummary.confidenceCapped", { band: bandWord("medium") })
                  }}
                </dt>
                <dd data-test="rca-confidence-caps" class="text-text-body m-0">
                  {{ listOf(breakdown.caps) }}
                </dd>
              </template>
            </dl>
          </div>
        </OPopover>
      </span>

      <OButton
        v-if="unverifiedCount > 0"
        data-test="rca-verdict-unverified-count"
        variant="ghost-warning"
        size="xs"
        @click="$emit('show-unverified')"
      >
        {{
          t(
            "alerts.incidents.rcaSummary.unverifiedCount",
            { count: formatCount(unverifiedCount) },
            unverifiedCount,
          )
        }}
      </OButton>

      <span
        v-if="pageAdvice"
        data-test="rca-verdict-page"
        class="text-text-heading inline-flex items-center gap-1.5 text-sm font-semibold"
      >
        {{ t("alerts.incidents.rcaLight.agentSuggests") }}
        <RcaPill
          data-test="rca-verdict-page-action"
          :data-tone="pageAdvice.action === 'page' ? 'warn' : 'neutral'"
          :tone="pageAdvice.action === 'page' ? 'warn' : 'neutral'"
          :icon="pageAdvice.action === 'page' ? 'notifications' : 'check'"
        >
          {{ pageWord }}
        </RcaPill>
        <OPopover
          v-if="pageAdvice.reason"
          side="bottom"
          align="start"
          :aria-label="t('alerts.incidents.rcaLight.whySuggestion')"
        >
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-xs"
              icon-left="info-outline"
              data-test="rca-verdict-page-info"
              :aria-label="t('alerts.incidents.rcaLight.whySuggestion')"
            />
          </template>
          <div
            data-test="rca-verdict-page-why"
            class="flex w-96 max-w-[calc(100vw-1.5rem)] flex-col gap-1.5 p-3"
          >
            <span class="text-text-heading text-sm font-semibold">
              {{ t("alerts.incidents.rcaLight.whySuggestionTitle", { action: pageWord }) }}
            </span>
            <OText variant="meta">{{ pageAdvice.reason }}</OText>
          </div>
        </OPopover>
      </span>
    </div>

    <div class="flex max-w-225 flex-col items-start gap-0.5">
      <p
        ref="headlineEl"
        data-test="rca-verdict-headline"
        class="text-text-heading m-0 text-base leading-normal [text-wrap:pretty]"
        :class="{ 'line-clamp-2': !headlineOpen }"
      >
        <RcaInlineText :text="headline" />
      </p>
      <OButton
        v-if="headlineClamped || headlineOpen"
        data-test="rca-verdict-headline-toggle"
        variant="ghost-primary"
        size="xs"
        :aria-expanded="headlineOpen"
        @click="headlineOpen = !headlineOpen"
      >
        {{
          headlineOpen
            ? t("alerts.incidents.rcaLight.showLess")
            : t("alerts.incidents.rcaLight.showMore")
        }}
      </OButton>
    </div>

    <dl
      data-test="rca-verdict-facts"
      class="m-0 grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-6 gap-y-3"
    >
      <div data-test="rca-fact-impact" class="min-w-0">
        <dt class="text-text-secondary flex items-center gap-1 text-xs">
          {{ t("alerts.incidents.rcaSummary.impact") }}
          <OPopover
            v-if="impactDetailsShown"
            side="bottom"
            align="start"
            :aria-label="t('alerts.incidents.rcaLight.impactDetails')"
          >
            <template #trigger>
              <OButton
                variant="ghost"
                size="icon-xs"
                icon-left="info-outline"
                data-test="rca-fact-impact-info"
                :aria-label="t('alerts.incidents.rcaLight.impactDetails')"
              />
            </template>
            <dl
              data-test="rca-fact-impact-why"
              class="text-compact m-0 grid w-96 max-w-[calc(100vw-1.5rem)] grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 p-3"
            >
              <template v-if="card.impact?.summary">
                <dt class="text-text-secondary">{{ t("alerts.incidents.rcaSummary.impact") }}</dt>
                <dd class="text-text-body m-0">{{ card.impact.summary }}</dd>
              </template>
              <template v-if="card.impact?.peak">
                <dt class="text-text-secondary">{{ t("alerts.incidents.rcaLight.peakLabel") }}</dt>
                <dd class="text-text-body m-0">{{ card.impact.peak }}</dd>
              </template>
              <template v-if="impactWindow">
                <dt class="text-text-secondary">
                  {{ t("alerts.incidents.rcaLight.windowLabel") }}
                </dt>
                <dd class="text-text-body m-0">{{ impactWindow }}</dd>
              </template>
              <template v-if="impact.kind === 'services'">
                <dt class="text-text-secondary">
                  {{ t("alerts.incidents.rcaLight.servicesLabel") }}
                </dt>
                <dd class="text-text-body m-0">{{ listOf(impact.services) }}</dd>
              </template>
              <template v-if="impact.kind === 'customer'">
                <dt class="text-text-secondary">
                  {{ t("alerts.incidents.rcaLight.customerImpactLabel") }}
                </dt>
                <dd class="text-text-body m-0">{{ impact.full }}</dd>
              </template>
            </dl>
          </OPopover>
        </dt>
        <OTruncatedText
          as="dd"
          :lines="3"
          data-test="rca-fact-value"
          class="text-text-heading m-0 text-sm font-semibold"
          :tooltip="false"
        >
          <RcaInlineText :text="impactText" />
        </OTruncatedText>
        <OTruncatedText :lines="3" as="span" class="text-text-secondary text-xs">
          {{
            card.impact?.peak
              ? t("alerts.incidents.rcaLight.peak", { peak: card.impact.peak })
              : t("alerts.incidents.rcaLight.noPeak")
          }}
        </OTruncatedText>
      </div>

      <div data-test="rca-fact-incident" class="min-w-0">
        <dt class="text-text-secondary text-xs">
          {{ t("alerts.incidents.rcaLight.inThisIncident") }}
        </dt>
        <dd
          data-test="rca-fact-value"
          class="text-text-heading m-0 text-sm font-semibold tabular-nums"
        >
          {{ scopeText }}
        </dd>
        <span v-if="scopeSpan" class="text-text-secondary block text-xs tabular-nums">
          {{ scopeSpan }}
        </span>
      </div>

      <div data-test="rca-fact-now" class="min-w-0">
        <dt class="text-text-secondary text-xs">{{ t("alerts.incidents.rcaLight.alertsNow") }}</dt>
        <dd
          data-test="rca-fact-value"
          class="m-0 flex items-center gap-1.5 text-sm font-semibold"
          :class="
            alertsNow && alertsNow.firing > 0 ? 'text-status-warning-text' : 'text-text-heading'
          "
        >
          <span
            v-if="alertsNow && alertsNow.firing > 0"
            class="bg-status-warning-text size-2 shrink-0 rounded-full"
            aria-hidden="true"
          />
          {{ nowText }}
        </dd>
        <span v-if="nowDetail" class="text-text-secondary block text-xs tabular-nums">
          {{ nowDetail }}
        </span>
      </div>

      <div v-if="actions.length > 0" data-test="rca-fact-action" class="min-w-0">
        <dt class="text-text-secondary text-xs">
          {{ t("alerts.incidents.rcaLight.firstAction") }}
        </dt>
        <OTruncatedText
          as="dd"
          :lines="3"
          data-test="rca-fact-value"
          class="text-text-heading m-0 text-sm font-semibold"
        >
          {{ actions[0].title }}
        </OTruncatedText>
        <span class="text-text-secondary block text-xs">
          {{
            actions.length > 1
              ? t("alerts.incidents.rcaLight.andMoreBelow", {
                  count: formatCount(actions.length - 1),
                })
              : t("alerts.incidents.rcaLight.suggestionOnly")
          }}
        </span>
      </div>

      <div v-if="blindSpots.length > 0" data-test="rca-fact-blind" class="min-w-0">
        <dt class="text-text-secondary text-xs">{{ t("alerts.incidents.rcaLight.blindSpots") }}</dt>
        <dd data-test="rca-fact-value" class="m-0">
          <OButton
            data-test="rca-fact-blind-spots"
            variant="ghost-warning"
            size="xs"
            icon-left="visibility-off"
            @click="$emit('show-blind-spots')"
          >
            {{ formatCount(blindSpots.length) }}
          </OButton>
        </dd>
        <OTruncatedText :lines="3" as="span" class="text-text-secondary text-xs">
          {{ blindSpots[0].title }}
        </OTruncatedText>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useIsTruncated } from "@/lib/overlay/Tooltip/useIsTruncated";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { RcaBand, RcaRunSummary } from "@/services/incidents";
import {
  RCA_OUTCOME_PILL,
  rcaBandLevel,
  rcaHypothesisStatusLabel,
  type RcaVerdictView,
} from "@/utils/incidents/rcaSummary";
import { formatTimestampInTimezone } from "@/utils/date";
import { timezoneAbbr } from "@/utils/formatters";
import { incidentLiveWords, unfoldDuration } from "@/utils/incidents/incidentUnfold";
import { useNowMicros } from "@/composables/downtimes/useNowMicros";
import { getIntlLocale } from "@/locales";
import { rcaImpactFact, rcaOpenFindings, type RcaAlertsNow, type RcaFiringScope } from "./rcaLight";
import RcaInlineText from "./RcaInlineText.vue";
import RcaPill from "./RcaPill.vue";

const props = withDefaults(
  defineProps<{
    /** A graded run's summary. */
    summary: RcaRunSummary;
    /** The AI sentence; the card words a missing one. */
    headline?: I18nText;
    verdictDetails?: RcaVerdictView | null;
    /** The run's report, for its Customer Impact row. */
    reportText?: string;
    firingScope?: RcaFiringScope | null;
    alertsNow?: RcaAlertsNow | null;
    /** The app's time zone. */
    timezone?: string;
  }>(),
  {
    headline: undefined,
    verdictDetails: null,
    reportText: "",
    firingScope: null,
    alertsNow: null,
    timezone: "UTC",
  },
);

defineEmits<{
  /** The open-finding chip: open that hypothesis. */
  "open-hypothesis": [hypothesisId: string];
  "show-unverified": [];
  "show-blind-spots": [];
}>();

const { t } = useI18nTyped();

/** Heights of the three band bars. */
const BAR_HEIGHT = ["h-1.5", "h-2.25", "h-3"] as const;
const DASH = raw("—");

const card = computed(() => props.summary.card);
const outcomePill = computed(() => RCA_OUTCOME_PILL[card.value.outcome ?? "inconclusive"]);
const breakdown = computed(() => card.value.confidence ?? null);

const BAND_WORD: Record<RcaBand, I18nText> = {
  high: t("alerts.incidents.aiAnalysis.band.high"),
  medium: t("alerts.incidents.aiAnalysis.band.medium"),
  low: t("alerts.incidents.aiAnalysis.band.low"),
};
const bandWord = (band: RcaBand | undefined) => (band ? BAND_WORD[band] : DASH);
const bandText = computed(() =>
  t("alerts.incidents.rcaLight.bandConfidence", { band: bandWord(card.value.band) }),
);

const openFindings = computed(() => rcaOpenFindings(props.summary.hypotheses));
const openFindingsLabel = computed(() => {
  const count = openFindings.value.length;
  const status = rcaHypothesisStatusLabel(openFindings.value[0].status, card.value.outcome);
  return t("alerts.incidents.rcaLight.openFindings", { count, status }, count);
});

const unverifiedCount = computed(() => props.summary.unverified.length);

const pageAdvice = computed(() => props.verdictDetails?.pageRecommendation ?? null);
const pageWord = computed<I18nText>(() => {
  switch (pageAdvice.value?.action) {
    case "page":
      return t("alerts.incidents.rcaLight.pageAction.page");
    case "suppress":
      return t("alerts.incidents.rcaLight.pageAction.suppress");
    default:
      return t("alerts.incidents.rcaLight.pageAction.downgrade");
  }
});

const headline = computed<I18nText>(
  () =>
    props.headline ??
    (card.value.headline
      ? raw(card.value.headline)
      : t("alerts.incidents.rcaRun.headline.analyzed")),
);
const headlineEl = ref<HTMLElement | null>(null);
const headlineOpen = ref(false);
// Re-measured on every resize, so a wider or narrower page shows "Show more" only when it clamps.
const { isTruncated: headlineClamped, update: remeasureHeadline } = useIsTruncated(headlineEl, {
  clamp: true,
});
const measureHeadline = async () => {
  await nextTick();
  remeasureHeadline();
};
watch(headline, () => {
  headlineOpen.value = false;
  void measureHeadline();
});

const formatCount = (value: number) => value.toLocaleString(getIntlLocale());
const listOf = (items: string[]) => new Intl.ListFormat(getIntlLocale()).format(items);

const zone = (us: number) => timezoneAbbr(props.timezone, new Date(us / 1000));
const clock = (us: number) => formatTimestampInTimezone(us, "HH:mm", props.timezone);
const day = (us: number) => formatTimestampInTimezone(us, "MMM D", props.timezone);

const impact = computed(() =>
  rcaImpactFact(props.reportText, card.value.impact, props.verdictDetails?.impactedServices ?? []),
);
const impactText = computed<I18nText>(() => {
  const value = impact.value;
  if (value.kind === "services") {
    const locale = getIntlLocale();
    const more = value.services.length - 2;
    if (more <= 0) return raw(new Intl.ListFormat(locale).format(value.services));
    const list = new Intl.ListFormat(locale, { type: "unit", style: "short" }).format(
      value.services.slice(0, 2),
    );
    return t("alerts.incidents.rcaLight.servicesMore", { list, count: formatCount(more) });
  }
  if (value.kind === "customer") {
    return t("alerts.incidents.rcaLight.customerImpact", { text: value.short });
  }
  if (value.kind === "summary") return raw(value.short);
  return t("alerts.incidents.rcaLight.noServiceImpact");
});
const impactWindow = computed(() => {
  const window = card.value.impact?.window;
  if (!window) return "";
  return t("alerts.incidents.rcaLight.span", {
    start: `${day(window.start)}, ${clock(window.start)}`,
    end: clock(window.end),
    zone: zone(window.start),
  });
});
const impactDetailsShown = computed(() => !!card.value.impact || impact.value.kind !== "none");

const scopeText = computed<I18nText>(() => {
  const scope = props.firingScope;
  if (!scope) return DASH;
  if (scope.firings === 1) return t("alerts.incidents.rcaLight.firedOnce");
  return t("alerts.incidents.firingsAlerts", {
    firings: t(
      "alerts.incidents.unfold.firings",
      { count: formatCount(scope.firings) },
      scope.firings,
    ),
    alerts: t("alerts.incidents.unfold.alerts", { count: formatCount(scope.alerts) }, scope.alerts),
  });
});
const scopeSpan = computed<I18nText | null>(() => {
  const scope = props.firingScope;
  if (!scope) return null;
  const sameDay = day(scope.firstAt) === day(scope.lastAt);
  const at = (us: number) => (sameDay ? clock(us) : `${day(us)}, ${clock(us)}`);
  if (scope.firings === 1 || scope.firstAt === scope.lastAt) {
    return t("alerts.incidents.rcaLight.spanOne", {
      time: at(scope.firstAt),
      zone: zone(scope.firstAt),
    });
  }
  return t("alerts.incidents.rcaLight.span", {
    start: at(scope.firstAt),
    end: at(scope.lastAt),
    zone: zone(scope.lastAt),
  });
});

const nowMicros = useNowMicros();
const nowText = computed<I18nText>(() => {
  const live = props.alertsNow;
  return (live && incidentLiveWords(t, live, getIntlLocale())?.label) || DASH;
});
const nowDetail = computed<I18nText | null>(() => {
  const last = props.alertsNow?.lastFiring;
  if (last === undefined) return null;
  return t("alerts.incidents.liveLastFired", {
    duration: unfoldDuration(t, nowMicros.value - last),
  });
});

const actions = computed(() => props.verdictDetails?.proposedActions ?? []);
const blindSpots = computed(() => props.summary.blind_spots);
</script>
