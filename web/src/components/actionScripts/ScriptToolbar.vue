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
          <OIcon name="arrow-back-ios-new" size="xs" />
        </div>
      </div>
      <div class="tw:text-lg tw:w-full add-script-title q-mr-md">
        Add Action
      </div>
      <q-form ref="addScriptForm" class="o2-input">
        <div class="tw:flex tw:items-center">
          <q-input
            data-test="add-script-name-input"
            v-model.trim="actionName"
            :label="t('actions.name')"
            color="input-border"
            bg-color="input-bg"
            class="q-pa-none tw:w-full"
            stack-label
            outlined
            filled
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
          <OIcon
            :key="actionName"
            v-if="isValidMethodName() !== true && showInputError"
            name="info"
            size="md"
            class="q-ml-xs cursor-pointer"
            :class="store.state.theme === 'dark' ? 'text-red-5' : 'text-red-7'"
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
          </OIcon>
        </div>
      </q-form>
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
import { useQuasar } from "quasar";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

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
