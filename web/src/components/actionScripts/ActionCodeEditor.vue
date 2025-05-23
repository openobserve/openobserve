<!-- Copyright 2023 OpenObserve Inc. -->

<template>
  <q-dialog
    v-model="showDialog"
    persistent
    maximized
    transition-show="slide-up"
    transition-hide="slide-down"
    data-test="action-code-editor-dialog"
  >
    <div
      class="column full-height !tw-w-[calc(100vw-60px)] tw-bg-white tw-ml-auto"
    >
      <!-- Header -->
      <div class="row items-center q-px-sm tw-py-1">
        <div class="flex items-center">
          <q-icon name="code" size="20px" class="tw-mr-1" />
          <div class="tw-text-[16px]">Code Editor</div>
        </div>
        <q-space />
        <q-btn
          flat
          round
          dense
          size="10px"
          icon="fullscreen"
          @click="toggleFullscreen"
          class="q-mr-sm cursor-pointer"
        />
        <q-btn
          flat
          round
          dense
          size="10px"
          icon="close"
          @click="closeDialog"
          class="q-mr-sm cursor-pointer"
        />
      </div>

      <!-- Content -->
      <div class="col q-pa-none tw-relative">
        <!-- Editor -->
        <div class="col column tw-relative tw-px-2">
          <iframe
            id="vscode-iframe"
            :src="`${store.state.API_ENDPOINT}/web/vscode?origin=${encodeURIComponent(store.state.API_ENDPOINT + '?id=' + actionId + '&name=' + formData.name)}`"
            sandbox="allow-scripts allow-same-origin"
            style="width: 100%; height: max(600px, calc(100vh - 42px))"
          />
        </div>
      </div>
    </div>
  </q-dialog>
</template>

<script setup>
import { ref, defineProps, defineEmits, watch } from "vue";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  uploadedFile: {
    type: Object,
    default: () => null,
  },
  actionId: {
    type: String,
    default: "",
  },
  formData: {
    type: Object,
    default: () => null,
  },
});

const emit = defineEmits(["update:modelValue", "save", "close"]);
const $q = useQuasar();

const showDialog = ref(props.modelValue);
const selectedTab = ref("main.py");
const fileInput = ref(null);
const uploadedFileName = ref("Test_1.zip");
const isFullscreen = ref(false);
const store = useStore();
const splitterModel = ref(20);
const { t } = useI18n();

const showSidebar = ref(true);

const previousUsedFiles = ref([
  {
    name: "Test_1.zip",
    usedAt: "2023-01-01 12:00:00",
  },
  {
    name: "Test_2.zip",
    usedAt: "2023-01-02 12:00:00",
  },
]);

watch(
  () => props.modelValue,
  (newVal) => {
    showDialog.value = newVal;

    // If file is provided, update the file name
    if (props.uploadedFile && props.uploadedFile.name) {
      uploadedFileName.value = props.uploadedFile.name;
    }
  },
);

const closeDialog = () => {
  showDialog.value = false;
  emit("close");
  emit("update:modelValue", false);
};

const toggleFullscreen = () => {
  isFullscreen.value = !isFullscreen.value;
  if (isFullscreen.value) {
    document.documentElement.requestFullscreen();
  } else {
    document.exitFullscreen();
  }
};

const triggerFileUpload = () => {
  fileInput.value.click();
};

const handleFileChange = (event) => {
  const file = event.target.files[0];
  if (file && file.name.endsWith(".zip")) {
    uploadedFileName.value = file.name;
  }
};

const selectFile = (file) => {
  selectedTab.value = file;
};

const saveCode = () => {
  // Here you would process the code and emit the result
  emit("save", {
    code: "# Code content here",
    fileName: uploadedFileName.value,
  });
  closeDialog();
};

const toggleSidebar = () => {
  showSidebar.value = !showSidebar.value;
  splitterModel.value = showSidebar.value ? 20 : 0;
};
</script>

<style scoped>
.hidden-input {
  display: none;
}

.sidebar-wrapper {
  height: 100%;
  width: 240px;
  display: flex;
  flex-direction: column;
}

.explorer-tree {
  flex-grow: 0;
}

.outline-section {
  flex-grow: 1;
}

.code-editor-wrapper {
  display: flex;
  position: relative;
  background-color: #1e1e1e;
}

.editor-tabs-wrapper {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}

.code-editor-container {
  display: flex;
  overflow: auto;
  padding: 8px 0;
}

.line-numbers {
  display: flex;
  flex-direction: column;
  padding: 0 8px;
  margin-right: 8px;
  text-align: right;
  color: #858585;
  user-select: none;
}

.line-number {
  font-size: 14px;
  font-family: "Consolas", "Monaco", "Courier New", monospace;
  line-height: 1.5;
}

.code-editor {
  color: #d4d4d4;
  font-family: "Consolas", "Monaco", "Courier New", monospace;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre;
  tab-size: 4;
  flex-grow: 1;
  padding: 0;
  margin: 0;
}

.editor-status-bar {
  display: flex;
  align-items: center;
  height: 25px;
  background-color: #007acc;
  color: white;
  font-size: 12px;
}

.border-right {
  border-right: 1px solid rgba(0, 0, 0, 0.12);
}

.dark-theme .border-right {
  border-right: 1px solid rgba(255, 255, 255, 0.12);
}

:deep(.q-expansion-item--standard .q-item) {
  padding: 4px 8px;
  min-height: 32px;
}
</style>
