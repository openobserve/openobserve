<template>
  <div
    class="tw:w-full tw:flex tw:justify-between tw:items-center"
  >
    <div class="tw:flex tw:items-center">
      <div class="add-function-back-btn">
        <div
          data-test="add-function-back-btn"
          no-caps
          padding="xs"
          outline
          icon="arrow_back_ios_new"
          class="el-border tw:w-6 tw:h-6 tw:flex tw:items-center tw:justify-center cursor-pointer el-border-radius q-mr-sm"
          title="Go Back"
          @click="redirectToFunctions"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
      </div>
      <div class="tw:text-lg tw:w-full add-function-title q-mr-sm">
        {{ t('function.addFunction') }}
      </div>
      <div class="o2-input tw:flex tw:items-center tw:gap-6">
        <div class="tw:flex tw:items-center">
          <OInput
            data-test="add-function-name-input"
            v-model.trim="functionName"
            :label="t('function.name')"
            class="q-pa-none tw:w-full"
            v-bind:readonly="disableName"
            v-bind:disabled="disableName"
            :error="showInputError && !!nameError"
            :error-message="nameError"
            tabindex="0"
            style="min-width: 300px"
            @update:model-value="onUpdate"
            @blur="onUpdate"
          />
          <OIcon
            :key="functionName"
            v-if="isValidMethodName() !== true && showInputError"
            name="info-outline"
            size="md"
            class="q-ml-xs cursor-pointer"
          >
            <OTooltip
              side="right"
              align="center"
              max-width="300px"
              :side-offset="2"
              :content="isValidMethodName() !== true ? String(isValidMethodName()) : ''"
            />
          </OIcon>
        </div>
        <!-- Transform Type Radio Buttons -->
        <div class="tw:flex tw:items-center tw:gap-4">
          <ORadioGroup v-model="selectedTransType" class="tw:flex tw:items-center tw:gap-4">
            <div class="tw:flex tw:items-center tw:gap-1" data-test="function-transform-type-vrl-radio">
              <ORadio value="0" />
              <span class="tw:text-[13px] tw:font-medium tw:leading-none">{{ transformTypeOptions[0]?.label }}</span>
            </div>
            <!-- JavaScript option only shown in _meta organization -->
            <div v-if="transformTypeOptions[1]" class="tw:flex tw:items-center tw:gap-1" data-test="function-transform-type-js-radio">
              <ORadio value="1" />
              <span class="tw:text-[13px] tw:font-medium tw:leading-none">{{ transformTypeOptions[1]?.label }}</span>
            </div>
          </ORadioGroup>
          <!-- Info icon with tooltip -->
          <OIcon
            name="info-outline"
            size="xs"
            class="tw:cursor-pointer"
          >
            <OTooltip>
              <template #content>
                <div class="tw:font-semibold tw:mb-1">{{ selectedTransType === '1' ? t('function.javascript') : t('function.vrl') }} Tip:</div>
                <div>{{ selectedTransType === '1' ? t('function.jsFunctionHint') : t('function.vrlFunctionHint') }}</div>
              </template>
            </OTooltip>
          </OIcon>
        </div>
      </div>
    </div>
    <div class="add-function-actions flex justify-center tw:gap-2">
      <OButton
            v-if="config.isEnterprise == 'true' && !isAddFunctionComponent && store.state.zoConfig.ai_enabled"
            variant="ghost"
            size="icon-sm"
            @click="emit('open:chat',!store.state.isAiChatEnabled)"
            data-test="menu-link-ai-item"
            class="ai-hover-btn"
            :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
            style="border-radius: 6px;"
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
        @click="handleFullScreen"
        icon-left="fullscreen"
      >
        {{ t('common.fullscreen') }}
      </OButton>
      <OButton
        data-test="add-function-test-btn"
        variant="outline"
        size="sm-action"
        @click="emit('test')"
        icon-left="play-arrow"
      >
        {{ t('function.testFunction') }}
      </OButton>
      <OButton
        data-test="add-function-cancel-btn"
        variant="outline"
        size="sm-action"
        @click="emit('cancel')"
      >
        {{ t('function.cancel') }}
      </OButton>
      <OButton
        data-test="add-function-save-btn"
        variant="primary"
        size="sm-action"
        type="submit"
        @click="onSave"
      >
        {{ t('function.save') }}
      </OButton>
    </div>
  </div>
</template>
<script setup lang="ts">
import {
  ref,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "../../aws-exports";
import { getImageURL } from "@/utils/zincutils";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ORadioGroup from "@/lib/forms/Radio/ORadioGroup.vue";
import ORadio from "@/lib/forms/Radio/ORadio.vue";
const { t } = useI18n();

const q = useQuasar();

const router = useRouter();

const store = useStore();

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  disableName: {
    type: Boolean,
    default: false,
  },
  isAddFunctionComponent: {
    type: Boolean,
    default: true,
  },
  transType: {
    type: String,
    default: "0",
  },
  transformTypeOptions: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["test", "save", "update:name", "back", "cancel", "open:chat", "update:transType"]);

const addFunctionForm = ref(null);

const showInputError = ref(false);

const isHovered = ref(false);
const isValidMethodName = () => {
  if (!functionName.value) return "Field is required!";
  const methodPattern = /^[A-Z_][A-Z0-9_]*$/i;
  return (
    methodPattern.test(functionName.value) ||
    "Invalid method name. Must start with a letter or underscore. Use only letters, numbers, and underscores."
  );
};

const nameError = computed(() => {
  if (!showInputError.value) return '';
  if (!functionName.value) return 'Field is required!';
  const check = isValidMethodName();
  return check === true ? '' : String(check);
});

const onUpdate = () => {
  showInputError.value = true;
};

const functionName = computed({
  get: () => props.name,
  set: (value) => emit("update:name", value),
});

const selectedTransType = computed({
  get: () => {
    // Ensure the value is always a string for radio button comparison
    return String(props.transType || "0");
  },
  set: (value) => emit("update:transType", value),
});

const isAddFunctionComponent = computed(() => router.currentRoute.value.path.includes('functions'))
const handleFullScreen = () => {
  q.fullscreen.toggle();
};

const redirectToFunctions = () => {
  emit("back");
};

const onSave = () => {
  showInputError.value = true;
  emit("save");
};

const getBtnLogo = computed(() => {
      if (isHovered.value || store.state.isAiChatEnabled) {
        return getImageURL('images/common/ai_icon_dark.svg')
      }

      return store.state.theme === 'dark'
        ? getImageURL('images/common/ai_icon_dark.svg')
        : getImageURL('images/common/ai_icon_gradient.svg')
    })

defineExpose({
  addFunctionForm: {
    validate: async () => {
      showInputError.value = true;
      return !!functionName.value && isValidMethodName() === true;
    },
  },
});
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
