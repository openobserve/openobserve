<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <ODialog
    data-test="add-annotation-dialog"
    v-model:open="isOpen"
    persistent
    size="lg"
    :title="isEditMode ? 'Edit Annotation' : 'Add Annotation'"
    form-id="add-annotation-form"
    :primary-button-label="annotationData.annotation_id ? 'Update' : 'Save'"
    secondary-button-label="Cancel"
    :neutral-button-label="annotationData.annotation_id ? 'Delete' : undefined"
    neutral-button-variant="destructive"
    @click:secondary="handleClose"
    @click:neutral="handleDeleteWithConfirm"
  >
    <OForm id="add-annotation-form" :schema="addAnnotationSchema" :default-values="addAnnotationDefaults" @submit="saveAnnotation">
    <div class="tw:flex tw:flex-col">
        <OFormInput
          name="title"
          label="Title"
          required
          data-test="dashboard-add-annotation-title-input"
        />
        <OFormTextarea
          name="text"
          label="Description"
          :rows="3"
          data-test="dashboard-add-annotation-text-input"
        />

        <OFormSelect
            name="panels"
            hint="If no panel is selected, annotations will be applied to all the panels of the dashboard."
            :options="groupedPanelsOptions"
            multiple
            style="min-width: 150px"
            label="Select Panels"
            class="textbox tw:flex tw:flex-col no-case showLabelOnTop"
            data-test="dashboard-add-annotation-panels-select"
          />
        <div class="tw:text-xs tw:mt-3">
          Timestamp: {{ annotationDateString }}
        </div>
    </div>
    </OForm>

    <ODialog data-test="add-annotation-delete-confirm-dialog"
      v-model:open="showDeleteConfirm"
      size="xs"
      title="Confirm Delete"
      secondary-button-label="Cancel"
      primary-button-label="Delete"
      primary-button-variant="destructive"
      :primary-button-loading="deleteAnnotation.isLoading.value"
      @click:secondary="showDeleteConfirm = false"
      @click:primary="deleteAnnotation.execute()"
    >
      <p>Are you sure you want to delete this annotation?</p>
    </ODialog>
  </ODialog>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useLoading } from "@/composables/useLoading";
import { annotationService } from "@/services/dashboard_annotations";
import useNotifications from "@/composables/useNotifications";
import ODialog from '@/lib/overlay/Dialog/ODialog.vue';
import OInput from "@/lib/forms/Input/OInput.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { addAnnotationSchema } from "./AddAnnotation.schema";
const props = defineProps({
  dashboardId: { type: String, required: true },
  annotation: { type: Object, default: null, required: false },
  panelsList: { type: Array, default: () => [], required: true },
});

const emit = defineEmits(["remove", "close"]);

const store = useStore();
const isOpen = ref(true);
const showDeleteConfirm = ref(false);

const annotationData = ref(
  props.annotation || {
    annotation_id: null,
    title: "",
    text: "",
    start_time: null,
    end_time: null,
    tags: [],
    panels: [],
  },
);

// Dynamic: in edit mode `annotationData` is seeded from `props.annotation`, so
// the form's defaults are prefilled from runtime data (not always blank). The
// form owns title/text/panels — project all three from the prefilled model.
const addAnnotationDefaults = computed(() => ({
  title: annotationData.value.title,
  text: annotationData.value.text ?? "",
  panels: annotationData.value.panels ?? [],
}));

const groupedPanels = ref({});

const groupedPanelsOptions = computed(() =>
  Object.entries(groupedPanels.value).flatMap(([tab, panels]) => [
    { label: tab, isTab: true, disable: true },
    ...panels.map((panel) => ({
      label: panel.title,
      value: panel.id,
      isTab: false,
    })),
  ]),
);

const groupPanels = () => {
  groupedPanels.value = props.panelsList.reduce((acc, panel) => {
    const tabName = panel.tabName || "Unknown Tab";
    if (!acc[tabName]) acc[tabName] = [];
    acc[tabName].push({ id: panel.id, title: panel.title });
    return acc;
  }, {});
};

watch(
  () => props.panelsList,
  () => {
    groupPanels();
  },
  { immediate: true },
);

const isEditMode = computed(() => !!annotationData?.value?.annotation_id);

const annotationDateString = computed(() => {
  let timestampString = "";

  const start = annotationData?.value?.start_time;
  const end = annotationData?.value?.end_time;

  if (start) {
    const startDate = new Date(start / 1000);
    timestampString += startDate.toLocaleString("sv-SE").replace("T", " ");
  }

  if (end) {
    const endDate = new Date(end / 1000);
    timestampString +=
      " - " + endDate.toLocaleString("sv-SE").replace("T", " ");
  }

  return timestampString;
});

const handleClose = () => {
  isOpen.value = false;
  emit("close");
};

const organization = store.state.selectedOrganization.identifier;
const { showErrorNotification } = useNotifications();
const handleSave = async () => {
  if (annotationData?.value?.title?.trim()) {
    if (isEditMode.value) {
      try {
        const annotationToUpdate = {
          start_time: annotationData.value.start_time,
          end_time: annotationData.value.end_time,
          title: annotationData.value.title,
          text: annotationData.value.text,
          panels: annotationData.value.panels,
          tags: annotationData.value.tags,
        };
        const response = await annotationService.update_timed_annotations(
          organization,
          props.dashboardId,
          annotationData.value.annotation_id,
          annotationToUpdate,
        );
      } catch (error) {
        showErrorNotification(
          error?.message ?? "Failed to update annotation: " + error.message,
        );
        return;
      }
    } else {
      try {
        // create annotation
        const response = await annotationService.create_timed_annotations(
          organization,
          props.dashboardId,
          [annotationData.value],
        );
      } catch (error) {
        showErrorNotification(
          error?.message ?? "Failed to create annotation: " + error.message,
        );
        return;
      }
    }

    handleClose();
  }
};

const handleDeleteWithConfirm = () => {
  showDeleteConfirm.value = true;
};

const confirmDelete = async () => {
  await annotationService.delete_timed_annotations(
    organization,
    props.dashboardId,
    [annotationData.value.annotation_id],
  );

  handleClose();
};

// The @submit payload is the source of truth for the form fields
// (title/text/panels); annotationData carries the rest (tags/times/id). We seed
// those three back onto annotationData so handleSave (and the edit-update path)
// reads consistent values. Plain async — OForm awaits it, and the ODialog
// built-in primary button (form-id) auto-shows the Save spinner (no useLoading).
const saveAnnotation = async (value) => {
  if (value?.title != null) annotationData.value.title = value.title;
  annotationData.value.text = value?.text ?? "";
  annotationData.value.panels = value?.panels ?? [];
  await handleSave();
};
const deleteAnnotation = useLoading(confirmDelete);
</script>
