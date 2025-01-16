<template>
  <q-dialog v-model="isOpen" persistent>
    <q-card style="min-width: 500px">
      <q-card-section class="q-pa-md">
        <div class="text-h6">Add Annotation</div>
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
        <div class="text-caption q-mt-sm">
          Timestamp: {{ dateString }}
        </div>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancel" @click="handleClose" />
        <q-btn
          v-if="annotationData.id"
          color="negative"
          label="Delete"
          @click="handleDelete"
        />
        <q-btn
          color="primary"
          label="Save"
          @click="handleSave"
          :loading="saving"
          :disable="saving || !annotationData.name"
        />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref } from "vue";

const props = defineProps({
  startTime: {
    type: [String, Number],
    required: true,
  },
  endTime: {
    type: [String, Number],
    required: false,
  },
  dateString: {
    type: String,
    required: false,
  }
});

const emit = defineEmits(["save", "remove", "close"]);

const isOpen = ref(true);
const saving = ref(false);

const annotationData = ref({
  name: "",
  description: "",
  type: "xAxis",
  value: props.startTime,
});

const handleClose = () => {
  isOpen.value = false;
  emit("close");
};

const handleSave = async () => {
  if (annotationData?.value?.name?.trim()) {
    saving.value = true;
    try {
      emit("save", annotationData.value);
    } finally {
      saving.value = false;
    }
  }
};

const handleDelete = () => {
  emit("remove", annotationData.value.id);
  handleClose();
};
</script>
