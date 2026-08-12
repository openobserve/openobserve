import http from "./http";
import { defineQuery } from "@/composables/query/queryClient";

export const annotationService = {
  create_timed_annotations: (
    org_id: string,
    dashboard_id: string,
    annotations: Omit<any, "annotation_id">[],
  ) => {
    // Construct the request payload
    const data: any = {
      timed_annotations: annotations.map((annotation) => ({
        annotation_id: crypto.randomUUID(),
        ...annotation,
      })),
    };

    // Make the API call
    return http().post(`/api/${org_id}/dashboards/${dashboard_id}/annotations`, data, {
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
    });
  },

  update_timed_annotations: (
    org_id: string,
    dashboard_id: string,
    timed_annotation_id: string,
    annotations: Record<string, unknown>,
  ) => {
    return http().put(
      `/api/${org_id}/dashboards/${dashboard_id}/annotations/${timed_annotation_id}`,
      annotations,
      {
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
        },
      },
    );
  },

  delete_timed_annotations: (
    organization: string,
    dashboardId: string,
    annotationIds: string[],
  ) => {
    return http().delete(`/api/${organization}/dashboards/${dashboardId}/annotations`, {
      data: {
        annotation_ids: annotationIds,
      },
    });
  },

  get_timed_annotations: (
    org_id: string,
    dashboard_id: string,
    params: {
      panels: string[];
      start_time: number;
      end_time: number;
    },
  ) => {
    // Format the panels parameter as comma-separated string if it's an array
    const formattedPanels = Array.isArray(params.panels) ? params.panels.join(",") : params.panels;

    // Construct query parameters
    const queryParams = {
      panels: formattedPanels,
      start_time: params.start_time,
      end_time: params.end_time,
    };

    // Make the API call
    return http().get(`/api/${org_id}/dashboards/${dashboard_id}/annotations`, {
      params: queryParams,
    });
  },
};

/**
 * Every panel on a dashboard asks for the same window, so this collapses N
 * requests into one per distinct window. `?? null` because a query result may
 * not be undefined.
 */
export const dashboardAnnotationsQuery = defineQuery<[dashboardId: string, params: unknown], any>({
  key: (dashboardId, params) => ["dashboards", "annotations", dashboardId, params],
  fetch: async (org, dashboardId, params) =>
    (await annotationService.get_timed_annotations(org, dashboardId, params as any)).data ?? null,
  scope: ["dashboards"],
});
