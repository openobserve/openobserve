<template>
  <!-- Standard app header: back tile + "Add Function" title, with the name/
       transform-type fields inline (#tabs) and the action buttons (#actions).
       The name + transType controls are form-owned (OForm*); the parent
       AddFunction.vue provides the <OForm> context they inject. -->
  <AppPageHeader
    :title="t('function.addFunction')"
    :back="{ label: t('function.header'), onClick: redirectToFunctions, dataTest: 'add-function-back-btn' }"
  >
    <template #tabs>
      <div class="o2-input tw:flex tw:items-center tw:gap-6">
        <div class="tw:flex tw:items-center">
          <OFormInput
            name="name"
            data-test="add-function-name-input"
            :placeholder="t('function.name')"
            class="tw:p-0 tw:w-full"
            :readonly="disableName"
            :disabled="disableName"
            required
            tabindex="0"
            style="min-width: 300px"
          />
        </div>
        <!-- Transform Type Radio Buttons -->
        <div class="tw:flex tw:items-center tw:gap-4 tw:h-9">
          <OFormRadioGroup name="transType" orientation="horizontal" class="tw:items-center tw:gap-4">
            <div class="tw:flex tw:items-center tw:gap-1">
              <ORadio value="0" data-test="function-transform-type-vrl-radio" />
              <span class="tw:text-[13px] tw:font-medium tw:leading-none">{{ transformTypeOptions[0]?.label }}</span>
            </div>
            <!-- JavaScript option only shown in _meta organization -->
            <div v-if="transformTypeOptions[1]" class="tw:flex tw:items-center tw:gap-1">
              <ORadio value="1" data-test="function-transform-type-js-radio" />
              <span class="tw:text-[13px] tw:font-medium tw:leading-none">{{ transformTypeOptions[1]?.label }}</span>
            </div>
          </OFormRadioGroup>
          <!-- Info icon with tooltip -->
          <OIcon
            name="info-outline"
            size="sm"
            class="tw:cursor-pointer tw:text-gray-500 tw:shrink-0"
          >
            <OTooltip>
              <template #content>
                <div class="tw:font-semibold tw:mb-1">{{ transTypeValue === '1' ? t('function.javascript') : t('function.vrl') }} Tip:</div>
                <div>{{ transTypeValue === '1' ? t('function.jsFunctionHint') : t('function.vrlFunctionHint') }}</div>
              </template>
            </OTooltip>
          </OIcon>
        </div>
      </div>
    </template>
    <template #actions>
      <OButton
        v-if="config.isEnterprise == 'true' && !isAddFunctionComponent && store.state.zoConfig.ai_enabled"
        variant="ghost"
        size="icon-sm"
        @click="emit('open:chat',!store.state.isAiChatEnabled)"
        data-test="menu-link-ai-item"
        class="ai-hover-btn"
        :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
        style="border-radius: 6px;"
        :disabled="isSubmitting"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
      >
        <img :src="getBtnLogo" class="header-icon ai-icon" />
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
        {{ t('common.fullscreen') }}
      </OButton>
      <OButton
        data-test="add-function-test-btn"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="emit('test')"
        icon-left="play-arrow"
      >
        {{ t('function.testFunction') }}
      </OButton>
      <OButton
        data-test="add-function-cancel-btn"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="emit('cancel')"
      >
        {{ t('function.cancel') }}
      </OButton>
      <OButton
        data-test="add-function-save-btn"
        variant="primary"
        size="sm-action"
        type="submit"
        :loading="isSubmitting"
      >
        {{ t('function.save') }}
      </OButton>
    </template>
  </AppPageHeader>
</template>
<script setup lang="ts">
import {
  ref,
  computed,
} from "vue";
import { inject } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "../../aws-exports";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OFormRadioGroup from "@/lib/forms/Radio/OFormRadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { toggleFullscreen } from "@/utils/dom";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
const { t } = useI18n();



const router = useRouter();

const store = useStore();

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
    type: Array,
    default: () => [],
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

const isAddFunctionComponent = computed(() => router.currentRoute.value.path.includes('functions'))
const handleFullScreen = () => {
  toggleFullscreen();
};

const redirectToFunctions = () => {
  emit("back");
};

const getBtnLogo = computed(() => {
      if (isHovered.value || store.state.isAiChatEnabled) {
        return getImageURL('images/common/ai_icon_dark.svg')
      }

      return store.state.theme === 'dark'
        ? getImageURL('images/common/ai_icon_dark.svg')
        : getImageURL('images/common/ai_icon_gradient.svg')
    })
</script>
<style scoped lang="scss">
.functions-toolbar {
  :deep(.q-field__bottom) {
    display: none;
  }

  .add-function-actions {
    :deep(.q-btn) {
      padding-top: 4px !important;
      padding-bottom: 4px !important;
      font-size: 13px;
    }
    :deep(.q-btn .OIcon) {
      margin-right: 2px;
    }

    :deep(.block) {
      font-weight: lighter;
    }

    :deep(.cancel-btn)::before {
      border: 1px solid var(--q-negative) !important;
    }
  }
}

/* ── AI button — mirrors MainLayout.vue ─────────────────────────── */
.ai-hover-btn {
  background: linear-gradient(
    135deg,
    rgba(139, 92, 246, 0.15) 0%,
    rgba(236, 72, 153, 0.15) 100%
  ) !important;
  transition: background 0.3s ease, box-shadow 0.3s ease;
}

.ai-hover-btn:hover {
  background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%) !important;
  box-shadow: 0 0.25rem 0.75rem 0 rgba(139, 92, 246, 0.35);
}

.ai-btn-active {
  background: linear-gradient(
    135deg,
    rgba(139, 92, 246, 0.15) 0%,
    rgba(236, 72, 153, 0.15) 100%
  ) !important;

  .header-icon {
    opacity: 1 !important;
  }
}

.ai-btn-active:hover {
  background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%) !important;
}

.header-icon {
  opacity: 0.7;
}

.ai-icon {
  transition: transform 0.6s ease;
}

.ai-hover-btn:hover .ai-icon {
  transform: rotate(180deg);
  filter: brightness(0) invert(1);
}
</style>
