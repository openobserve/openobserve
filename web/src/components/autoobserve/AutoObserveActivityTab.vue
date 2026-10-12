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
  <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-test="autoobserve-activity">
    <div
      class="border-border-default px-page-edge flex shrink-0 flex-wrap items-center gap-2 border-b py-2"
      data-test="autoobserve-activity-toolbar"
    >
      <OToggleGroup
        :model-value="chip"
        :aria-label="t('autoobserve.activity.outcomeFilter')"
        mobile-dropdown
        class="rounded-full!"
        data-test="autoobserve-activity-status"
        @update:model-value="(v) => v && (chip = v as ChipFilter)"
      >
        <OToggleGroupItem
          v-for="c in CHIPS"
          :key="c"
          :value="c"
          size="sm"
          class="rounded-full! px-3!"
          :disabled="!counts[c] && c !== chip"
          :data-test="`autoobserve-activity-chip-${c}`"
        >
          <span
            v-if="CHIP_DOT[c]"
            class="size-1.5 shrink-0 rounded-full"
            :class="CHIP_DOT[c]"
            aria-hidden="true"
          />
          {{ t(CHIP_LABEL[c]) }}
          <span class="font-semibold tabular-nums">{{ counts[c] }}</span>
        </OToggleGroupItem>
      </OToggleGroup>
      <OToggleGroup
        mobile-dropdown
        :model-value="loop"
        :aria-label="t('autoobserve.activity.loopFilter')"
        class="ms-auto"
        data-test="autoobserve-activity-loop"
        @update:model-value="(v) => (loop = v as Loop | 'all')"
      >
        <OToggleGroupItem value="all" size="sm">{{
          t("autoobserve.activity.allLoops")
        }}</OToggleGroupItem>
        <OToggleGroupItem v-for="l in LOOPS" :key="l" :value="l" size="sm">
          {{ t(LOOP_LABEL[l]) }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>
    <div
      class="px-page-edge border-table-row-divider flex shrink-0 items-center gap-2 border-b py-1.5"
    >
      <OIcon name="history" size="sm" class="text-text-secondary shrink-0" />
      <span class="text-text-secondary text-xs">{{ t("autoobserve.activity.ledgerHint") }}</span>
    </div>
    <p class="sr-only" role="status" data-test="autoobserve-activity-announce">
      {{ announcement }}
    </p>

    <OContent y class="min-h-0 min-w-0 flex-1 overflow-auto">
      <div
        v-if="groups.length"
        class="border-border-subtle rounded-surface bg-surface-base relative overflow-x-auto border"
      >
        <table class="w-full min-w-[60rem] border-collapse text-sm" data-test="autoobserve-ledger">
          <caption class="sr-only">
            {{
              t("autoobserve.activity.ledgerHint")
            }}
          </caption>
          <thead>
            <tr class="border-table-row-divider bg-table-header-bg border-b">
              <th
                v-for="col in COLUMNS"
                :key="col"
                scope="col"
                class="text-table-header-text text-2xs px-1.5 py-1.5 text-start font-medium tracking-wide whitespace-nowrap uppercase first:ps-3"
                :class="col === 'actions' ? 'text-end' : ''"
              >
                <span :class="col === 'actions' ? 'sr-only' : ''">{{ t(COLUMN_LABEL[col]) }}</span>
              </th>
            </tr>
          </thead>
          <tbody v-for="group in groups" :key="group.key">
            <tr v-if="group.label">
              <th
                :colspan="COLUMNS.length"
                scope="colgroup"
                class="bg-surface-panel border-table-row-divider border-b px-3 py-1 text-start text-xs font-medium"
                :class="group.key === 'pending' ? 'text-status-warning-text' : 'text-text-body'"
                :data-test="`autoobserve-activity-group-${group.key}`"
              >
                <span class="inline-flex items-center gap-1.5">
                  <OIcon
                    v-if="group.key === 'pending'"
                    name="schedule"
                    size="xs"
                    aria-hidden="true"
                  />
                  {{ group.label }}
                  <span class="text-text-secondary tabular-nums">· {{ group.rows.length }}</span>
                </span>
              </th>
            </tr>
            <template v-for="row in group.rows" :key="row.entry.id">
              <tr
                class="border-table-row-divider hover:bg-table-row-hover-bg cursor-pointer border-b transition-colors duration-500"
                :class="[
                  flashId === row.entry.id ? 'bg-table-highlight-bg' : '',
                  expanded[row.entry.id] ? 'bg-table-row-expanded-bg' : '',
                ]"
                :data-test="`autoobserve-ledger-${row.entry.id}`"
                @click="onRowClick($event, row.entry.id)"
              >
                <td
                  class="border-s-4 py-2 ps-2.5 pe-2 align-middle whitespace-nowrap"
                  :class="LOOP_RAIL[row.entry.loop]"
                >
                  <span class="text-text-body text-xs tabular-nums">{{ whenOf(row) }}</span>
                </td>
                <td class="px-1.5 py-2 align-middle whitespace-nowrap">
                  <OTag
                    :variant="LOOP_VARIANT[row.entry.loop]"
                    size="xs"
                    :label="t(LOOP_LABEL[row.entry.loop])"
                  />
                </td>
                <td class="px-1.5 py-2 align-middle whitespace-nowrap">
                  <OText variant="mono" class="text-text-heading text-xs">{{
                    row.entry.actionClass
                  }}</OText>
                </td>
                <td class="px-1.5 py-2 align-middle">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span
                      class="text-text-body block max-w-[9rem] truncate text-xs"
                      :title="row.entry.target"
                      >{{ row.entry.target }}</span
                    >
                    <span
                      v-if="row.entry.userBuilt"
                      class="border-border-default text-text-secondary inline-flex size-5 shrink-0 items-center justify-center rounded-full border"
                      :title="t('autoobserve.activity.userBuilt')"
                      :data-test="`autoobserve-ledger-${row.entry.id}-user-built`"
                    >
                      <OIcon name="person" size="xs" aria-hidden="true" />
                      <span class="sr-only">{{ t("autoobserve.activity.userBuilt") }}</span>
                    </span>
                  </span>
                </td>
                <td class="px-1.5 py-2 align-middle">
                  <span
                    class="block max-w-[10rem] truncate text-xs whitespace-nowrap"
                    :title="shiftText(row.entry)"
                  >
                    <span class="text-text-secondary line-through">{{
                      t(entryKey(row.entry.id, "from"))
                    }}</span>
                    <OIcon
                      name="arrow-forward"
                      size="xs"
                      class="text-text-muted mx-1 align-middle"
                      aria-hidden="true"
                    />
                    <span class="sr-only">{{ t("autoobserve2.needs.shiftTo") }}</span>
                    <span class="text-text-heading font-medium">{{
                      t(entryKey(row.entry.id, "to"))
                    }}</span>
                  </span>
                </td>
                <td class="px-1.5 py-2 align-middle whitespace-nowrap">
                  <span :title="confidenceHint(row.entry)">
                    <OTag
                      variant="default-soft"
                      size="xs"
                      :label="t(CONFIDENCE_LABEL[row.entry.confidence])"
                      aria-hidden="true"
                    />
                    <span class="sr-only">{{ confidenceHint(row.entry) }}</span>
                  </span>
                </td>
                <td class="text-text-secondary px-1.5 py-2 align-middle text-xs whitespace-nowrap">
                  <span
                    v-if="row.entry.status === 'awaiting'"
                    class="text-text-muted"
                    aria-hidden="true"
                    >—</span
                  >
                  <template v-else>{{ modeLabel(row.entry) }}</template>
                </td>
                <td class="px-1.5 py-2 align-middle whitespace-nowrap">
                  <span class="inline-flex items-center gap-1.5">
                    <OTag
                      :variant="OUTCOME_LOOK[row.outcome].variant"
                      :icon="OUTCOME_LOOK[row.outcome].icon"
                      size="xs"
                      :label="outcomeLabel(row)"
                      :data-test="`autoobserve-ledger-${row.entry.id}-outcome`"
                    />
                    <OButton
                      v-if="row.incidentId"
                      variant="ghost-primary"
                      size="xs"
                      class="font-mono"
                      :aria-label="t('autoobserve.activity.openIncident', { id: row.incidentId })"
                      :data-test="`autoobserve-ledger-${row.entry.id}-incident`"
                      @click="emit('open-incident', row.incidentId)"
                    >
                      {{ row.incidentId }}
                    </OButton>
                  </span>
                </td>
                <td class="py-1.5 ps-1.5 pe-2 align-middle whitespace-nowrap">
                  <span class="flex items-center justify-end gap-1">
                    <template v-if="row.entry.status === 'awaiting' && editing !== row.entry.id">
                      <OButton
                        variant="ghost-destructive"
                        size="xs"
                        :aria-label="t('autoobserve.activity.rejectFor', actionOf(row.entry))"
                        :data-test="`autoobserve-ledger-${row.entry.id}-reject`"
                        @click="reject(row.entry)"
                      >
                        {{ t("autoobserve.activity.reject") }}
                      </OButton>
                      <OButton
                        variant="outline"
                        size="icon-xs"
                        :title="t('autoobserve.activity.edit')"
                        :aria-label="t('autoobserve.activity.editFor', actionOf(row.entry))"
                        :data-test="`autoobserve-ledger-${row.entry.id}-edit`"
                        @click="startEdit(row.entry)"
                      >
                        <OIcon name="edit" size="sm" aria-hidden="true" />
                      </OButton>
                      <OButton
                        variant="primary"
                        size="xs"
                        :aria-label="t('autoobserve.activity.approveFor', actionOf(row.entry))"
                        :data-test="`autoobserve-ledger-${row.entry.id}-approve`"
                        @click="approve(row.entry)"
                      >
                        {{ t("autoobserve.activity.approve") }}
                      </OButton>
                    </template>
                    <OButton
                      :id="toggleId(row.entry.id)"
                      variant="ghost-muted"
                      size="icon-xs"
                      :aria-expanded="!!expanded[row.entry.id]"
                      :aria-controls="detailId(row.entry.id)"
                      :aria-label="
                        t(
                          expanded[row.entry.id]
                            ? 'autoobserve.activity.hideDetails'
                            : 'autoobserve.activity.showDetails',
                          actionOf(row.entry),
                        )
                      "
                      :data-test="`autoobserve-ledger-${row.entry.id}-toggle`"
                      @click="toggle(row.entry.id)"
                    >
                      <OIcon
                        name="chevron-right"
                        size="sm"
                        class="transition-transform duration-200 motion-reduce:transition-none"
                        :class="expanded[row.entry.id] ? 'rotate-90' : ''"
                      />
                    </OButton>
                  </span>
                </td>
              </tr>
              <tr
                v-if="expanded[row.entry.id]"
                :id="detailId(row.entry.id)"
                class="bg-table-row-expanded-bg border-table-row-divider border-b"
                :data-test="`autoobserve-ledger-${row.entry.id}-details`"
              >
                <td
                  :colspan="COLUMNS.length"
                  class="border-s-4 px-4 pt-1 pb-3"
                  :class="LOOP_RAIL[row.entry.loop]"
                >
                  <div class="flex max-w-[60rem] flex-col gap-3 ps-12">
                    <dl
                      class="text-text-secondary flex flex-wrap gap-x-4 gap-y-1 text-xs"
                      :data-test="`autoobserve-ledger-${row.entry.id}-meta`"
                    >
                      <div class="flex gap-1">
                        <dt>{{ t("autoobserve.activity.entryId") }}</dt>
                        <dd class="text-text-body font-mono">{{ row.entry.id }}</dd>
                      </div>
                      <div class="flex gap-1">
                        <dt>{{ t("autoobserve.activity.logged") }}</dt>
                        <dd class="text-text-body">{{ row.entry.when }}</dd>
                      </div>
                      <div class="flex gap-1">
                        <dt>{{ t("autoobserve.activity.columns.target") }}</dt>
                        <dd class="text-text-body">{{ row.entry.target }}</dd>
                      </div>
                      <div class="flex gap-1">
                        <dt>{{ t("autoobserve.activity.columns.confidence") }}</dt>
                        <dd class="text-text-body">{{ confidenceHint(row.entry) }}</dd>
                      </div>
                    </dl>
                    <p class="text-text-body text-sm leading-relaxed text-pretty">
                      <span class="text-text-label text-xs font-medium">{{
                        t("autoobserve.activity.evidence")
                      }}</span>
                      {{ row.entry.evidence }}
                    </p>
                    <div v-if="editing === row.entry.id" class="flex flex-col gap-2">
                      <OCodeBlock
                        :code="row.entry.before"
                        :lang="codeLang(row.entry.before)"
                        chrome="editor"
                        :filename="t('autoobserve.activity.before')"
                        wrap
                        :copyable="false"
                        :data-test="`autoobserve-ledger-${row.entry.id}-before`"
                      />
                      <OTextarea
                        v-model="draft"
                        :label="t('autoobserve.activity.after')"
                        :rows="4"
                        :data-test="`autoobserve-ledger-${row.entry.id}-draft`"
                      />
                      <span class="flex justify-end gap-2">
                        <OButton variant="outline" size="sm-action" @click="cancelEdit(row.entry)">
                          {{ t("common.cancel") }}
                        </OButton>
                        <OButton
                          variant="primary"
                          size="sm-action"
                          :data-test="`autoobserve-ledger-${row.entry.id}-save`"
                          @click="saveAndApprove(row.entry)"
                        >
                          {{ t("autoobserve.activity.saveApprove") }}
                        </OButton>
                      </span>
                    </div>
                    <div
                      v-else
                      role="group"
                      :aria-label="t('autoobserve.activity.diff')"
                      class="border-border-subtle rounded-default bg-surface-base overflow-x-auto border py-1 font-mono text-xs leading-5"
                      :data-test="`autoobserve-ledger-${row.entry.id}-diff`"
                    >
                      <div
                        v-for="(line, i) in diffOf(row.entry)"
                        :key="i"
                        class="flex gap-2 px-3"
                        :class="line.added ? 'bg-status-success-bg' : 'bg-status-error-bg'"
                      >
                        <span
                          class="w-3 shrink-0 select-none"
                          :class="
                            line.added ? 'text-status-success-text' : 'text-status-error-text'
                          "
                          aria-hidden="true"
                          >{{ line.added ? "+" : "-" }}</span
                        >
                        <span class="sr-only">{{
                          line.added
                            ? t("autoobserve.activity.after")
                            : t("autoobserve.activity.before")
                        }}</span>
                        <code class="text-text-heading min-w-0 break-words whitespace-pre-wrap"
                          >{{ line.code
                          }}<span class="text-text-secondary">{{ line.comment }}</span></code
                        >
                      </div>
                    </div>
                    <ul v-if="notesOf(row.entry).length" class="flex flex-col gap-1">
                      <li
                        v-for="(note, i) in notesOf(row.entry)"
                        :key="i"
                        class="text-text-secondary flex items-start gap-2 text-xs leading-relaxed"
                      >
                        <OIcon name="info-outline" size="xs" class="mt-0.5 shrink-0" />
                        <span>{{ note }}</span>
                      </li>
                    </ul>
                    <div
                      v-if="row.entry.status === 'auto_applied' && row.entry.reviewWindow"
                      class="flex flex-col gap-1.5"
                      :data-test="`autoobserve-ledger-${row.entry.id}-review`"
                    >
                      <span v-if="row.reviewDays" class="flex items-center gap-2 text-xs">
                        <span
                          role="progressbar"
                          :aria-label="t('autoobserve.activity.reviewProgress')"
                          aria-valuemin="0"
                          :aria-valuemax="TRUST_WINDOW_DAYS"
                          :aria-valuenow="TRUST_WINDOW_DAYS - row.reviewDays"
                          :aria-valuetext="
                            t(
                              'autoobserve.activity.daysLeft',
                              { count: row.reviewDays },
                              row.reviewDays,
                            )
                          "
                        >
                          <OProgressBar
                            :value="reviewProgress(row.reviewDays)"
                            size="xs"
                            class="w-32"
                          />
                        </span>
                        <span class="text-text-body font-medium tabular-nums">{{
                          t(
                            "autoobserve.activity.daysLeft",
                            { count: row.reviewDays },
                            row.reviewDays,
                          )
                        }}</span>
                      </span>
                      <span class="text-text-secondary text-xs leading-relaxed">
                        <OIcon name="timer" size="xs" class="me-1 align-middle" />{{
                          t("autoobserve.activity.reviewWindow", {
                            window: raw(row.entry.reviewWindow),
                          })
                        }}
                      </span>
                    </div>
                    <span
                      v-if="row.entry.decided || row.entry.status === 'auto_applied'"
                      class="flex justify-end"
                    >
                      <OButton
                        v-if="row.entry.decided"
                        variant="outline"
                        size="sm"
                        icon-left="undo"
                        :aria-label="t('autoobserve.activity.undoFor', actionOf(row.entry))"
                        :data-test="`autoobserve-ledger-${row.entry.id}-undo-decision`"
                        @click="undoDecision(row.entry)"
                      >
                        {{ t("autoobserve.activity.undo") }}
                      </OButton>
                      <OButton
                        v-else
                        variant="outline"
                        size="sm"
                        icon-left="undo"
                        :aria-label="t('autoobserve.activity.undoFor', actionOf(row.entry))"
                        :data-test="`autoobserve-ledger-${row.entry.id}-undo`"
                        @click="undo(row.entry)"
                      >
                        {{ t("autoobserve.activity.undo") }}
                      </OButton>
                    </span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <OEmptyState
        v-else
        size="block"
        illustration="history"
        :title="t('autoobserve.activity.emptyTitle')"
        :description="t('autoobserve.activity.emptyDescription')"
      />
    </OContent>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import OContent from "@/lib/core/Content/OContent.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { DAY_DATE, DEMO_NOW, LEDGER, PROBLEMS, type DayKey } from "./data/facts";
import { CONFIDENCE_LABEL, LOOP_LABEL, type LedgerEntry, type Loop } from "./fixtures";
import { DAY_LABEL } from "./v2/fixtures";
import { useDecisions } from "./v2/useDecisions";
import { STATE_LOOK, TRUST_WINDOW_DAYS, toChanges, type ChangeState } from "./v2/changes";

type Outcome = ChangeState | "awaiting" | "kept" | "rejected";
type ChipFilter = "all" | "awaiting" | "worked" | "review" | "didntHelp" | "undone";
type Column =
  | "time"
  | "loop"
  | "action"
  | "target"
  | "change"
  | "confidence"
  | "decision"
  | "outcome"
  | "actions";

interface LedgerRow {
  entry: LedgerEntry;
  outcome: Outcome;
  reviewDays?: number;
  day: DayKey;
  time?: string;
  incidentId?: string;
}

interface DiffLine {
  added: boolean;
  code: string;
  comment: string;
}

const props = defineProps<{ ledger: LedgerEntry[]; highlightId?: string }>();

const emit = defineEmits<{
  "update-entry": [id: string, patch: Partial<LedgerEntry>];
  "open-incident": [incidentId: string];
}>();

const { t } = useI18nTyped();
const store = useDecisions();

const LOOPS: Loop[] = ["coverage", "calibration", "investigation", "action"];
const LOOP_VARIANT: Record<Loop, BadgeVariant> = {
  coverage: "teal-soft",
  calibration: "amber-soft",
  investigation: "orange-soft",
  action: "purple-soft",
};
const LOOP_RAIL: Record<Loop, string> = {
  coverage: "border-s-ingest-accent-teal",
  calibration: "border-s-ingest-accent-amber",
  investigation: "border-s-ingest-accent-orange",
  action: "border-s-ingest-accent-purple",
};

const COLUMNS: Column[] = [
  "time",
  "loop",
  "action",
  "target",
  "change",
  "confidence",
  "decision",
  "outcome",
  "actions",
];
const COLUMN_LABEL: Record<Column, I18nKey> = {
  time: "autoobserve.activity.columns.time",
  loop: "autoobserve.activity.columns.loop",
  action: "autoobserve.activity.columns.action",
  target: "autoobserve.activity.columns.target",
  change: "autoobserve.activity.columns.change",
  confidence: "autoobserve.activity.columns.confidence",
  decision: "autoobserve.activity.columns.decision",
  outcome: "autoobserve.activity.columns.outcome",
  actions: "autoobserve.activity.columns.actions",
};

const CHIPS: ChipFilter[] = ["all", "awaiting", "worked", "review", "didntHelp", "undone"];
const CHIP_LABEL: Record<ChipFilter, I18nKey> = {
  all: "autoobserve2.activityPage.filters.all",
  awaiting: "autoobserve.activity.awaiting",
  worked: "autoobserve2.activityPage.status.worked",
  review: "autoobserve2.activityPage.status.review",
  didntHelp: "autoobserve2.activityPage.status.didntHelp",
  undone: "autoobserve2.activityPage.status.undone",
};
const CHIP_DOT: Record<ChipFilter, string | undefined> = {
  all: undefined,
  awaiting: "bg-status-warning-text",
  worked: "bg-status-positive",
  review: "bg-badge-indigo-soft-text",
  didntHelp: "bg-ingest-accent-orange",
  undone: "bg-ingest-accent-purple",
};
// A rejected proposal never changed anything, so only the All chip lists it.
const CHIP_OF: Record<Outcome, ChipFilter | undefined> = {
  awaiting: "awaiting",
  worked: "worked",
  kept: "worked",
  done: "worked",
  review: "review",
  applying: "review",
  didntHelp: "didntHelp",
  undone: "undone",
  rejected: undefined,
};

const OUTCOME_LOOK: Record<Outcome, { variant: BadgeVariant; key: I18nKey; icon?: IconName }> = {
  ...STATE_LOOK,
  awaiting: { variant: "warning-soft", key: "autoobserve.ledgerStatus.awaiting", icon: "schedule" },
  kept: { variant: "success-soft", key: "autoobserve.ledgerStatus.kept", icon: "check" },
  rejected: { variant: "default-soft", key: "autoobserve.ledgerStatus.rejected", icon: "close" },
};

const FACTS = Object.fromEntries(LEDGER.map((f) => [f.id, f]));

// A fix, or a proposal raised from an incident, links back to that incident.
const INCIDENT_OF: Record<string, string> = Object.fromEntries(
  Object.values(PROBLEMS).flatMap((p) =>
    [p.fix?.ledgerId, p.proposalLedgerId]
      .filter((id): id is string => !!id)
      .map((id) => [id, p.incidentId]),
  ),
);

const loop = ref<Loop | "all">("all");
const chip = ref<ChipFilter>("all");
const editing = ref<string | null>(null);
const draft = ref("");
const expanded = reactive<Record<string, boolean>>({});
const flashId = ref<string | null>(null);
const announcement = ref("");

const outcomeOf = (entry: LedgerEntry, state?: ChangeState): Outcome => {
  if (entry.status === "awaiting" || entry.status === "rejected") return entry.status;
  if (entry.status === "kept") return "kept";
  return state ?? "done";
};

// An answered request happened now, so it moves to today however old the proposal is.
const allRows = computed<LedgerRow[]>(() => {
  const changes = new Map(toChanges(props.ledger, store.phases).map((c) => [c.entry.id, c]));
  return props.ledger.map((entry) => {
    const change = changes.get(entry.id);
    const fact = FACTS[entry.id];
    return {
      entry,
      outcome: outcomeOf(entry, change?.state),
      reviewDays: change?.reviewDays,
      day: entry.decided ? "today" : fact.day,
      time: entry.decided ? DEMO_NOW : fact.time,
      incidentId: INCIDENT_OF[entry.id],
    };
  });
});

const loopRows = computed(() =>
  allRows.value.filter((r) => loop.value === "all" || r.entry.loop === loop.value),
);

const counts = computed(
  () =>
    Object.fromEntries(
      CHIPS.map((c) => [
        c,
        loopRows.value.filter((r) => c === "all" || CHIP_OF[r.outcome] === c).length,
      ]),
    ) as Record<ChipFilter, number>,
);

const sortKey = (r: LedgerRow) => `${DAY_DATE[r.day]} ${r.time ?? "00:00"}`;

const groups = computed(() => {
  const rows = loopRows.value
    .filter((r) => chip.value === "all" || CHIP_OF[r.outcome] === chip.value)
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const pending = rows.filter((r) => r.entry.status === "awaiting");
  const rest = rows.filter((r) => r.entry.status !== "awaiting");
  return [
    { key: "pending", label: t("autoobserve.activity.needsApproval"), rows: pending },
    { key: "rest", label: undefined, rows: rest },
  ].filter((g) => g.rows.length);
});

const whenOf = (row: LedgerRow) =>
  row.time
    ? t("autoobserve2.when", { day: t(DAY_LABEL[row.day]), time: raw(row.time) })
    : t(DAY_LABEL[row.day]);

const entryKey = (id: string, part: "from" | "to") =>
  `autoobserve2.activityPage.entries.${id}.${part}` as I18nKey;
const toggleId = (id: string) => `autoobserve-ledger-toggle-${id}`;
const detailId = (id: string) => `autoobserve-ledger-details-${id}`;
const actionOf = (entry: LedgerEntry) => ({
  action: raw(entry.actionClass),
  target: entry.target,
});

const confidenceHint = (entry: LedgerEntry) =>
  t("autoobserve.activity.confidenceHint", { value: t(CONFIDENCE_LABEL[entry.confidence]) });

const shiftText = (entry: LedgerEntry) =>
  `${t(entryKey(entry.id, "from"))} → ${t(entryKey(entry.id, "to"))}`;

const modeLabel = (entry: LedgerEntry) => {
  if (entry.status === "approved") return t("autoobserve.ledgerStatus.approved");
  if (entry.status === "rejected") return t("autoobserve.ledgerStatus.rejected");
  return t("autoobserve.activity.auto");
};

const outcomeLabel = (row: LedgerRow) =>
  row.outcome === "review" && row.reviewDays
    ? t("autoobserve2.activityPage.status.reviewDays", { count: row.reviewDays }, row.reviewDays)
    : t(OUTCOME_LOOK[row.outcome].key);

const reviewProgress = (daysLeft: number) =>
  Math.max(0.06, (TRUST_WINDOW_DAYS - daysLeft) / TRUST_WINDOW_DAYS);

const codeLang = (code: string) => (code.startsWith("WHERE") ? "sql" : "yaml");

// A trailing "# ..." is an annotation on the value, so it is dimmed apart from the code.
const splitComment = (line: string) => {
  const at = line.search(/(^|\s)#/);
  if (at < 0) return { code: line, comment: "" };
  const hash = line.indexOf("#", at);
  return { code: line.slice(0, hash), comment: line.slice(hash) };
};

const diffOf = (entry: LedgerEntry): DiffLine[] => [
  ...entry.before.split("\n").map((l) => ({ added: false, ...splitComment(l) })),
  ...entry.after.split("\n").map((l) => ({ added: true, ...splitComment(l) })),
];

const notesOf = (entry: LedgerEntry) =>
  [
    entry.note,
    entry.actionClass === "ReviewForDeletion" ? t("autoobserve.activity.neverAutoRetire") : null,
    entry.userBuilt ? t("autoobserve.activity.neverSilent") : null,
  ].filter((n): n is I18nText => !!n);

const toggle = (id: string) => {
  expanded[id] = !expanded[id];
};

const onRowClick = (event: MouseEvent, id: string) => {
  const target = event.target as HTMLElement;
  if (target.closest("button, a, input, textarea")) return;
  toggle(id);
};

const announce = async (message: I18nText) => {
  announcement.value = "";
  await nextTick();
  announcement.value = String(message);
};

// A decision moves the row to another group, so focus follows it to its new toggle.
const decide = async (entry: LedgerEntry, patch: Partial<LedgerEntry>, message: I18nText) => {
  emit("update-entry", entry.id, patch);
  toast({ variant: patch.status === "rejected" ? "default" : "success", message });
  void announce(message);
  await nextTick();
  document.getElementById(toggleId(entry.id))?.focus();
};

const approve = (entry: LedgerEntry) =>
  decide(entry, { status: "approved" }, t("autoobserve.activity.approvedToast"));

const reject = (entry: LedgerEntry) =>
  decide(
    entry,
    { status: "rejected", note: t("autoobserve.activity.rejectedNote") },
    t("autoobserve.activity.rejectedToast"),
  );

const undo = (entry: LedgerEntry) =>
  decide(
    entry,
    { status: "rolled_back", note: t("autoobserve.activity.undoneNote") },
    t("autoobserve.activity.undoneToast"),
  );

const undoDecision = (entry: LedgerEntry) =>
  decide(entry, { status: "awaiting" }, t("autoobserve2.activityPage.toast.undoDecided"));

const startEdit = async (entry: LedgerEntry) => {
  editing.value = entry.id;
  draft.value = entry.after;
  expanded[entry.id] = true;
  await nextTick();
  document
    .querySelector<HTMLTextAreaElement>(
      `[data-test="autoobserve-ledger-${entry.id}-draft"] textarea`,
    )
    ?.focus();
};

const cancelEdit = async (entry: LedgerEntry) => {
  editing.value = null;
  await nextTick();
  document.getElementById(toggleId(entry.id))?.focus();
};

const saveAndApprove = (entry: LedgerEntry) => {
  editing.value = null;
  return decide(
    entry,
    { status: "approved", after: draft.value },
    t("autoobserve.activity.approvedToast"),
  );
};

let flashTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(async () => {
  const id = props.highlightId;
  if (!id) return;
  expanded[id] = true;
  await nextTick();
  document
    .querySelector(`[data-test="autoobserve-ledger-${id}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
  flashId.value = id;
  flashTimer = setTimeout(() => (flashId.value = null), 2500);
});

onBeforeUnmount(() => clearTimeout(flashTimer));
</script>
