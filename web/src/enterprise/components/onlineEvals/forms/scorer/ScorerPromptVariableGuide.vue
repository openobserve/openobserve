<template>
  <section class="flex flex-col gap-2.5" data-test="scorer-form-prompt-variable-guide">
    <div class="flex flex-col gap-1.5">
      <!-- No "View Component" badge: that is internal architecture vocabulary
           and told the reader nothing about what the table is for. -->
      <div class="flex flex-wrap items-center gap-2">
        <strong class="text-xs font-semibold text-text-heading">
          {{ t("onlineEvals.scorer.promptVariableGuide.title") }}
        </strong>
        <!-- Same affordance as the Eval Job form: a Learn more that opens the
             reference in a side drawer, rather than expanding inline and
             pushing the prompt field down. -->
        <OButton
          type="button"
          variant="ghost-primary"
          size="xs"
          icon-left="help"
          class="ml-auto gap-1 font-medium"
          data-test="scorer-form-prompt-variable-learn-more"
          @click="detailOpen = true"
        >
          <span>{{ t("alerts.alertSettings.helpLearnMore") }}</span>
        </OButton>
      </div>

      <!-- The question this answers 99% of the time is "what can I type?", so
           the names lead. The per-scope matrix is reference material and stays
           collapsed until asked for. -->
      <div class="flex flex-wrap gap-1.5">
        <code
          v-for="variable in allVariables"
          :key="variable"
          class="rounded-default bg-surface-subtle px-1.5 py-0.5"
          :data-test="`scorer-form-prompt-variable-chip-${variable}`"
          >{{ formatTemplateVariable(variable) }}</code
        >
      </div>
    </div>

    <ODrawer
      v-model:open="detailOpen"
      :title="t('onlineEvals.scorer.promptVariableGuide.title')"
      size="lg"
      bleed
      data-test="scorer-form-prompt-variable-detail"
    >
      <!-- `bleed` drops ODrawer's body inset so the table runs edge to edge;
           the prose keeps the inset via the same tokens the drawer would have
           applied. Mirrors the Eval Job variables drawer. -->
      <div class="flex flex-col gap-3 py-dialog-content-py">
        <span class="px-dialog-content-px text-xs leading-relaxed text-text-secondary">
          {{ t("onlineEvals.scorer.promptVariableGuide.description") }}
        </span>

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
                class="rounded-default bg-surface-subtle px-1.5 py-0.5"
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

        <div class="px-dialog-content-px">
          <OBanner
            variant="info"
            icon="info"
            dense
            data-test="scorer-form-prompt-variable-index-note"
          >
            <span class="text-xs leading-relaxed">
              {{
                t("onlineEvals.scorer.promptVariableGuide.indexDescription", {
                  spansVar: formatTemplateVariable("spans"),
                  stepsVar: formatTemplateVariable("steps"),
                  indexedVar: formatTemplateVariable("spans[0]"),
                })
              }}
            </span>
          </OBanner>
        </div>
      </div>
    </ODrawer>
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, type PropType } from "vue";
import { useI18n } from "vue-i18n";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { formatTemplateVariable } from "../../utils/evalFormat";

type GuideScope = "span" | "trace" | "session";
type GuideStatus = "jobMapped" | "systemProvided" | "requiresSelector" | "unavailable";

interface GuideRow {
  key: "inputOutput" | "statistics" | "spans" | "steps";
  variables: string[];
  statuses: Record<GuideScope, GuideStatus>;
}

const { t } = useI18n();
const detailOpen = ref(false);

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

// Flattened for the chip row — the names are what the user types.
const allVariables = computed(() => guideRows.flatMap((row) => row.variables));

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
      const primaryStatus = status === "requiresSelector" ? "systemProvided" : status;
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
            () => t(`onlineEvals.scorer.promptVariableGuide.statuses.${primaryStatus}`),
          ),
          status === "requiresSelector"
            ? h(OTag, { variant: "warning-soft", size: "xs" }, () =>
                t("onlineEvals.scorer.promptVariableGuide.statuses.selectorRequired"),
              )
            : null,
        ]),
        h(
          "span",
          {
            class: "text-2xs leading-[1.4] text-text-secondary",
          },
          t(`onlineEvals.scorer.promptVariableGuide.variables.${props.row.key}.${props.scope}`),
        ),
      ]);
    };
  },
});
</script>
