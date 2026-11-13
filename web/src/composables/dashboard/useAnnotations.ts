import { isAxiosError } from "axios";
import { dashboardAnnotationsQuery } from "@/services/dashboard_annotations.queries";
import { queryClient } from "@/composables/query/queryClient";
import type { TranslateFn } from "@/types/i18n";
import { deploysQuery } from "@/services/service_versions.queries";
import store from "@/stores";
import { featureState } from "@/utils/featureGate";
import { unavailableDeployServices } from "./deployMarkerScope";
import {
  dashboardDeploys,
  deployMarkers,
  withoutAnnotatedVersions,
} from "@/enterprise/components/ServiceVersions/deployMarkers";

export interface DeployMarkerScope {
  service: string;
  env?: string;
  metric: string;
  timezone: string;
  user: string;
  t: TranslateFn;
}
// A denied read is a permission answer, not an outage, so it draws nothing and offers no retry.
function isDenied(error: unknown) {
  return isAxiosError(error) && [403, 404].includes(error.response?.status ?? 0);
}
// A cancelled panel load says nothing about the deploy read, so it never shows the retry chip.
function isAbort(error: unknown) {
  const name = (error as { name?: string })?.name;
  return name === "CanceledError" || name === "AbortError" || name === "CancelledError";
}

export const useAnnotations = (
  organization: string,
  dashboardId: string,
  panelId: string,
  enableAnnotations: boolean = true,
  deployScope?: () => DeployMarkerScope | undefined,
) => {
  const manualAnnotations = async (start_time: number, end_time: number) => {
    if (!enableAnnotations) return null;
    if (!panelId || !dashboardId) return undefined;
    try {
      // Cached per dashboard + window: every panel on a dashboard asks for its
      // own annotations over the same range, so this collapses N requests to one
      // per distinct window.
      return await queryClient.fetchQuery(
        dashboardAnnotationsQuery(organization, dashboardId, {
          panels: [panelId],
          start_time,
          end_time,
        }),
      );
    } catch (err: any) {
      console.error("Error fetching annotations:", err);
      return null;
    }
  };

  // Deploy markers need only a service variable: RUM Performance dashboards are inline, with no id.
  const derivedDeploys = async (start_time: number, end_time: number, manual: any[]) => {
    const scope = deployScope?.();
    if (!scope?.service || featureState(store.state.zoConfig?.features, "traces") === "locked")
      return [];
    try {
      const { deploys } = await queryClient.fetchQuery(
        deploysQuery(organization, scope.user, {
          service: scope.service,
          env: scope.env || undefined,
          start_time,
          end_time,
        }),
      );
      const markers = deployMarkers(
        dashboardDeploys(deploys),
        scope.metric,
        scope.timezone,
        scope.t,
      );
      unavailableDeployServices.delete(scope.service);
      return withoutAnnotatedVersions(markers, manual).map((marker) => ({
        annotation_id: `deploy:${marker.deployKey ?? marker.version}:${marker.where}`,
        start_time: marker.at,
        end_time: null,
        title: marker.version,
        text: "",
        tags: [],
        panels: panelId ? [panelId] : [],
        deploy_marker: { ...marker, service: scope.service },
      }));
    } catch (error) {
      if (!isAbort(error) && !isDenied(error)) unavailableDeployServices.add(scope.service);
      return [];
    }
  };

  const refreshAnnotations = async (start_time: number, end_time: number) => {
    const manual = await manualAnnotations(start_time, end_time);
    const derived = await derivedDeploys(start_time, end_time, manual || []);
    if (!derived.length) return manual;
    return [...(manual || []), ...derived];
  };

  return {
    refreshAnnotations,
  };
};
