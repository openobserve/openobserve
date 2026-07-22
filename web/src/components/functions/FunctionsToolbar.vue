<template>
  <!-- Standard app header: back tile + "Add Function" title, with the name/
       transform-type fields inline (#tabs) and the action buttons (#actions).
       The name + transType controls are form-owned (OForm*); the parent
       AddFunction.vue provides the <OForm> context they inject. -->
  <OPageHeader
    :title="t('function.addFunction')"
    :back="{
      label: t('function.header'),
      onClick: redirectToFunctions,
      dataTest: 'add-function-back-btn',
    }"
  >
    <template #tabs>
      <div class="o2-input flex items-center gap-6">
        <div class="flex items-center">
          <OFormInput
            name="name"
            data-test="add-function-name-input"
            :placeholder="t('function.name')"
            class="p-0 w-full"
            :readonly="disableName"
            :disabled="disableName"
            required
            tabindex="0"
            style="min-width: 300px"
          />
        </div>
        <!-- Transform Type Radio Buttons -->
        <div class="flex items-center gap-4 h-9">
          <!-- Language toggle hidden when a host forces a single language
               (e.g. workflow function nodes are JS-only); the info tip stays. -->
          <OFormRadioGroup
            v-if="!hideTransType"
            name="transType"
            orientation="horizontal"
            class="items-center gap-4"
          >
            <div class="flex items-center gap-1">
              <ORadio value="0" data-test="function-transform-type-vrl-radio" />
              <span class="text-compact font-medium leading-none">{{
                transformTypeOptions[0]?.label
              }}</span>
            </div>
            <!-- JavaScript option only shown in _meta organization -->
            <div v-if="transformTypeOptions[1]" class="flex items-center gap-1">
              <ORadio value="1" data-test="function-transform-type-js-radio" />
              <span class="text-compact font-medium leading-none">{{
                transformTypeOptions[1]?.label
              }}</span>
            </div>
          </OFormRadioGroup>
          <!-- Info icon with tooltip -->
          <OIcon name="info-outline" size="sm" class="cursor-pointer text-icon-color shrink-0">
            <OTooltip>
              <template #content>
                <!-- Wrap in one column container: OTooltip renders the #content
                     slot inside an inline-flex row, so sibling blocks would sit
                     side-by-side. A single flex-col child keeps title over body. -->
                <div class="flex flex-col">
                  <div class="font-semibold mb-1">
                    {{ transTypeValue === "1" ? t("function.javascript") : t("function.vrl") }} Tip:
                  </div>
                  <div>
                    {{
                      transTypeValue === "1"
                        ? t("function.jsFunctionHint")
                        : t("function.vrlFunctionHint")
                    }}
                  </div>
                </div>
              </template>
            </OTooltip>
          </OIcon>
        </div>
      </div>
    </template>
    <template #actions>
      <OButton
        v-if="
          config.isEnterprise == 'true' &&
          !isAddFunctionComponent &&
          store.state.zoConfig.ai_enabled
        "
        variant="ghost"
        size="icon-sm"
        @click="emit('open:chat', !store.state.isAiChatEnabled)"
        data-test="menu-link-ai-item"
        class="![background:var(--color-gradient-ai-subtle)] transition-[background,box-shadow] duration-300 ease-in-out hover:![background:var(--color-gradient-ai)] hover:shadow-[0_0.25rem_0.75rem_0_rgba(139,92,246,0.35)] rounded-default"
        :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
        :disabled="isSubmitting"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
      >
        <img
          :src="getBtnLogo"
          class="opacity-70 transition-transform duration-600 [.ai-btn-active_&]:!opacity-100"
        />
      </OButton>
      <OButton
        data-test="add-function-fullscreen-btn"
        v-close-popup="true"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="handleFullScreen"
        icon-left="fullscreen"
      >
        {{ t("common.fullscreen") }}
      </OButton>
      <OButton
        data-test="add-function-test-btn"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="emit('test')"
        icon-left="play-arrow"
      >
        {{ t("function.testFunction") }}
      </OButton>
      <OButton
        data-test="add-function-cancel-btn"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="emit('cancel')"
      >
        {{ t("function.cancel") }}
      </OButton>
      <OButton
        data-test="add-function-save-btn"
        variant="primary"
        size="sm-action"
        type="submit"
        :loading="isSubmitting"
      >
        {{ t("function.save") }}
      </OButton>
    </template>
  </OPageHeader>
</template>
<script setup lang="ts">
import { ref, computed, type PropType } from "vue";
import { inject } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useTheme } from "@/composables/useTheme";
import config from "../../aws-exports";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import { toggleFullscreen } from "@/utils/dom";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
const { t } = useI18n();

const router = useRouter();

const store = useStore();
const { isDark } = useTheme();

const props = defineProps({
  disableName: {
    type: Boolean,
    default: false,
  },
  isAddFunctionComponent: {
    type: Boolean,
    default: true,
  },
  transformTypeOptions: {
    type: Array as PropType<{ label: string; value: string | number }[]>,
    default: () => [],
  },
  // Hides the VRL/JS language toggle entirely (used when a host forces a single
  // language — e.g. workflow function nodes are JavaScript-only).
  hideTransType: {
    type: Boolean,
    default: false,
  },
  /** Drives the Save spinner + disables sibling actions while the form submits. */
  isSubmitting: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["test", "back", "cancel", "open:chat"]);

const isHovered = ref(false);

// The name + transType fields are form-owned (OForm*). We only READ transType
// here (for the info tooltip) via the injected OForm context.
const form = inject(FORM_CONTEXT_KEY, null);
const transTypeValue = form
  ? form.useStore((s: any) => String(s.values.transType ?? "0"))
  : ref("0");

const isAddFunctionComponent = computed(() => router.currentRoute.value.path.includes("functions"));
const handleFullScreen = () => {
  toggleFullscreen();
};

const redirectToFunctions = () => {
  emit("back");
};

const getBtnLogo = computed(() => {
  if (isHovered.value || store.state.isAiChatEnabled) {
    return getImageURL("images/common/ai_icon_dark.svg");
  }

  return isDark.value
    ? getImageURL("images/common/ai_icon_dark.svg")
    : getImageURL("images/common/ai_icon_gradient.svg");
});
</script>
