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
    class="step-advanced w-full"
  >
    <!-- DESCENDANT step (Rule ③): the AddAlert orchestrator owns the ONE <OForm>
         and provides FORM_CONTEXT_KEY. The OForm* fields below inject that form
         and bind by nested `name=` (template, context_attributes[i].*,
         description, row_template, row_template_type); the composed schema in
         AddAlert.schema.ts validates on save. -->
    <div>
    <div
      class="step-content rounded-default bg-surface-overlay border border-border-default"
    >
      <!-- Section header -->
      <div
        class="section-header flex items-center py-2.5 px-3 border-b border-border-default"
      >
        <div class="section-header-accent w-0.75 h-4 rounded-default mr-2 shrink-0 bg-theme-accent" />
        <span
          class="section-header-title text-compact font-semibold text-text-heading"
        >{{
          t("alerts.additional_settings")
        }}</span>
      </div>

      <div class="px-3 py-3 flex flex-col gap-4">
        <!-- Template Override -->
        <div>
          <div
            class="subsection-label flex items-center text-xs font-semibold mb-2 text-text-secondary"
          >
            <span>{{ t("alerts.template") }}</span>
            <OButton
              data-test="advanced-template-info-btn"
              variant="ghost-primary"
              size="xs"
              class="gap-1 font-medium"
              @click="openHelp('template')"
            >
              <OIcon name="help" size="xs" />
              <span>{{ t("alerts.alertSettings.helpLearnMore") }}</span>
            </OButton>
          </div>
          <div class="flex items-center gap-2">
            <OFormSelect
              name="template"
              :options="formattedTemplates"
              clearable
              :placeholder="t('alerts.advanced.selectTemplate')"
              class="min-w-60 max-w-75"
              data-test="advanced-template-override-select"
            >
              <template #empty>{{ t("alerts.advanced.noTemplatesAvailable") }}</template>
            </OFormSelect>
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
          <div
            class="subsection-label flex items-center text-xs font-semibold mb-2 text-text-secondary"
          >
            <span>{{ t("alerts.additionalVariables") }}</span>
            <OButton
              data-test="advanced-variables-info-btn"
              variant="ghost-primary"
              size="xs"
              class="gap-1 font-medium"
              @click="openHelp('variables')"
            >
              <OIcon name="help" size="xs" />
              <span>{{ t("alerts.alertSettings.helpLearnMore") }}</span>
            </OButton>
          </div>
          <template v-if="!variableRows.length">
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
            <!-- Rule ①: repeatable key/value rows are FORM-OWNED. Each row's
                 fields bind by INDEX-based `name=` (`context_attributes[i].*`),
                 so the v-for `:key` MUST be the array INDEX — a stable-id/uuid
                 `:key` would leave surviving rows bound to their OLD index after a
                 mid-list delete (inputs shift/blank while data stays correct).
                 Proven by the delete test in Advanced.spec.ts. -->
            <div
              v-for="(variable, index) in variableRows"
              :key="index"
              class="flex items-center gap-2 mb-2"
              :data-test="`alert-variables-${index + 1}`"
            >
              <OFormInput
                data-test="alert-variables-key-input"
                :name="`context_attributes[${index}].key`"
                :placeholder="t('common.name')"
                class="min-w-35"
              />
              <OFormInput
                data-test="alert-variables-value-input"
                :name="`context_attributes[${index}].value`"
                :placeholder="t('common.value')"
                class="min-w-50"
              />
              <OButton
                data-test="alert-variables-delete-variable-btn"
                variant="ghost"
                size="icon-circle-sm"
                @click="removeVariable(index)"
              >
                <OIcon name="delete-outline" size="sm" />
              </OButton>
              <OButton
                data-test="alert-variables-add-variable-btn"
                v-if="index === variableRows.length - 1"
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
          <div
            class="subsection-label flex items-center text-xs font-semibold mb-2 text-text-secondary"
          >
            <span>{{ t("alerts.description") }}</span>
          </div>
          <OFormTextarea
            name="description"
            :placeholder="t('alerts.placeholders.typeSomething')"
            :rows="4"
          />
        </div>

        <!-- Row Template -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <div
              class="subsection-label flex items-center text-xs font-semibold text-text-secondary"
            >
              <span>{{ t("alerts.row") }}</span>
              <OButton
                data-test="add-alert-row-input-info-btn"
                variant="ghost-primary"
                size="xs"
                class="gap-1 font-medium"
                @click="openHelp('rowTemplate')"
              >
                <OIcon name="help" size="xs" />
                <span>{{ t("alerts.alertSettings.helpLearnMore") }}</span>
              </OButton>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs opacity-60">{{
                t("alerts.advanced.templateType")
              }}</span>
              <OFormToggleGroup
                data-test="add-alert-row-template-type-toggle"
                name="row_template_type"
              >
                <OToggleGroupItem value="String" size="sm">
                  <template #icon-left><OIcon name="title" size="sm" /></template>
                  {{ t("alerts.advanced.templateTypeString") }}
                </OToggleGroupItem>
                <OToggleGroupItem value="Json" size="sm">
                  <template #icon-left><OIcon name="data-object" size="sm" /></template>
                  {{ t("alerts.advanced.templateTypeJson") }}
                </OToggleGroupItem>
              </OFormToggleGroup>
            </div>
          </div>
          <OFormTextarea
            data-test="add-alert-row-input-textarea"
            name="row_template"
            :placeholder="rowTemplatePlaceholder"
            :rows="4"
          />
        </div>
      </div>
    </div>
    </div>
    <AlertSettingsHelpDrawer
      v-model:open="helpDrawerOpen"
      :topic="helpTopic"
      :templates="templates"
      :current-template="templateValue || ''"
      :selected-destinations="selectedDestinations"
      :destinations="destinations"
      :context-attributes="variableRows"
      :row-template="rowTemplateValue"
      :row-template-type="rowTemplateTypeValue"
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
  inject,
  type PropType,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { getUUID } from "@/utils/zincutils";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import AlertSettingsHelpDrawer from "@/components/alerts/AlertSettingsHelpDrawer.vue";

export interface Variable {
  id: string;
  key: string;
  value: string;
}

export default defineComponent({
  name: "Step6Advanced",
  components: {
    OFormToggleGroup,
    OToggleGroupItem,
    OButton,
    OIcon,
    OFormInput,
    OFormTextarea,
    OFormSelect,
    AlertSettingsHelpDrawer,
  },
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
  setup(props) {
    const { t } = useI18n();
    const store = useStore();

    // DESCENDANT step (Rule ③): the AddAlert orchestrator provides
    // FORM_CONTEXT_KEY — this is the ONE form all reads/writes go through.
    const form: any = inject(FORM_CONTEXT_KEY, null);

    // ── Reactive form reads (single source of truth for preview + help
    //    drawer). ────────────────────────────────────────────────────────────
    const variableRows = form.useStore(
      (s: any) => (s.values?.context_attributes ?? []) as Variable[],
    );
    const templateValue = form.useStore(
      (s: any) => (s.values?.template ?? "") as string,
    );
    const descriptionValue = form.useStore(
      (s: any) => (s.values?.description ?? "") as string,
    );
    const rowTemplateValue = form.useStore(
      (s: any) => (s.values?.row_template ?? "") as string,
    );
    const rowTemplateTypeValue = form.useStore(
      (s: any) => (s.values?.row_template_type ?? "String") as string,
    );

    const formattedTemplates = computed(() =>
      props.templates.map((tpl: any) => tpl.name),
    );

    // NOTE: these two messages contain `{name}` / `{timestamp}` — END-USER row
    // template syntax, NOT i18n params. Their braces are escaped in en.json
    // (`{'{'}` / `{'}'}`) so vue-i18n emits them verbatim instead of trying to
    // interpolate them. Advanced.spec.ts asserts the rendered strings.
    const rowTemplatePlaceholder = computed(() => {
      return rowTemplateTypeValue.value === "Json"
        ? t("alerts.advanced.rowTemplatePlaceholderJson")
        : t("alerts.advanced.rowTemplatePlaceholderString");
    });

    // ── Field-array add/remove — mutate the form (Rule ①), never a local ref.
    //    The OForm* fields write their own values; no emit mirror is needed —
    //    the ONE form is the single source of truth. ───────────────────────────
    const addVariable = () => {
      form.pushFieldValue("context_attributes", {
        id: getUUID(),
        key: "",
        value: "",
      });
    };

    const removeVariable = (index: number) => {
      form.removeFieldValue("context_attributes", index);
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
      contextVariables: (variableRows.value || []).reduce(
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
      form.setFieldValue("template", name);
    };

    return {
      t,
      store,
      variableRows,
      templateValue,
      descriptionValue,
      rowTemplateValue,
      rowTemplateTypeValue,
      formattedTemplates,
      rowTemplatePlaceholder,
      addVariable,
      removeVariable,
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
