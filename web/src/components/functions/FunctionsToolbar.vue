<template>
  <!-- Standard app header: back tile + "Add Function" title, with the name/
       transform-type fields inline (#tabs) and the action buttons (#actions). -->
  <AppPageHeader
    :title="t('function.addFunction')"
    :back="{ label: t('function.header'), onClick: redirectToFunctions, dataTest: 'add-function-back-btn' }"
  >
    <template #tabs>
      <div class="o2-input flex items-center gap-6">
        <div class="flex items-center">
          <OInput
            data-test="add-function-name-input"
            v-model.trim="functionName"
            :placeholder="t('function.name')"
            class="p-0 w-full"
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
            class="ml-1 cursor-pointer"
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
        <div class="flex items-center gap-4 h-9">
          <ORadioGroup v-model="selectedTransType" orientation="horizontal" class="items-center gap-4">
            <div class="flex items-center gap-1">
              <ORadio value="0" data-test="function-transform-type-vrl-radio" />
              <span class="text-[13px] font-medium leading-none">{{ transformTypeOptions[0]?.label }}</span>
            </div>
            <!-- JavaScript option only shown in _meta organization -->
            <div v-if="transformTypeOptions[1]" class="flex items-center gap-1">
              <ORadio value="1" data-test="function-transform-type-js-radio" />
              <span class="text-[13px] font-medium leading-none">{{ transformTypeOptions[1]?.label }}</span>
            </div>
          </ORadioGroup>
          <!-- Info icon with tooltip -->
          <OIcon
            name="info-outline"
            size="sm"
            class="cursor-pointer text-gray-500 shrink-0"
          >
            <OTooltip>
              <template #content>
                <div class="font-semibold mb-1">{{ selectedTransType === '1' ? t('function.javascript') : t('function.vrl') }} Tip:</div>
                <div>{{ selectedTransType === '1' ? t('function.jsFunctionHint') : t('function.vrlFunctionHint') }}</div>
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
        class="![background:linear-gradient(135deg,rgba(139,92,246,0.15)_0%,rgba(236,72,153,0.15)_100%)] transition-[background,box-shadow] duration-300 ease-in-out hover:![background:linear-gradient(135deg,#8b5cf6_0%,#ec4899_100%)] hover:shadow-[0_0.25rem_0.75rem_0_rgba(139,92,246,0.35)] rounded-md"
        :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
      >
        <img :src="getBtnLogo" class="opacity-70 transition-transform duration-600 [.ai-btn-active_&]:!opacity-100 [.ai-hover-btn:hover_&]:rotate-180 [.ai-hover-btn:hover_&]:[filter:brightness(0)_invert(1)]" />
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
    </template>
  </AppPageHeader>
</template>
<script setup lang="ts">
import {
  ref,
  computed,
  type PropType,
} from "vue";
import { useI18n } from "vue-i18n";
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
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { toggleFullscreen } from "@/utils/dom";
const { t } = useI18n();



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
    type: Array as PropType<{ label: string; value: string | number }[]>,
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
  toggleFullscreen();
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
