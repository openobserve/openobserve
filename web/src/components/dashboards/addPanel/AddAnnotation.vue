<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <ODialog
    data-test="add-annotation-dialog"
    v-model:open="isOpen"
    persistent
    size="lg"
    :title="isEditMode ? t('dashboard.addAnnotation.editAnnotation') : t('dashboard.addAnnotation.addAnnotation')"
    form-id="add-annotation-form"
    :primary-button-label="annotationData.annotation_id ? t('dashboard.addAnnotation.update') : t('dashboard.addAnnotation.save')"
    :secondary-button-label="t('dashboard.addAnnotation.cancel')"
    :neutral-button-label="annotationData.annotation_id ? t('dashboard.addAnnotation.delete') : undefined"
    neutral-button-variant="destructive"
    @click:secondary="handleClose"
    @click:neutral="handleDeleteWithConfirm"
  >
    <OForm id="add-annotation-form" :schema="addAnnotationSchema" :default-values="addAnnotationDefaults" @submit="saveAnnotation">
    <div class="flex flex-col">
        <OFormInput
          name="title"
          :label="t('dashboard.addAnnotation.titleLabel')"
          required
          data-test="dashboard-add-annotation-title-input"
        />
        <OFormTextarea
          name="text"
          :label="t('dashboard.addAnnotation.description')"
          :rows="3"
          data-test="dashboard-add-annotation-text-input"
        />

        <OFormSelect
            name="panels"
            :hint="t('dashboard.addAnnotation.panelsHint')"
            :options="groupedPanelsOptions"
            multiple
            :label="t('dashboard.addAnnotation.selectPanels')"
            class="textbox flex flex-col no-case showLabelOnTop min-w-37.5"
            data-test="dashboard-add-annotation-panels-select"
        />
        <div class="text-xs mt-3">
          {{ t('dashboard.addAnnotation.timestamp') }} {{ annotationDateString }}
        </div>
    </div>
    </OForm>

    <ODialog data-test="add-annotation-delete-confirm-dialog"
      v-model:open="showDeleteConfirm"
      size="xs"
      :title="t('dashboard.addAnnotation.confirmDelete')"
      :secondary-button-label="t('dashboard.addAnnotation.cancel')"
      :primary-button-label="t('dashboard.addAnnotation.delete')"
      primary-button-variant="destructive"
      :primary-button-loading="deleteAnnotation.isLoading.value"
      @click:secondary="showDeleteConfirm = false"
      @click:primary="deleteAnnotation.execute()"
    >
      <p>{{ t('dashboard.addAnnotation.deleteConfirmMessage') }}</p>
    </ODialog>
  </ODialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { PropType } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
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
import type { AddAnnotationForm } from "./AddAnnotation.schema";

interface AnnotationData {
  annotation_id: string | null;
  title: string;
  text: string;
  start_time: number | null;
  end_time: number | null;
  tags: string[];
  panels: string[];
}

interface AnnotationPanel {
  id: string;
  title: string;
  tabName?: string;
}

const props = defineProps({
  dashboardId: { type: String, required: true },
  annotation: {
    type: Object as PropType<AnnotationData | null>,
    default: null,
    required: false,
  },
  panelsList: {
    type: Array as PropType<AnnotationPanel[]>,
    default: () => [],
    required: true,
  },
});

const emit = defineEmits<{
  (e: "remove"): void;
  (e: "close"): void;
}>();

const store = useStore();
const { t } = useI18n();
const isOpen = ref(true);
const showDeleteConfirm = ref(false);

const annotationData = ref<AnnotationData>(
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

const groupedPanels = ref<Record<string, AnnotationPanel[]>>({});

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
  groupedPanels.value = props.panelsList.reduce(
    (acc: Record<string, AnnotationPanel[]>, panel) => {
      const tabName = panel.tabName || t('dashboard.addAnnotation.unknownTab');
      if (!acc[tabName]) acc[tabName] = [];
      acc[tabName].push({ id: panel.id, title: panel.title });
      return acc;
    },
    {},
  );
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

// Caught errors are `unknown`; read `.message` when the error is object-like.
const errorMessage = (error: unknown): string | undefined => {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message?: unknown };
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
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
        const annotationId = annotationData.value.annotation_id ?? "";
        const response = await annotationService.update_timed_annotations(
          organization,
          props.dashboardId,
          annotationId,
          annotationToUpdate,
        );
      } catch (error) {
        showErrorNotification(
          errorMessage(error) ?? t('dashboard.addAnnotation.failedUpdateAnnotation', { error: errorMessage(error) }),
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
          errorMessage(error) ?? t('dashboard.addAnnotation.failedCreateAnnotation', { error: errorMessage(error) }),
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
  // Delete is reachable only for a persisted annotation, so `annotation_id` is a string.
  const annotationId = annotationData.value.annotation_id ?? "";
  await annotationService.delete_timed_annotations(
    organization,
    props.dashboardId,
    [annotationId],
  );

  handleClose();
};

// The @submit payload is the source of truth for the form fields
// (title/text/panels); annotationData carries the rest (tags/times/id). We seed
// those three back onto annotationData so handleSave (and the edit-update path)
// reads consistent values. Plain async — OForm awaits it, and the ODialog
// built-in primary button (form-id) auto-shows the Save spinner (no useLoading).
const saveAnnotation = async (value: AddAnnotationForm) => {
  if (value?.title != null) annotationData.value.title = value.title;
  annotationData.value.text = value?.text ?? "";
  annotationData.value.panels = value?.panels ?? [];
  await handleSave();
};
const deleteAnnotation = useLoading(confirmDelete);
</script>
