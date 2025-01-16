import { ref, watch } from "vue";
import { annotationService } from "../../services/dashboard_annotations";
const annotations = ref<any[]>([]);
const annotationMarkLines = ref<any[]>([]);
const currentStartTime = ref<number>(0);
const currentEndTime = ref<number>(0);
export const useAnnotationsData = (
  panelId: string,
  organization: any,
  dashboardId: any,
) => {
  const showAnnotationButton = ref(false);
  const showAddAnnotation = ref(false);
  const selectedTimestamp = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const updateTimeRange = (start: number, end: number) => {
    currentStartTime.value = start;
    currentEndTime.value = end;
  };

  const handleChartClick = (params: any) => {
    if (params) {
      const clickedTimestamp = params[0] || params.time || params.name;

      if (clickedTimestamp) {
        const date = new Date(clickedTimestamp);
        selectedTimestamp.value = date
          .toLocaleString("sv-SE")
          .replace("T", " ");
        showAnnotationButton.value = true;
      }
    }
  };

  const handleAddAnnotation = () => {
    showAddAnnotation.value = true;
    showAnnotationButton.value = false;
  };

  const handleSaveAnnotation = async (annotationData: any) => {
    loading.value = true;
    error.value = null;

    try {
      const payload = {
        annotation_id: annotationData.id || crypto.randomUUID(),
        start_time: new Date(annotationData.value).getTime() * 1000,
        end_time: null,
        title: annotationData.name,
        text: annotationData.description || null,
        tags: annotationData.tags || "",
        panels: [panelId],
      };

      await annotationService.create_timed_annotations(
        organization,
        dashboardId,
        [payload],
      );

      closeAddAnnotation();
      await refreshAnnotations(currentStartTime.value, currentEndTime.value);
    } catch (err: any) {
      error.value = err.message;
      console.error("Error saving annotation:", err);
    } finally {
      loading.value = false;
    }
  };

  const handleDeleteAnnotation = async (annotationId: string) => {
    loading.value = true;
    error.value = null;

    try {
      await annotationService.delete_timed_annotations(
        organization,
        dashboardId,
        [annotationId],
      );
      await refreshAnnotations(currentStartTime.value, currentEndTime.value);
    } catch (err: any) {
      error.value = err.message;
      console.error("Error removing annotation:", err);
    } finally {
      loading.value = false;
    }
  };

  const closeAddAnnotation = () => {
    showAddAnnotation.value = false;
    showAnnotationButton.value = false;
  };

  const getLabelFormatter = (name: string) => ({
    formatter: name ? "{b}:{c}" : "{c}",
    position: "insideEndTop",
  });

  const getConfigMarkLines = (config: any) => {
    if (!config?.mark_line?.length) return [];
    return config.mark_line.map((markLine: any) => ({
      symbol: ["none", "none"],
      name: markLine.name,
      type: markLine.type,
      xAxis: markLine.type === "xAxis" ? markLine.value : null,
      yAxis: markLine.type === "yAxis" ? markLine.value : null,
      label: getLabelFormatter(markLine.name),
    }));
  };

  const changeFormatOfDateTime = (timestamp: any) => {
    const date = new Date(timestamp / 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  watch(
    () => annotations.value,
    () => {
      annotationMarkLines.value =
        annotations?.value?.map((annotation) => ({
          symbol: ["none", "none"],
          name: annotation.name,
          type: annotation.type,
          xAxis:
            annotation.type === "xAxis"
              ? changeFormatOfDateTime(annotation.value)
              : null,
          yAxis:
            annotation.type === "yAxis"
              ? changeFormatOfDateTime(annotation.value)
              : null,
          label: getLabelFormatter(annotation.name),
        })) ?? [];
    },
    {
      deep: true,
    },
  );

  const getCombinedMarkLines = (panelSchema: any) => {
    try {
      const configMarkLines = getConfigMarkLines(panelSchema?.config || {});
      const uniqueLines = new Set<string>();
      const combinedMarkLines = [...configMarkLines];

      annotationMarkLines.value.forEach((annotationLine) => {
        const key = `${annotationLine.name}-${annotationLine.xAxis}-${annotationLine.yAxis}`;
        if (!uniqueLines.has(key)) {
          uniqueLines.add(key);
          combinedMarkLines.push(annotationLine);
        }
      });

      return combinedMarkLines;
    } catch (error) {
      console.error("Error combining mark lines:", error);
      return [];
    }
  };

  const refreshAnnotations = async (start_time: number, end_time: number) => {
    loading.value = true;
    error.value = null;

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

      annotations.value = response.data.map((item: any) => ({
        id: item.annotation_id,
        name: item.title,
        description: item.text || "",
        value: item.start_time,
        type: "xAxis",
      }));
    } catch (err: any) {
      error.value = err.message;
      console.error("Error fetching annotations:", err);
    } finally {
      loading.value = false;
    }
  };

  return {
    showAnnotationButton,
    showAddAnnotation,
    selectedTimestamp,
    annotations,
    loading,
    error,
    handleChartClick,
    handleAddAnnotation,
    handleSaveAnnotation,
    handleDeleteAnnotation,
    closeAddAnnotation,
    refreshAnnotations,
    updateTimeRange,
    getCombinedMarkLines,
  };
};
