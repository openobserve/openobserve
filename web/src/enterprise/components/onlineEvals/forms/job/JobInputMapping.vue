<template>
  <div class="flex flex-col gap-2.5">
    <div class="flex flex-col gap-0.5">
      <div class="flex flex-wrap items-center gap-1">
        <span
          class="text-compact leading-tight font-medium text-input-label-text"
          >{{ t("onlineEvals.job.inputMapping.title") }}</span
        >
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
          <span>{{ t("alerts.alertSettings.helpLearnMore") }}</span>
        </OButton>
      </div>
      <span class="text-xs text-input-help-text leading-none">{{
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
        <div class="flex flex-col gap-3 py-dialog-content-py">
          <span
            class="px-dialog-content-px text-xs leading-relaxed text-text-secondary"
          >
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
                class="w-fit max-w-full rounded-default bg-surface-subtle px-1.5 py-0.5"
                :data-test="`job-input-mapping-system-variable-${row.name}`"
                >{{ formatTemplateVariable(row.name) }}</code
              >
            </template>

            <template #cell-source="{ row }">
              <div class="flex flex-wrap items-center gap-1">
                <OTag variant="primary-soft" size="xs">
                  {{ t("onlineEvals.job.inputMapping.systemProvided.badge") }}
                </OTag>
                <OTag
                  v-if="row.name === 'spans'"
                  variant="warning-soft"
                  size="xs"
                >
                  {{
                    t(
                      "onlineEvals.job.inputMapping.systemProvided.selectorRequired",
                    )
                  }}
                </OTag>
              </div>
            </template>
          </OTable>
        </div>
      </ODrawer>
    </template>
    <div
      v-if="selectedScorers.length === 0"
      class="py-2.5 px-3 border border-dashed border-dialog-header-border rounded-default text-text-secondary text-xs text-center"
    >
      {{ t("onlineEvals.job.inputMapping.selectScorers") }}
    </div>
    <template v-else>
      <article
        v-for="scorer in selectedScorers"
        :key="entityId(scorer)"
        class="border border-dialog-header-border rounded-default bg-card-bg overflow-hidden"
      >
        <div
          class="flex items-center justify-between gap-3 py-2.5 px-3 border-b border-dialog-header-border"
        >
          <div class="flex flex-col gap-px min-w-0">
            <strong
              class="truncate text-compact font-semibold text-text-heading"
              >{{ scorer.name }}</strong
            >
            <small class="text-2xs text-text-secondary">{{
              t("onlineEvals.job.scorerPicker.meta", {
                type: scorerTypeOf(scorer).replace("_", " "),
                version: scorer.version,
              })
            }}</small>
          </div>
          <span
            class="shrink-0 text-2xs font-semibold text-text-secondary"
          >
            {{
              t("onlineEvals.job.inputMapping.variableCount", {
                count: variablesFor(scorer).length,
              })
            }}
          </span>
        </div>
        <!-- The binding is per SCORER, not per variable: the backend's
             validate_for_activation() requires one for EVERY trace scorer,
             whether or not its prompt uses {{ spans }}. Rendering it inside the
             `spans` row made it unreachable for scorers without that variable,
             so activation could be blocked with no way to satisfy it. -->
        <div
          v-if="targetScope === 'trace'"
          class="flex flex-col gap-1 border-b border-dialog-header-border py-2 px-3"
          :data-test="`job-input-mapping-span-selector-${entityId(scorer)}`"
        >
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="text-2xs font-semibold text-text-secondary">
              {{ t("onlineEvals.job.spanSelector.editorTitle") }}
              <span aria-hidden="true">*</span>
            </span>
            <SpanSelectorBinding
              :scorer-id="entityId(scorer)"
              :selectors="spanSelectors"
              :binding="spanSelectorBindings[entityId(scorer)]"
              :stream-fields="streamFields"
              @update:selectors="emit('update:spanSelectors', $event)"
              @update:binding="
                updateSpanSelectorBinding(entityId(scorer), $event)
              "
            />
          </div>
          <!-- Required with no explanation is why this read as arbitrary: say
               what a selector does and why a trace needs one. -->
          <span class="text-2xs leading-[1.4] text-text-secondary">
            {{ t("onlineEvals.job.spanSelector.bindingHelp") }}
          </span>
        </div>

        <div
          v-if="variablesFor(scorer).length"
          class="grid gap-1.5 py-2.5 px-3"
        >
          <div
            v-for="variable in variablesFor(scorer)"
            :key="`${entityId(scorer)}-${variable}`"
            class="grid grid-cols-[minmax(8.125rem,0.35fr)_minmax(0,1fr)] items-start gap-2.5"
          >
            <code
              class="mt-0.5 truncate overflow-hidden rounded-default bg-surface-subtle px-2 py-1.25"
              >{{ formatTemplateVariable(variable) }}</code
            >
            <div
              v-if="isSystemProvided(variable)"
              class="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 px-1 py-1.5"
              :data-test="`job-input-mapping-system-provided-${entityId(scorer)}-${variable}`"
            >
              <!-- Auto-filled rows stay quiet: an icon plus where the value
                   comes from. A badge on every row shouted the one thing that
                   is true of most rows, which is what made the list read as
                   noise rather than as a list. `spans` reads the same way — the
                   selector that fills it is bound once per scorer above. -->
              <OIcon name="bolt" size="xs" class="shrink-0 text-text-tertiary" />
              <span class="text-2xs leading-[1.4] text-text-secondary">
                {{ systemProvidedDescription(variable) }}
              </span>
            </div>
            <OInput
              v-else
              class="group min-w-0 font-mono"
              size="sm"
              :model-value="inputMappings[entityId(scorer)]?.[variable] || ''"
              :placeholder="defaultJobMappingValue(variable)"
              :data-test="`job-input-mapping-input-${entityId(scorer)}-${variable}`"
              @update:model-value="
                updateMapping(entityId(scorer), variable, String($event ?? ''))
              "
            >
              <template #icon-right>
                <OButton
                  type="button"
                  variant="ghost-muted"
                  size="icon-chip"
                  icon-left="content-copy"
                  class="pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                  :aria-label="t('common.copy')"
                  :title="t('common.copy')"
                  :data-test="`job-input-mapping-copy-${entityId(scorer)}-${variable}`"
                  @click="copyMapping(entityId(scorer), variable)"
                />
              </template>
            </OInput>
          </div>
        </div>
        <div
          v-else
          class="py-2.5 px-3 border border-dashed border-dialog-header-border rounded-default text-text-secondary text-xs text-center"
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
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import type {
  EvalTargetScope,
  Scorer,
  SpanSelector,
} from "@/services/online-evals.service";
import { copyToClipboard } from "@/utils/clipboard";
import { entityId, scorerTypeOf } from "../../utils/evalEntity";
import { formatTemplateVariable } from "../../utils/evalFormat";
import {
  defaultJobMappingValue,
  jobMappingVariablesForScorer,
} from "../../utils/jobMappings";
import {
  isSystemProvidedVariable,
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
  (
    e: "update:inputMappings",
    value: Record<string, Record<string, string>>,
  ): void;
  (e: "update:spanSelectors", value: SpanSelector[]): void;
  (e: "update:spanSelectorBindings", value: Record<string, string>): void;
}>();

const { t } = useI18n();
const systemVariablesDrawerOpen = ref(false);
const targetScopeName = computed(() =>
  t(`onlineEvals.job.targetScopes.${props.targetScope}`),
);
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
const systemProvidedVariables = computed(() =>
  systemProvidedVariablesForScope(props.targetScope),
);
const systemProvidedColumns = computed<
  OTableColumnDef<SystemProvidedVariable>[]
>(() => [
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
    header: t(
      "onlineEvals.job.inputMapping.systemProvided.columns.description",
    ),
    accessorFn: (row) =>
      t(
        `onlineEvals.job.inputMapping.systemProvided.variables.${row.name}.${props.targetScope}`,
      ),
    size: 360,
    minSize: 240,
    meta: { align: "left", autoWidth: true },
  },
]);

function isSystemProvided(variable: string) {
  return isSystemProvidedVariable(props.targetScope, variable);
}

function systemProvidedDescription(variable: string) {
  return t(
    `onlineEvals.job.inputMapping.systemProvided.variables.${variable}.${props.targetScope}`,
  );
}

function variablesFor(scorer: Scorer) {
  return jobMappingVariablesForScorer(
    scorer,
    props.inputMappings[entityId(scorer)],
  );
}

function copyMapping(scorerId: string, variable: string) {
  const value =
    props.inputMappings[scorerId]?.[variable] ||
    defaultJobMappingValue(variable);
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
