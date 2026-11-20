<template>
  <section class="flex flex-col gap-1" data-test="svcver-verdict-banner">
    <template v-if="verdict"
      ><div class="flex flex-wrap items-center gap-2">
        <VerdictChip :verdict="verdict" :clickable="false" />
        <span data-test="svcver-verdict-sentence" class="text-text-heading text-sm font-semibold">{{
          sentence
        }}</span>
      </div>
      <template v-if="!verdict.restricted"
        ><p
          v-if="why || lastGoodShown"
          :data-test="code === 'not_serving' ? 'svcver-not-serving' : 'svcver-verdict-reason'"
          class="text-text-body text-compact"
        >
          {{ why
          }}<span
            v-if="lastGood && lastGoodShown"
            class="text-text-secondary"
            data-test="svcver-last-good"
            >{{ why ? " · " : "" }}{{ t("serviceVersions.compare.lastGood") }}
            <span class="text-text-heading font-mono font-semibold whitespace-nowrap">{{
              lastGoodLabel
            }}</span>
            {{ lastGoodNote }}</span
          >
        </p>
        <p v-if="changed" data-test="svcver-verdict-changed" class="text-text-secondary text-xs">
          {{ t("serviceVersions.compare.changed") }}
        </p>
        <p data-test="svcver-baseline-detail" class="text-text-secondary text-xs">
          {{ windowLine }}
        </p>
        <p
          v-if="switchedAt"
          data-test="svcver-baseline-switched"
          class="text-text-secondary text-xs"
        >
          {{
            t("serviceVersions.compare.baselineSwitched", {
              at: formatTime(switchedAt),
            })
          }}
        </p>
        <div v-if="progress" class="mt-1 flex items-center gap-2" data-test="svcver-progress">
          <OProgressBar variant="neutral" class="flex-1" :value="progress.value" />
          <span class="text-text-secondary text-xs" data-test="svcver-progress-detail">{{
            t("serviceVersions.compare.progressLine", progress.label)
          }}</span>
        </div>
        <div v-if="regions.length > 1" class="flex flex-wrap gap-1">
          <OTag
            v-for="region in regions"
            :key="region.cluster"
            type="versionVerdict"
            :value="region.verdict"
            :label="
              raw(
                t('serviceVersions.compare.region', {
                  cluster: region.cluster,
                  verdict: t(`serviceVersions.verdict.${verdictNames[region.verdict]}` as I18nKey),
                }),
              )
            "
            :data-test="`svcver-region-${region.cluster}`"
          /></div></template
    ></template>
    <p v-else data-test="svcver-verdict-empty" class="text-text-secondary text-compact">
      {{ t("serviceVersions.compare.empty") }}
    </p>
  </section>
</template>
<script setup lang="ts">
import { computed } from "vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import type {
  CompareArm,
  CompareResponse,
  Signal,
  Verdict,
  VerdictSummary,
} from "@/services/service_versions";
import VerdictChip from "./VerdictChip.vue";
import type { LastGood } from "./useLastGood";
import { rumVerdictSentence } from "./rumStrip";
import {
  buildLabel,
  changeRoundsToZero,
  compareArmLabel,
  whereSentence,
} from "@/utils/serviceVersionsCopy";
import {
  baselineProvenance,
  baselineSwitchedAt,
  headlineDirection,
  leadingVerdict,
  metricName,
  verdictChanged,
  verdictCode,
  verdictNames,
  verdictSentence,
} from "./verdictText";
import {
  buildTiles,
  displayed,
  FLOORS,
  changeSize,
  formatCount,
  formatDuration,
  formatMetric,
  formatTime,
  formatWindow,
  hasBaseline,
  sectionFailed,
  shortWindow,
  type TileMetric,
} from "./VersionSummaryTiles.format";
const RUM_VITALS = ["lcp_p75", "inp_p75", "cls_p75"];
const OK_REASONS = new Set(["within_noise", "improved", "below_min_effect"]);
// Count tiles carry no judgement, so they never explain a verdict.
const TILE_METRICS: Record<string, true> = {
  error_rate: true,
  p95: true,
  p99: true,
  error_view_rate: true,
  lcp_p75: true,
  inp_p75: true,
  cls_p75: true,
  js_errors: true,
};
const ERROR_METRICS = new Set(["error_rate", "error_view_rate"]);
interface Explanation {
  text: string;
  real?: boolean;
  improved?: boolean;
}
const props = defineProps<{ result: CompareResponse; lastGood?: LastGood }>();
const { t, te } = useI18nTyped();
const verdict = computed(() => leadingVerdict(props.result));
const code = computed(() => verdict.value && verdictCode(verdict.value));
const sentence = computed(() =>
  verdict.value
    ? rumVerdictSentence(verdict.value, t) ||
      verdictSentence(verdict.value, t, { improved: Boolean(explained.value.improved) })
    : "",
);
const changed = computed(() => verdictChanged(props.result));
// Every Why line that calls a change real passes the one noise judgement; a change the tiles call noise gets none.
const explained = computed((): Explanation => {
  const line = explanation();
  return line.real && headlineNoise.value ? { text: "" } : line;
});
// Two builds of one version text: the Why line also says the version was rebuilt.
const rebuilt = computed(() => {
  const { a, b } = props.result.arms;
  return a.version && a.version === b.version && a.image && b.image && a.image !== b.image
    ? t("serviceVersions.compare.why.rebuilt", { version: a.version })
    : "";
});
const why = computed(() => [explained.value.text, rebuilt.value].filter(Boolean).join(" · "));
function explanation(): Explanation {
  const value = verdict.value;
  if (!value || code.value === "insufficient") return { text: "" };
  const params = {
    verdict: t(`serviceVersions.verdict.${verdictNames[code.value!]}` as I18nKey),
    version: value.version,
    baseline: props.result.arms.b.version,
    metric: metricName(value.headline?.metric, t),
    delta: headlineDelta.value,
  };
  // The sentence already says the version is not serving; the Why line only adds who takes the traffic.
  if (code.value === "not_serving")
    return {
      text:
        value.reason_code === "seen_in_k8s_no_requests"
          ? t("serviceVersions.compare.why.seen_in_k8s_no_requests", params)
          : "",
    };
  const rumWhy = rumWhyLine(value, params.verdict);
  if (rumWhy) return { text: rumWhy, real: true };
  if (code.value === "rollback_recovered" || code.value === "rollback_still_worse")
    return { text: rollbackWhy(value, params), real: true };
  if (code.value === "ok") return okWhy(value, params.verdict);
  const reason = `serviceVersions.compare.why.${value.reason_code}`;
  if (value.reason_code && te(reason) && explainsHeadline(value))
    return { text: t(reason as I18nKey, params), real: value.reason_code !== "new_error_types" };
  if (!headlineDelta.value) return { text: "" };
  // The sentence must agree with the sign of its own numbers; a contradiction gets no Why line.
  const direction = headlineDirection(value);
  return {
    text:
      direction > 0 && (code.value === "regressed" || code.value === "watch")
        ? t("serviceVersions.compare.why.rose", params)
        : "",
    real: true,
  };
}
// The banner calls a change real only where its tile does, and never one that prints as zero or whose range crosses zero.
const headlineNoise = computed(() => {
  const value = verdict.value;
  const headline = value?.headline;
  if (!value || !headline?.metric || headline.new == null || headline.base == null) return false;
  const metric = headline.metric;
  const base = displayed(metric, headline.base);
  if (changeRoundsToZero(metric, displayed(metric, headline.new) - base, base)) return true;
  if (headline.lo != null && headline.hi != null && headline.lo <= 0 && headline.hi >= 0)
    return true;
  if (!(metric in TILE_METRICS)) return false;
  const signal: Signal = value.signal ?? (props.result.traces ? "traces" : "rum");
  const tile = buildTiles(props.result, signal, t).find((row) => row.key === metric);
  return tile?.tone === "neutral";
});
// A rollback is explained against the version it left, and only in the direction its outcome claims.
function rollbackWhy(value: VerdictSummary, params: Record<string, string>) {
  if (!params.metric || !params.delta) return "";
  const direction = headlineDirection(value);
  if (code.value === "rollback_recovered")
    return direction < 0 ? t("serviceVersions.compare.why.recovered", params) : "";
  return direction > 0 ? t("serviceVersions.compare.why.stillWorse", params) : "";
}
// An OK verdict names its case; a real-change claim the tiles on screen do not show falls back to what they show.
function okWhy(value: VerdictSummary, verdictLabel: string): Explanation {
  const signal: Signal = value.signal ?? (props.result.traces ? "traces" : "rum");
  const tiles = buildTiles(props.result, signal, t).filter((tile) => tile.key in TILE_METRICS);
  const worse = tiles.some((tile) => tile.tone === "crit" || tile.tone === "warn");
  const improved = tiles.filter((tile) => tile.tone === "good").map((tile) => tile.key);
  const waiting = !tiles.length || tiles.every((tile) => tile.tone === "waiting");
  const shown = worse
    ? "below_min_effect"
    : improved.length
      ? "improved"
      : waiting
        ? ""
        : "within_noise";
  const stated = OK_REASONS.has(value.reason_code ?? "") ? value.reason_code : shown;
  const kind = stated === "below_min_effect" && !worse ? shown : stated;
  if (kind === "below_min_effect")
    return { text: t("serviceVersions.compare.why.below_min_effect", { verdict: verdictLabel }) };
  if (kind === "within_noise")
    return { text: t("serviceVersions.compare.why.noise", { verdict: verdictLabel }) };
  if (kind !== "improved") return { text: "" };
  // Improved tiles were judged by their own ranges; only the headline fallback still needs the judgement.
  const names = (improved.length ? improved : [value.headline?.metric ?? ""])
    .map((key) => metricName(key, t))
    .filter(Boolean);
  if (!names.length) return { text: "" };
  return {
    text: t("serviceVersions.compare.why.improved", {
      verdict: verdictLabel,
      metrics: new Intl.ListFormat(undefined, { type: "conjunction" }).format(names),
    }),
    real: !improved.length,
    improved: true,
  };
}
// The new-error-types reason explains an error headline only; another headline gets its own Why.
function explainsHeadline(value: VerdictSummary) {
  const metric = value.headline?.metric;
  return value.reason_code !== "new_error_types" || !metric || ERROR_METRICS.has(metric);
}
// The RUM drawer explains a held-back vital by its real but sub-threshold change; the threshold varies per metric, so no number is named.
function rumWhyLine(value: VerdictSummary, verdictLabel: string) {
  const headline = value.headline;
  if (value.signal !== "rum" || !headline?.metric || !RUM_VITALS.includes(headline.metric))
    return "";
  const params = { verdict: verdictLabel, metric: metricName(headline.metric, t) };
  if (value.reason_code === "within_good_band")
    return t("serviceVersions.compare.drill.why.withinGood", {
      ...params,
      limit: t(`serviceVersions.compare.drill.goodLimit.${headline.metric}` as I18nKey),
    });
  if (value.reason_code === "not_significant_yet" && !value.needs?.metric && (headline.lo ?? 0) > 0)
    return t("serviceVersions.compare.drill.why.belowEffect", params);
  return "";
}
const switchedAt = computed(() =>
  baselineSwitchedAt(baselineProvenance(props.result, verdict.value)),
);
const lastGoodShown = computed(() =>
  Boolean(
    props.lastGood && ["regressed", "watch", "rollback_still_worse"].includes(code.value || ""),
  ),
);
const lastGoodLabel = computed(() =>
  props.lastGood ? buildLabel(props.lastGood, props.result.arms.a, t) : "",
);
const lastGoodNote = computed(() => {
  const verdict = t("serviceVersions.verdict.ok");
  const ran = props.lastGood?.ran;
  return ran
    ? t("serviceVersions.compare.lastGoodRan", { verdict, duration: formatDuration(ran) })
    : t("serviceVersions.compare.lastGoodVerdict", { verdict });
});
const headlineDelta = computed(() => {
  const headline = verdict.value?.headline;
  if (!headline?.metric || headline.new == null || headline.base == null) return "";
  const metric = headline.metric;
  const diff = Math.abs(displayed(metric, headline.new) - displayed(metric, headline.base));
  if (metric === "error_rate" || metric === "error_view_rate")
    return t("serviceVersions.compare.unit.points", { value: changeSize(diff * 100) });
  return formatMetric(metric, diff, t);
});
function armLabel(arm: CompareArm, side: "a" | "b", images: number | undefined) {
  const version = compareArmLabel(props.result.arms, side, images, t);
  return props.result.baseline_rule === "env_fallback"
    ? whereSentence(
        { in: "serviceVersions.compare.armIn", outside: "serviceVersions.compare.armOutside" },
        arm.where_key || props.result.where_key,
        null,
        { version },
        t,
      )
    : version;
}
function compactCount(value: number) {
  return value >= 1000
    ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
        value,
      )
    : formatCount(value);
}
// Sequential windows are called equal only when their lengths agree to within 1%.
function equalWindows(a: CompareArm, b: CompareArm) {
  const lengthA = a.end_time - a.start_time;
  const lengthB = b.end_time - b.start_time;
  return Math.abs(lengthA - lengthB) <= Math.max(lengthA, lengthB) * 0.01;
}
// Counts come only from a section that loaded; a failed traces read is never replaced by another signal's zeros.
const counts = computed(() => {
  const { traces, rum } = props.result;
  const hidden = sectionFailed(traces) && verdict.value?.signal !== "rum";
  const loaded = hidden || sectionFailed(rum) ? undefined : rum;
  return {
    requests: sectionFailed(traces) ? undefined : traces?.requests,
    sessions: loaded?.session_windows,
    views: loaded?.views,
  };
});
const windowLine = computed(() => {
  const { a, b } = props.result.arms;
  const seconds = shortWindow(a, hasBaseline(props.result) ? b : null);
  const { requests: traces, sessions, views } = counts.value;
  if (!hasBaseline(props.result))
    return traces
      ? t("serviceVersions.compare.windowLineFirst", {
          version: a.version,
          window: formatWindow(a.start_time, a.end_time, t, seconds),
          requests: t("serviceVersions.compare.requestsCount", { count: formatCount(traces.a) }),
        })
      : t("serviceVersions.compare.windowLineFirstBare", {
          version: a.version,
          window: formatWindow(a.start_time, a.end_time, t, seconds),
        });
  const concurrent = props.result.mode === "concurrent";
  const windows = {
    before: armLabel(b, "b", verdict.value?.baseline?.version_images),
    beforeWindow: formatWindow(b.start_time, b.end_time, t, seconds),
    after: armLabel(
      { ...a, where_key: props.result.where_key },
      "a",
      verdict.value?.version_images,
    ),
    afterWindow: formatWindow(a.start_time, a.end_time, t, seconds),
  };
  // A RUM-only drawer counts sessions, not requests; equal windows are implied, a concurrent run is still named.
  if (!traces && sessions && !concurrent)
    return t("serviceVersions.compare.drill.windowLine", {
      ...windows,
      sessions: t("serviceVersions.compare.drill.sessionsPair", {
        b: compactCount(sessions.b ?? 0),
        a: compactCount(sessions.a ?? 0),
      }),
    });
  const named = concurrent || equalWindows(a, b);
  const mode = named
    ? t(
        concurrent
          ? "serviceVersions.compare.modeConcurrent"
          : "serviceVersions.compare.modeSequential",
      )
    : "";
  const requests = traces
    ? t("serviceVersions.compare.requestsPair", {
        b: formatCount(traces.b),
        a: formatCount(traces.a),
      })
    : sessions
      ? t("serviceVersions.compare.drill.sessionsPair", {
          b: compactCount(sessions.b ?? 0),
          a: compactCount(sessions.a ?? 0),
        })
      : views
        ? t("serviceVersions.compare.viewsPair", {
            b: formatCount(views.b),
            a: formatCount(views.a),
          })
        : "";
  if (!requests)
    return t(
      named
        ? "serviceVersions.compare.windowLineBare"
        : "serviceVersions.compare.windowLineUnequalBare",
      { ...windows, mode },
    );
  return t(
    named ? "serviceVersions.compare.windowLine" : "serviceVersions.compare.windowLineUnequal",
    { ...windows, mode, requests },
  );
});
const progress = computed(() => {
  const value = verdict.value;
  if (!value || code.value !== "insufficient") return undefined;
  const metric = value.needs?.metric ?? "error_rate";
  const need = value.needs?.need ?? FLOORS[metric as TileMetric] ?? 0;
  const have = value.needs?.have ?? value.sample?.n_new ?? 0;
  if (!need) return undefined;
  return {
    value: Math.min(1, Math.max(0, have / need)),
    label: { have: formatCount(have), need: formatCount(need) },
  };
});
const regions = computed(() =>
  (verdict.value?.regions || [])
    .filter((region): region is { cluster: string; verdict: Verdict } => typeof region === "object")
    .filter((region) => region.verdict in verdictNames),
);
</script>
