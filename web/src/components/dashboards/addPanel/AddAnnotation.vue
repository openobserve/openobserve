<template>
  <q-dialog v-model="isOpen" persistent>
    <q-card style="min-width: 500px">
      <q-card-section class="q-pa-md">
        <div class="text-h6">
          {{ annotationData.id ? "Edit" : "Add" }} Annotation
        </div>
      </q-card-section>
      <q-card-section class="q-pa-md">
        <q-input
          v-model="annotationData.name"
          label="Title"
          dense
          outlined
          clearable
          style="margin-bottom: 16px"
          :rules="[(val) => !!val || 'Field is required!']"
        />
        <q-input
          v-model="annotationData.description"
          label="Description"
          dense
          outlined
          clearable
          type="textarea"
          :rows="3"
        />
        <div class="text-caption q-mt-sm">Timestamp: {{ dateString }}</div>
        <div
          v-if="duplicateAnnotations.length > 0"
          class="text-caption text-warning q-mt-sm"
        >
          Note: There are existing annotations at this timestamp
        </div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" @click="handleClose" />
        <q-btn
          v-if="annotationData.id"
          color="negative"
          label="Delete"
          @click="handleDeleteWithConfirm"
        />
        <q-btn
          color="primary"
          :label="annotationData.id ? 'Update' : 'Save'"
          @click="handleSave"
          :loading="saving"
          :disable="saving || !annotationData.name"
        />
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
        <q-btn flat label="Cancel" v-close-popup />
        <q-btn color="negative" label="Delete" @click="confirmDelete" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, onMounted, computed, watch } from "vue";

const props = defineProps({
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: false,
  },
  dateString: {
    type: String,
    required: false,
  },
  existingAnnotation: {
    type: String,
    default: null,
  },
});
console.log("props", props.existingAnnotation);

const emit = defineEmits(["save", "remove", "close", "update"]);

const isOpen = ref(true);
const saving = ref(false);
const showDeleteConfirm = ref(false);

const annotationData = ref({
  id: null,
  name: "",
  description: "",
  type: "xAxis",
  value: props.startTime,
});

watch(
  () => props.existingAnnotation,
  (newVal) => {
    if (newVal) {
      annotationData.value = {
        ...annotationData.value,
        id: newVal.id,
        name: newVal.name,
        description: newVal.description,
        value: newVal.value,
      };
    }
  },
  { immediate: true },
);

const duplicateAnnotations = computed(() => []);

const handleClose = () => {
  isOpen.value = false;
  emit("close");
};

const handleSave = async () => {
  if (annotationData?.value?.name?.trim()) {
    saving.value = true;
    try {
      if (annotationData.value.id) {
        emit("update", {
          ...annotationData.value,
          endTime: props.endTime,
        });
      } else {
        emit("save", {
          ...annotationData.value,
          endTime: props.endTime,
        });
      }
    } finally {
      saving.value = false;
    }
  }
};

const handleDeleteWithConfirm = () => {
  showDeleteConfirm.value = true;
};

const confirmDelete = () => {
  emit("remove", annotationData.value.id);
  showDeleteConfirm.value = false;
  handleClose();
};
</script>
