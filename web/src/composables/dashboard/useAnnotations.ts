import { annotationService } from "../../services/dashboard_annotations";

export const useAnnotations = (
  organization: string,
  dashboardId: string,
  panelId: string,
) => {
  const refreshAnnotations = async (start_time: number, end_time: number) => {
    if (!panelId) {
      return;
    }
    if (!dashboardId) {
      return;
    }
    
    try {
      const response = await annotationService.get_timed_annotations(
        organization,
        dashboardId,
        {
          panels: [panelId],
          start_time,
          end_time,
        },
      );

      return response.data;
    } catch (err: any) {
      console.error("Error fetching annotations:", err);
      return null;
    }
  };

  return {
    refreshAnnotations,
  };
};
