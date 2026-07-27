<template>
  <div class="flex flex-col gap-2.5">
    <div class="flex flex-col gap-0.5">
      <div class="flex flex-wrap items-center gap-1">
        <span class="text-compact text-input-label-text leading-tight font-medium">{{
          t("onlineEvals.job.inputMapping.title")
        }}</span>
        <OButton
          v-if="systemProvidedVariables.length"
          data-test="job-input-mapping-system-variables-learn-more"
          type="button"
          variant="ghost-primary"
          size="xs"
          icon-left="help"
          class="gap-1 font-medium"
          @click="systemVariablesDrawerOpen = true"
        >
          <span>{{ t("onlineEvals.job.inputMapping.systemProvided.about") }}</span>
        </OButton>
      </div>
      <span class="text-input-help-text text-xs leading-none">{{
        t(`onlineEvals.job.inputMapping.hint.${targetScope}`)
      }}</span>
    </div>
    <!-- Overlay only — deliberately not wrapped in a layout element, so it
         doesn't claim a row (and a gap) in this flex column. -->
    <template v-if="systemProvidedVariables.length">
      <ODrawer
        v-model:open="systemVariablesDrawerOpen"
        data-test="job-input-mapping-system-variables-drawer"
        :title="systemProvidedTitle"
        size="lg"
        bleed
      >
        <!-- `bleed` drops ODrawer's body inset so the table runs edge to edge.
             The vertical rhythm and the prose inset are re-applied with the
             same tokens the drawer would have used, so only the table bleeds. -->
        <div class="py-dialog-content-py flex flex-col gap-3">
          <span class="px-dialog-content-px text-text-secondary text-xs leading-relaxed">
            {{ systemProvidedDescriptionText }}
          </span>

          <OTable
            data-test="job-input-mapping-system-variables-table"
            :data="systemProvidedVariables"
            :columns="systemProvidedColumns"
            row-key="name"
            pagination="none"
            sorting="none"
            selection="none"
            :show-global-filter="false"
            :default-columns="false"
            :fill-height="false"
            :frame="false"
            :sticky-header="false"
            dense
            wrap
          >
            <template #cell-variable="{ row }">
              <code
                class="rounded-default bg-surface-subtle w-fit max-w-full px-1.5 py-0.5"
                :data-test="`job-input-mapping-system-variable-${row.name}`"
                >{{ row.name }}</code
              >
            </template>

            <template #cell-source="{ row }">
              <div class="flex flex-wrap items-center gap-1">
                <OTag variant="primary-soft" size="xs">
                  {{ t("onlineEvals.job.inputMapping.systemProvided.badge") }}
                </OTag>
                <OTag v-if="row.name === 'spans'" variant="warning-soft" size="xs">
                  {{ t("onlineEvals.job.inputMapping.systemProvided.selectorRequired") }}
                </OTag>
              </div>
            </template>
          </OTable>
        </div>
      </ODrawer>
    </template>
    <div
      v-if="selectedScorers.length === 0"
      class="border-dialog-header-border rounded-default text-text-secondary border border-dashed px-3 py-2.5 text-center text-xs"
    >
      {{ t("onlineEvals.job.inputMapping.selectScorers") }}
    </div>
    <template v-else>
      <article
        v-for="scorer in selectedScorers"
        :key="entityId(scorer)"
        class="border-dialog-header-border rounded-default bg-card-bg overflow-hidden border"
      >
        <div
          class="border-dialog-header-border flex items-center justify-between gap-3 border-b px-3 py-2.5"
        >
          <div class="flex min-w-0 flex-col gap-px">
            <strong class="text-compact text-text-heading truncate font-semibold">{{
              scorer.name
            }}</strong>
            <small class="text-2xs text-text-secondary">{{
              t("onlineEvals.job.scorerPicker.meta", {
                type: scorerTypeOf(scorer).replace("_", " "),
                version: scorer.version,
              })
            }}</small>
          </div>
          <span class="text-2xs text-text-secondary shrink-0 font-semibold">
            {{
              t("onlineEvals.job.inputMapping.variableCount", {
                count: variablesFor(scorer).length,
              })
            }}
          </span>
        </div>
        <div
          v-if="targetScope === 'trace' && scorerUsesSpans(scorer, inputMappings[entityId(scorer)])"
          class="border-dialog-header-border flex flex-col gap-1 border-b px-3 py-2"
          :data-test="`job-input-mapping-span-selector-${entityId(scorer)}`"
        >
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="text-2xs text-text-secondary font-semibold">
              {{ t("onlineEvals.job.spanSelector.editorTitle") }}
              <span aria-hidden="true">*</span>
            </span>
            <SpanSelectorBinding
              :scorer-id="entityId(scorer)"
              :selectors="spanSelectors"
              :binding="spanSelectorBindings[entityId(scorer)]"
              :stream-fields="streamFields"
              @update:selectors="emit('update:spanSelectors', $event)"
              @update:binding="updateSpanSelectorBinding(entityId(scorer), $event)"
            />
          </div>
          <span class="text-2xs text-text-secondary leading-[1.4]">
            {{ t("onlineEvals.job.spanSelector.bindingHelp") }}
          </span>
        </div>

        <div v-if="variablesFor(scorer).length" class="grid gap-1.5 px-3 py-2.5">
          <div
            v-for="variable in variablesFor(scorer)"
            :key="`${entityId(scorer)}-${variable}`"
            class="grid grid-cols-[minmax(8.125rem,0.35fr)_minmax(0,1fr)] items-center gap-2.5"
            :data-test="`job-input-mapping-row-${entityId(scorer)}-${variable}`"
          >
            <code class="rounded-default bg-surface-subtle truncate overflow-hidden px-2 py-1.25">{{
              formatTemplateVariable(variable)
            }}</code>
            <div class="flex min-w-0 items-center gap-1.5">
              <OSelect
                class="min-w-0 flex-1"
                size="sm"
                searchable
                :options="mappingOptions"
                :model-value="inputMappings[entityId(scorer)]?.[variable] || ''"
                :placeholder="t('onlineEvals.job.inputMapping.placeholder')"
                :search-placeholder="t('onlineEvals.job.inputMapping.searchPlaceholder')"
                :data-test="`job-input-mapping-select-${entityId(scorer)}-${variable}`"
                @update:model-value="
                  updateMapping(entityId(scorer), variable, String($event ?? ''))
                "
              />
              <OButton
                type="button"
                variant="ghost-muted"
                size="icon-chip"
                icon-left="content-copy"
                :aria-label="t('common.copy')"
                :title="t('common.copy')"
                :data-test="`job-input-mapping-copy-${entityId(scorer)}-${variable}`"
                @click="copyMapping(entityId(scorer), variable)"
              />
            </div>
          </div>
        </div>
        <div
          v-else
          class="border-dialog-header-border rounded-default text-text-secondary border border-dashed px-3 py-2.5 text-center text-xs"
        >
          {{ t("onlineEvals.job.inputMapping.noVariables") }}
        </div>
      </article>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import type { EvalTargetScope, Scorer, SpanSelector } from "@/services/online-evals.service";
import { copyToClipboard } from "@/utils/clipboard";
import { DEFAULT_JOB_STREAM_FIELDS } from "../../utils/defaultStreamFields";
import { entityId, scorerTypeOf } from "../../utils/evalEntity";
import { formatTemplateVariable } from "../../utils/evalFormat";
import {
  defaultJobMappingValue,
  jobMappingVariablesForScorer,
  scorerUsesSpans,
} from "../../utils/jobMappings";
import {
  systemProvidedVariablesForScope,
  type SystemProvidedVariable,
} from "../../utils/systemProvidedVariables";
import SpanSelectorBinding from "./SpanSelectorBinding.vue";

const props = withDefaults(
  defineProps<{
    targetScope: EvalTargetScope;
    selectedScorers: Scorer[];
    inputMappings: Record<string, Record<string, string>>;
    spanSelectors?: SpanSelector[];
    spanSelectorBindings?: Record<string, string>;
    streamFields?: Array<{ label: string; value: string; type: string }>;
  }>(),
  {
    spanSelectors: () => [],
    spanSelectorBindings: () => ({}),
    streamFields: () => [],
  },
);

const emit = defineEmits<{
  (e: "update:inputMappings", value: Record<string, Record<string, string>>): void;
  (e: "update:spanSelectors", value: SpanSelector[]): void;
  (e: "update:spanSelectorBindings", value: Record<string, string>): void;
}>();

const { t } = useI18n();
const systemVariablesDrawerOpen = ref(false);
const targetScopeName = computed(() => t(`onlineEvals.job.targetScopes.${props.targetScope}`));
const systemProvidedTitle = computed(() =>
  t("onlineEvals.job.inputMapping.systemProvided.title", {
    scope: targetScopeName.value,
  }),
);
// Lower-cased mid-sentence ("…from the trace itself"), unlike the title where
// the scope leads the phrase.
const systemProvidedDescriptionText = computed(() =>
  t("onlineEvals.job.inputMapping.systemProvided.description", {
    scope: targetScopeName.value.toLowerCase(),
  }),
);
const systemProvidedVariables = computed(() => systemProvidedVariablesForScope(props.targetScope));
const mappingStreamFields = computed(() =>
  props.streamFields.length ? props.streamFields : DEFAULT_JOB_STREAM_FIELDS,
);
const mappingOptions = computed<SelectOption[]>(() => {
  const options: SelectOption[] = [];
  const systemValues = new Set<string>();

  if (systemProvidedVariables.value.length) {
    options.push({
      label: t("onlineEvals.job.inputMapping.groups.systemProvided", {
        scope: targetScopeName.value.toLowerCase(),
      }),
      header: true,
    });
    systemProvidedVariables.value.forEach(({ name }) => {
      const value = mappingExpression(name);
      systemValues.add(value);
      options.push({
        label: name,
        value,
      });
    });
  }

  const seenAttributes = new Set<string>();
  const attributeOptions = mappingStreamFields.value.flatMap((field) => {
    const value = mappingExpression(field.value);
    if (systemValues.has(value) || seenAttributes.has(value)) return [];
    seenAttributes.add(value);
    return [{ label: field.label, value }];
  });

  if (attributeOptions.length) {
    options.push({
      label: t("onlineEvals.job.inputMapping.groups.spanAttributes"),
      header: true,
    });
    options.push(...attributeOptions);
  }

  return options;
});
const systemProvidedColumns = computed<OTableColumnDef<SystemProvidedVariable>[]>(() => [
  {
    id: "variable",
    header: t("onlineEvals.job.inputMapping.systemProvided.columns.variable"),
    accessorKey: "name",
    size: 170,
    minSize: 145,
    meta: { align: "left", isName: true },
  },
  {
    id: "source",
    header: t("onlineEvals.job.inputMapping.systemProvided.columns.source"),
    accessorFn: () => "systemProvided",
    size: 200,
    minSize: 175,
    meta: { align: "left" },
  },
  {
    id: "description",
    header: t("onlineEvals.job.inputMapping.systemProvided.columns.description"),
    accessorFn: (row) =>
      t(`onlineEvals.job.inputMapping.systemProvided.variables.${row.name}.${props.targetScope}`),
    size: 360,
    minSize: 240,
    meta: { align: "left", autoWidth: true },
  },
]);

function variablesFor(scorer: Scorer) {
  return jobMappingVariablesForScorer(scorer, props.inputMappings[entityId(scorer)]);
}

function mappingExpression(source: string) {
  return `{{${source.trim()}}}`;
}

function copyMapping(scorerId: string, variable: string) {
  const value =
    props.inputMappings[scorerId]?.[variable] ||
    defaultJobMappingValue(variable, props.targetScope);
  void copyToClipboard(value, {
    successMessage: t("common.copySuccess"),
  });
}

function updateMapping(scorerId: string, variable: string, value: string) {
  emit("update:inputMappings", {
    ...props.inputMappings,
    [scorerId]: {
      ...(props.inputMappings[scorerId] || {}),
      [variable]: value,
    },
  });
}

function updateSpanSelectorBinding(scorerId: string, selectorId: string) {
  const bindings = { ...props.spanSelectorBindings };
  if (selectorId) bindings[scorerId] = selectorId;
  else delete bindings[scorerId];
  emit("update:spanSelectorBindings", bindings);
}
</script>
