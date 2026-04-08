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

    <!-- ───────────────────────────────────────────────────────────────
         SECTION 1: Avoid Duplicate Notifications  (Scheduled only)
    ─────────────────────────────────────────────────────────────────── -->
    <div
      v-if="isRealTime === 'false'"
      class="adv-section tw:rounded tw:mb-4"
      :class="sectionClass"
    >
      <!-- Header (always visible) -->
      <div
        class="adv-section-header tw:flex tw:items-start tw:justify-between tw:px-4 tw:py-3 tw:cursor-pointer"
        @click="toggleDeduplication"
        data-test="advanced-deduplication-header"
      >
        <div class="tw:flex tw:items-start tw:gap-3 tw:flex-1 tw:min-w-0">
          <q-icon name="notifications_off" size="20px" class="adv-icon tw:mt-0.5 tw:shrink-0" />
          <div class="tw:flex-1 tw:min-w-0">
            <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
              <span class="adv-section-title">{{ t('alerts.advanced.deduplicationTitle') }}</span>
              <span class="adv-badge adv-badge-scheduled">{{ t('alerts.advanced.scheduledOnly') }}</span>
            </div>
            <p class="adv-section-desc tw:mt-1 tw:mb-0">
              {{ t('alerts.advanced.deduplicationDesc') }}
            </p>
          </div>
        </div>
        <q-icon
          :name="deduplicationExpanded ? 'expand_less' : 'expand_more'"
          size="sm"
          class="adv-expand-icon tw:ml-2 tw:shrink-0 tw:mt-1"
        />
      </div>

      <!-- Expanded content -->
      <div v-if="deduplicationExpanded" class="adv-section-body">
        <q-separator class="adv-separator" />
        <Deduplication
          :deduplication="deduplication"
          :columns="columns"
          @update:deduplication="$emit('update:deduplication', $event)"
        />
      </div>
    </div>

    <!-- ───────────────────────────────────────────────────────────────
         SECTION 2: Compare Against Past Data  (Scheduled + SQL only)
    ─────────────────────────────────────────────────────────────────── -->
    <div
      v-if="isRealTime === 'false'"
      class="adv-section tw:rounded tw:mb-4"
      :class="sectionClass"
    >
      <!-- Header (always visible) -->
      <div
        class="adv-section-header tw:flex tw:items-start tw:justify-between tw:px-4 tw:py-3"
        :class="isSqlMode ? 'tw:cursor-pointer' : ''"
        @click="isSqlMode && toggleCompareWithPast()"
        data-test="advanced-compare-past-header"
      >
        <div class="tw:flex tw:items-start tw:gap-3 tw:flex-1 tw:min-w-0">
          <q-icon name="history" size="20px" class="adv-icon tw:mt-0.5 tw:shrink-0" />
          <div class="tw:flex-1 tw:min-w-0">
            <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
              <span class="adv-section-title">{{ t('alerts.advanced.compareWithPastTitle') }}</span>
              <span class="adv-badge adv-badge-scheduled">{{ t('alerts.advanced.scheduledOnly') }}</span>
              <span class="adv-badge adv-badge-sql">{{ t('alerts.advanced.sqlModeRequired') }}</span>
            </div>
            <p class="adv-section-desc tw:mt-1 tw:mb-0">
              {{ t('alerts.advanced.compareWithPastDesc') }}
            </p>
            <!-- Not in SQL mode — inline notice instead of hiding everything -->
            <div v-if="!isSqlMode" class="adv-notice tw:mt-2 tw:flex tw:items-center tw:gap-1.5">
              <q-icon name="lock_outline" size="14px" />
              <span>{{ t('alerts.compareWithPast.sqlModeOnlyNote') }}</span>
            </div>
          </div>
        </div>
        <q-icon
          v-if="isSqlMode"
          :name="compareWithPastExpanded ? 'expand_less' : 'expand_more'"
          size="sm"
          class="adv-expand-icon tw:ml-2 tw:shrink-0 tw:mt-1"
        />
      </div>

      <!-- Expanded content (SQL mode only) -->
      <div v-if="isSqlMode && compareWithPastExpanded" class="adv-section-body">
        <q-separator class="adv-separator" />
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

    <!-- ───────────────────────────────────────────────────────────────
         SECTION 3: Customize Notification Content  (All alert types)
    ─────────────────────────────────────────────────────────────────── -->
    <div
      class="adv-section tw:rounded tw:mb-4"
      :class="sectionClass"
    >
      <!-- Header (always visible) -->
      <div
        class="adv-section-header tw:flex tw:items-start tw:justify-between tw:px-4 tw:py-3 tw:cursor-pointer"
        @click="toggleVariables"
        data-test="advanced-notification-header"
      >
        <div class="tw:flex tw:items-start tw:gap-3 tw:flex-1 tw:min-w-0">
          <q-icon name="mail_outline" size="20px" class="adv-icon tw:mt-0.5 tw:shrink-0" />
          <div class="tw:flex-1 tw:min-w-0">
            <div class="tw:flex tw:items-center tw:gap-2 tw:flex-wrap">
              <span class="adv-section-title">{{ t('alerts.advanced.notificationContentTitle') }}</span>
            </div>
            <p class="adv-section-desc tw:mt-1 tw:mb-0">
              {{ t('alerts.advanced.notificationContentDesc') }}
            </p>
          </div>
        </div>
        <q-icon
          :name="variablesExpanded ? 'expand_less' : 'expand_more'"
          size="sm"
          class="adv-expand-icon tw:ml-2 tw:shrink-0 tw:mt-1"
        />
      </div>

      <!-- Expanded content -->
      <div v-if="variablesExpanded" class="adv-section-body tw:px-4 tw:py-4 tw:flex tw:flex-col tw:gap-6">
        <!-- ── 3a. Extra Variables ── -->
        <div>
          <div class="adv-field-label tw:mb-0.5">
            {{ t('alerts.advanced.variablesTitle') }}
          </div>
          <p class="adv-field-desc tw:mb-2">
            {{ t('alerts.advanced.variablesDesc') }}
          </p>

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

        <q-separator class="adv-inner-separator" />

        <!-- ── 3b. Alert Description ── -->
        <div>
          <div class="adv-field-label tw:mb-0.5">
            {{ t('alerts.advanced.descriptionTitle') }}
          </div>
          <p class="adv-field-desc tw:mb-2">
            {{ t('alerts.advanced.descriptionDesc') }}
          </p>
          <q-input
            v-model="localDescription"
            color="input-border"
            bg-color="input-bg"
            class="showLabelOnTop q-text-area-input"
            stack-label
            outlined
            borderless
            dense
            tabindex="0"
            style="width: 100%; resize: none;"
            type="textarea"
            :placeholder="t('alerts.placeholders.typeSomething')"
            rows="4"
            @update:model-value="emitUpdate"
          />
        </div>

        <q-separator class="adv-inner-separator" />

        <!-- ── 3c. Row Message Template ── -->
        <div>
          <div class="tw:flex tw:items-center tw:justify-between tw:mb-0.5">
            <div class="adv-field-label">
              {{ t('alerts.advanced.rowTemplateTitle') }}
            </div>
            <div class="tw:flex tw:items-center tw:gap-2">
              <span class="adv-field-desc tw:mb-0">{{ t('alerts.advanced.templateType') }}</span>
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
          <p class="adv-field-desc tw:mb-2">
            {{ rowTemplateDesc }}
          </p>
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
            rows="4"
            @update:model-value="emitUpdate"
          />
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
    isAggregationEnabled: {
      type: Boolean,
      default: false,
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

    // Collapsible section state — open by default so users immediately see what's here
    const compareWithPastExpanded = ref(false);
    const deduplicationExpanded = ref(true);
    const variablesExpanded = ref(true);

    const isSqlMode = computed(() => props.selectedTab === "sql");

    const sectionClass = computed(() =>
      store.state.theme === 'dark' ? 'section-dark' : 'section-light'
    );

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
      { label: "String", value: "String" },
      { label: "JSON", value: "Json" },
    ];

    const rowTemplatePlaceholder = computed(() =>
      localRowTemplateType.value === 'Json'
        ? 'e.g. {"user": "{name}", "timestamp": "{timestamp}"}'
        : 'e.g. Alert triggered at {timestamp} — status: {status_code}'
    );

    // Context-aware description for the row template field
    const rowTemplateDesc = computed(() => {
      if (props.isAggregationEnabled) {
        return t('alerts.advanced.rowTemplateDescAggregate');
      }
      if (props.selectedTab === 'sql' || props.selectedTab === 'promql') {
        return t('alerts.advanced.rowTemplateDescGeneric');
      }
      return t('alerts.advanced.rowTemplateDescRows');
    });

    // Watch for prop changes
    watch(() => props.contextAttributes, (v) => { localVariables.value = [...v]; }, { deep: true });
    watch(() => props.description, (v) => { localDescription.value = v; });
    watch(() => props.rowTemplate, (v) => { localRowTemplate.value = v; });
    watch(() => props.rowTemplateType, (v) => { localRowTemplateType.value = v; });

    const addVariable = () => {
      localVariables.value.push({ id: getUUID(), key: "", value: "" });
      emitUpdate();
    };

    const removeVariable = (variable: Variable) => {
      localVariables.value = localVariables.value.filter((v: Variable) => v.id !== variable.id);
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
      rowTemplateDesc,
      compareWithPastExpanded,
      deduplicationExpanded,
      variablesExpanded,
      isSqlMode,
      sectionClass,
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
}

/* ── Section card ── */
.adv-section {
  border-radius: 8px;
  overflow: hidden;

  &.section-dark {
    border: 1px solid #343434;

    .adv-section-header { background-color: #2a2a2a; }
    .adv-section-title   { color: #e0e0e0; }
    .adv-icon            { color: #9e9e9e; }
    .adv-expand-icon     { color: #9e9e9e; }
    .adv-section-desc    { color: #888888; }
    .adv-notice          { color: #777777; }
    .adv-field-label     { color: #d0d0d0; }
    .adv-field-desc      { color: #888888; }
    .adv-separator       { border-color: #343434; }
    .adv-inner-separator { border-color: #2e2e2e; }
  }

  &.section-light {
    border: 1px solid #e0e0e0;

    .adv-section-header { background-color: #f5f5f5; }
    .adv-section-title   { color: #2d2d2d; }
    .adv-icon            { color: #666666; }
    .adv-expand-icon     { color: #666666; }
    .adv-section-desc    { color: #666666; }
    .adv-notice          { color: #888888; }
    .adv-field-label     { color: #2d2d2d; }
    .adv-field-desc      { color: #666666; }
    .adv-separator       { border-color: #e0e0e0; }
    .adv-inner-separator { border-color: #eeeeee; }
  }
}

/* ── Section header text ── */
.adv-section-title {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.3;
}

.adv-section-desc {
  font-size: 0.8rem;
  line-height: 1.5;
}

/* ── Badges ── */
.adv-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.6;
  white-space: nowrap;

  &.adv-badge-scheduled {
    background: rgba(104, 50, 204, 0.12);
    color: #7c4dcc;
  }

  &.adv-badge-sql {
    background: rgba(50, 150, 204, 0.12);
    color: #2e86c1;
  }
}

/* ── Notice (lock / info) ── */
.adv-notice {
  font-size: 0.75rem;
}

/* ── Field labels inside expanded body ── */
.adv-field-label {
  font-size: 0.875rem;
  font-weight: 600;
}

.adv-field-desc {
  font-size: 0.78rem;
  line-height: 1.5;
}

/* ── Section body ── */
.adv-section-body {
  background-color: transparent;
}

/* ── Misc ── */
.iconHoverBtn {
  &:hover { background-color: rgba(0, 0, 0, 0.05); }
  &.icon-dark { filter: none !important; }
}
</style>
