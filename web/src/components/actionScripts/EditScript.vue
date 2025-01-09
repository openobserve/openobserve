<!-- Copyright 2023 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="add-functions-section tw-pl-4 tw-py-0 tw-pr-0 tw-h-full">
    <div class="add-function-actions tw-pb-2 tw-pt-1">
      <ScriptToolbar
        v-model:name="formData.name"
        ref="functionsToolbarRef"
        :disable-name="beingUpdated"
        @test="onTestFunction"
        @save="onSubmit"
        @back="closeAddFunction"
        @cancel="cancelAddFunction"
        class="tw-pr-4"
      />
      <q-separator />
    </div>
    <q-splitter
      v-model="splitterModel"
      class="tw-h-[calc(100%-55px)] tw-w-full"
      @input="updateEditorContent"
      unit="px"
    >
      <template #before>
        <div class="file-list tw-h-full tw-overflow-auto">
          <div
            class="tw-flex tw-justify-between tw-items-center tw-py-2 tw-pr-2"
          >
            <div>Files</div>
            <q-icon
              :name="outlinedNoteAdd"
              size="18px"
              class="tw-cursor-pointer"
              @click="addNewFile"
              title="Add new file"
            />
          </div>
          <ul class="tw-list-none tw-pr-2 tw-m-0">
            <template v-for="(file, index) in files" :key="index">
              <FileItem
                v-model:name="file.name"
                :isActive="file.id === editingFileId"
                @open-file="openFile(file)"
                :editMode="file.name === ''"
                @delete-file="cofirmDeleteFile(file)"
              />
            </template>
          </ul>
        </div>
      </template>

      <template #after>
        <div class="tw-h-full tw-overflow-auto tw-pr-2 tw-w-full tw-pl-2">
          <template v-for="file in editingFiles" :key="file.id">
            <ScriptEditor
              v-model:script="file.content"
              :file="file"
              ref="testFunctionRef"
              :vrlFunction="formData"
              @function-error="handleFunctionError"
            />
          </template>
        </div>
      </template>
    </q-splitter>
  </div>
  <confirm-dialog
    :title="confirmDialogMeta.title"
    :message="confirmDialogMeta.message"
    @update:ok="confirmDialogMeta.onConfirm()"
    @update:cancel="resetConfirmDialog"
    v-model="confirmDialogMeta.show"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted, onActivated } from "vue";

import jsTransformService from "../../services/jstransform";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import segment from "../../services/segment_analytics";
import TestFunction from "@/components/functions/TestFunction.vue";
import ScriptToolbar from "@/components/actionScripts/ScriptToolbar.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import ScriptEditor from "@/components/actionScripts/ScriptEditor.vue";
import JSZip from "jszip";
import { outlinedNoteAdd } from "@quasar/extras/material-icons-outlined";
import FileItem from "@/components/actionScripts/FileItem.vue";
import { getUUID } from "@/utils/zincutils";

const defaultValue: any = () => {
  return {
    name: "",
    function: "",
    params: "row",
    transType: "0",
  };
};

let callTransform: Promise<{ data: any }>;

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({
      name: "",
      function: "",
      params: "row",
      transType: "0",
    }),
  },
  isUpdated: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:list", "cancel:hideform"]);

const store: any = useStore();
const addJSTransformForm: any = ref(null);
const disableColor: any = ref("");
const formData: any = ref({
  name: "",
  function: "",
  params: "row",
  transType: "0",
});
const indexOptions = ref([]);
const { t } = useI18n();
const $q = useQuasar();
const editorRef: any = ref(null);
let editorobj: any = null;
const streams: any = ref({});
const isFetchingStreams = ref(false);
const testFunctionRef = ref<typeof TestFunction>();
const functionsToolbarRef = ref<typeof ScriptToolbar>();
const splitterModel = ref(200);
const confirmDialogMeta = ref({
  title: "",
  message: "",
  show: false,
  onConfirm: () => {},
  data: null,
});

const fileListRef = ref(null);

const expandState = ref({
  functions: true,
  functionError: false,
});

const vrlFunctionError = ref("");

let compilationErr = ref("");

const beingUpdated = computed(() => props.isUpdated);

const streamTypes = ["logs", "metrics", "traces"];

const router = useRouter();

const isFunctionDataChanged = ref(false);

const editingFileId = computed(() => {
  return editingFiles.value[0]?.id;
});

const files = ref([]);

const editingFiles = ref([]);

onMounted(() => {
  if (!files.value.length) addNewFile();
});

watch(
  () => formData.value.name + formData.value.function,
  () => {
    isFunctionDataChanged.value = true;
  },
);

onUnmounted(() => {
  window.removeEventListener("beforeunload", beforeUnloadHandler);
});

const beforeUnloadHandler = (e: any) => {
  if (isFunctionDataChanged.value) {
    const confirmMessage = t("dashboard.unsavedMessage");
    e.returnValue = confirmMessage;
    return confirmMessage;
  }
  return;
};

let forceSkipBeforeUnloadListener = false;

onBeforeRouteLeave((to, from, next) => {
  if (forceSkipBeforeUnloadListener) {
    next();
    return;
  }
  const actions = ["add", "update"];

  if (
    from.path === "/pipeline/functions" &&
    actions.includes((from.query?.action as string) || "none") &&
    isFunctionDataChanged.value
  ) {
    const confirmMessage = t("pipeline.unsavedMessage");
    if (window.confirm(confirmMessage)) {
      next();
    } else {
      next(false);
    }
  } else {
    next();
  }
});

const editorUpdate = (e: any) => {
  formData.value.function = e.target.value;
};
const prefixCode = ref("");
const suffixCode = ref("");

const isValidParam = () => {
  const methodPattern = /^[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*$/g;
  return methodPattern.test(formData.value.params) || "Invalid params.";
};

const isValidMethodName = () => {
  const methodPattern = /^[$A-Z_][0-9A-Z_$]*$/i;
  return methodPattern.test(formData.value.name) || "Invalid Function name.";
};
const updateEditorContent = () => {
  if (formData.value.transType == "1") {
    prefixCode.value = `function(row)`;
    suffixCode.value = `
  end`;
  } else {
    prefixCode.value = ``;
    suffixCode.value = ``;
  }

  formData.value.function = `${prefixCode.value}
  ${formData.value.function}
  ${suffixCode.value}`;
};

const openFile = (file: any) => {
  editingFiles.value = [];
  editingFiles.value.push(file);
};

const isValidFnName = () => {
  return formData.value.name.trim().length > 0;
};

const fetchAndUnzipFiles = async () => {
  try {
    const zip = new JSZip();

    const zipFiles = await zip.loadAsync(response.data);
    const fetchedFiles = [];
    zipFiles.forEach(async (relativePath, file) => {
      const content = await file.async("string");
      fetchedFiles.push({ name: relativePath, content });
    });
    files.value = fetchedFiles;
  } catch (error) {
    console.error("Error fetching or unzipping files:", error);
  }
};

const saveChanges = async () => {
  try {
    const zip = new JSZip();
    files.value.forEach((file) => {
      zip.file(file.name, file.content);
    });
    const content = await zip.generateAsync({ type: "blob" });
    const formData = new FormData();
    formData.append("file", content, "scripts.zip");
  } catch (error) {
    console.error("Error saving changes:", error);
  }
};

const onSubmit = () => {
  if (!functionsToolbarRef.value) return;

  functionsToolbarRef.value.addFunctionForm.validate().then((valid: any) => {
    if (!valid) {
      return false;
    }

    const loadingNotification = $q.notify({
      spinner: true,
      message: "Please wait...",
      timeout: 0,
    });

    try {
      if (!beingUpdated.value) {
        formData.value.transType = parseInt(formData.value.transType);
        if (formData.value.transType == 1) {
          formData.value.params = "";
        }

        callTransform = jsTransformService.create(
          store.state.selectedOrganization.identifier,
          formData.value,
        );
      } else {
        formData.value.transType = parseInt(formData.value.transType);
        if (formData.value.transType == 1) {
          formData.value.params = "";
        }

        callTransform = jsTransformService.update(
          store.state.selectedOrganization.identifier,
          formData.value,
        );
      }

      forceSkipBeforeUnloadListener = true;

      callTransform
        .then((res: { data: any }) => {
          const data = res.data;
          const _formData: any = { ...formData.value };
          formData.value = { ...defaultValue() };

          emit("update:list", _formData);
          addJSTransformForm?.value?.resetValidation();

          loadingNotification();
          $q.notify({
            type: "positive",
            message: res.data.message || "Function saved successfully",
          });
        })
        .catch((err) => {
          compilationErr.value = err?.response?.data["message"];
          $q.notify({
            type: "negative",
            message: err.response?.data?.message ?? "Function creation failed",
          });
          loadingNotification();
        });
    } catch (error) {
      console.error("Error while saving function:", error);
      loadingNotification();
    }

    segment.track("Button Click", {
      button: "Save Function",
      user_org: store.state.selectedOrganization.identifier,
      user_id: store.state.userInfo.email,
      function_name: formData.value.name,
      page: "Add/Update Function",
    });
  });
};

const onTestFunction = () => {
  if (testFunctionRef.value) testFunctionRef.value.testFunction();
};

const handleFunctionError = (err: string) => {
  vrlFunctionError.value = err;
};

const closeAddFunction = () => {
  if (isFunctionDataChanged.value) {
    confirmDialogMeta.value.show = true;
    confirmDialogMeta.value.title = t("common.unsavedTitle");
    confirmDialogMeta.value.message = t("common.unsavedMessage");
    confirmDialogMeta.value.onConfirm = () => {
      emit("cancel:hideform");
      resetConfirmDialog();
    };
  } else {
    emit("cancel:hideform");
  }
};

const cancelAddFunction = () => {
  if (isFunctionDataChanged.value) {
    confirmDialogMeta.value.show = true;
    confirmDialogMeta.value.title = t("common.cancelTitle");
    confirmDialogMeta.value.message = t("common.cancelMessage");
    confirmDialogMeta.value.onConfirm = () => {
      emit("cancel:hideform");
      resetConfirmDialog();
    };
  } else {
    emit("cancel:hideform");
  }
};

const resetConfirmDialog = () => {
  confirmDialogMeta.value.show = false;
  confirmDialogMeta.value.title = "";
  confirmDialogMeta.value.message = "";
  confirmDialogMeta.value.onConfirm = () => {};
  confirmDialogMeta.value.data = null;
};

const addNewFile = () => {
  console.log("adding new file");
  files.value.push({
    name: "",
    content: "",
    language: "python",
    id: getUUID(),
  });
  openFile(files.value[files.value.length - 1]);
};

const validateFileName = (file, index) => {
  if (file.name.trim() === "") {
    $q.notify({
      type: "negative",
      message: "File name cannot be empty.",
    });
    files.value[index].name = "new.py";
  }
};

const cofirmDeleteFile = (file: any) => {
  confirmDialogMeta.value.show = true;
  confirmDialogMeta.value.title = t("actions.deleteTitle") + " " + file.name;
  confirmDialogMeta.value.message = t("actions.deleteText");
  confirmDialogMeta.value.data = file;
  confirmDialogMeta.value.onConfirm = () => {
    deleteFile();
    resetConfirmDialog();
  };
};

const deleteFile = () => {
  const index = files.value.findIndex(
    (f) => f.name === confirmDialogMeta.value.data.name,
  );
  files.value.splice(index, 1);
  openFile(files.value[0]);
};

const getFileExtension = (fileName: string) => {
  return fileName.split(".").pop();
};

const extensionToLanguageMap = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  java: "java",
  cpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  html: "html",
  css: "css",
  json: "json",
  xml: "xml",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  rs: "rust",
  go: "go",
  swift: "swift",
};

const getLanguageFromExtension = (fileName: string) => {
  const extension = getFileExtension(fileName);
  return extensionToLanguageMap[extension] || "plaintext";
};
</script>

<style scoped lang="scss">
.monaco-editor {
  width: 100%;
  height: calc(100vh - 160px);
  border-radius: 5px;
}

.add-function-name-input {
  :deep(.q-field--dense .q-field__control) {
    height: 36px;
    min-height: auto;
    border-radius: 3px;

    .q-field__control-container {
      height: 32px;

      .q-field__native {
        height: 32px !important;
      }
    }

    .q-field__marginal {
      height: 32px;
      min-height: auto;
    }
  }

  :deep(.q-field__bottom) {
    padding-top: 4px !important;
    min-height: auto;
  }
}

.function-stream-select-input {
  :deep(.q-field--auto-height .q-field__control) {
    height: 32px;
    min-height: auto;

    .q-field__control-container {
      height: 32px;

      .q-field__native {
        min-height: 32px !important;
        height: 32px !important;
      }
    }

    .q-field__marginal {
      height: 32px;
      min-height: auto;
    }
  }
}

.functions-duration-input {
  :deep(.date-time-button) {
    width: 100%;
  }
}
</style>
<style>
.no-case .q-field__native span {
  text-transform: none !important;
}
</style>
