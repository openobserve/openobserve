<template>
  <q-dialog v-model="isOpen" persistent>
    <q-card style="min-width: 500px">
      <q-card-section class="q-pa-md">
        <div class="text-h6">{{ isEditMode ? "Edit" : "Add" }} Annotation</div>
      </q-card-section>
      <q-card-section class="q-pa-md">
        <q-input
          v-model="annotationData.title"
          label="Title"
          dense
          outlined
          clearable
          style="margin-bottom: 16px"
          :rules="[(val) => !!val || 'Field is required!']"
        />
        <q-input
          v-model="annotationData.text"
          label="Description"
          dense
          outlined
          clearable
          type="textarea"
          :rows="3"
        />
        <div class="text-caption q-mt-sm">
          Timestamp: {{ annotationDateString }}
        </div>
      </q-card-section>
      <q-card-actions align="right">
        <div class="tw-w-full tw-flex">
          <q-btn
            v-if="annotationData.annotation_id"
            color="negative"
            label="Delete"
            @click="handleDeleteWithConfirm"
          />
          <div class="tw-flex-1"></div>
          <q-btn flat label="Cancel" @click="handleClose" />
          <q-btn
            color="primary"
            :label="annotationData.id ? 'Update' : 'Save'"
            @click="saveAnnotation.execute()"
            :loading="saveAnnotation.isLoading?.value"
            :disable="!annotationData.title"
          />
        </div>
      </q-card-actions>
    </q-card>
  </q-dialog>

  <q-dialog v-model="showDeleteConfirm">
    <q-card>
      <q-card-section>
        <div class="text-h6">Confirm Delete</div>
      </q-card-section>
      <q-card-section>
        Are you sure you want to delete this annotation?
      </q-card-section>
      <q-card-actions align="right">
        <q-btn
          flat
          label="Cancel"
          v-close-popup
          :loading="deleteAnnotation.isLoading.value"
        />
        <q-btn
          color="negative"
          label="Delete"
          :loading="deleteAnnotation.isLoading.value"
          @click="deleteAnnotation.execute()"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { useLoading } from "@/composables/useLoading";
import { annotationService } from "@/services/dashboard_annotations";
import { ref, computed, watch } from "vue";
import { useStore } from "vuex";

const props = defineProps({
  dashboardId: {
    type: String,
    required: true,
  },
  annotation: {
    type: Object,
    default: null,
    required: false,
  },
});

const emit = defineEmits(["save", "remove", "close", "update"]);

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

watch(
  () => props.annotation,
  (newVal) => {
    if (newVal) {
      annotationData.value = newVal;
    }
  },
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

const handleSave = async () => {
  if (annotationData?.value?.title?.trim()) {
    if (isEditMode.value) {
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
    } else {
      // create annotation
      const response = await annotationService.create_timed_annotations(
        organization,
        props.dashboardId,
        [annotationData.value],
      );
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
