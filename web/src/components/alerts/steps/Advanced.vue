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

<template>
  <div
    class="step-advanced"
    :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'"
  >
    <div class="step-content card-container">
      <!-- Section header -->
      <div class="section-header">
        <div class="section-header-accent" />
        <span class="section-header-title">{{
          t("alerts.additional_settings") || "Additional Settings"
        }}</span>
      </div>

      <div class="tw:px-3 tw:py-3 tw:flex tw:flex-col tw:gap-4">
        <!-- Template Override -->
        <div>
          <div class="subsection-label tw:mb-2">
            <span>{{ t("alerts.template") }}</span>
            <OButton
              style="color: #a0a0a0"
              variant="ghost"
              size="icon-sm"
            >
              <q-icon name="info_outline" />
              <q-tooltip>{{
                t("alerts.alertSettings.templateTooltip")
              }}</q-tooltip>
            </OButton>
          </div>
          <div class="tw:flex tw:items-center tw:gap-2">
            <q-select
              v-model="localTemplate"
              :options="filteredTemplates"
              class="no-case q-py-none inline-condition-select alert-v3-select"
              borderless
              dense
              use-input
              clearable
              emit-value
              :input-debounce="400"
              hide-bottom-space
              @filter="filterTemplates"
              @update:model-value="emitTemplateUpdate"
              style="min-width: 240px; max-width: 300px"
            >
              <template v-slot:selected>
                <div v-if="localTemplate" class="ellipsis">
                  {{ localTemplate }}<q-tooltip>{{ localTemplate }}</q-tooltip>
                </div>
              </template>
              <template v-slot:no-option>
                <q-item
                  ><q-item-section class="text-grey">{{
                    t("alerts.advanced.noTemplatesAvailable")
                  }}</q-item-section></q-item
                >
              </template>
            </q-select>
            <OButton
              variant="ghost"
              size="icon-circle-sm"
              :title="t('alerts.advanced.refreshTemplates')"
              @click="$emit('refresh:templates')"
            >
              <q-icon name="refresh" />
            </OButton>
          </div>
        </div>

        <!-- Context Variables -->
        <div>
          <div class="subsection-label tw:mb-2">
            <span>{{ t("alerts.additionalVariables") }}</span>
            <OButton
              style="color: #a0a0a0"
              variant="ghost"
              size="icon-sm"
            >
              <q-icon name="info_outline" />
              <q-tooltip>{{ t("alerts.advanced.variablesTooltip") }}</q-tooltip>
            </OButton>
          </div>
          <template v-if="!localVariables.length">
            <OButton
              data-test="alert-variables-add-btn"
              variant="outline"
              size="sm"
              @click="addVariable"
            >
              <span>{{ t("alerts.advanced.addVariable") }}</span>
            </OButton>
          </template>
          <template v-else>
            <div
              v-for="(variable, index) in localVariables"
              :key="variable.id"
              class="tw:flex tw:items-center tw:gap-2 tw:mb-2"
              :data-test="`alert-variables-${index + 1}`"
            >
              <q-input
                data-test="alert-variables-key-input"
                v-model="variable.key"
                :placeholder="t('common.name')"
                dense
                borderless
                class="inline-condition-select alert-v3-input"
                style="min-width: 140px"
                @update:model-value="emitUpdate"
              />
              <q-input
                data-test="alert-variables-value-input"
                v-model="variable.value"
                :placeholder="t('common.value')"
                dense
                borderless
                class="inline-condition-select alert-v3-input"
                style="min-width: 200px"
                @update:model-value="emitUpdate"
              />
              <OButton
                data-test="alert-variables-delete-variable-btn"
                variant="ghost"
                size="icon-circle-sm"
                @click="removeVariable(variable)"
              >
                <q-icon name="delete_outline" />
              </OButton>
              <OButton
                data-test="alert-variables-add-variable-btn"
                v-if="index === localVariables.length - 1"
                variant="ghost"
                size="icon-circle-sm"
                @click="addVariable"
              >
                <q-icon name="add" />
              </OButton>
            </div>
          </template>
        </div>

        <!-- Description -->
        <div>
          <div class="subsection-label tw:mb-2">
            <span>{{ t("alerts.description") }}</span>
          </div>
          <q-input
            v-model="localDescription"
            dense
            borderless
            class="inline-condition-select"
            style="width: 100%; resize: none"
            type="textarea"
            :placeholder="t('alerts.placeholders.typeSomething')"
            rows="4"
            @update:model-value="emitUpdate"
          />
        </div>

        <!-- Row Template -->
        <div>
          <div class="tw:flex tw:items-center tw:justify-between tw:mb-2">
            <div class="subsection-label">
              <span>{{ t("alerts.row") }}</span>
              <OButton
                data-test="add-alert-row-input-info-btn"
                style="color: #a0a0a0"
                variant="ghost"
                size="icon-sm"
              >
                <q-icon name="info_outline" />
                <q-tooltip>{{
                  t("alerts.advanced.rowTemplateTooltip")
                }}</q-tooltip>
              </OButton>
            </div>
            <div class="tw:flex tw:items-center tw:gap-2">
              <span class="tw:text-xs tw:opacity-60">{{
                t("alerts.advanced.templateType")
              }}</span>
              <OToggleGroup
                data-test="add-alert-row-template-type-toggle"
                v-model="localRowTemplateType"
                @update:model-value="emitUpdate"
              >
                <OToggleGroupItem value="String" size="sm">
                  <template #icon-left><TypeIcon class="tw:size-3.5 tw:shrink-0" /></template>
                  String
                </OToggleGroupItem>
                <OToggleGroupItem value="Json" size="sm">
                  <template #icon-left><Braces class="tw:size-3.5 tw:shrink-0" /></template>
                  JSON
                </OToggleGroupItem>
              </OToggleGroup>
            </div>
          </div>
          <q-input
            data-test="add-alert-row-input-textarea"
            v-model="localRowTemplate"
            dense
            borderless
            class="inline-condition-select"
            style="width: 100%; resize: none"
            type="textarea"
            :placeholder="rowTemplatePlaceholder"
            rows="4"
            @update:model-value="emitUpdate"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  watch,
  type PropType,
  type Ref,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getUUID } from "@/utils/zincutils";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { Type as TypeIcon, Braces } from "lucide-vue-next";

export interface Variable {
  id: string;
  key: string;
  value: string;
}

export default defineComponent({
  name: "Step6Advanced",
  components: { OToggleGroup, OToggleGroupItem, OButton, TypeIcon, Braces },
  props: {
    template: {
      type: String,
      default: "",
    },
    templates: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
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
  emits: [
    "update:template",
    "refresh:templates",
    "update:contextAttributes",
    "update:description",
    "update:rowTemplate",
    "update:rowTemplateType",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    // Template override
    const localTemplate = ref(props.template);
    const formattedTemplates = computed(() =>
      props.templates.map((t: any) => t.name),
    );
    const filteredTemplates: Ref<string[]> = ref([]);
    const filterTemplates = (val: string, update: any) => {
      update(() => {
        if (val === "") {
          filteredTemplates.value = [...formattedTemplates.value];
        } else {
          const needle = val.toLowerCase();
          filteredTemplates.value = formattedTemplates.value.filter(
            (v: string) => v.toLowerCase().indexOf(needle) > -1,
          );
        }
      });
    };
    const emitTemplateUpdate = () => {
      emit("update:template", localTemplate.value || "");
    };

    watch(
      () => props.template,
      (newVal) => {
        localTemplate.value = newVal;
      },
    );
    watch(
      () => props.templates,
      () => {
        filteredTemplates.value = [...formattedTemplates.value];
      },
      { immediate: true },
    );

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
      return localRowTemplateType.value === "Json"
        ? 'e.g - {"user": "{name}", "timestamp": "{timestamp}"}'
        : "e.g - Alert was triggered at {timestamp}";
    });

    // Watch for prop changes
    watch(
      () => props.contextAttributes,
      (newVal) => {
        localVariables.value = [...newVal];
      },
      { deep: true },
    );

    watch(
      () => props.description,
      (newVal) => {
        localDescription.value = newVal;
      },
    );

    watch(
      () => props.rowTemplate,
      (newVal) => {
        localRowTemplate.value = newVal;
      },
    );

    watch(
      () => props.rowTemplateType,
      (newVal) => {
        localRowTemplateType.value = newVal;
      },
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
        (v: Variable) => v.id !== variable.id,
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
      localTemplate,
      filteredTemplates,
      filterTemplates,
      emitTemplateUpdate,
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

  .step-content {
    border-radius: 8px;
  }

  &.dark-mode {
    .step-content {
      background-color: #212121;
      border: 1px solid #343434;
    }
    .section-header {
      border-bottom: 1px solid #343434;
    }
    .section-header-title {
      color: #e0e0e0;
    }
    .section-header-accent {
      background: var(--q-primary);
    }
    .subsection-label {
      color: #9ca3af;
    }
  }

  &.light-mode {
    .step-content {
      background-color: #ffffff;
      border: 1px solid #e6e6e6;
    }
    .section-header {
      border-bottom: 1px solid #eeeeee;
    }
    .section-header-title {
      color: #374151;
    }
    .section-header-accent {
      background: var(--q-primary);
    }
    .subsection-label {
      color: #6b7280;
    }
  }
}

.section-header {
  display: flex;
  align-items: center;
  padding: 10px 12px;
}
.section-header-accent {
  width: 3px;
  height: 16px;
  border-radius: 2px;
  margin-right: 8px;
  flex-shrink: 0;
}
.section-header-title {
  font-size: 13px;
  font-weight: 600;
}
.subsection-label {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
}

.inline-condition-select {
  :deep(.q-field__control) {
    border: 1px solid var(--o2-border-color, #e0e0e0);
    border-radius: 0.375rem;
    padding: 0 8px;
    min-height: 28px;
    height: 28px;
    background-color: transparent;
  }

  :deep(.q-field__native),
  :deep(.q-field__input) {
    font-size: 13px;
    min-height: 28px;
    height: 28px;
    padding: 0 !important;
  }

  :deep(.q-field__marginal) {
    height: 28px !important;
  }

  :deep(.q-field__append) {
    height: 28px !important;
    align-items: center;
  }
}

// Override fixed height for textarea fields
.inline-condition-select:has(textarea) {
  :deep(.q-field__control) {
    height: auto !important;
    min-height: 80px !important;
  }
  :deep(.q-field__native) {
    height: auto !important;
    min-height: 80px !important;
  }
}
</style>
