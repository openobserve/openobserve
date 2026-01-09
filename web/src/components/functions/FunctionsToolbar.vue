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
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
      </div>
      <div class="tw:text-lg tw:w-full add-function-title q-mr-sm">
        {{ t('function.addFunction') }}
      </div>
      <q-form ref="addFunctionForm" class="o2-input tw:flex tw:items-center tw:gap-6">
        <div class="tw:flex tw:items-center">
          <q-input
            data-test="add-function-name-input"
            v-model.trim="functionName"
            :label="t('function.name')"
            class="q-pa-none tw:w-full"
            stack-label
            borderless
            dense
            v-bind:readonly="disableName"
            v-bind:disable="disableName"
            :rules="[
              (val: any) => !!val || 'Field is required!',
              isValidMethodName,
            ]"
            no-error-icon
            tabindex="0"
            style="min-width: 300px"
            @update:model-value="onUpdate"
            @blur="onUpdate"
          />
          <q-icon
            :key="functionName"
            v-if="isValidMethodName() !== true && showInputError"
            :name="outlinedInfo"
            size="20px"
            class="q-ml-xs cursor-pointer"
          >
            <q-tooltip
              anchor="center right"
              self="center left"
              max-width="300px"
              :offset="[2, 0]"
              class="tw:text-[12px]"
            >
              {{ isValidMethodName() }}
            </q-tooltip>
          </q-icon>
        </div>
        <!-- Transform Type Radio Buttons -->
        <div class="tw:flex tw:items-center tw:gap-4">
          <div class="tw:flex tw:items-center tw:gap-1" data-test="function-transform-type-vrl-radio">
            <q-radio
              v-model="selectedTransType"
              val="0"
              size="xs"
              class="tw:mb-0"
            />
            <span class="tw:text-[13px] tw:font-medium tw:leading-none">{{ transformTypeOptions[0]?.label }}</span>
          </div>
          <!-- JavaScript option only shown in _meta organization -->
          <div v-if="transformTypeOptions[1]" class="tw:flex tw:items-center tw:gap-1" data-test="function-transform-type-js-radio">
            <q-radio
              v-model="selectedTransType"
              val="1"
              size="xs"
              class="tw:mb-0"
            />
            <span class="tw:text-[13px] tw:font-medium tw:leading-none">{{ transformTypeOptions[1]?.label }}</span>
          </div>
          <!-- Info icon with tooltip -->
          <q-icon
            name="info_outline"
            size="xs"
            class="tw:cursor-pointer"
          >
            <q-tooltip class="bg-grey-8">
              <div class="tw:font-semibold tw:mb-1">{{ selectedTransType === '1' ? t('function.javascript') : t('function.vrl') }} Tip:</div>
              <div>{{ selectedTransType === '1' ? t('function.jsFunctionHint') : t('function.vrlFunctionHint') }}</div>
            </q-tooltip>
          </q-icon>
        </div>
      </q-form>
    </div>
    <div class="add-function-actions flex justify-center tw:gap-2">
      <q-btn
            v-if="config.isEnterprise == 'true' && !isAddFunctionComponent && store.state.zoConfig.ai_enabled"
            :ripple="false"
            @click="emit('open:chat',!store.state.isAiChatEnabled)"
            data-test="menu-link-ai-item"
            no-caps
            :borderless="true"
            flat
            dense
            class="o2-button ai-hover-btn q-px-sm q-py-sm"
            :class="store.state.isAiChatEnabled ? 'ai-btn-active' : ''"
            style="border-radius: 100%;"
            @mouseenter="isHovered = true"
            @mouseleave="isHovered = false"

          >
            <div class="row items-center no-wrap tw:gap-2  ">
              <img  :src="getBtnLogo" class="header-icon ai-icon" />
            </div>
          </q-btn>
      <q-btn
        data-test="add-function-fullscreen-btn"
        v-close-popup="true"
        class="o2-secondary-button tw:h-[36px]"
        :label="t('common.fullscreen')"
        no-caps
        flat
        icon="fullscreen"
        @click="handleFullScreen"
      />
      <q-btn
        data-test="add-function-test-btn"
        :label="t('function.testFunction')"
        class="tw:ml-[12px] o2-secondary-button no-border tw:h-[36px]"
        no-caps
        icon="play_arrow"
        @click="emit('test')"
      />
      <q-btn
        data-test="add-function-cancel-btn"
        class="tw:ml-[12px] o2-secondary-button no-border tw:h-[36px]"
        flat
        :label="t('function.cancel')"
        no-caps
        @click="emit('cancel')"
      />
      <q-btn
        data-test="add-function-save-btn"
        :label="t('function.save')"
        class="tw:ml-[12px] o2-primary-button no-border tw:h-[36px]"
        flat
        type="submit"
        no-caps
        @click="onSave"
      />
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
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
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
        : getImageURL('images/common/ai_icon.svg')
    })

defineExpose({ addFunctionForm });
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
    :deep(.q-btn .q-icon) {
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
</style>
