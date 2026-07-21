<!-- Copyright 2026 OpenObserve Inc.

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
  <div class="w-full h-full flex flex-col min-h-0">
    <!-- The toolbar hosts the form-owned name + transType fields and the Save
         button (type="submit"), so it lives INSIDE the <OForm>. The editor +
         TestFunction below stay OUTSIDE the form. Inline form → Enter submits
         natively via the type="submit" Save button (no form-id needed). -->
    <OForm
      id="add-function-form"
      :form="addFunctionForm"
      class="shrink-0 px-2 border-b border-border-default"
      v-slot="{ isSubmitting }"
    >
      <FunctionsToolbar
        :is-submitting="isSubmitting"
        :disable-name="beingUpdated"
        :transform-type-options="transformTypeOptions"
        :hide-trans-type="!!forcedLanguage"
        @test="onTestFunction"
        @back="closeAddFunction"
        @cancel="cancelAddFunction"
        @open:chat="openChat"
        :is-add-function-component="isAddFunctionComponent"
      />
    </OForm>

    <div class="flex flex-1 min-h-0">
      <div
        class="flex overflow-hidden min-h-0"
        :class="[
          store.state.isAiChatEnabled && !isAddFunctionComponent
            ? 'w-3/4'
            : 'w-full',
        ]"
      >
        <OSplitter
          v-model="splitterModel"
          :limits="[30, 100]"
          class="overflow-hidden w-full"
          :horizontal="false"
          separator-class="w-[0.0625rem] bg-card-glass-border"
        >
          <template v-slot:before>
            <div class="px-2 pt-2 pb-3 bg-card-glass-bg h-full flex flex-col min-h-0">
              <div class="pb-2 o2-input flex flex-col flex-1 min-h-0">
                  <FullViewContainer
                    name="function"
                    v-model:is-expanded="expandState.functions"
                    :label="(transType === '1' ? t('function.jsfunction') : t('function.vrlfunction')) + '*'"
                    min-header-height="2.125rem"
                  />
                  <div
                    v-show="expandState.functions"
                    class="mb-1.5 relative flex-1 min-h-0"
                  >
                    <!-- Unified Query Editor (with built-in AI bar) -->
                    <unified-query-editor
                      data-test="logs-vrl-function-editor"
                      data-test-prefix="function-vrl"
                      ref="editorRef"
                      :languages="['vrl', 'javascript']"
                      :default-language="transType === '1' ? 'javascript' : 'vrl'"
                      :query="formData.function"
                      :hide-nl-toggle="!store.state.zoConfig.ai_enabled"
                      :disable-ai="!store.state.zoConfig.ai_enabled"
                      :disable-ai-reason="''"
                      :ai-placeholder="t('function.askAIFunctionPlaceholder')"
                      :ai-tooltip="t('function.enterFunctionPrompt')"
                      editor-height="100%"
                      @focus="functionEditorPlaceholderFlag = false"
                      @blur="functionEditorPlaceholderFlag = true"
                      @update:query="handleFunctionUpdate"
                      @language-change="handleLanguageChange"
                      @toggle-nlp-mode="handleToggleNlpMode"
                      @generation-start="handleGenerationStart"
                      @generation-end="handleGenerationEnd"
                      @generation-success="handleGenerationSuccess"
                    />
                    <!-- Typewriter placeholder for an empty editor.
                         Deliberately NOT gated on `!forcedLanguage`: a forced
                         language is no reason to drop the placeholder. transType
                         is locked to the forced language (see the mounted hook),
                         so the ternary below still picks the right one, and
                         `!formData.function` already hides this whenever a host
                         seeded `defaultCode`. Excluding forced hosts left the
                         pipeline Function node with a blank editor — it forces
                         vrl but passes no defaultCode. -->
                    <div
                      v-if="!formData.function && functionEditorPlaceholderFlag"
                      class="absolute inset-0 flex items-start pt-0.75 pr-2 pb-0 pl-[2.15rem] pointer-events-none z-1 select-none"
                    >
                      <span class="font-mono text-[var(--text-sm)] [line-height:1.3125rem] text-text-placeholder whitespace-nowrap overflow-hidden [text-overflow:ellipsis]">{{
                        transType === '1' ? jsPlaceholder : vrlPlaceholder
                      }}</span>
                    </div>
                  </div>
                  <div class="text-sm font-medium">
                    <div v-if="vrlFunctionError">
                      <FullViewContainer
                        name="function"
                        v-model:is-expanded="expandState.functionError"
                        :label="transType === '1' ? t('function.jsErrorDetails') : t('function.errorDetails')"
                        labelClass="text-status-error-text font-semibold"
                      />
                      <div
                        v-if="expandState.functionError"
                        data-test="function-error-details"
                        class="px-2 pb-2 border-l-4 border-status-negative bg-surface-subtle"
                      >
                        <pre class="my-0 text-status-error-text whitespace-pre-wrap" style="font-family: var(--font-mono); font-size: var(--text-compact);">{{
                          vrlFunctionError
                        }}</pre>
                      </div>
                    </div>
                  </div>
              </div>
            </div>
          </template>
          <template v-slot:after>
            <div class="px-2 pt-2 pb-3 h-full overflow-y-auto bg-card-glass-bg">
              <TestFunction
                ref="testFunctionRef"
                :vrlFunction="vrlFunctionData"
                @function-error="handleFunctionError"
                :heightOffset="heightOffset"
                :sample-events="sampleEvents"
                @sendToAiChat="sendToAiChat"
              />
            </div>
          </template>
        </OSplitter>
      </div>
      <div
        v-if="store.state.isAiChatEnabled && !isAddFunctionComponent"
        :class="[
          'w-1/4 max-w-full min-w-19',
          heightOffset ? '[--ai-chat-offset:4.6875rem]' : '',
        ]"
      >
        <O2AIChat
          class="h-[calc(100vh-(112px+var(--ai-chat-offset,0px)))]"
          :is-open="store.state.isAiChatEnabled"
          @close="store.state.isAiChatEnabled = false"
          :aiChatInputContext="aiChatInputContext"
        />
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
import config from "@/aws-exports";
import segment from "../../services/segment_analytics";
import TestFunction from "@/components/functions/TestFunction.vue";
import FunctionsToolbar from "@/components/functions/FunctionsToolbar.vue";
import FullViewContainer from "@/components/functions/FullViewContainer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { onBeforeRouteLeave } from "vue-router";
import O2AIChat from "@/components/O2AIChat.vue";
import { useRouter } from "vue-router";
import { useReo } from "@/services/reodotdev_analytics";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useVrlPlaceholder, useJsPlaceholder } from "@/composables/useVrlPlaceholder";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makeAddFunctionSchema,
  type AddFunctionForm,
} from "./AddFunction.schema";
export const defaultValue: any = () => {
  return {
    name: "",
    function: "",
    params: "row",
    transType: "0",
  };
};

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
    // Optional sample events for the TestFunction "Events" editor (workflows pass
    // the alert payload; omitted elsewhere → generic log sample).
    sampleEvents: {
      type: Array,
      default: undefined,
    },
    // When set ('vrl' | 'javascript'), the language is locked to this value and
    // the VRL/JS toggle is hidden (workflow function nodes force 'javascript').
    forcedLanguage: {
      type: String,
      default: "",
    },
    // Seed code for a fresh function editor (replaces the typewriter placeholder
    // with ready-to-edit boilerplate + a worked example in comments).
    defaultCode: {
      type: String,
      default: "",
    },
  },
  components: {
    OSplitter,
    OForm,
    UnifiedQueryEditor: defineAsyncComponent(
      () => import("@/components/QueryEditor.vue"),
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
    const addJSTransformForm: any = ref(null);    const disableColor: any = ref("");
    const formData: any = ref({
      name: "",
      function: "",
      params: "row",
      transType: "0",
    });
    const indexOptions = ref([]);
    const { t } = useI18n();
    const editorRef: any = ref(null);
    const functionEditorPlaceholderFlag = ref(true);
    const { placeholder: vrlPlaceholder } = useVrlPlaceholder();
    const { placeholder: jsPlaceholder } = useJsPlaceholder();
    let editorobj: any = null;
    const streams: any = ref({});
    const isFetchingStreams = ref(false);
    const testFunctionRef = ref<typeof TestFunction>();
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

    // JavaScript functions are an enterprise/cloud feature; OSS stays VRL-only.
    // EXCEPT the _meta org, which keeps JS even on OSS — that predates the
    // entitlement (SSO claim parsing) and must not break.
    const isJsAllowed = computed(
      () =>
        config.isEnterprise === "true" ||
        config.isCloud === "true" ||
        store.state.selectedOrganization?.identifier === "_meta",
    );

    // Transform type options for the VRL/JS radio group.
    const transformTypeOptions = computed(() => {
      const options = [{ label: t("function.vrl"), value: "0" }];

      // An already-JS function keeps the JS option even where JS isn't offered
      // (e.g. a build that lost the entitlement), so editing it renders the right
      // language instead of a radio group with nothing selected.
      const editingJsFunction =
        String((props.modelValue as any)?.transType ?? "0") === "1";

      if (isJsAllowed.value || editingJsFunction) {
        options.push({ label: t("function.javascript"), value: "1" });
      }

      return options;
    });

    const beingUpdated = computed(() => props.isUpdated);

    // AddFunction OWNS the <OForm> but also reads form state (transType drives
    // the Monaco editor language + placeholder) and writes it (the editor's
    // language toggle). The owner cannot inject the form it renders, so it
    // creates the form here with useOForm, reads it reactively via form.useStore,
    // and hands it to <OForm :form="addFunctionForm">. Defaults are seeded from
    // modelValue (edit-prefill); the VRL/JS body + `params` stay in `formData`
    // (the bare Monaco editor lives outside the form and is merged in at @submit).
    const addFunctionForm = useOForm<AddFunctionForm>({
      defaultValues: {
        name: props.modelValue?.name ?? "",
        transType: String(props.modelValue?.transType ?? "0"),
      },
      // Built with the component's `t` so validation messages are localized.
      schema: makeAddFunctionSchema(t),
      onSubmit: (value) => onSubmit(value),
    });

    // Reactive, read-only views of the form-owned fields.
    const nameValue = addFunctionForm.useStore((s: any) =>
      String(s.values.name ?? ""),
    );
    const transType = addFunctionForm.useStore((s: any) =>
      String(s.values.transType ?? "0"),
    );

    // What TestFunction consumes: the live form-owned name/transType combined
    // with the non-form Monaco body + params held in `formData`.
    const vrlFunctionData = computed(() => ({
      ...formData.value,
      name: nameValue.value,
      transType: transType.value,
    }));

    const streamTypes = ["logs", "metrics", "traces"];

    const isFunctionDataChanged = ref(false);
    const isAddFunctionComponent = computed(() => router.currentRoute.value.path.includes('functions'))


    watch(
      () => nameValue.value + formData.value.function,
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

    // @submit handler — OForm only calls it once the schema passes (name
    // required + method-name regex), so the schema, not a manual validate()
    // shim, gates the save. `value` carries the form-owned name + transType;
    // `function`/`params` (Monaco body / hidden constant) come from formData.
    // Awaited so OForm's isSubmitting drives the Save spinner.
    const onSubmit = async (value: AddFunctionForm) => {
      const loadingNotification = toast({
        variant: "loading",
        message: "Please wait...",
        timeout: 0,
      });

      // Both VRL and JS use the params field (e.g., "row") — no clearing needed.
      const payload: any = {
        ...formData.value,
        name: value.name,
        transType: parseInt(value.transType ?? "0"),
      };

      forceSkipBeforeUnloadListener = true;

      try {
        const res = beingUpdated.value
          ? await jsTransformService.update(
              store.state.selectedOrganization.identifier,
              payload,
            )
          : await jsTransformService.create(
              store.state.selectedOrganization.identifier,
              payload,
            );

        const _formData: any = { ...payload };
        formData.value = { ...defaultValue() };

        emit("update:list", _formData);

        loadingNotification();
        toast({
          variant: "success",
          message: res.data.message || "Function saved successfully",
        });
      } catch (err: any) {
        compilationErr.value = err?.response?.data?.["message"];
        toast({
          variant: "error",
          message: err.response?.data?.message ?? "Function creation failed",
        });
        loadingNotification();
      }

      segment.track("Button Click", {
        button: "Save Function",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        function_name: value.name,
        page: "Add/Update Function",
      });
      track("Button Click", {
        button: "Save Function",
        page: "Add Function"
      });
    };

    const onTestFunction = () => {
      if (testFunctionRef.value) testFunctionRef.value.testFunction();
    };

    const handleFunctionError = (err: string) => {
      vrlFunctionError.value = err;
      if (err) {
        expandState.value.functionError = true;
      } else {
        expandState.value.functionError = false;
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

    // Unified Query Editor: Handle function update
    const handleFunctionUpdate = (newFunction: string) => {
      formData.value.function = newFunction;
    };

    // Unified Query Editor: Handle language change
    const handleLanguageChange = (
      newLanguage: 'sql' | 'promql' | 'vrl' | 'javascript',
    ) => {
      // transType is form-owned — write it straight to the form; the useStore
      // reads above make the editor + tooltip react.
      const tt = newLanguage === 'javascript' ? '1' : '0';
      addFunctionForm.setFieldValue('transType', tt);
    };

    /**
     * Handle NLP mode toggle from AI icon in editor
     */
    const handleToggleNlpMode = () => {
      // UnifiedQueryEditor manages its own NLP mode state internally
    };

    /**
     * Handle generation start event from UnifiedQueryEditor
     */
    const handleGenerationStart = () => {
      // Can add loading indicators here if needed
    };

    /**
     * Handle generation end event from UnifiedQueryEditor
     */
    const handleGenerationEnd = () => {
      // Can remove loading indicators here if needed
    };

    /**
     * Handle successful generation from UnifiedQueryEditor
     */
    const handleGenerationSuccess = (payload: {type: string, message: string}) => {
      // Function code is already updated via @update:query handler
    };

    // Unified Query Editor: Handle Ask AI
    const handleAskAI = async (naturalLanguage: string, language: 'vrl' | 'javascript') => {

      // Enable AI chat if not already enabled
      if (!store.state.isAiChatEnabled) {
        openChat(true);
      }

      // The unified component handles AI generation internally
      // This event is just for parent components that may need to react
    };

    return {
      t,
      emit,
      disableColor,
      beingUpdated,
      formData,
      store,
      compilationErr,
      indexOptions,
      editorRef,
      functionEditorPlaceholderFlag,
      vrlPlaceholder,
      jsPlaceholder,
      editorobj,
      streamTypes,
      isFetchingStreams,
      onSubmit,
      // Returned so the Options-API template can see them (a module-level import
      // is out of scope in setup()-driven templates).
      addFunctionForm,
      transType,
      vrlFunctionData,
      expandState,
      testFunctionRef,
      onTestFunction,
      handleFunctionError,
      vrlFunctionError,
      splitterModel,
      closeAddFunction,
      confirmDialogMeta,
      transformTypeOptions,
      resetConfirmDialog,
      cancelAddFunction,
      openChat,
      isAddFunctionComponent,
      sendToAiChat,
      aiChatInputContext,
      handleFunctionUpdate,
      handleLanguageChange,
      handleToggleNlpMode,
      handleGenerationStart,
      handleGenerationEnd,
      handleGenerationSuccess,
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

    // Host-forced language (e.g. workflow function nodes are JS-only) — lock the
    // transType to the forced language. The host HIDES the VRL/JS toggle, so the
    // displayed + saved language must match forcedLanguage on BOTH the create and
    // the edit path — otherwise editing a function whose saved transType differs
    // would run/save the wrong language with no way to correct it.
    if (this.forcedLanguage) {
      const tt = this.forcedLanguage === "javascript" ? "1" : "0";
      this.formData.transType = tt;
      // transType is form-owned (drives the editor language, the "*Function*"
      // label, and the info tooltip), so it must be written to the FORM — setting
      // formData alone leaves the display on VRL.
      (this as any).addFunctionForm?.setFieldValue?.("transType", tt);
      // Seed boilerplate only for a brand-new function; never clobber saved code.
      if (!this.beingUpdated && this.defaultCode && !this.formData.function) {
        this.formData.function = this.defaultCode;
      }
    }
  },
});
</script>
