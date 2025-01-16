import { ref, watch } from "vue";
import { annotationService } from "../../services/dashboard_annotations";

export const useAnnotations = (
  organization: any,
  dashboardId: any,
  panelId: string,
) => {
  const refreshAnnotations = async (start_time: number, end_time: number) => {
    if (!panelId) {
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

      return response.data.map((item: any) => ({
        id: item.annotation_id,
        name: item.title,
        description: item.text || "",
        value: item.start_time,
        type: "xAxis",
      }));
    } catch (err: any) {
      console.error("Error fetching annotations:", err);
      return null;
    }
  };

  return {
    refreshAnnotations,
  };
};
