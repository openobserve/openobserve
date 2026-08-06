import { annotationService } from "../../services/dashboard_annotations";
import { dashboardAnnotationsQuery } from "@/composables/query/queries/dashboards";

export const useAnnotations = (
  organization: string,
  dashboardId: string,
  panelId: string,
  enableAnnotations: boolean = true,
) => {
  const refreshAnnotations = async (start_time: number, end_time: number) => {
    // Skip annotations API call if disabled
    if (!enableAnnotations) {
      return null;
    }

    if (!panelId) {
      return;
    }
    if (!dashboardId) {
      return;
    }

    try {
      // Cached per dashboard + window: every panel on a dashboard asks for its
      // own annotations over the same range, so this collapses N requests to one
      // per distinct window.
      return await dashboardAnnotationsQuery.fetch(organization, dashboardId, {
        panels: [panelId],
        start_time,
        end_time,
      });
    } catch (err: any) {
      console.error("Error fetching annotations:", err);
      return null;
    }
  };

  return {
    refreshAnnotations,
  };
};
