<template>
  <q-dialog v-model="isOpen" persistent>
    <q-card style="min-width: 700px">
      <q-card-section class="q-pa-md">
        <div class="text-h6">{{ isEditMode ? "Edit" : "Add" }} Annotation</div>
      </q-card-section>
      <q-card-section class="q-pa-md">
        <q-input
          v-model="annotationData.title"
          label="Title *"
          stack-label
          class="q-py-md showLabelOnTop"
          dense
          borderless
          hide-bottom-space
          style="margin-bottom: 10px"
          :rules="[(val) => !!val || 'Title is required.']"
        />
        <q-input
          v-model="annotationData.text"
          label="Description"
          stack-label
          class="q-py-md showLabelOnTop"
          dense
          type="textarea"
          :rows="3"
          borderless
          hide-bottom-space
        />

        <div class="q-mt-md">
          <q-select
            hint="If no panel is selected, annotations will be applied to all the panels of the dashboard."
            v-model="selectedPanels"
            :options="groupedPanelsOptions"
            multiple
            stack-label
            emit-value
            map-options
            @update:model-value="updateSelectedPanels"
            :display-value="displayValue"
            style="min-width: 150px"
            dense
            label="Select Panels"
            input-debounce="0"
            behavior="menu"
            use-input
            class="textbox col no-case showLabelOnTop"
            popup-no-route-dismiss
            popup-content-style="z-index: 10001"
            borderless
            hide-bottom-space
          >
            <template v-slot:option="{ opt, selected, toggleOption }">
              <q-item
                v-if="opt.isTab"
                class="bg-grey-3 text-bold text-dark"
                style="pointer-events: none"
              >
                <q-item-section>{{ opt.label }}</q-item-section>
              </q-item>

              <q-item v-else v-ripple clickable @click="toggleOption(opt)">
                <q-item-section side>
                  <q-checkbox
                    :model-value="selected"
                    @update:model-value="() => toggleOption(opt)"
                    dense
                    class="q-ma-none"
                  />
                </q-item-section>
                <q-item-section>
                  <q-item-label>{{ opt.label }}</q-item-label>
                </q-item-section>
              </q-item>
            </template>
          </q-select>
        </div>
        <div class="text-caption q-mt-md">
          Timestamp: {{ annotationDateString }}
        </div>
      </q-card-section>
      <q-card-actions align="right">
        <div class="tw:w-full tw:flex">
          <q-btn
            v-if="annotationData.annotation_id"
            color="negative"
            label="Delete"
            @click="handleDeleteWithConfirm"
          />
          <div class="tw:flex-1"></div>
          <q-btn
            flat
            label="Cancel"
            @click="handleClose"
            class="o2-secondary-button tw:h-[36px] q-ml-md"
            :class="
              store.state.theme === 'dark'
                ? 'o2-secondary-button-dark'
                : 'o2-secondary-button-light'
            "
          />
          <q-btn
            class="o2-primary-button tw:h-[36px] q-ml-md"
            :class="
              store.state.theme === 'dark'
                ? 'o2-primary-button-dark'
                : 'o2-primary-button-light'
            "
            :label="annotationData.annotation_id ? 'Update' : 'Save'"
            @click="saveAnnotation.execute()"
            :loading="saveAnnotation.isLoading?.value"
            :disable="!annotationData.title"
          />
        </div>
      </q-card-actions>
    </q-card>

    <q-dialog v-model="showDeleteConfirm">
      <q-card>
        <q-card-section>
          <div class="text-h6">Confirm Delete</div>
        </q-card-section>
        <q-card-section>
          Are you sure you want to delete this annotation?
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn
            color="negative"
            label="Delete"
            :loading="deleteAnnotation.isLoading.value"
            @click="deleteAnnotation.execute()"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-dialog>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { useStore } from "vuex";
import { useLoading } from "@/composables/useLoading";
import { annotationService } from "@/services/dashboard_annotations";
import useNotifications from "@/composables/useNotifications";

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

const groupedPanels = ref({});
const selectedPanels = ref([]);

const groupedPanelsOptions = computed(() =>
  Object.entries(groupedPanels.value).flatMap(([tab, panels]) => [
    { label: tab, isTab: true },
    ...panels.map((panel) => ({
      label: panel.title,
      value: panel.id,
      isTab: false,
    })),
  ]),
);

const displayValue = computed(() => {
  if (!selectedPanels.value.length) {
    return "All Panels";
  }
  const selectedTitles = selectedPanels.value.map((panelId) => {
    const panel = props.panelsList.find((p) => p.id === panelId);
    return panel?.title || "Unknown";
  });

  if (selectedTitles.length > 2) {
    return `${selectedTitles.slice(0, 2).join(", ")}... + ${
      selectedTitles.length - 2
    } more`;
  }
  return selectedTitles.join(", ");
});

const groupPanels = () => {
  groupedPanels.value = props.panelsList.reduce((acc, panel) => {
    const tabName = panel.tabName || "Unknown Tab";
    if (!acc[tabName]) acc[tabName] = [];
    acc[tabName].push({ id: panel.id, title: panel.title });
    return acc;
  }, {});
};

const updateSelectedPanels = () => {
  annotationData.value.panels = selectedPanels.value;
};

const restorePreviousSelections = () => {
  if (annotationData.value.panels && annotationData.value.panels.length) {
    selectedPanels.value = annotationData.value.panels;
  }
};

watch(
  () => props.panelsList,
  () => {
    groupPanels();
    if (props.annotation) restorePreviousSelections();
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

const saveAnnotation = useLoading(handleSave);
const deleteAnnotation = useLoading(confirmDelete);
</script>
