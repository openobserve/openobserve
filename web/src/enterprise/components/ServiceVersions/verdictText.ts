import type {
  CompareResponse,
  Tracking,
  VerdictSummary,
  Verdict,
} from "@/services/service_versions";
import type { TranslateFn, I18nKey } from "@/types/i18n";
import {
  compareArmLabel,
  isNoiseChange,
  noVerdictRule,
  noVerdictText,
  sameBuild,
  trackingNotStarted,
} from "@/utils/serviceVersionsCopy";
import {
  FLOORS,
  displayed,
  formatCount,
  formatMetric,
  hasBaseline,
  type TileMetric,
} from "./VersionSummaryTiles.format";
export type NoVerdict = "not_tracking" | "no_data" | "pre_existing";
export interface NoVerdictContext {
  tracking?: Tracking | null;
  scopeStarted?: boolean;
  deployKind?: string;
}
export const verdictNames: Record<Verdict, string> = {
  ok: "ok",
  watch: "watch",
  regressed: "regressed",
  insufficient: "insufficient",
  first_version: "firstVersion",
  pre_existing: "preExisting",
  not_serving: "notServing",
  capped: "capped",
  restricted: "restricted",
  rollback_recovered: "rollbackRecovered",
  rollback_still_worse: "rollbackStillWorse",
};
const INLINE_METRICS = new Set([
  "requests",
  "error_rate",
  "p50",
  "p95",
  "p99",
  "error_view_rate",
  "lcp_p75",
  "inp_p75",
  "cls_p75",
]);
// no_previous_version is absent on purpose: the First version banner already says it.
const NOTE_KEYS: Record<string, I18nKey> = {
  baseline_unavailable: "serviceVersions.compare.notes.baselineUnavailable",
  "Requested deploy transition is no longer available; comparing the version with an automatic baseline":
    "serviceVersions.compare.notes.transitionMissing",
};
const SEVERITY: Partial<Record<Verdict, number>> = { ok: 1, watch: 2, regressed: 3 };
const WORSE_CODES = new Set<Verdict>(["watch", "regressed", "rollback_still_worse"]);
export function verdictCode(value: VerdictSummary): Verdict {
  if (value.restricted) return "restricted";
  if (value.state === "pre_existing") return "pre_existing";
  if (value.rollback_outcome === "recovered") return "rollback_recovered";
  if (value.rollback_outcome === "not_recovered") return "rollback_still_worse";
  // A version with no baseline is a First version; a picked baseline, a redeploy or a change from another version is not one.
  if (
    value.verdict === "insufficient" &&
    value.reason_code === "no_previous_version" &&
    !value.baseline?.version &&
    !value.deploy?.from_version &&
    value.deploy?.kind !== "redeploy"
  )
    return "first_version";
  return value.verdict || "insufficient";
}
function decisiveRollback(value: VerdictSummary | null | undefined) {
  return value?.rollback_outcome === "recovered" || value?.rollback_outcome === "not_recovered";
}
// One live check has not passed the stored path's debounce, so it may not read better than the stored verdict.
function unconfirmed(live: VerdictSummary, stored: VerdictSummary) {
  if (live.verdict === "insufficient" || live.reason_code === "debounce_pending") return true;
  const own = SEVERITY[live.verdict];
  const release = SEVERITY[stored.verdict];
  return own != null && release != null && own < release;
}
/** Why a compare has no verdict to show, or undefined when it has one; a stored verdict always wins. */
export function noVerdict(
  result: CompareResponse | undefined,
  context: NoVerdictContext,
): NoVerdict | undefined {
  if (trackingNotStarted(context.tracking, context.scopeStarted)) return "not_tracking";
  if (!result || result.stored_verdict) return undefined;
  if (result.live_verdict?.restricted) return undefined;
  if (context.deployKind === "pre_existing" && !manualCompare(result)) return "pre_existing";
  // A window the rollup has not reached reads as zero traffic, which would be a false count.
  const { a, b } = result.arms;
  if (a.has_rollup === false || (hasBaseline(result) && b.has_rollup === false)) return "no_data";
  return undefined;
}
/** The one no-verdict sentence for a compare, from the shared no-verdict helper. */
export function noVerdictSentence(reason: NoVerdict, context: NoVerdictContext, t: TranslateFn) {
  return noVerdictText(context.tracking, t, undefined, scopeFlag(reason, context));
}
/** The baseline rule a no-verdict compare names when it has no baseline, in the words of its sentence. */
export function noVerdictBaselineRule(
  reason: NoVerdict,
  context: NoVerdictContext,
  t: TranslateFn,
) {
  return noVerdictRule(context.tracking, t, undefined, scopeFlag(reason, context));
}
// Only a pre-existing compare reads the scope's own flag; the other reasons are warm-up by definition.
function scopeFlag(reason: NoVerdict, context: NoVerdictContext) {
  return reason === "pre_existing" ? context.scopeStarted : false;
}
/** The state a compare shows: its no-verdict reason's chip state, or its leading verdict. */
export function compareState(result: CompareResponse, context: NoVerdictContext) {
  const reason = noVerdict(result, context);
  if (reason) return reason === "pre_existing" ? "pre_existing" : "no_verdict";
  const leading = leadingVerdict(result);
  return leading ? verdictCode(leading) : "no_verdict";
}
/** True when the user picked the baseline; such a compare judges its own two windows once. */
export function manualCompare(result: CompareResponse) {
  return result.baseline_rule === "manual";
}
// A live recompute that cannot judge (e.g. K1 pod evidence it never sees) must not hide a decisive stored verdict.
export function leadingVerdict(result: CompareResponse): VerdictSummary | undefined {
  const { live_verdict: live, stored_verdict: stored } = result;
  // A picked baseline is judged once on its own windows, so the stored verdict cannot outrank it.
  if (
    live &&
    stored &&
    !manualCompare(result) &&
    stored.verdict !== "insufficient" &&
    unconfirmed(live, stored)
  )
    return stored;
  // A live preview has no frozen rollback input, so the stored outcome stays authoritative; a picked baseline judges other windows.
  if (
    live &&
    stored &&
    !manualCompare(result) &&
    decisiveRollback(stored) &&
    !decisiveRollback(live)
  )
    return {
      ...live,
      rollback_outcome: stored.rollback_outcome,
      deploy: live.deploy ?? stored.deploy,
    };
  return live || stored || undefined;
}
/** Both arms of one comparison named by build, so every legend of it reads the same. */
export function compareArmLabels(result: CompareResponse, t: TranslateFn) {
  const leading = leadingVerdict(result);
  return {
    a: compareArmLabel(result.arms, "a", leading?.version_images, t),
    b: compareArmLabel(result.arms, "b", leading?.baseline?.version_images, t),
  };
}
// A live recheck keeps no switch history, so it borrows the stored one only while both name the same baseline build.
export function baselineProvenance(result: CompareResponse, leading: VerdictSummary | undefined) {
  const baseline = leading?.baseline;
  const stored = result.stored_verdict?.baseline;
  if (!baseline || !stored || leading === result.stored_verdict) return baseline;
  if (baseline.switched_at || baseline.initial_version || !sameBuild(stored, baseline))
    return baseline;
  return {
    ...baseline,
    initial_rule: stored.initial_rule,
    initial_version: stored.initial_version,
    initial_image: stored.initial_image,
    switched_at: stored.switched_at,
  };
}

/** When the baseline moved off its first build; 0 when it never did, as a drained canary falling back to that build. */
export function baselineSwitchedAt(baseline: VerdictSummary["baseline"]) {
  if (!baseline?.switched_at || !baseline.initial_version) return 0;
  const first = { version: baseline.initial_version, image: baseline.initial_image };
  return sameBuild(first, baseline) ? 0 : baseline.switched_at;
}
/** True only when a confirmed live verdict leads and differs from the stored release verdict. */
export function verdictChanged(result: CompareResponse) {
  const { live_verdict: live, stored_verdict: stored } = result;
  if (!live || !stored || live.verdict === "insufficient" || manualCompare(result)) return false;
  return leadingVerdict(result) !== stored && live.verdict !== stored.verdict;
}
export function worseTone(result: CompareResponse): "crit" | "warn" {
  const leading = leadingVerdict(result);
  return leading && verdictCode(leading) === "watch" ? "warn" : "crit";
}
/** +1 when the headline metric rose, −1 when it fell, 0 when unknown or flat. */
export function headlineDirection(value: VerdictSummary) {
  const headline = value.headline;
  if (!headline?.metric || headline.new == null || headline.base == null) return 0;
  return Math.sign(headline.new - headline.base);
}
/** The copy keys of the response notes this UI knows; an unknown note is dropped, never shown raw. */
export function noteKeys(notes: string[] | null | undefined): I18nKey[] {
  return [...new Set(notes || [])].flatMap((note) => (NOTE_KEYS[note] ? [NOTE_KEYS[note]] : []));
}
export function metricName(metric: string | null | undefined, t: TranslateFn) {
  return metric && INLINE_METRICS.has(metric)
    ? t(`serviceVersions.compare.inline.${metric}` as I18nKey)
    : "";
}
function sentenceKey(value: VerdictSummary, code: Verdict, improved: boolean) {
  // A real improvement contradicts "no real change", so that OK keeps only its request count.
  if (code === "ok" && improved) return "serviceVersions.sentence.okImproved";
  if (code === "not_serving")
    return value.reason_code === "traffic_drop"
      ? "serviceVersions.sentence.notServingDrop"
      : value.reason_code === "seen_in_k8s_no_requests"
        ? "serviceVersions.sentence.notServingPods"
        : "serviceVersions.sentence.notServing";
  if (code === "insufficient")
    return value.needs?.metric
      ? "serviceVersions.sentence.insufficient"
      : "serviceVersions.sentence.insufficientBare";
  const headline = Boolean(value.headline?.metric && value.headline.new != null);
  // Every headline metric is lower-is-better, so a fall printed under a worse verdict would contradict it.
  const contradicts = WORSE_CODES.has(code) && headlineDirection(value) < 0;
  if (
    (!headline || contradicts || printsFlat(value)) &&
    ["watch", "regressed", "rollback_recovered", "rollback_still_worse"].includes(code)
  )
    return `serviceVersions.sentence.${verdictNames[code]}Bare`;
  return `serviceVersions.sentence.${verdictNames[code]}`;
}
// Without the tiles, only the producer's improved reason on a headline that is no noise names a real improvement.
function improvedHeadline(value: VerdictSummary) {
  const headline = value.headline;
  if (value.reason_code !== "improved" || !headline?.metric) return false;
  if (headline.new == null || headline.base == null || headline.lo == null || headline.hi == null)
    return false;
  const delta = headline.new - headline.base;
  return (
    delta < 0 &&
    !isNoiseChange(headline.metric, { delta, lo: headline.lo, hi: headline.hi, b: headline.base })
  );
}
// Two equal printed values cannot carry a change, so the sentence names none.
function printsFlat(value: VerdictSummary) {
  const headline = value.headline;
  if (!headline?.metric || headline.new == null || headline.base == null) return false;
  return displayed(headline.metric, headline.new) === displayed(headline.metric, headline.base);
}
/** The one verdict sentence; `improved` says the Why line beside it names a real improvement. */
export function verdictSentence(
  value: VerdictSummary,
  t: TranslateFn,
  options: { improved?: boolean } = {},
) {
  const code = verdictCode(value);
  if (code === "restricted") return t("serviceVersions.compare.restricted");
  const metric = value.headline?.metric ?? value.needs?.metric ?? "";
  const need = value.needs?.need ?? FLOORS[metric as TileMetric] ?? FLOORS.error_rate ?? 100;
  return t(sentenceKey(value, code, options.improved ?? improvedHeadline(value)) as I18nKey, {
    version: value.version,
    from: value.deploy?.from_version || "",
    n: formatCount(value.sample?.n_new ?? 0),
    need: formatCount(need),
    count: formatCount(Math.max(0, need - (value.needs?.have ?? value.sample?.n_new ?? 0))),
    metric: metricName(metric, t),
    base: formatMetric(metric, value.headline?.base, t),
    new: formatMetric(metric, value.headline?.new, t),
  });
}
