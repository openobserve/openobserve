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
              data-test="advanced-template-info-btn"
              variant="ghost-primary"
              size="xs"
              class="help-learn-more"
              @click="openHelp('template')"
            >
              <OIcon name="help" size="xs" />
              <span>{{ t("alerts.alertSettings.helpLearnMore") }}</span>
            </OButton>
          </div>
          <div class="tw:flex tw:items-center tw:gap-2">
            <OSelect
              v-model="localTemplate"
              :options="formattedTemplates"
              clearable
              :placeholder="t('alerts.advanced.selectTemplate')"
              class="tw:min-w-[240px] tw:max-w-[300px]"
              data-test="advanced-template-override-select"
              @update:model-value="emitTemplateUpdate"
            >
              <template #empty>{{ t("alerts.advanced.noTemplatesAvailable") }}</template>
            </OSelect>
            <OButton
              variant="ghost"
              size="icon-circle-sm"
              :title="t('alerts.advanced.refreshTemplates')"
              @click="$emit('refresh:templates')"
            >
              <OIcon name="refresh" size="sm" />
            </OButton>
          </div>
        </div>

        <!-- Context Variables -->
        <div>
          <div class="subsection-label tw:mb-2">
            <span>{{ t("alerts.additionalVariables") }}</span>
            <OButton
              data-test="advanced-variables-info-btn"
              variant="ghost-primary"
              size="xs"
              class="help-learn-more"
              @click="openHelp('variables')"
            >
              <OIcon name="help" size="xs" />
              <span>{{ t("alerts.alertSettings.helpLearnMore") }}</span>
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
              <OInput
                data-test="alert-variables-key-input"
                v-model="variable.key"
                :placeholder="t('common.name')"
                class="tw:min-w-[140px]"
                @update:model-value="emitUpdate"
              />
              <OInput
                data-test="alert-variables-value-input"
                v-model="variable.value"
                :placeholder="t('common.value')"
                class="tw:min-w-[200px]"
                @update:model-value="emitUpdate"
              />
              <OButton
                data-test="alert-variables-delete-variable-btn"
                variant="ghost"
                size="icon-circle-sm"
                @click="removeVariable(variable)"
              >
                <OIcon name="delete-outline" size="sm" />
              </OButton>
              <OButton
                data-test="alert-variables-add-variable-btn"
                v-if="index === localVariables.length - 1"
                variant="ghost"
                size="icon-circle-sm"
                @click="addVariable"
              >
                <OIcon name="add" size="sm" />
              </OButton>
            </div>
          </template>
        </div>

        <!-- Description -->
        <div>
          <div class="subsection-label tw:mb-2">
            <span>{{ t("alerts.description") }}</span>
          </div>
          <OTextarea
            v-model="localDescription"
            :placeholder="t('alerts.placeholders.typeSomething')"
            :rows="4"
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
                variant="ghost-primary"
                size="xs"
                class="help-learn-more"
                @click="openHelp('rowTemplate')"
              >
                <OIcon name="help" size="xs" />
                <span>{{ t("alerts.alertSettings.helpLearnMore") }}</span>
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
                  <template #icon-left><OIcon name="title" size="sm" /></template>
                  String
                </OToggleGroupItem>
                <OToggleGroupItem value="Json" size="sm">
                  <template #icon-left><OIcon name="data-object" size="sm" /></template>
                  JSON
                </OToggleGroupItem>
              </OToggleGroup>
            </div>
          </div>
          <OTextarea
            data-test="add-alert-row-input-textarea"
            v-model="localRowTemplate"
            :placeholder="rowTemplatePlaceholder"
            :rows="4"
            @update:model-value="emitUpdate"
          />
        </div>
      </div>
    </div>
    <AlertSettingsHelpDrawer
      v-model:open="helpDrawerOpen"
      :topic="helpTopic"
      :templates="templates"
      :current-template="localTemplate || ''"
      :selected-destinations="selectedDestinations"
      :destinations="destinations"
      :context-attributes="localVariables"
      :row-template="localRowTemplate"
      :row-template-type="localRowTemplateType"
      :facts="previewFacts"
      :extra="previewExtra"
      @apply:template="onApplyTemplate"
    />
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  watch,
  type PropType,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getUUID } from "@/utils/zincutils";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AlertSettingsHelpDrawer from "@/components/alerts/AlertSettingsHelpDrawer.vue";

export interface Variable {
  id: string;
  key: string;
  value: string;
}

export default defineComponent({
  name: "Step6Advanced",
  components: { OToggleGroup, OToggleGroupItem, OButton, OIcon, OInput, OTextarea, OSelect, AlertSettingsHelpDrawer },
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
    destinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    selectedDestinations: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    alertName: {
      type: String,
      default: "",
    },
    streamName: {
      type: String,
      default: "",
    },
    streamType: {
      type: String,
      default: "",
    },
    triggerCondition: {
      type: Object as PropType<any>,
      default: () => ({}),
    },
    streamFields: {
      type: Array as PropType<any[]>,
      default: () => [],
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
    const localTemplate = ref<string | undefined>(props.template || undefined);
    const formattedTemplates = computed(() =>
      props.templates.map((t: any) => t.name),
    );
    const emitTemplateUpdate = () => {
      emit("update:template", localTemplate.value || "");
    };

    watch(
      () => props.template,
      (newVal) => {
        localTemplate.value = newVal || undefined;
      },
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

    const helpDrawerOpen = ref(false);
    const helpTopic = ref<"template" | "variables" | "rowTemplate">("template");
    const openHelp = (topic: "template" | "variables" | "rowTemplate") => {
      helpTopic.value = topic;
      helpDrawerOpen.value = true;
    };

    // Facts the preview can render truthfully from data the form already
    // holds — surfaced as "your data" (live) rather than chipped. Runtime-only
    // values (count, trigger time, rows) stay sample/opaque.
    const previewFacts = computed(() => ({
      alert_name: props.alertName,
      stream_name: props.streamName,
      stream_type: props.streamType,
      alert_operator: props.triggerCondition?.operator,
      alert_threshold: props.triggerCondition?.threshold,
      alert_period: props.triggerCondition?.period,
    }));

    // The user's typed context variables ({key} -> value) are real data → live.
    // Stream field NAMES are known but their runtime values are not, so they
    // are passed through and the composable keeps them opaque (not faked).
    const previewExtra = computed(() => ({
      contextVariables: localVariables.value.reduce(
        (acc: Record<string, string>, v: Variable) => {
          if (v.key) acc[v.key] = v.value;
          return acc;
        },
        {},
      ),
      streamFields: (props.streamFields || [])
        .map((c: any) => (typeof c === "string" ? c : c?.value))
        .filter((name: any): name is string => !!name),
    }));

    const onApplyTemplate = (name: string) => {
      localTemplate.value = name;
      emitTemplateUpdate();
    };

    return {
      t,
      store,
      localTemplate,
      formattedTemplates,
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
      helpDrawerOpen,
      helpTopic,
      openHelp,
      previewFacts,
      previewExtra,
      onApplyTemplate,
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
  gap: 0.5rem;
  font-size: 12px;
  font-weight: 600;
}

// "Learn more" help trigger — a clear, labeled, clickable affordance that
// opens the help drawer. Distinct from passive info tooltips elsewhere, so
// the click action is never ambiguous. Tighten the icon/label gap.
.help-learn-more {
  gap: 0.25rem;
  font-weight: 500;
}


</style>
