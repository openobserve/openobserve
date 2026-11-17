import { gt, type TranslateFn } from "@/types/i18n";
import { metricName, verdictCode, verdictSentence } from "./verdictText";
import { metricChange } from "./rumStrip";
import { escapeHtml } from "@/utils/html";
import { toZonedTime } from "date-fns-tz";
import type { DeployMarker } from "@/services/service_versions";
import { chartColor } from "@/utils/chartTheme";
import { buildLabel, whereText } from "@/utils/serviceVersionsCopy";
export interface RumChartMarker {
  version: string;
  at: number;
  deployKey?: string;
  where?: string;
  unavailable?: boolean;
  symbol?: string[];
  symbolSize?: number;
  tooltip?: { show: boolean; formatter: string };
  lineStyle?: { type: string; width: number; color: string };
  label?: {
    formatter: string;
    show?: boolean;
    position?: string;
    fontSize?: number;
    color?: string;
  };
}
// Charts without a per-metric verdict (e.g. page loads) colour by the verdict as a whole.
export const OVERALL_METRIC = "overall";
const VITAL_METRICS = new Set(["lcp_p75", "inp_p75", "cls_p75"]);
const OVERALL_BADGES: Record<string, string> = {
  regressed: "worse",
  rollback_still_worse: "worse",
  watch: "possible",
};
function badgeOf(marker: DeployMarker, metric: string) {
  if (marker.verdict?.restricted) return undefined;
  if (metric === OVERALL_METRIC)
    return marker.verdict ? OVERALL_BADGES[verdictCode(marker.verdict)] : marker.badge;
  return (
    marker.verdict?.metrics?.find((value) => value.metric === metric)?.badge ??
    marker.metrics?.[metric]?.badge
  );
}
// A worsened metric takes its deploy's severity, as its drawer tile does.
function severityOf(marker: DeployMarker, badge: string | undefined) {
  if ((badge !== "worse" && badge !== "possible") || !marker.verdict || marker.verdict.restricted)
    return badge;
  const code = verdictCode(marker.verdict);
  if (code === "regressed" || code === "rollback_still_worse") return "worse";
  return code === "watch" ? "possible" : badge;
}
// A judged metric whose whole range sits below zero improved.
function improvedOn(marker: DeployMarker, metric: string) {
  if (marker.verdict?.restricted || metric === OVERALL_METRIC) return false;
  const row =
    marker.verdict?.metrics?.find((value) => value.metric === metric) ?? marker.metrics?.[metric];
  return Boolean(row && row.badge !== "insufficient" && row.hi != null && row.hi < 0);
}
// A Web Vitals chart names its own metric change on the label, as the strip does.
function metricLabel(marker: DeployMarker, metric: string, t?: TranslateFn) {
  if (!t || !VITAL_METRICS.has(metric) || marker.verdict?.restricted) return "";
  const row = marker.verdict?.metrics?.find((value) => value.metric === metric);
  if (!row || row.badge === "insufficient" || row.base_value == null || row.new_value == null)
    return "";
  const name = metricName(metric, t);
  const change = metricChange(metric, row.base_value, row.new_value, t);
  return name && change !== "—" ? `${name} ${change}` : "";
}
function previousBuild(marker: DeployMarker) {
  return marker.from_version
    ? { version: marker.from_version, image: marker.from_image }
    : undefined;
}
export function deployMarkers(
  markers: DeployMarker[],
  metric: string,
  timezone = "UTC",
  t?: TranslateFn,
) {
  return markers
    .filter((marker) => marker.kind !== "pre_existing")
    .map((marker) => {
      const restricted = marker.verdict?.restricted;
      const badge = severityOf(marker, badgeOf(marker, metric));
      const notServing =
        !restricted &&
        (marker.verdict?.verdict === "not_serving" || marker.badge === "not_serving");
      const recovered =
        !restricted && marker.verdict && verdictCode(marker.verdict) === "rollback_recovered";
      const color = chartColor(
        notServing || badge === "worse"
          ? "--color-status-error-text"
          : badge === "possible"
            ? "--color-status-warning-text"
            : recovered || improvedOn(marker, metric)
              ? "--color-status-success-text"
              : "--color-text-secondary",
      );
      const hollow = marker.kind === "rollback" || marker.provisional || notServing;
      const from = previousBuild(marker);
      const to = deployBuildLabel(marker, t ?? gt);
      const heading = escapeHtml(from ? `${buildLabel(from, marker, t ?? gt)} → ${to}` : to);
      const sentence = marker.verdict && t ? escapeHtml(verdictSentence(marker.verdict, t)) : "";
      const action = t ? escapeHtml(t("serviceVersions.panel.clickToCompare")) : "";
      const version = marker.kind === "rollback" ? `↩ ${to}` : to;
      const change = metricLabel(marker, metric, t);
      return {
        name: marker.version,
        xAxis: toZonedTime(new Date(marker.at / 1000), timezone).getTime(),
        at: marker.at,
        deployKey: marker.deploy_key,
        version: marker.version,
        where: marker.where_key,
        symbol: ["none", hollow ? "emptyCircle" : "none"],
        symbolSize: 8,
        tooltip: {
          show: true,
          formatter: [
            `<b>${heading}</b>`,
            escapeHtml(whereText(marker.where_key, marker.where, t ?? gt)),
            sentence,
            action,
          ]
            .filter(Boolean)
            .join(" · "),
        },
        lineStyle: { type: marker.provisional ? "dotted" : "dashed", width: 1, color },
        label: {
          show: true,
          position: "end",
          fontSize: 10,
          color,
          formatter: change ? `${version} · ${change}` : version,
        },
      };
    });
}
export type ChartDeployMarker = ReturnType<typeof deployMarkers>[number];
/** The build a deploy brought in, named against the build it replaced. */
export function deployBuildLabel(marker: DeployMarker, t: TranslateFn) {
  return buildLabel(marker, previousBuild(marker), t);
}
// First-seen markers drawn when the verdict read failed: grey, never coloured by a guess.
export function unavailableMarkers(
  deploys: { version: string; firstSeen: number }[],
  timezone = "UTC",
  t?: TranslateFn,
) {
  const color = chartColor("--color-text-secondary");
  const label = t ? t("serviceVersions.rum.markers.unavailable") : "";
  return deploys.map((deploy) => ({
    name: deploy.version,
    xAxis: toZonedTime(new Date(deploy.firstSeen / 1000), timezone).getTime(),
    at: deploy.firstSeen,
    deployKey: undefined as string | undefined,
    version: deploy.version,
    where: "",
    unavailable: true,
    symbol: ["none", "none"],
    symbolSize: 8,
    tooltip: {
      show: true,
      formatter: [`<b>${escapeHtml(deploy.version)}</b>`, escapeHtml(label)]
        .filter(Boolean)
        .join(" · "),
    },
    lineStyle: { type: "dashed", width: 1, color },
    label: {
      show: true,
      position: "end",
      fontSize: 10,
      color,
      formatter: label ? `${deploy.version} · ${label}` : deploy.version,
    },
  }));
}
// Manual annotations stay authoritative: one titled or tagged with the version hides the derived marker.
export function withoutAnnotatedVersions<T extends { version: string }>(
  markers: T[],
  annotations: { title?: string; tags?: string[] }[] | null | undefined,
) {
  const named = new Set<string>();
  for (const annotation of annotations || []) {
    if (annotation.title) named.add(annotation.title.trim());
    for (const tag of annotation.tags || []) named.add(String(tag).trim());
  }
  return markers.filter((marker) => !named.has(marker.version));
}
// One marker per (version, where); the server already narrowed them to the dashboard env.
export function dashboardDeploys(deploys: DeployMarker[]) {
  const seen = new Set<string>();
  return deploys.filter((marker) => {
    const key = `${marker.version}\u0000${marker.where_key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
