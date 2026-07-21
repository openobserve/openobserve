<template>
  <section
    class="flex flex-col gap-2.5"
    data-test="scorer-form-prompt-variable-guide"
  >
    <div class="flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-2">
        <strong class="text-xs font-semibold text-text-heading">
          {{ t("onlineEvals.scorer.promptVariableGuide.title") }}
        </strong>
        <OTag variant="primary-soft" size="xs">
          {{ t("onlineEvals.scorer.promptVariableGuide.viewComponentBadge") }}
        </OTag>
      </div>
      <span class="text-2xs leading-[1.45] text-text-secondary">
        {{ t("onlineEvals.scorer.promptVariableGuide.description") }}
      </span>
    </div>

    <div class="overflow-hidden rounded-default border border-border-default">
      <OTable
        data-test="scorer-form-prompt-variable-table"
        :data="guideRows"
        :columns="columns"
        row-key="key"
        pagination="none"
        sorting="none"
        selection="none"
        :show-global-filter="false"
        :default-columns="false"
        :fill-height="false"
        :frame="false"
        :sticky-header="false"
        :dense="false"
        wrap
      >
        <template #cell-variable="{ row }">
          <div
            class="flex flex-wrap gap-1.5"
            :data-test="`scorer-form-prompt-variable-${row.key}`"
          >
            <code
              v-for="variable in row.variables"
              :key="variable"
              class="rounded-default bg-surface-subtle px-1.5 py-0.5 font-mono text-2xs font-semibold text-text-heading"
              >{{ formatTemplateVariable(variable) }}</code
            >
          </div>
        </template>

        <template #cell-span="{ row }">
          <ScopeCell :row="row" scope="span" />
        </template>

        <template #cell-trace="{ row }">
          <ScopeCell :row="row" scope="trace" />
        </template>

        <template #cell-session="{ row }">
          <ScopeCell :row="row" scope="session" />
        </template>
      </OTable>
    </div>

    <OBanner
      variant="info"
      icon="info"
      dense
      data-test="scorer-form-prompt-variable-index-note"
    >
      <span class="text-2xs leading-[1.45]">
        {{
          t("onlineEvals.scorer.promptVariableGuide.indexDescription", {
            spansVar: formatTemplateVariable("spans"),
            stepsVar: formatTemplateVariable("steps"),
            indexedVar: formatTemplateVariable("spans[0]"),
          })
        }}
      </span>
    </OBanner>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { formatTemplateVariable } from "../../utils/evalFormat";

type GuideScope = "span" | "trace" | "session";
type GuideStatus =
  | "jobMapped"
  | "systemProvided"
  | "requiresSelector"
  | "unavailable";

interface GuideRow {
  key: "inputOutput" | "statistics" | "spans" | "steps";
  variables: string[];
  statuses: Record<GuideScope, GuideStatus>;
}

const { t } = useI18n();

const guideRows: GuideRow[] = [
  {
    key: "inputOutput",
    variables: ["input", "output"],
    statuses: {
      span: "jobMapped",
      trace: "systemProvided",
      session: "unavailable",
    },
  },
  {
    key: "statistics",
    variables: ["statistics"],
    statuses: {
      span: "jobMapped",
      trace: "systemProvided",
      session: "systemProvided",
    },
  },
  {
    key: "spans",
    variables: ["spans"],
    statuses: {
      span: "jobMapped",
      trace: "requiresSelector",
      session: "unavailable",
    },
  },
  {
    key: "steps",
    variables: ["steps"],
    statuses: {
      span: "jobMapped",
      trace: "systemProvided",
      session: "systemProvided",
    },
  },
];

const columns = computed<OTableColumnDef<GuideRow>[]>(() => [
  {
    id: "variable",
    header: t("onlineEvals.scorer.promptVariableGuide.columns.variable"),
    accessorKey: "key",
    size: 160,
    minSize: 140,
    meta: { align: "left", isName: true, cellClass: "align-top" },
  },
  ...(["span", "trace", "session"] as GuideScope[]).map((scope) => ({
    id: scope,
    header: t(`onlineEvals.scorer.promptVariableGuide.scopes.${scope}`),
    accessorFn: (row: GuideRow) => row.statuses[scope],
    size: 240,
    minSize: 180,
    meta: {
      align: "left" as const,
      autoWidth: true,
      cellClass: "align-top",
    },
  })),
]);

const ScopeCell = defineComponent({
  props: {
    row: {
      type: Object as PropType<GuideRow>,
      required: true,
    },
    scope: {
      type: String as PropType<GuideScope>,
      required: true,
    },
  },
  setup(props) {
    return () => {
      const status = props.row.statuses[props.scope];
      const primaryStatus =
        status === "requiresSelector" ? "systemProvided" : status;
      const statusVariant =
        primaryStatus === "systemProvided"
          ? "primary-soft"
          : primaryStatus === "jobMapped"
            ? "default-soft"
            : "default-outline";

      return h("div", { class: "flex flex-col gap-1.5 py-1" }, [
        h("div", { class: "flex flex-wrap items-center gap-1" }, [
          h(
            OTag,
            {
              variant: statusVariant,
              size: "xs",
              disabled: primaryStatus === "unavailable",
            },
            () =>
              t(
                `onlineEvals.scorer.promptVariableGuide.statuses.${primaryStatus}`,
              ),
          ),
          status === "requiresSelector"
            ? h(OTag, { variant: "warning-soft", size: "xs" }, () =>
                t(
                  "onlineEvals.scorer.promptVariableGuide.statuses.selectorRequired",
                ),
              )
            : null,
        ]),
        h(
          "span",
          {
            class: "text-2xs leading-[1.4] text-text-secondary",
          },
          t(
            `onlineEvals.scorer.promptVariableGuide.variables.${props.row.key}.${props.scope}`,
          ),
        ),
      ]);
    };
  },
});
</script>
