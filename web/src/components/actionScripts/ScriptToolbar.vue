<template>
  <div
    class="action-scripts-toolbar tw:pb-1.5 tw:w-full tw:flex tw:justify-between tw:items-center"
  >
    <div class="tw:flex tw:items-center">
      <div class="tw:mr-2 add-script-back-btn">
        <div
          data-test="add-script-back-btn"
          class="flex justify-center items-center cursor-pointer"
          style="
            border: 1.5px solid;
            border-radius: 50%;
            width: 22px;
            height: 22px;
          "
          title="Go Back"
          @click="redirectToScripts"
        >
          <q-icon name="arrow_back_ios_new" size="14px" />
        </div>
      </div>
      <div class="tw:text-lg tw:w-full add-script-title q-mr-md">
        Add Action
      </div>
      <div class="o2-input">
        <div class="tw:flex tw:items-center">
          <OInput
            data-test="add-script-name-input"
            v-model.trim="actionName"
            :label="t('actions.name')"
            class="q-pa-none tw:w-full"
            :readonly="disableName"
            :disabled="disableName"
            :error="!!scriptNameError"
            :error-message="scriptNameError"
            @update:model-value="onUpdate"
            @blur="onUpdate"
            style="min-width: 300px"
          />
          <q-icon
            :key="actionName"
            v-if="isValidMethodName() !== true && showInputError"
            :name="outlinedInfo"
            size="20px"
            class="q-ml-xs cursor-pointer"
            :class="store.state.theme === 'dark' ? 'text-red-5' : 'text-red-7'"
          >
            <OTooltip side="right" :content="String(isValidMethodName())" />
          </q-icon>
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
        ><q-icon name="fullscreen" size="18px" class="tw:mr-1" />{{
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
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

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
  q.fullscreen.toggle();
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
