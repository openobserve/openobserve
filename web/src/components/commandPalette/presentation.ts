import type { I18nKey } from "@/types/i18n";
import type { ResourceKind } from "@/ts/interfaces/resources";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { NavGateContext } from "@/lib/core/Navbar/ONavbar.types";
import { featureState } from "@/utils/featureGate";
export const KIND_LABELS: Record<ResourceKind, I18nKey> = {
  dashboard: "menu.dashboard",
  alert: "menu.alerts",
  stream: "menu.index",
  saved_view: "accessBoundary.resources.savedviews",
  function: "function.header",
  pipeline: "menu.pipeline",
  synthetic: "menu.synthetic",
  user: "iam.basicUsers",
  service_account: "iam.serviceAccounts",
};
export const KIND_ICONS: Record<ResourceKind, IconName> = {
  dashboard: "dashboard",
  alert: "notifications",
  stream: "storage",
  saved_view: "bookmark",
  function: "code",
  pipeline: "account-tree",
  synthetic: "monitor-heart",
  user: "person",
  service_account: "manage-accounts",
};
export const PEER_KINDS: ResourceKind[] = [
  "stream",
  "dashboard",
  "alert",
  "pipeline",
  "function",
  "saved_view",
  "synthetic",
  "user",
  "service_account",
];
export function enabledResourceKinds(
  hasRoute: (_name: string) => boolean,
  context: NavGateContext,
  syntheticsEnabled: boolean,
): ResourceKind[] {
  const signalEnabled = ["logs", "metrics", "traces"].some(
    (signal) =>
      hasRoute(signal) &&
      featureState(context.features, signal) === "enabled" &&
      !context.hiddenMenus.has(signal),
  );
  const routeNames: Record<ResourceKind, string> = {
    stream: "logs",
    dashboard: "dashboards",
    alert: "alertList",
    saved_view: "logs",
    function: "functionList",
    pipeline: "pipelines",
    synthetic: "synthetics",
    user: "users",
    service_account: "serviceAccounts",
  };
  return PEER_KINDS.filter((kind) => {
    if (context.hiddenMenus.has(routeNames[kind])) return false;
    if (kind === "stream" || kind === "saved_view") return signalEnabled;
    if (!hasRoute(routeNames[kind])) return false;
    if (kind === "service_account") return context.serviceAccount;
    if (kind === "synthetic" && !syntheticsEnabled) return false;
    const features: Partial<Record<ResourceKind, string>> = {
      dashboard: "dashboards",
      alert: "alerts",
      function: "pipelines",
      pipeline: "pipelines",
      synthetic: "synthetics",
    };
    const feature = features[kind];
    return !feature || featureState(context.features, feature) === "enabled";
  });
}
