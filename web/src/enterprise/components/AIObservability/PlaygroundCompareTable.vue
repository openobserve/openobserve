<!-- Copyright 2026 OpenObserve Inc.

  Rows down, variants across. Deliberately verdict-free: no sorting, no deltas,
  no red or green. With n ≤ 10 and no scoring, ranking the columns would be a
  claim the bench cannot support — the footer points at experiments instead.
-->
<template>
  <div class="flex h-full min-h-0 flex-col">
    <!-- The template references no row field, so every row would produce the
         same answer. Informational here; the hard gate lives on Run. -->
    <OBanner
      v-if="zeroReference"
      variant="warning"
      dense
      icon="warning"
      inline-actions
      class="mx-4 mt-3 shrink-0"
      data-test="ai-playground-zero-ref-warning"
    >
      <span class="text-xs">
        {{ t("aiObservability.playground.zeroRefWarning", { count: draft.rows?.length ?? 0 }) }}
      </span>
      <template #actions>
        <OButton
          v-for="field in fields"
          :key="field"
          variant="outline"
          size="chip"
          :data-test="`ai-playground-insert-field-${field}`"
          @click="emit('insert-field', field)"
        >
          <span class="font-mono">{{ tokenFor(field) }}</span>
        </OButton>
      </template>
    </OBanner>

    <div class="min-h-0 flex-1 overflow-hidden px-4 pb-2">
      <OTable
        :data="tableRows"
        :columns="columns"
        row-key="id"
        :frame="false"
        class="h-full"
        data-test="ai-playground-compare-table"
        @row-click="onRowClick"
      >
        <template #[`cell-${INPUT_COLUMN}`]="{ row }">
          <div class="flex min-w-0 flex-col gap-1 py-1">
            <span class="text-text-body truncate text-xs">{{ row.input }}</span>
            <div class="flex flex-wrap items-center gap-1.5">
              <OTag
                variant="default"
                size="sm"
                :label="
                  row.source
                    ? raw(row.source.datasetName)
                    : t('aiObservability.playground.manualRow')
                "
                :data-test="`ai-playground-row-source-${row.id}`"
              />
              <span
                v-if="!row.expectedOutput"
                class="text-text-secondary text-2xs font-mono"
                :title="t('aiObservability.playground.noReferenceTooltip')"
              >
                {{ t("aiObservability.playground.noReference") }}
              </span>
            </div>
          </div>
        </template>

        <template
          v-for="variant in draft.variants"
          :key="`cell-${variant.id}`"
          #[`cell-${variant.id}`]="{ row }"
        >
          <PlaygroundOutputCell
            compact
            :cell="cellFor(variant.id, row.id)"
            :stale="variant.stale"
            :data-test="`ai-playground-cell-${variant.id}-${row.id}`"
            @retry="emit('run-variant', variant.id)"
          />
        </template>

        <template #[`cell-${ACTIONS_COLUMN}`]="{ row }">
          <OButton
            variant="ghost-muted"
            size="icon-xs"
            icon-left="close"
            :title="t('aiObservability.playground.removeRow')"
            :data-test="`ai-playground-remove-row-${row.id}`"
            @click.stop="emit('remove-row', row.id)"
          />
        </template>
      </OTable>
    </div>

    <div class="text-text-secondary text-2xs flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3">
      <OButton
        variant="ghost-primary"
        size="xs"
        :disabled="draft.variants.length >= MAX_VARIANTS || running"
        :title="
          draft.variants.length >= MAX_VARIANTS
            ? t('aiObservability.playground.variantLimit', { max: MAX_VARIANTS })
            : undefined
        "
        data-test="ai-playground-add-variant-btn"
        @click="emit('add-variant')"
      >
        {{ t("aiObservability.playground.addVariant") }}
        <span class="font-mono">
          {{
            t("aiObservability.playground.variantCount", {
              count: draft.variants.length,
              max: MAX_VARIANTS,
            })
          }}
        </span>
      </OButton>
      <span class="font-mono">
        {{ t("aiObservability.playground.rowFooter", { count: draft.rows?.length ?? 0 }) }}
      </span>
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="ai-playground-footer-experiment"
        @click="emit('create-experiment', draft.variants[0]?.id)"
      >
        {{ t("aiObservability.playground.rowFooterLink") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import PlaygroundOutputCell from "./PlaygroundOutputCell.vue";
import PlaygroundVariantHeader from "./PlaygroundVariantHeader.vue";
import {
  MAX_VARIANTS,
  cellAt,
  hasZeroFieldReference,
  rowFieldsFor,
  variantLabel,
  type PlaygroundDraft,
  type PlaygroundResults,
  type PlaygroundRow,
} from "@/enterprise/views/AIObservability/playgroundDraft";

const props = withDefaults(
  defineProps<{
    draft: PlaygroundDraft;
    results: PlaygroundResults;
    streamingVariants: string[];
    running?: boolean;
    runDisabled?: boolean;
  }>(),
  { running: false, runDisabled: false },
);

const emit = defineEmits<{
  "open-config": [variantId: string];
  "open-row": [index: number];
  "remove-row": [rowId: string];
  "add-variant": [];
  "run-variant": [variantId: string];
  "duplicate-variant": [variantId: string];
  "remove-variant": [variantId: string];
  "create-experiment": [variantId: string];
  "insert-field": [field: string];
}>();

const { t } = useI18nTyped();

const INPUT_COLUMN = "__input";
const ACTIONS_COLUMN = "__actions";

function tokenFor(name: string) {
  return `{{${name}}}`;
}

const fields = computed(() => rowFieldsFor(props.draft.rows));

const zeroReference = computed(() => hasZeroFieldReference(props.draft.variants, props.draft.rows));

const tableRows = computed<PlaygroundRow[]>(() => props.draft.rows ?? []);

function cellFor(variantId: string, rowKey: string) {
  return cellAt(props.results, variantId, rowKey);
}

/**
 * Columns are derived from the variants, so adding a column IS adding a
 * variant — there is no second list to keep in step.
 *
 * Nothing is sortable: no backend sort stands behind these rows, and ordering a
 * 10-row diagnostic grid answers no question the bench is asking.
 */
const columns = computed<OTableColumnDef[]>(() => [
  {
    id: INPUT_COLUMN,
    header: t("aiObservability.playground.inputColumn", { count: props.draft.rows?.length ?? 0 }),
    accessorKey: "input",
    size: 260,
    minSize: 180,
  },
  ...props.draft.variants.map((variant, index) => ({
    id: variant.id,
    // OTable has no header slot, so an interactive header is a render function
    // — the same shape PermissionsTable uses for its checkbox headers.
    header: () =>
      h(PlaygroundVariantHeader, {
        variant,
        label: variantLabel(index),
        compact: true,
        running: props.streamingVariants.includes(variant.id),
        runDisabled: props.runDisabled,
        canRemove: props.draft.variants.length > 1,
        canDuplicate: props.draft.variants.length < MAX_VARIANTS,
        "onOpen-config": () => emit("open-config", variant.id),
        onRun: () => emit("run-variant", variant.id),
        onDuplicate: () => emit("duplicate-variant", variant.id),
        onRemove: () => emit("remove-variant", variant.id),
        "onCreate-experiment": () => emit("create-experiment", variant.id),
      }),
    accessorFn: () => "",
    minSize: 220,
  })),
  {
    id: ACTIONS_COLUMN,
    header: raw(""),
    isAction: true,
    size: 44,
  },
]);

function onRowClick(row: PlaygroundRow) {
  const index = tableRows.value.findIndex((candidate) => candidate.id === row.id);
  if (index !== -1) emit("open-row", index);
}
</script>
