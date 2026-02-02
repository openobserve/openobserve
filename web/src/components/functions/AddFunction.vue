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
  <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
    <div class="card-container tw:mb-[0.8rem]">
      <div class="tw:flex tw:items-center tw:justify-between tw:py-3 tw:pl-4 tw:pr-2 tw:h-[68px]">
          <FunctionsToolbar
            v-model:name="formData.name"
            v-model:trans-type="formData.transType"
            ref="functionsToolbarRef"
            :disable-name="beingUpdated"
            :transform-type-options="transformTypeOptions"
            @test="onTestFunction"
            @save="onSubmit"
            @back="closeAddFunction"
            @cancel="cancelAddFunction"
            @open:chat="openChat"
            :is-add-function-component="isAddFunctionComponent"
            class="tw:pr-4"
          />
      </div>
    </div>

    <div class="tw:flex">


      <div
        class="tw:flex tw:overflow-auto "
        :style="{
          width: store.state.isAiChatEnabled && !isAddFunctionComponent ? '75%' : '100%',
        }"
      >
        <q-splitter
          v-model="splitterModel"
          :limits="[30, Infinity]"
          class="tw:overflow-hidden tw:w-full"
          reverse
        >
          <template v-slot:before>
            <div class="q-px-md q-pt-sm q-pb-md tw:h-max card-container tw:h-[calc(100vh-128px)]">
              <q-form id="addFunctionForm" ref="addJSTransformForm">
                <div class="add-function-name-input q-pb-sm o2-input">
                  <FullViewContainer
                    name="function"
                    v-model:is-expanded="expandState.functions"
                    :label="(formData.transType === '1' ? t('function.jsfunction') : t('function.vrlfunction')) + '*'"
                    class="tw-mt-1"
                  />
                  <div
                    v-show="expandState.functions"
                    class="tw:border-[1px] tw:border-gray-200"
                  >
                    <query-editor
                      data-test="logs-vrl-function-editor"
                      ref="editorRef"
                      editor-id="add-function-editor"
                      class="monaco-editor"
                      :style="{ height: `calc(100vh - (180px + ${heightOffset}px))` }"
                      v-model:query="formData.function"
                      :language="formData.transType === '1' ? 'javascript' : 'vrl'"
                    />
                  </div>
                  <div class="text-subtitle2">
                    <div v-if="vrlFunctionError">
                      <FullViewContainer
                        name="function"
                        v-model:is-expanded="expandState.functionError"
                        :label="formData.transType === '1' ? 'JavaScript Error Details' : t('function.errorDetails')"
                        labelClass="tw:text-red-600 tw:font-semibold"
                      />
                      <div
                        v-if="expandState.functionError"
                        class="q-px-sm q-pb-sm tw:border-l-4 tw:border-red-500"
                        :class="
                          store.state.theme === 'dark'
                            ? 'bg-grey-10'
                            : 'bg-grey-2'
                        "
                      >
                        <pre class="q-my-none tw:text-red-700" :class="store.state.theme === 'dark' ? 'tw:text-red-400' : 'tw:text-red-700'" style="white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 13px;">{{
                          vrlFunctionError
                        }}</pre>
                      </div>
                    </div>
                  </div>
                </div>
              </q-form>
            </div>
          </template>
          <template v-slot:after>
            <div class="q-px-md q-pt-sm q-pb-md tw:h-max q-ml-sm card-container">
              <TestFunction
                ref="testFunctionRef"
                :vrlFunction="formData"
                @function-error="handleFunctionError"
                :heightOffset="heightOffset"
                @sendToAiChat="sendToAiChat"
              />
            </div>
          </template>
        </q-splitter>
      </div>
      <div v-if="store.state.isAiChatEnabled && !isAddFunctionComponent" style="width: 25%; max-width: 100%; min-width: 75px;   " :class="store.state.theme == 'dark' ? 'dark-mode-chat-container' : 'light-mode-chat-container'" >
        <O2AIChat :style="{
          height: `calc(100vh - (112px + ${heightOffset}px))`
        }"  :is-open="store.state.isAiChatEnabled" @close="store.state.isAiChatEnabled = false" :aiChatInputContext="aiChatInputContext" />
      </div>
    </div>
  </div>  
  <confirm-dialog
    :title="confirmDialogMeta.title"
    :message="confirmDialogMeta.message"
    @update:ok="confirmDialogMeta.onConfirm()"
    @update:cancel="resetConfirmDialog"
    v-model="confirmDialogMeta.show"
  />
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  onMounted,
  computed,
  watch,
  onUnmounted,
  defineAsyncComponent,
  nextTick,
} from "vue";

import jsTransformService from "../../services/jstransform";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import segment from "../../services/segment_analytics";
import TestFunction from "@/components/functions/TestFunction.vue";
import FunctionsToolbar from "@/components/functions/FunctionsToolbar.vue";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { onBeforeRouteLeave } from "vue-router";
import O2AIChat from "@/components/O2AIChat.vue";
import { useRouter } from "vue-router";
import { useReo } from "@/services/reodotdev_analytics";
const defaultValue: any = () => {
  return {
    name: "",
    function: "",
    params: "row",
    transType: "0",
  };
};

let callTransform: Promise<{ data: any }>;

export default defineComponent({
  name: "ComponentAddUpdateFunction",
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    isUpdated: {
      type: Boolean,
      default: false,
    },
    heightOffset: {
      type: Number,
      default: 0,
    },
  },
  components: {
    QueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
    FunctionsToolbar,
    FullViewContainer,
    TestFunction,
    ConfirmDialog,
    O2AIChat,
  },
  emits: ["update:list", "cancel:hideform", "sendToAiChat"],
  setup(props, { emit }) {
    const store: any = useStore();
    const router = useRouter();
    const { track } = useReo();

    // let beingUpdated: boolean = false;
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
    const functionsToolbarRef = ref<typeof FunctionsToolbar>();
    const splitterModel = ref(50);
    const aiChatInputContext = ref("");
    const confirmDialogMeta = ref({
      title: "",
      message: "",
      show: false,
      onConfirm: () => {},
      data: null,
    });

    const expandState = ref({
      functions: true,
      functionError: false,
    });

    const vrlFunctionError = ref("");

    let compilationErr = ref("");

    // Transform type options for radio buttons
    const transformTypeOptions = computed(() => {
      const options = [
        { label: t("function.vrl"), value: "0" },
      ];

      // JavaScript functions are only allowed in _meta organization (for SSO claim parsing)
      if (store.state.selectedOrganization.identifier === "_meta") {
        options.push({ label: t("function.javascript"), value: "1" });
      }

      return options;
    });

    const beingUpdated = computed(() => props.isUpdated);

    const streamTypes = ["logs", "metrics", "traces"];

    const isFunctionDataChanged = ref(false);
    const isAddFunctionComponent = computed(() => router.currentRoute.value.path.includes('functions'))


    watch(
      () => formData.value.name + formData.value.function,
      () => {
        isFunctionDataChanged.value = true;
      },
    );

    onMounted(() => {
      window.addEventListener("beforeunload", beforeUnloadHandler);
    });

    onUnmounted(() => {
      window.removeEventListener("beforeunload", beforeUnloadHandler);
    });

    const beforeUnloadHandler = (e: any) => {
      //check is data updated or not
      if (isFunctionDataChanged.value) {
        // Display a confirmation message
        const confirmMessage = t("dashboard.unsavedMessage"); // Some browsers require a return statement to display the message
        e.returnValue = confirmMessage;
        return confirmMessage;
      }
      return;
    };

    let forceSkipBeforeUnloadListener = false;

    onBeforeRouteLeave((to, from, next) => {
      // check if it is a force navigation, then allow
      if (forceSkipBeforeUnloadListener) {
        next();
        return;
      }
      // else continue to warn user
      const actions = ["add", "update"];

      if (
        from.path === "/pipeline/functions" &&
        actions.includes((from.query?.action as string) || "none") &&
        isFunctionDataChanged.value
      ) {
        const confirmMessage = t("pipeline.unsavedMessage");
        if (window.confirm(confirmMessage)) {
          // User confirmed, allow navigation
          next();
        } else {
          // User canceled, prevent navigation
          next(false);
        }
      } else {
        // No unsaved changes or not leaving the edit route, allow navigation
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
      return (
        methodPattern.test(formData.value.name) || "Invalid Function name."
      );
    };
    const updateEditorContent = () => {
      // JS functions don't need prefix/suffix, only VRL functions might
      // For now, both VRL and JS are written as-is
      prefixCode.value = ``;
      suffixCode.value = ``;

      formData.value.function = `${prefixCode.value}
    ${formData.value.function}
    ${suffixCode.value}`;
    };

    const isValidFnName = () => {
      return formData.value.name.trim().length > 0;
    };

    const onSubmit = () => {
      if (!functionsToolbarRef.value) return;

      functionsToolbarRef.value.addFunctionForm
        .validate()
        .then((valid: any) => {
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
              // Both VRL and JS use params field (e.g., "row")
              // No need to clear params for JS

              callTransform = jsTransformService.create(
                store.state.selectedOrganization.identifier,
                formData.value,
              );
            } else {
              formData.value.transType = parseInt(formData.value.transType);
              // Both VRL and JS use params field (e.g., "row")
              // No need to clear params for JS

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
                  message:
                    err.response?.data?.message ?? "Function creation failed",
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
          track("Button Click", {
            button: "Save Function",
            page: "Add Function"
          });
        });
    };

    const onTestFunction = () => {
      if (testFunctionRef.value) testFunctionRef.value.testFunction();
    };

    const handleFunctionError = (err: string) => {
      vrlFunctionError.value = err;
      // Auto-expand error section when error occurs
      if (err) {
        expandState.value.functionError = true;
      }
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
      track("Button Click", {
        button: "Cancel Function",
        page: "Add Function"
      });
    };

    const resetConfirmDialog = () => {
      confirmDialogMeta.value.show = false;
      confirmDialogMeta.value.title = "";
      confirmDialogMeta.value.message = "";
      confirmDialogMeta.value.onConfirm = () => {};
      confirmDialogMeta.value.data = null;
    };
    const openChat = (val: boolean) => {
        store.dispatch("setIsAiChatEnabled", val);
    };

    const sendToAiChat = (value: any) => {
      //this is for when user in pipeline add function page and click on ai chat button
      //here we reset the value befoere setting it because if user clears the input then again click on the same value it wont trigger the watcher that is there in the child component
      //so to force trigger we do this
      aiChatInputContext.value = '';
      nextTick(() => {
        aiChatInputContext.value = value;
      });
      store.dispatch("setIsAiChatEnabled", true);
      //this is for when user in functions page and click on ai chat button
      emit("sendToAiChat", value);
    };

    return {
      t,
      $q,
      emit,
      disableColor,
      beingUpdated,
      formData,
      addJSTransformForm,
      store,
      compilationErr,
      indexOptions,
      editorRef,
      editorobj,
      prefixCode,
      suffixCode,
      editorUpdate,
      updateEditorContent,
      streamTypes,
      isFetchingStreams,
      isValidParam,
      isValidMethodName,
      onSubmit,
      expandState,
      testFunctionRef,
      onTestFunction,
      handleFunctionError,
      vrlFunctionError,
      functionsToolbarRef,
      splitterModel,
      closeAddFunction,
      confirmDialogMeta,
      transformTypeOptions,
      resetConfirmDialog,
      cancelAddFunction,
      openChat,
      isAddFunctionComponent,
      sendToAiChat,
      aiChatInputContext
    };
  },
  created() {
    this.formData = { ...defaultValue(), ...this.modelValue };
    this.beingUpdated = this.isUpdated;

    if (
      this.modelValue &&
      this.modelValue.name != undefined &&
      this.modelValue.name != ""
    ) {
      this.beingUpdated = true;
      this.disableColor = "grey-5";
      this.formData = this.modelValue;
      // Ensure transType is a string for radio button binding
      if (this.formData.transType !== undefined) {
        this.formData.transType = String(this.formData.transType);
      }
    }
  },
});
</script>

<style scoped lang="scss">
.monaco-editor {
  width: 100%;
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
