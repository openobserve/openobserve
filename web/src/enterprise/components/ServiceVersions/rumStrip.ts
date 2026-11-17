import { reactive } from "vue";
import type { LocationQuery, LocationQueryRaw } from "vue-router";
import { compareKeys } from "@/enterprise/composables/useVersionCompareDrawer";
import type { I18nKey, TranslateFn } from "@/types/i18n";
import type { VerdictSummary } from "@/services/service_versions";
import { formatMetric, formatPoints, percentChange } from "./VersionSummaryTiles.format";
import { metricName, verdictCode, verdictNames, verdictSentence } from "./verdictText";
// The tab that owns an app picker reports it, so the strip describes the app on screen.
export const rumTabApps = reactive({ errors: "", performance: "" });
// Performance reports its env and relative range, so the no-version hint in the strip names them.
export const rumHintContext = reactive({ env: "", period: "" });
const RUM_METRICS = ["error_view_rate", "lcp_p75", "inp_p75", "cls_p75"];
const JUDGED = new Set(["ok", "watch", "regressed", "rollback_recovered", "rollback_still_worse"]);
const HEADLINED = new Set(["watch", "regressed", "rollback_recovered", "rollback_still_worse"]);
const UNIT = /\s(ms|s)$/;
function signed(value: number, text: string) {
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}
export function metricChange(metric: string, base: number, value: number, t: TranslateFn) {
  const delta = value - base;
  if (metric === "error_view_rate") return formatPoints(delta, t);
  if (metric === "cls_p75") return signed(delta, Math.abs(delta).toFixed(2));
  if (!base) return "—";
  return percentChange(delta, base);
}
// "142 → 168 ms" reads the shared unit once.
function pair(metric: string, base: number, value: number, t: TranslateFn) {
  const before = formatMetric(metric, base, t);
  const after = formatMetric(metric, value, t);
  const unit = before.match(UNIT)?.[1];
  return {
    base: unit && after.match(UNIT)?.[1] === unit ? before.replace(UNIT, "") : before,
    new: after,
  };
}
export function improvedMetrics(verdict: VerdictSummary, t: TranslateFn) {
  const headline = verdict.headline?.metric;
  const names = (verdict.metrics || [])
    .filter(
      (row) =>
        row.metric !== headline &&
        RUM_METRICS.includes(row.metric) &&
        row.hi != null &&
        row.lo != null &&
        row.hi < 0,
    )
    .sort((a, b) => RUM_METRICS.indexOf(a.metric) - RUM_METRICS.indexOf(b.metric))
    .map((row) => metricName(row.metric, t))
    .filter(Boolean);
  return names.length ? new Intl.ListFormat(undefined, { type: "conjunction" }).format(names) : "";
}
export function stripSummary(verdict: VerdictSummary, t: TranslateFn) {
  const code = verdictCode(verdict);
  if (code === "insufficient") return verdictSentence(verdict, t);
  if (!JUDGED.has(code)) return "";
  const { metric, base, new: value } = verdict.headline || {};
  const improved = improvedMetrics(verdict, t);
  const headline =
    metric && base != null && value != null
      ? t("serviceVersions.rum.strip.headline", {
          metric: metricName(metric, t),
          change: metricChange(metric, base, value, t),
          ...pair(metric, base, value, t),
        })
      : "";
  if (headline && improved)
    return t("serviceVersions.rum.strip.headlineWithImproved", {
      headline,
      improved: t("serviceVersions.rum.strip.improved", { metrics: improved }),
    });
  if (improved) return t("serviceVersions.rum.strip.improved", { metrics: improved });
  return headline;
}
// The RUM drawer names the tile metric with its change and pair; "" leaves the shared sentence in place.
export function rumVerdictSentence(verdict: VerdictSummary, t: TranslateFn) {
  const code = verdictCode(verdict);
  const { metric, base, new: value } = verdict.headline || {};
  if (verdict.signal !== "rum" || !HEADLINED.has(code) || !metric || base == null || value == null)
    return "";
  if (!RUM_METRICS.includes(metric)) return "";
  const improved = improvedMetrics(verdict, t);
  const params = {
    verdict: t(`serviceVersions.verdict.${verdictNames[code]}` as I18nKey),
    metric: t(`serviceVersions.compare.tile.${metric}` as I18nKey),
    change: metricChange(metric, base, value, t),
    ...pair(metric, base, value, t),
    improved: improved ? t("serviceVersions.rum.strip.improved", { metrics: improved }) : "",
  };
  return t(
    improved
      ? "serviceVersions.compare.drill.sentence.headlineWithImproved"
      : "serviceVersions.compare.drill.sentence.headline",
    params,
  );
}
// RUM tabs rewrite their route on mount, so the compare-drawer keys must ride along or a copied drawer link closes.
export function drawerQuery(query: LocationQuery): LocationQueryRaw {
  return Object.fromEntries(
    compareKeys.filter((key) => query[key] != null).map((key) => [key, query[key]]),
  );
}
