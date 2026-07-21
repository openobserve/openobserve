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
      <div class="flex items-center gap-2">
        <OButton
          v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
          variant="ghost"
          size="icon-toolbar"
          @click="toggleAIChat"
          data-test="add-regex-pattern-open-close-ai-btn"
          class="group [background:var(--color-gradient-ai-subtle)]! text-ai-accent! dark:text-white! [transition:background_0.3s_ease,box-shadow_0.3s_ease,color_0.3s_ease] dark:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_20%,transparent)] hover:[background:var(--color-gradient-ai)]! hover:text-white! hover:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_35%,transparent)] dark:hover:shadow-[0_0.25rem_0.75rem_0_color-mix(in_srgb,var(--color-ai-accent)_35%,transparent)]"
          :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
          @mouseenter="isHovered = true"
          @mouseleave="isHovered = false"
        >
          <img :src="getBtnLogo" class="header-icon [transition:transform_0.6s_ease] group-hover:rotate-180 group-hover:brightness-0 group-hover:invert group-hover:[transition:filter_0.3s_ease]" />
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
            :class="isFullScreen ? 'text-accent' : ''"
          />
        </OButton>
      </div>
    </template>
    <!-- form inputs starts here -->
    <div class="flex w-full h-full">
      <div
        :class="
          store.state.isAiChatEnabled
            ? isFullScreen
              ? 'w-[75%] pl-2'
              : 'w-[65%] pl-2'
            : 'w-full'
        "
      >
        <OForm
          id="add-regex-pattern-form"
          ref="addRegexPatternForm"
          :schema="addRegexPatternSchema"
          :default-values="addRegexPatternDefaults"
          @submit="saveRegexPattern"
          class="flex flex-col gap-4"
        >
          <div class="flex flex-col gap-y-3">
            <OFormInput
              name="name"
              :readonly="isEdit"
              :disabled="isEdit"
              :label="t('regex_patterns.name')"
              required
              data-test="add-regex-pattern-name-input"
              :placeholder="t('settings.addRegexPattern.namePlaceholder')"
            />
            <OFormInput
              name="description"
              :readonly="isEdit"
              :disabled="isEdit"
              :label="t('regex_patterns.description')"
              class="pb-3"
              data-test="add-regex-pattern-description-input"
              :placeholder="t('settings.addRegexPattern.descriptionPlaceholder')"
            />
            <OBanner
              variant="info"
              icon="info"
              dense
              data-test="add-regex-pattern-lookaround-note"
            >
              <div class="text-xs font-normal leading-4.5">
                {{ t("regex_patterns.unsupported_lookaround_note") }}
                {{ t("regex_patterns.unsupported_lookaround_example") }}
                <code
                  class="font-mono text-xs px-1 py-px rounded-default bg-banner-info-border"
                  >(?=openobserve)\w+</code
                >
                <OIcon
                  name="arrow-right-alt"
                  size="xs"
                  class="inline-block align-middle mx-1"
                />
                <code
                  class="font-mono text-xs px-1 py-px rounded-default bg-banner-info-border"
                  >openobserve\w*</code
                >
              </div>
            </OBanner>
            <div class="regex-pattern-input-container">
              <div class="flex items-center justify-between">
                <span class="text-sm font-bold leading-5.25">{{ t('settings.addRegexPattern.regexPatternLabel') }}</span>
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
                    class="w-5 h-5 mr-1"
                  />
                  <span
                    class="text-brand-indigo text-sm flex items-center gap-1"
                  >
                    {{ t('settings.addRegexPattern.tryAiAssistant') }}
                  </span>
                  <OIcon
                    size="sm"
                    name="arrow-right-alt"
                    class="text-brand-indigo w-5 h-5 ml-1"
                  />
                </OButton>
              </div>
              <div class="regex-pattern-input">
                <div class="py-0.5 h-6 bg-surface-subtle">
                  <div class="text-xs font-[500] px-2 text-text-secondary">
                    {{ t('settings.addRegexPattern.writePattern') }}
                  </div>
                </div>
                <OFormTextarea
                  name="pattern"
                  data-test="add-regex-pattern-input"
                  class="regex-pattern-input w-full"
                  tabindex="0"
                  style="resize: none"
                  :placeholder="t('settings.addRegexPattern.patternPlaceholder')"
                  :rows="5"
                />
              </div>
            </div>
            <OSeparator class="my-2" />
            <div>
              <div class="flex items-center justify-between">
                <span class="text-sm font-bold leading-5.25">
                  {{ t('settings.addRegexPattern.testRegexPattern') }}
                </span>
                <OButton
                  variant="primary"
                  size="chip"
                  :disabled="!patternValue"
                  @click="testStringOutput"
                >
                  {{ t('settings.addRegexPattern.testInput') }}
                </OButton>
              </div>
            </div>
            <div class="regex-pattern-test-string-container mb-2">
              <FullViewContainer
                name="query"
                v-model:is-expanded="expandState.regexTestString"
                :label="t('settings.addRegexPattern.inputStringLabel')"
                class="mt-1 py-md h-6"
                labelClass="text-text-secondary font-medium text-xs leading-5.25 -ml-1"
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
                  class="regex-test-string-input w-full"
                  tabindex="0"
                  style="resize: none"
                  :placeholder="t('settings.addRegexPattern.testStringPlaceholder')"
                  :rows="5"
                />
              </div>
            </div>
            <div class="regex-pattern-test-string-container">
              <FullViewContainer
                name="output"
                v-model:is-expanded="expandState.outputString"
                :label="t('settings.addRegexPattern.outputLabel')"
                class="mt-1 py-md h-6"
                labelClass="text-text-secondary font-medium text-xs leading-5.25 -ml-1"
              >
              </FullViewContainer>
              <div v-if="expandState.outputString" class="regex-pattern-input">
                <OFormTextarea
                  v-if="outputStringValue.length > 0"
                  name="outputString"
                  :readonly="true"
                  data-test="add-regex-output-string-input"
                  class="regex-test-string-input w-full"
                  tabindex="0"
                  style="resize: none"
                  :placeholder="t('settings.addRegexPattern.outputStringPlaceholder')"
                  :rows="5"
                />
                <div
                  v-else
                  class="flex flex-col items-center justify-center h-27.75 rounded-default border border-input-border bg-input-bg"
                >
                  <div v-if="!testLoading && outputStringValue.length === 0">
                    <OIcon
                      name="lightbulb"
                      size="md"
                      class="text-icon-color"
                    />
                    <span
                      class="text-xs font-[400] text-center text-text-secondary"
                    >
                      {{ t('settings.addRegexPattern.clickTestInputHint') }}
                    </span>
                  </div>
                  <div v-else-if="testLoading">
                    <span
                      class="flex items-center justify-center h-27.75"
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
        class="ml-2 max-w-full"
        v-if="store.state.isAiChatEnabled"
        style="
          width: 35%;
          min-width: 75px;
          height: calc(100vh - 90px) !important;
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
import useTheme from "@/composables/useTheme";
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
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
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
    OBanner,
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
    const { isDark } = useTheme();


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
    // (edit → the loaded pattern, create → blank).
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
      return isDark.value
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
      const payload = {
        name: value.name,
        pattern: value.pattern,
        description: value.description ?? "",
      };
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
              ? t("settings.addRegexPattern.updateSuccess")
              : t("settings.addRegexPattern.createSuccess"),
            variant: "success",
          });
          emit("close");
          emit("update:list");
        }
      } catch (error) {
        const e = error as { response: { status: number; data?: { message?: string } } };
        if (e.response.status != 403) {
          toast({
            message:
              e.response?.data?.message ||
              (props.isEdit
                ? t("settings.addRegexPattern.updateFailed")
                : t("settings.addRegexPattern.createFailed")),
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
        const e = error as { response?: { data?: { message?: string } } };
        toast({
          message: e.response?.data?.message || t("settings.addRegexPattern.testFailed"),
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

<style scoped>
/* keep(lib-override:o2-textarea): squares the top corners of the textarea's own
   border box (OTextarea's internal wrapper div, only reachable via :deep()) so
   each field reads as one unit under its flat full-width section-header strip. */
.regex-pattern-input :deep(.rounded-default.border),
.regex-test-string-input :deep(.rounded-default.border) {
  border-top-left-radius: 0 !important;
  border-top-right-radius: 0 !important;
}
</style>

