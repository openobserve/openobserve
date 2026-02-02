<!-- Copyright 2023 OpenObserve Inc.

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

<template>
  <div class="step-advanced" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div class="step-content card-container tw:px-3 tw:py-4">
      <!-- Context Variables -->
      <div class="tw:mb-4">
        <div class="tw:pb-2 custom-input-label text-bold">
          <span>{{ t("alerts.additionalVariables") }}</span>
          <q-btn
            style="color: #A0A0A0;"
            no-caps
            padding="xs"
            class="q-ml-xs"
            size="sm"
            flat
            icon="info_outline"
          >
            <q-tooltip>
              Variables are used to pass data from the alert to the destination.
            </q-tooltip>
          </q-btn>
        </div>

        <!-- Variables List -->
        <template v-if="!localVariables.length">
          <q-btn
            data-test="alert-variables-add-btn"
            size="sm"
            class="no-border o2-secondary-button tw:h-[36px]"
            flat
            no-caps
            @click="addVariable"
          >
            <q-icon name="add" />
            <span>Add Variable</span>
          </q-btn>
        </template>
        <template v-else>
          <div
            v-for="(variable, index) in localVariables"
            :key="variable.id"
            class="tw:flex tw:items-center tw:mb-2"
            :data-test="`alert-variables-${index + 1}`"
          >
            <q-input
              data-test="alert-variables-key-input"
              v-model="variable.key"
              :placeholder="t('common.name')"
              dense
              stack-label
              borderless
              tabindex="0"
              @update:model-value="emitUpdate"
            />
            <q-input
              data-test="alert-variables-value-input"
              v-model="variable.value"
              :placeholder="t('common.value')"
              dense
              stack-label
              borderless
              tabindex="0"
              style="min-width: 250px"
              @update:model-value="emitUpdate"
            />
            <q-btn
              data-test="alert-variables-delete-variable-btn"
              icon="delete_outline"
              class="q-ml-xs iconHoverBtn"
              :class="store.state.theme === 'dark' ? 'icon-dark' : ''"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              @click="removeVariable(variable)"
            />
            <q-btn
              data-test="alert-variables-add-variable-btn"
              v-if="index === localVariables.length - 1"
              icon="add"
              class="q-ml-xs iconHoverBtn"
              :class="store.state.theme === 'dark' ? 'icon-dark' : ''"
              padding="sm"
              unelevated
              size="sm"
              round
              flat
              @click="addVariable"
            />
          </div>
        </template>
      </div>

      <!-- Description -->
      <div class="tw:mb-4">
        <div class="flex items-center q-mb-sm">
          <span class="text-bold custom-input-label">{{ t("alerts.description") }}</span>
        </div>
        <q-input
          v-model="localDescription"
          color="input-border"
          bg-color="input-bg"
          class="showLabelOnTop q-mb-sm q-text-area-input"
          stack-label
          outlined
          borderless
          dense
          tabindex="0"
          style="width: 100%; resize: none;"
          type="textarea"
          :placeholder="t('alerts.placeholders.typeSomething')"
          rows="5"
          @update:model-value="emitUpdate"
        />
      </div>

      <!-- Row Template -->
      <div class="tw:mb-4">
        <div class="flex items-center justify-between q-mb-sm">
          <div class="flex items-center">
            <span class="text-bold custom-input-label">{{ t("alerts.row") }}</span>
            <q-btn
              data-test="add-alert-row-input-info-btn"
              style="color: #A0A0A0;"
              no-caps
              padding="xs"
              class="q-ml-xs"
              size="sm"
              flat
              icon="info_outline"
            >
              <q-tooltip>
                Row Template is used to format the alert message.
              </q-tooltip>
            </q-btn>
          </div>
          <div class="flex items-center">
            <span class="text-caption q-mr-sm">Template Type:</span>
            <q-btn-toggle
              data-test="add-alert-row-template-type-toggle"
              v-model="localRowTemplateType"
              toggle-color="primary"
              :options="rowTemplateTypeOptions"
              dense
              no-caps
              unelevated
              size="sm"
              @update:model-value="emitUpdate"
            />
          </div>
        </div>
        <q-input
          data-test="add-alert-row-input-textarea"
          v-model="localRowTemplate"
          color="input-border"
          bg-color="input-bg"
          class="row-template-input"
          stack-label
          outlined
          borderless
          dense
          tabindex="0"
          style="width: 100%; resize: none;"
          type="textarea"
          :placeholder="rowTemplatePlaceholder"
          rows="5"
          @update:model-value="emitUpdate"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getUUID } from "@/utils/zincutils";

export interface Variable {
  id: string;
  key: string;
  value: string;
}

export default defineComponent({
  name: "Step6Advanced",
  props: {
    contextAttributes: {
      type: Array as PropType<Variable[]>,
      default: () => [],
    },
    description: {
      type: String,
      default: "",
    },
    rowTemplate: {
      type: String,
      default: "",
    },
    rowTemplateType: {
      type: String,
      default: "String",
    },
  },
  emits: ["update:contextAttributes", "update:description", "update:rowTemplate", "update:rowTemplateType"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const localVariables = ref<Variable[]>([...props.contextAttributes]);
    const localDescription = ref(props.description);
    const localRowTemplate = ref(props.rowTemplate);
    const localRowTemplateType = ref(props.rowTemplateType);

    const rowTemplateTypeOptions = [
      {
        label: "String",
        value: "String",
      },
      {
        label: "JSON",
        value: "Json",
      },
    ];

    const rowTemplatePlaceholder = computed(() => {
      return localRowTemplateType.value === 'Json'
        ? 'e.g - {"user": "{name}", "timestamp": "{timestamp}"}'
        : 'e.g - Alert was triggered at {timestamp}';
    });

    // Watch for prop changes
    watch(
      () => props.contextAttributes,
      (newVal) => {
        localVariables.value = [...newVal];
      },
      { deep: true }
    );

    watch(
      () => props.description,
      (newVal) => {
        localDescription.value = newVal;
      }
    );

    watch(
      () => props.rowTemplate,
      (newVal) => {
        localRowTemplate.value = newVal;
      }
    );

    watch(
      () => props.rowTemplateType,
      (newVal) => {
        localRowTemplateType.value = newVal;
      }
    );

    const addVariable = () => {
      localVariables.value.push({
        id: getUUID(),
        key: "",
        value: "",
      });
      emitUpdate();
    };

    const removeVariable = (variable: Variable) => {
      localVariables.value = localVariables.value.filter(
        (v: Variable) => v.id !== variable.id
      );
      emitUpdate();
    };

    const emitUpdate = () => {
      emit("update:contextAttributes", localVariables.value);
      emit("update:description", localDescription.value);
      emit("update:rowTemplate", localRowTemplate.value);
      emit("update:rowTemplateType", localRowTemplateType.value);
    };

    return {
      t,
      store,
      localVariables,
      localDescription,
      localRowTemplate,
      localRowTemplateType,
      rowTemplateTypeOptions,
      rowTemplatePlaceholder,
      addVariable,
      removeVariable,
      emitUpdate,
    };
  },
});
</script>

<style scoped lang="scss">
.step-advanced {
  width: 100%;
  height: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;

  .step-content {
    border-radius: 8px;
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
  }
}

.iconHoverBtn {
  &:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }

  &.icon-dark {
    filter: none !important;
  }
}

.custom-input-label {
  font-size: 14px;
}

.row-template-input {
  &.dark-mode-row-template {
    :deep(.q-field__control) {
      background-color: #181a1b !important;
    }
  }

  &.light-mode-row-template {
    :deep(.q-field__control) {
      background-color: #ffffff !important;
    }
  }
}
</style>
