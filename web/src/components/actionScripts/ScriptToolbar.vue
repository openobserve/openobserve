<template>
  <div
    class="action-scripts-toolbar tw:pb-1.5 tw:w-full tw:flex tw:justify-between tw:items-center"
  >
    <div class="tw:flex tw:items-center">
      <div class="tw:mr-2 add-script-back-btn">
        <div
          data-test="add-script-back-btn"
          class="tw:flex tw:justify-center tw:items-center tw:cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px;
          "
          title="Go Back"
          @click="redirectToScripts"
        >
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
      </div>
      <div class="tw:text-lg tw:w-full add-script-title tw:mr-3">
        Add Action
      </div>
      <div class="o2-input">
        <div class="tw:flex tw:items-center">
          <OInput
            data-test="add-script-name-input"
            v-model.trim="actionName"
            :label="t('actions.name')"
            class="tw:p-0 tw:w-full"
            :readonly="disableName"
            :disabled="disableName"
            :error="!!scriptNameError"
            :error-message="scriptNameError"
            @update:model-value="onUpdate"
            @blur="onUpdate"
            style="min-width: 300px"
          />
          <OIcon
            :key="actionName"
            v-if="isValidMethodName() !== true && showInputError"
            name="info"
            size="md"
            class="tw:ml-1 tw:cursor-pointer"
            :class="store.state.theme === 'dark' ? 'text-red-5' : 'text-red-7'"
          >
            <OTooltip side="right" :content="String(isValidMethodName())" />
          </OIcon>
        </div>
      </div>
    </div>
    <div class="add-script-actions tw:flex tw:items-center tw:gap-2">
      <OButton
        data-test="add-script-fullscreen-btn"
        v-close-popup="true"
        variant="outline"
        size="sm"
        @click="handleFullScreen"
        ><OIcon name="fullscreen" size="sm" class="tw:mr-1" />{{
          t("common.fullscreen")
        }}</OButton
      >
      <OButton
        data-test="add-script-save-btn"
        variant="primary"
        size="sm-action"
        type="submit"
        @click="onSave"
        >{{ t("actions.save") }}</OButton
      >
      <OButton
        data-test="add-script-cancel-btn"
        variant="outline-destructive"
        size="sm-action"
        @click="emit('cancel')"
        >{{ t("common.cancel") }}</OButton
      >
    </div>
  </div>
</template>
<script setup lang="ts">
import { defineComponent, ref, onMounted, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
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
});

const emit = defineEmits(["test", "save", "update:name", "back", "cancel"]);

const addScriptForm = ref(null);

const scriptNameError = computed(() => {
  if (!showInputError.value) return '';
  if (!actionName.value) return 'Field is required!';
  const result = isValidMethodName();
  return result === true ? '' : result;
});

const showInputError = ref(false);

const isValidMethodName = () => {
  if (!actionName.value) return "Field is required!";
  const methodPattern = /^[A-Z_][A-Z0-9_]*$/i;
  return (
    methodPattern.test(actionName.value) ||
    "Invalid method name. Must start with a letter or underscore. Use only letters, numbers, and underscores."
  );
};

const onUpdate = () => {
  showInputError.value = true;
};

const actionName = computed({
  get: () => props.name,
  set: (value) => emit("update:name", value),
});

const handleFullScreen = () => {
  toggleFullscreen();
};

const redirectToScripts = () => {
  emit("back");
};

const onSave = () => {
  showInputError.value = true;
  emit("save");
};

defineExpose({ addScriptForm });
</script>
<style scoped lang="scss">
.action-scripts-toolbar {
  :deep(.q-field__bottom) {
    display: none;
  }

  .add-script-actions {
    :deep(.block) {
      font-weight: lighter;
    }
  }
}
</style>
