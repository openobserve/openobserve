import { computed, ref, watch } from "vue";
import { annotationService } from "../../services/dashboard_annotations";
import useNotifications from "../useNotifications";
import { useAnnotations } from "./useAnnotations";

export const useAnnotationsData = (
  organization: any,
  dashboardId: any,
  panelId: string,
) => {
  console.log("useAnnotationsData", organization, dashboardId, panelId);

  // const { refreshAnnotations } = useAnnotations(
  //   organization,
  //   dashboardId,
  //   panelId,
  // );
  // show annotation button
  const isAddAnnotationMode = ref(false);

  // show add annotation dialog
  const isAddAnnotationDialogVisible = ref(false);

  const isEditMode = ref(false);
  const annotationToAddEdit = ref<any>(null);

  // selected timestamp
  const annotationStartTimestamp = ref<any>(null);
  const annotationEndTimestamp = ref<any>(null);

  const annotations = ref<any[]>([]);

  const {
    showInfoNotification,
    showPositiveNotification,
    showErrorNotification,
  } = useNotifications();

  // loading state
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Add annotation button styles
  const addAnnotationbuttonStyle = ref<any>({});

  // Function

  // show add annotation button
  const enableAddAnnotationMode = () => {
    isAddAnnotationMode.value = true;
  };

  // hide add annotation button
  const disableAddAnnotationMode = () => {
    isAddAnnotationMode.value = false;
  };

  const toggleAddAnnotationMode = () => {
    isAddAnnotationMode.value = !isAddAnnotationMode.value;
  };

  // show annoation dialog
  const showAddAnnotationDialog = () => {
    isAddAnnotationDialogVisible.value = true;
  };

  // hide annotation dialog
  const hideAddAnnotationDialog = () => {
    isAddAnnotationDialogVisible.value = false;
    isEditMode.value = false;
    annotationToAddEdit.value = null;
  };

  const handleAddAnnotationButtonClick = () => {
    disableAddAnnotationMode();
    isEditMode.value = false;
    annotationToAddEdit.value = null;
    showAddAnnotationDialog();
  };

  // Handle adding or editing annotation
  const handleAddAnnotation = (start: any, end: any) => {
    console.log("handleAddAnnotation", start, end, annotations);

    annotationToAddEdit.value = {
      start_time: start ? Math.trunc(start * 1000) : null,
      end_time: end ? Math.trunc(end * 1000) : null,
      title: "",
      text: "",
      tags: [],
      panels: [panelId],
    };

    showAddAnnotationDialog();
  };

  const handleSaveAnnotation = async (annotationData: any) => {
    console.log("Saving annotation:", annotationData);
    loading.value = true;
    error.value = null;

    try {
      const payload = {
        annotation_id: annotationData.id || crypto.randomUUID(), // Generate a temporary ID
        start_time: new Date(annotationData.value).getTime() * 1000,
        end_time: annotationData.endTime
          ? new Date(annotationData.endTime).getTime() * 1000
          : null,
        title: annotationData.name,
        text: annotationData.description || null,
        tags: annotationData.tags || [],
        panels: [panelId],
      };

      // Save annotation and get the response
      const response: any = await annotationService.create_timed_annotations(
        organization,
        dashboardId,
        [payload],
      );

      console.log("Annotation created successfully", response);

      showPositiveNotification("Annotation created successfully");
      closeAddAnnotation();
    } catch (err: any) {
      console.error("Error saving annotation:", err);
      error.value = err.message;
      showErrorNotification("Failed to create annotation: " + err.message);
    } finally {
      loading.value = false;
    }
  };

  const editAnnotation = (annotation: any) => {
    annotationToAddEdit.value = annotation;
    showAddAnnotationDialog();
  };

  // Update existing annotation
  const handleUpdateAnnotation = async (annotationData: any) => {
    loading.value = true;
    error.value = null;

    try {
      const payload = {
        annotation_id: annotationData.id,
        start_time: new Date(annotationData.value).getTime() * 1000,
        end_time: annotationData.endTime
          ? new Date(annotationData.endTime).getTime() * 1000
          : null,
        title: annotationData.name,
        text: annotationData.description || null,
        tags: annotationData.tags || [],
        panels: [panelId],
      };

      await annotationService.update_timed_annotations(
        organization,
        dashboardId,
        [payload],
      );

      showPositiveNotification("Annotation updated successfully");
      closeAddAnnotation();
      // await refreshAnnotations(
      //   new Date(annotationStartTimestamp.value).getTime() * 1000,
      //   new Date(annotationEndTimestamp.value).getTime() * 1000,
      // );
    } catch (err: any) {
      error.value = err.message;
      showErrorNotification("Failed to update annotation: " + err.message);
      console.error("Error updating annotation:", err);
    } finally {
      loading.value = false;
    }
  };

  // Delete annotation
  const handleDeleteAnnotation = async (annotationId: string) => {
    console.log("Deleting annotation:", annotationId);
    loading.value = true;
    error.value = null;

    try {
      await annotationService.delete_timed_annotations(
        organization,
        dashboardId,
        [annotationId],
      );
      console.log("Annotation deleted successfully");
      showPositiveNotification("Annotation deleted successfully");
      // await refreshAnnotations(
      //   new Date(annotationStartTimestamp.value).getTime() * 1000,
      //   new Date(annotationEndTimestamp.value).getTime() * 1000,
      // );
    } catch (err: any) {
      console.error("Error removing annotation:", err);
      error.value = err.message;
      showErrorNotification("Failed to delete annotation: " + err.message);
    } finally {
      loading.value = false;
      console.log("Loading state set to false after delete annotation");
    }
  };

  // Dialog close handler
  const closeAddAnnotation = () => {
    isAddAnnotationDialogVisible.value = false;
    isAddAnnotationMode.value = false;
    isEditMode.value = false;
    annotationToAddEdit.value = null;
  };

  // Watch for annotation mode to show notification
  watch(isAddAnnotationMode, () => {
    if (isAddAnnotationMode.value) {
      showInfoNotification(
        "Click on the chart data or select a range to add an annotation",
        {},
      );
    }
  });

  return {
    isAddAnnotationMode,
    isAddAnnotationDialogVisible,
    isEditMode,
    annotationToAddEdit,
    annotations,
    loading,
    error,
    addAnnotationbuttonStyle,
    editAnnotation,
    enableAddAnnotationMode,
    disableAddAnnotationMode,
    toggleAddAnnotationMode,
    showAddAnnotationDialog,
    hideAddAnnotationDialog,
    handleAddAnnotation,
    handleAddAnnotationButtonClick,
    handleSaveAnnotation,
    handleUpdateAnnotation,
    handleDeleteAnnotation,
    closeAddAnnotation,
  };
};
