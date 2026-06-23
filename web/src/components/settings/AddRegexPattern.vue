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
<!-- TODO: Remove store.state.theme based styling as we moved towards having at central place that is app.scss so we plan this whole to that place -->
<template>
  <ODrawer
    :open="open"
    @update:open="$emit('update:open', $event)"
    :title="isEdit ? t('regex_patterns.edit_regex_pattern') : t('regex_patterns.create_regex_pattern')"
    :width="isFullScreen ? 100 : store.state.isAiChatEnabled ? 70 : 40"
    :primary-button-label="isEdit ? t('regex_patterns.update_close') : t('regex_patterns.create_close')"
    :secondary-button-label="t('regex_patterns.cancel')"
    form-id="add-regex-pattern-form"
    @click:secondary="handleClose"
    data-test="add-regex-pattern-drawer"
  >
    <template #header-right>
      <div class="tw:flex tw:items-center tw:gap-2">
        <OButton
          v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
          variant="ghost"
          size="icon-toolbar"
          @click="toggleAIChat"
          data-test="add-regex-pattern-open-close-ai-btn"
          class="ai-hover-btn"
          :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
          @mouseenter="isHovered = true"
          @mouseleave="isHovered = false"
        >
          <img :src="getBtnLogo" class="header-icon ai-icon" />
        </OButton>
        <OButton
          data-test="add-regex-pattern-fullscreen-btn"
          variant="ghost"
          size="icon-xs-sq"
          @click="toggleFullScreen"
        >
          <OIcon
            name="fullscreen"
            size="xs"
            :class="isFullScreen ? 'tw:text-[var(--o2-primary)]' : ''"
          />
        </OButton>
      </div>
    </template>
    <!-- form inputs starts here -->
    <div class="tw:flex tw:w-[100%] tw:h-full">
      <div
        :class="
          store.state.isAiChatEnabled
            ? isFullScreen
              ? 'tw:w-[75%] tw:pl-2'
              : 'tw:w-[65%] tw:pl-2'
            : 'tw:w-[100%] tw:px-3'
        "
      >
        <OForm
          id="add-regex-pattern-form"
          ref="addRegexPatternForm"
          :schema="addRegexPatternSchema"
          :default-values="addRegexPatternDefaults"
          @submit="saveRegexPattern"
          class="tw:flex tw:flex-col tw:gap-4 tw:mt-2"
        >
          <div class="tw:flex tw:flex-col tw:gap-y-3">
            <OFormInput
              name="name"
              :readonly="isEdit"
              :disabled="isEdit"
              :label="t('regex_patterns.name')"
              required
              data-test="add-regex-pattern-name-input"
              placeholder="Eg. Internal Passwords"
            />
            <OFormInput
              name="description"
              :readonly="isEdit"
              :disabled="isEdit"
              :label="t('regex_patterns.description')"
              class="tw:pb-3"
              data-test="add-regex-pattern-description-input"
              placeholder="Describe your pattern to help users understand"
            />
            <div class="regex-pattern-input-container">
              <div class="tw:flex tw:items-center tw:justify-between">
                <span class="regex-pattern-input-label"> Regex Pattern </span>
                <OButton
                  v-if="
                    config.isEnterprise == 'true' &&
                    store.state.zoConfig.ai_enabled
                  "
                  variant="ghost"
                  size="sm"
                  @click="toggleAIChat"
                >
                  <img
                    :src="goToAILogo"
                    class="tw:w-[20px] tw:h-[20px] tw:mr-1"
                  />
                  <span
                    class="tw:text-[#5960B2] tw:text-sm tw:flex tw:items-center tw:gap-1"
                  >
                    Try O2 Assistant to write expressions
                  </span>
                  <OIcon
                    size="sm"
                    name="arrow-right-alt"
                    class="tw:text-[#5960B2] tw:w-[20px] tw:h-[20px] tw:ml-1"
                  />
                </OButton>
              </div>
              <div class="regex-pattern-input">
                <div
                  class="tw:py-[2px] tw:h-[24px]"
                  :class="
                    store.state.theme === 'dark'
                      ? 'tw:bg-gray-500'
                      : 'tw:bg-gray-200 '
                  "
                >
                  <div
                    class="tw:text-[12px] tw:font-[500] tw:px-2"
                    :class="[
                      store.state.theme === 'dark'
                        ? 'tw:text-[#ffffff]'
                        : 'tw:text-[#6B7280]',
                    ]"
                  >
                    Write Pattern
                  </div>
                </div>
                <OFormTextarea
                  name="pattern"
                  data-test="add-regex-pattern-input"
                  class="regex-pattern-input"
                  :class="
                    store.state.theme === 'dark'
                      ? 'dark-mode-regex-pattern-input'
                      : 'light-mode-regex-pattern-input'
                  "
                  tabindex="0"
                  style="width: 100%; resize: none"
                  placeholder="Eg. \d....\d "
                  :rows="5"
                />
              </div>
            </div>
            <OSeparator class="tw:my-2" />
            <div>
              <div class="tw:flex tw:items-center tw:justify-between">
                <span class="regex-pattern-test-string-label">
                  Test Regex Pattern
                </span>
                <OButton
                  variant="primary"
                  size="chip"
                  :disabled="!patternValue"
                  @click="testStringOutput"
                >
                  Test Input
                </OButton>
              </div>
            </div>
            <div class="regex-pattern-test-string-container tw:mb-2">
              <FullViewContainer
                name="query"
                v-model:is-expanded="expandState.regexTestString"
                label="Input string"
                class="tw:mt-1 tw:py-md tw:h-[24px]"
                :labelClass="
                  store.state.theme === 'dark'
                    ? 'dark-test-string-container-label'
                    : 'light-test-string-container-label'
                "
              >
                <template #right> </template>
              </FullViewContainer>
              <div
                v-if="expandState.regexTestString"
                class="regex-pattern-input"
              >
                <OFormTextarea
                  name="testString"
                  data-test="add-regex-test-string-input"
                  class="regex-test-string-input"
                  :class="
                    store.state.theme === 'dark'
                      ? 'dark-mode-regex-test-string-input'
                      : 'light-mode-regex-test-string-input'
                  "
                  tabindex="0"
                  style="width: 100%; resize: none"
                  placeholder="Eg. 1234567890"
                  :rows="5"
                />
              </div>
            </div>
            <div class="regex-pattern-test-string-container">
              <FullViewContainer
                name="output"
                v-model:is-expanded="expandState.outputString"
                label="Output"
                class="tw:mt-1 tw:py-md tw:h-[24px]"
                :labelClass="
                  store.state.theme === 'dark'
                    ? 'dark-test-string-container-label'
                    : 'light-test-string-container-label'
                "
              >
              </FullViewContainer>
              <div v-if="expandState.outputString" class="regex-pattern-input">
                <OFormTextarea
                  v-if="outputStringValue.length > 0"
                  name="outputString"
                  :readonly="true"
                  data-test="add-regex-output-string-input"
                  class="regex-test-string-input"
                  :class="
                    store.state.theme === 'dark'
                      ? 'dark-mode-regex-test-string-input'
                      : 'light-mode-regex-test-string-input'
                  "
                  tabindex="0"
                  style="width: 100%; resize: none"
                  placeholder="Output String"
                  :rows="5"
                />
                <div
                  v-else
                  class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-[111px]"
                  :class="
                    store.state.theme === 'dark'
                      ? 'dark-mode-regex-no-output'
                      : 'light-mode-regex-no-output'
                  "
                >
                  <div v-if="!testLoading && outputStringValue.length === 0">
                    <OIcon
                      name="lightbulb"
                      size="md"
                      :class="
                        store.state.theme === 'dark'
                          ? 'tw:text-[#ffffff]'
                          : 'tw:text-[#A8A8A8]'
                      "
                    />
                    <span
                      class="tw:text-[12px] tw:font-[400] tw:text-center"
                      :class="
                        store.state.theme === 'dark'
                          ? 'tw:text-[#ffffff]'
                          : 'tw:text-[#4B5563]'
                      "
                    >
                      Please click Test Input to see the results
                    </span>
                  </div>
                  <div v-else-if="testLoading">
                    <span
                      class="tw:flex tw:items-center tw:justify-center tw:h-[111px]"
                    >
                      <OSpinner size="sm" />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </OForm>
      </div>
      <div
        class="tw:ml-2"
        v-if="store.state.isAiChatEnabled"
        style="
          width: 35%;
          max-width: 100%;
          min-width: 75px;
          height: calc(100vh - 90px) !important;
        "
        :class="
          store.state.theme == 'dark'
            ? 'dark-mode-chat-container'
            : 'light-mode-chat-container'
        "
      >
        <O2AIChat
          :aiChatInputContext="inputContext"
          style="height: calc(100vh - 90px) !important"
          :is-open="store.state.isAiChatEnabled"
          @close="store.state.isAiChatEnabled = false"
        />
      </div>
    </div>
  </ODrawer>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { computed } from "vue";
import config from "@/aws-exports";
import { getImageURL } from "@/utils/zincutils";
import FullViewContainer from "../functions/FullViewContainer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import regexPatternService from "@/services/regex_pattern";
import O2AIChat from "@/components/O2AIChat.vue";
import { useRouter } from "vue-router";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import {
  makeAddRegexPatternSchema,
  type AddRegexPatternForm,
} from "./AddRegexPattern.schema";

export default defineComponent({
  name: "AddRegexPattern",
  emits: ["close", "update:list", "update:open"],
  props: {
    data: {
      type: Object,
      default: () => ({}),
    },
    isEdit: {
      type: Boolean,
      default: false,
    },
    open: {
      type: Boolean,
      default: false,
    },
  },
  emit: ["close", "update:list", "update:open"],
  components: {
    OSeparator,
    FullViewContainer,
    O2AIChat,
    OButton,
    ODrawer,
    OSpinner,
    OIcon,
    OForm,
    OFormInput,
    OFormTextarea,
  },
  setup(props, { emit }) {
    const { t } = useI18n();

    const store = useStore();


    const isHovered = ref(false);

    const isFullScreen = ref(false);

    const router = useRouter();

    const testLoading = ref(false);

    const isPatternValid = ref(false);

    const queryEditorRef = ref<any>(null);

    const inputContext = ref("");

    // Ref to the <OForm>; used to read its live values (the form owns name/pattern).
    const addRegexPatternForm = ref<any>(null);

    // Zod schema for the form-owned fields (name + pattern). Built via the
    // i18n-driven factory and RETURNED from setup() so `:schema` resolves
    // (an Options-API template only sees setup's return — a module import is
    // out of scope, which would silently disable validation).
    const addRegexPatternSchema = makeAddRegexPatternSchema(t);

    // EDIT-prefill defaults as a typed computed. OForm reads `:default-values`
    // once at mount and the ODrawer (reka-ui `lazy`) unmounts/remounts its body
    // on close/open — so this re-seeds the form each time the drawer opens
    // (edit → the loaded pattern, create → blank). No `formKey` remount hack.
    const addRegexPatternDefaults = computed((): AddRegexPatternForm => {
      // "from logs" flow prefills the (non-saved) test string from the store.
      const testString =
        store.state.organizationData.regexPatternPrompt &&
        router.currentRoute.value.query.from === "logs"
          ? store.state.organizationData.regexPatternTestValue ?? ""
          : "";
      return props.isEdit
        ? {
            name: props.data?.name ?? "",
            pattern: props.data?.pattern ?? "",
            description: props.data?.description ?? "",
            testString,
            outputString: "",
          }
        : { name: "", pattern: "", description: "", testString, outputString: "" };
    });

    // The live `pattern` value, read ONE-WAY from the form store (never a
    // mirror). Used by the non-form Test feature (Test button enabled state +
    // highlight). The selector is wired once the OForm mounts and provides its
    // store; until then it reflects the default ("").
    const patternValue = ref<string>(addRegexPatternDefaults.value.pattern);
    // Live test-feature values, read ONE-WAY from the form store (the form owns
    // testString/outputString). Used by the Test button + highlight + output display.
    const testStringValue = ref<string>(
      addRegexPatternDefaults.value.testString ?? "",
    );
    const outputStringValue = ref<string>("");
    watch(
      () => addRegexPatternForm.value,
      (formRef) => {
        const f = formRef?.form;
        if (!f) return;
        const livePattern = f.useStore((s: any) => s.values.pattern ?? "");
        watch(livePattern, (v: string) => { patternValue.value = v; }, { immediate: true });
        const liveTestString = f.useStore((s: any) => s.values.testString ?? "");
        watch(liveTestString, (v: string) => { testStringValue.value = v; }, { immediate: true });
        const liveOutput = f.useStore((s: any) => s.values.outputString ?? "");
        watch(liveOutput, (v: string) => { outputStringValue.value = v; }, { immediate: true });
      },
      { immediate: true },
    );

    const expandState = ref({
      regexPattern: true,
      regexTestString: true,
      outputString: false,
    });

    const seedFromProps = () => {
      // name/pattern/description are form-owned — seeded by `:default-values`
      // (addRegexPatternDefaults) when the drawer body remounts on open. Here we
      // only handle the "from logs" prefill of the non-form test string.
      if (
        store.state.organizationData.regexPatternPrompt &&
        router.currentRoute.value.query.from == "logs"
      ) {
        inputContext.value = store.state.organizationData.regexPatternPrompt;
      }
    };

    watch(
      () => props.open,
      (v) => {
        if (v) seedFromProps();
      },
      { immediate: true },
    );

    // Watch for pattern changes to update highlighting
    watch(patternValue, (newPattern) => {
      if (testStringValue.value && queryEditorRef.value) {
        queryEditorRef.value.highlightRegexMatches(newPattern?.trim());
      }
    });

    const getBtnLogo = computed(() => {
      if (isHovered.value || store.state.isAiChatEnabled) {
        return getImageURL("images/common/ai_icon_dark.svg");
      }
      return store.state.theme === "dark"
        ? getImageURL("images/common/ai_icon_dark.svg")
        : getImageURL("images/common/ai_icon_gradient.svg");
    });
    const goToAILogo = computed(() => {
      return getImageURL("images/common/ai_icon_primary.svg");
    });
    const toggleAIChat = () => {
      const isEnabled = !store.state.isAiChatEnabled;
      store.dispatch("setIsAiChatEnabled", isEnabled);
      window.dispatchEvent(new Event("resize"));
    };

    // The validated `value` from @submit is the source of truth for name/pattern
    // (the schema already gated it). `description` is the non-form local. OForm
    // awaits this handler → the ODrawer Save spinner is automatic (no isSaving).
    const saveRegexPattern = async (value: AddRegexPatternForm) => {
      //payload for create and update regex pattern
      // we need to send the name , pattern , description
      const payload = {
        name: value.name,
        pattern: value.pattern,
        description: value.description ?? "",
      };
      //here we are emitting close and update:list to the parent component
      //this is used to close the dialog and update the regex pattern list
      try {
        const response = props.isEdit
          ? await regexPatternService.update(
              store.state.selectedOrganization.identifier,
              props.data.id,
              payload,
            )
          : await regexPatternService.create(
              store.state.selectedOrganization.identifier,
              payload,
            );
        if (response.status == 200) {
          toast({
            message: props.isEdit
              ? "Regex pattern updated successfully"
              : "Regex pattern created successfully",
            variant: "success",
          });
          emit("close");
          emit("update:list");
        }
      } catch (error) {
        if (error.response.status != 403) {
          toast({
            message:
              error.response?.data?.message ||
              (props.isEdit
                ? "Failed to update regex pattern"
                : "Failed to create regex pattern"),
            variant: "error",
          });
        }
      }
    };

    const toggleFullScreen = () => {
      isFullScreen.value = !isFullScreen.value;
      window.dispatchEvent(new Event("resize"));
    };

    const testStringOutput = async () => {
      try {
        expandState.value.outputString = true;
        addRegexPatternForm.value?.form?.setFieldValue("outputString", "");
        testLoading.value = true;
        const response = await regexPatternService.test(
          store.state.selectedOrganization.identifier,
          patternValue.value,
          [testStringValue.value],
        );
        addRegexPatternForm.value?.form?.setFieldValue(
          "outputString",
          response.data.results[0],
        );
      } catch (error) {
        toast({
          message: error.response?.data?.message || "Failed to test string",
          variant: "error",
        });
      } finally {
        testLoading.value = false;
      }
    };

    const closeAddRegexPatternDialog = () => {
      emit("close");
    };

    const handleClose = () => {
      emit("update:open", false);
      emit("close");
    };

    return {
      t,
      store,
      config,
      getBtnLogo,
      isHovered,
      toggleAIChat,
      isFullScreen,
      expandState,
      testStringValue,
      saveRegexPattern,
      isPatternValid,
      queryEditorRef,
      toggleFullScreen,
      outputStringValue,
      testStringOutput,
      outlinedLightbulb: "lightbulb",
      testLoading,
      goToAILogo,
      inputContext,
      closeAddRegexPatternDialog,
      handleClose,
      // Form wiring — MUST be returned so the Options-API template can resolve
      // them (a module import alone is out of the template's scope).
      addRegexPatternForm,
      addRegexPatternSchema,
      addRegexPatternDefaults,
      patternValue,
    };
  },
});
</script>

<style lang="scss">
.add-regex-pattern-container {
  width: 600px !important;
}
.add-regex-pattern-o2ai-enabled {
  width: calc(100vw - 500px) !important;
}
.add-regex-pattern-title {
  font-weight: 400;
  font-size: 18px;
  text-align: left;
}
.add-regex-pattern-light {
  .add-regex-pattern-title {
    color: #000000;
  }
}

.add-regex-pattern-name-input .q-field__control {
  display: flex;
  align-items: center;
  height: 44px;
}
.add-regex-pattern-description-input .q-field__control {
  display: flex;
  align-items: center;
  height: 65px;
}
.regex-pattern-input-container {
  border: 0px 1px 1px 1px solid #e6e6e6;
}
.regex-pattern-test-string-container {
  border: 0px 1px 1px 1px solid #e6e6e6;
}

.dark-mode-regex-pattern-input .q-field__control {
  background-color: #181a1b !important;
  border-left: 1px solid #212121 !important;
  border-right: 1px solid #212121 !important;
  border-bottom: 1px solid #212121 !important;
}
.light-mode-regex-pattern-input .q-field__control {
  background-color: #ffffff !important;
  border-left: 1px solid #e6e6e6 !important;
  border-right: 1px solid #e6e6e6 !important;
  border-bottom: 1px solid #e6e6e6 !important;
}
.regex-pattern-input > div > div > div > textarea {
  height: 200px !important;
  resize: none !important;
  padding-left: 0.5rem !important;
}

.dark-mode-regex-test-string-input .q-field__control {
  background-color: #181a1b !important;
  border-left: 2px solid #212121 !important;
  border-right: 2px solid #212121 !important;
  border-bottom: 2px solid #212121 !important;
}
.light-mode-regex-test-string-input {
  background-color: #ffffff !important;
  border-left: 1px solid #e6e6e6 !important;
  border-right: 1px solid #e6e6e6 !important;
  border-bottom: 1px solid #e6e6e6 !important;
}
.regex-test-string-input > div > div > div > textarea {
  resize: none !important;
  padding-left: 0.5rem !important;
}
.is-pattern-valid > div > div {
  .q-field__native {
    color: green !important;
  }
}
</style>

<style lang="scss">
.regex-pattern-test-string-editor {
  .lines-content {
    padding-left: 12px !important;
  }
}
.light-mode-regex-test-string-input {
  .monaco-editor-background {
    background-color: #ffffff !important;
  }
}
.dark-mode-regex-test-string-input {
  .monaco-editor-background {
    background-color: #181a1b !important;
  }
}
.regex-pattern-input-label {
  font-size: 14px;
  font-weight: 700;
  line-height: 21px;
}
.add-regex-pattern-dark {
  .regex-pattern-input-label {
    color: #ffffff;
  }
}
.add-regex-pattern-light {
  .regex-pattern-input-label {
    color: #6b7280;
  }
}
.regex-pattern-test-string-label {
  font-size: 14px;
  font-weight: 700;
  line-height: 21px;
}
.add-regex-pattern-dark {
  .regex-pattern-test-string-label {
    color: #ffffff;
  }
}
.add-regex-pattern-light {
  .regex-pattern-test-string-label {
    color: #6b7280;
  }
}
.dark-test-string-container-label {
  color: #ffffff;
  font-weight: 500;
  font-size: 12px;
  line-height: 21px;
}
.light-test-string-container-label {
  color: #6b7280;
  font-weight: 500;
  font-size: 12px;
  line-height: 21px;
  margin-left: -4px;
}
.dark-mode-regex-no-output {
  background-color: #181a1b !important;
  border-left: 2px solid #212121 !important;
  border-right: 2px solid #212121 !important;
  border-bottom: 2px solid #212121 !important;
}
.light-mode-regex-no-output {
  background-color: #ffffff !important;
  border-left: 1px solid #e6e6e6 !important;
  border-right: 1px solid #e6e6e6 !important;
  border-bottom: 1px solid #e6e6e6 !important;
}
</style>
