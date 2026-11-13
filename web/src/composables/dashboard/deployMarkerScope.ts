import { reactive, toRaw, watchEffect } from "vue";
import config from "@/aws-exports";
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import type { DeployMarkerScope } from "./useAnnotations";
import { OVERALL_METRIC } from "@/enterprise/components/ServiceVersions/deployMarkers";
import {
  useVersionCompareDrawer,
  type CompareLocation,
} from "@/enterprise/composables/useVersionCompareDrawer";
const VITALS: [RegExp, string][] = [
  [/largest_contentful_paint/, "lcp_p75"],
  [/interaction_to_next_paint/, "inp_p75"],
  [/cumulative_layout_shift/, "cls_p75"],
];
const CLICK_KEY = "chart_mark_line_click";
export const unavailableDeployServices = reactive(new Set<string>());
export interface DeployMarkerClick {
  service?: string;
  version: string;
  where: string;
  deployKey?: string;
}
export function single(value: unknown) {
  const first = Array.isArray(value) ? (value.length === 1 ? value[0] : "") : value;
  return typeof first === "string" && first !== "_o2_all_" ? first : "";
}
// A vitals chart reads the verdict of its own metric; any other chart reads the verdict as a whole.
export function panelMetric(panel: any) {
  const text = (panel?.queries || []).map((query: any) => query?.query || "").join(" ");
  return VITALS.find(([pattern]) => pattern.test(text))?.[1] ?? OVERALL_METRIC;
}
export function deployMarkerScope(
  panel: any,
  variables: { values?: { name: string; value: unknown }[] } | undefined,
  store: any,
): DeployMarkerScope | undefined {
  if (config.isEnterprise !== "true" && config.isCloud !== "true") return undefined;
  const value = (name: string) =>
    single(variables?.values?.find((variable) => variable.name === name)?.value);
  const service = value("service");
  if (!service) return undefined;
  return {
    service,
    env: value("env") || undefined,
    metric: panelMetric(panel),
    timezone: store.state.timezone || "UTC",
    user: store.state.userInfo?.email || "",
    t: i18n.global.t as unknown as TranslateFn,
  };
}
export function deployMarkerClickHandler(open: (input: CompareLocation) => unknown) {
  return (marker: DeployMarkerClick) => {
    if (!marker?.service || !marker.deployKey) return;
    open({
      service: marker.service,
      where: marker.where,
      a: marker.version,
      deployKey: marker.deployKey,
    });
  };
}
function hasServiceVariable(dashboard: any) {
  return (dashboard?.variables?.list || []).some((variable: any) => variable?.name === "service");
}
// Non-enumerable, so saving, cloning or diffing the dashboard never carries the handler.
export function attachDeployMarkerClicks(
  dashboard: any,
  handler: (marker: DeployMarkerClick) => void,
) {
  if (!hasServiceVariable(dashboard)) return;
  const configs = (dashboard.tabs || []).flatMap((tab: any) =>
    (tab?.panels || []).map((panel: any) => panel?.config).filter(Boolean),
  );
  for (const panelConfig of configs) {
    const target = toRaw(panelConfig);
    if (Object.prototype.hasOwnProperty.call(target, CLICK_KEY)) continue;
    Object.defineProperty(target, CLICK_KEY, {
      value: handler,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
}
// Deploy markers carry their service, so a marker click opens the drawer without reading variables.
export function useDeployMarkerClicks(dashboard: () => any) {
  if (config.isEnterprise !== "true" && config.isCloud !== "true") return;
  const handler = deployMarkerClickHandler(useVersionCompareDrawer().open);
  watchEffect(() => attachDeployMarkerClicks(dashboard(), handler));
}
