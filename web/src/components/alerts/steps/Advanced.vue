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
  <div class="step-advanced" :class="store.state.theme === 'dark' ? 'dark-mode' : 'light-mode'">
    <div>
      <!-- Compare with Past (Scheduled only) -->
      <div
        v-if="isRealTime === 'false'"
        class="section-group tw:rounded tw:mb-4"
        :class="store.state.theme === 'dark' ? 'section-group-dark' : 'section-group-light'"
      >
        <div
          class="section-group-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2"
          :class="isSqlMode ? 'tw:cursor-pointer' : ''"
          @click="isSqlMode && toggleCompareWithPast()"
        >
          <div class="tw:flex tw:items-center tw:gap-1.5">
            <span class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wide section-group-label">
              {{ t('alerts.steps.compareWithPast') }}
            </span>
          </div>
          <q-icon
            v-if="isSqlMode"
            :name="compareWithPastExpanded ? 'expand_less' : 'expand_more'"
            size="sm"
            class="section-expand-icon"
          />
        </div>
        <!-- Non-SQL mode note -->
        <div
          v-if="!isSqlMode"
          class="tw:px-3 tw:py-2 tw:flex tw:items-center tw:gap-1.5 tw:text-xs section-note"
        >
          <q-icon name="info_outline" size="14px" />
          <span>{{ t('alerts.compareWithPast.sqlModeOnlyNote') }}</span>
        </div>
        <!-- Content when SQL mode and expanded -->
        <div v-if="isSqlMode && compareWithPastExpanded">
          <CompareWithPast
            :multiTimeRange="multiTimeRange"
            :period="period"
            :frequency="frequency"
            :frequencyType="frequencyType"
            :cron="cron"
            :selectedTab="selectedTab"
            @update:multiTimeRange="$emit('update:multiTimeRange', $event)"
            @goToSqlEditor="$emit('goToSqlEditor')"
          />
        </div>
      </div>

      <!-- Deduplication (Scheduled only) -->
      <div
        v-if="isRealTime === 'false'"
        class="section-group tw:rounded tw:mb-4"
        :class="store.state.theme === 'dark' ? 'section-group-dark' : 'section-group-light'"
      >
        <div
          class="section-group-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2 tw:cursor-pointer"
          @click="toggleDeduplication"
        >
          <span class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wide section-group-label">
            {{ t('alerts.steps.deduplication') }}
          </span>
          <q-icon
            :name="deduplicationExpanded ? 'expand_less' : 'expand_more'"
            size="sm"
            class="section-expand-icon"
          />
        </div>
        <div v-if="deduplicationExpanded">
          <Deduplication
            :deduplication="deduplication"
            :columns="columns"
            @update:deduplication="$emit('update:deduplication', $event)"
          />
        </div>
      </div>

      <!-- Variables, Description & Row Template -->
      <div
        class="section-group tw:rounded tw:mb-4"
        :class="store.state.theme === 'dark' ? 'section-group-dark' : 'section-group-light'"
      >
        <div
          class="section-group-header tw:flex tw:items-center tw:justify-between tw:px-3 tw:py-2 tw:cursor-pointer"
          @click="toggleVariables"
        >
          <span class="tw:text-xs tw:font-semibold tw:uppercase tw:tracking-wide section-group-label">
            {{ t('alerts.advanced.notificationCustomization') }}
          </span>
          <q-icon
            :name="variablesExpanded ? 'expand_less' : 'expand_more'"
            size="sm"
            class="section-expand-icon"
          />
        </div>

        <div v-if="variablesExpanded" class="tw:px-3 tw:py-3 tw:flex tw:flex-col tw:gap-4">
          <!-- Hint text -->
          <p class="tw:text-xs tw:leading-relaxed section-note tw:m-0 tw:mb-0!">
            {{ t('alerts.stepIntro.advanced') }}
          </p>

          <!-- Context Variables -->
          <div>
            <div class="tw:pb-2 custom-input-label text-bold tw:flex tw:items-center">
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
                  {{ t('alerts.advanced.variablesTooltip') }}
                </q-tooltip>
              </q-btn>
            </div>
            <template v-if="!localVariables.length">
              <q-btn
                data-test="alert-variables-add-btn"
                size="sm"
                class="no-border o2-secondary-button tw:h-[36px]"
                flat
                no-caps
                @click="addVariable"
              >
                <span>{{ t('alerts.advanced.addVariable') }}</span>
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
          <div>
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
          <div>
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
                    {{ t('alerts.advanced.rowTemplateTooltip') }}
                  </q-tooltip>
                </q-btn>
              </div>
              <div class="flex items-center">
                <span class="text-caption q-mr-sm">{{ t('alerts.advanced.templateType') }}</span>
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
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getUUID } from "@/utils/zincutils";
import CompareWithPast from "./CompareWithPast.vue";
import Deduplication from "./Deduplication.vue";

export interface Variable {
  id: string;
  key: string;
  value: string;
}

export default defineComponent({
  name: "Step4Advanced",
  components: {
    CompareWithPast,
    Deduplication,
  },
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
    isRealTime: {
      type: String,
      default: "false",
    },
    selectedTab: {
      type: String,
      default: "custom",
    },
    multiTimeRange: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    period: {
      type: Number,
      default: 10,
    },
    frequency: {
      type: Number,
      default: 10,
    },
    frequencyType: {
      type: String,
      default: "minutes",
    },
    cron: {
      type: String,
      default: "",
    },
    deduplication: {
      type: Object as PropType<any>,
      default: () => ({
        enabled: true,
        fingerprint_fields: [],
        time_window_minutes: undefined,
      }),
    },
    columns: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
  },
  emits: [
    "update:contextAttributes",
    "update:description",
    "update:rowTemplate",
    "update:rowTemplateType",
    "update:multiTimeRange",
    "update:deduplication",
    "goToSqlEditor",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const localVariables = ref<Variable[]>([...props.contextAttributes]);
    const localDescription = ref(props.description);
    const localRowTemplate = ref(props.rowTemplate);
    const localRowTemplateType = ref(props.rowTemplateType);

    // Collapsible section state
    const compareWithPastExpanded = ref(false);
    const deduplicationExpanded = ref(false);
    const variablesExpanded = ref(false);

    const isSqlMode = computed(() => props.selectedTab === "sql");

    const toggleCompareWithPast = () => {
      compareWithPastExpanded.value = !compareWithPastExpanded.value;
    };

    const toggleDeduplication = () => {
      deduplicationExpanded.value = !deduplicationExpanded.value;
    };

    const toggleVariables = () => {
      variablesExpanded.value = !variablesExpanded.value;
    };

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
      compareWithPastExpanded,
      deduplicationExpanded,
      variablesExpanded,
      isSqlMode,
      toggleCompareWithPast,
      toggleDeduplication,
      toggleVariables,
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

.section-group {
  border-radius: 6px;
  overflow: hidden;

  &.section-group-dark {
    border: 1px solid #343434;

    .section-group-header {
      background-color: #2a2a2a;
    }

    .section-group-label {
      color: #b0b0b0;
    }

    .section-expand-icon {
      color: #b0b0b0;
    }

    .section-note {
      color: #888888;
    }
  }

  &.section-group-light {
    border: 1px solid #e0e0e0;

    .section-group-header {
      background-color: #f5f5f5;
    }

    .section-group-label {
      color: #555555;
    }

    .section-expand-icon {
      color: #666666;
    }

    .section-note {
      color: #888888;
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
