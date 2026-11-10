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

<!-- Spend is read live from trace cost columns; unpriced spend is named, never counted as $0. -->
<template>
  <AiPageShell
    data-test="ai-budgets"
    :title="t('aiBudgets.title')"
    :subtitle="t('aiBudgets.subtitle')"
    icon="account-balance"
    :date-state="dateState"
    :last-run-at="lastRunAt"
    :is-loading="loading"
    date-disabled
    @date-change="onDateStateChange"
    @refresh="reload"
  >
    <div class="px-page-edge flex min-h-0 flex-1 flex-col gap-2 py-2">
      <div class="flex items-center gap-2">
        <OSelect
          v-model="stream"
          :options="availableStreams.map((s) => ({ value: s, label: raw(s) }))"
          :label="t('llmAttribution.users.stream')"
          label-position="inside"
          size="sm"
          width="sm"
          data-test="ai-budgets-stream"
          @update:model-value="reload"
        />
        <span class="text-2xs text-text-secondary flex-1">{{ t("aiBudgets.signalNote") }}</span>
        <OButton
          variant="primary"
          size="sm"
          icon-left="add"
          :disabled="noStream || !!forbidden"
          data-test="ai-budgets-new"
          @click="openNew"
        >
          {{ t("aiBudgets.new") }}
        </OButton>
      </div>

      <!-- Spend is read from an LLM trace stream; without one nothing can be budgeted. -->
      <OBanner
        v-if="noStream"
        variant="info"
        icon="info"
        dense
        text-size="small"
        data-test="ai-budgets-no-stream"
      >
        {{ t("aiBudgets.noStream") }}
      </OBanner>

      <!-- One compact line, as the page's other notes: the message, then its action. -->
      <OBanner
        v-if="unpricedTraces > 0"
        variant="warning"
        icon="warning"
        dense
        inline-actions
        text-size="small"
        data-test="ai-budgets-unpriced"
      >
        {{ t("aiBudgets.unpriced", { n: unpricedTraces }, unpricedTraces) }}
        <template #actions>
          <OButton
            variant="outline"
            size="xs"
            data-test="ai-budgets-unpriced-add-price"
            @click="router.push(pricingGapsRoute(stream, org(), unpricedWindow))"
          >
            {{ t("llmDataTrust.cost.addPrice") }}
          </OButton>
        </template>
      </OBanner>

      <OTable
        :data="rows"
        :columns="columns"
        row-key="alertId"
        :loading="loading"
        :show-global-filter="false"
        pagination="none"
        class="min-h-0 flex-1"
        :empty-message="t('aiBudgets.empty')"
        :forbidden="forbidden"
        forbidden-resource="alert_folders"
        data-test="ai-budgets-table"
      >
        <template #cell-budget="{ row }">
          <div class="flex flex-col">
            <span class="text-compact text-text-body font-medium">{{ row.name }}</span>
            <span class="text-2xs text-text-secondary">{{ scopeLabel(row) }}</span>
          </div>
        </template>
        <template #cell-spent="{ row }">
          <div
            v-if="row.error"
            class="flex flex-col gap-1"
            :data-test="`ai-budgets-spend-error-${row.name}`"
          >
            <span class="text-compact">—</span>
            <span class="text-2xs text-text-secondary">{{
              row.error === "forbidden"
                ? t("aiBudgets.noAccess", { stream: row.stream })
                : t("aiBudgets.readFailed")
            }}</span>
          </div>
          <div v-else class="flex flex-col gap-1">
            <span class="text-compact">{{ spentLabel(row) }}</span>
            <OProgressBar
              :value="Math.min(100, (row.shown / Math.max(row.limitUsd, 0.0001)) * 100)"
              :variant="
                row.state === 'over' ? 'danger' : row.state === 'warning' ? 'warning' : 'default'
              "
              size="sm"
              class="w-48"
              aria-hidden="true"
            />
          </div>
        </template>
        <template #cell-state="{ row }">
          <OBadge
            :variant="stateVariant(row)"
            size="sm"
            :data-test="`ai-budgets-state-${row.name}`"
          >
            {{ stateLabel(row) }}
          </OBadge>
        </template>
        <template #cell-actions="{ row }">
          <ODropdown side="bottom" align="end">
            <template #trigger>
              <OButton
                :aria-label="t('common.moreActions')"
                icon-left="more-vert"
                variant="ghost"
                size="icon-xs-sq"
                :data-test="`ai-budgets-actions-${row.name}`"
                @click.stop
              />
            </template>
            <ODropdownItem
              icon-left="edit"
              :disabled="row.legacy"
              :description="row.legacy ? t('aiBudgets.legacyEdit') : null"
              :data-test="`ai-budgets-edit-${row.name}`"
              @select="openEdit(row)"
            >
              {{ t("common.edit") }}
            </ODropdownItem>
            <ODropdownItem
              icon-left="delete"
              :data-test="`ai-budgets-delete-${row.name}`"
              @select="remove(row)"
            >
              {{ t("common.delete") }}
            </ODropdownItem>
          </ODropdown>
        </template>
      </OTable>
    </div>

    <ODialog
      v-model:open="dialogOpen"
      size="md"
      :title="editing ? t('aiBudgets.edit') : t('aiBudgets.new')"
      :primary-button-label="editing ? t('aiBudgets.save') : t('aiBudgets.create')"
      :primary-button-disabled="!canCreate"
      :primary-button-loading="creating"
      primary-button-data-test="ai-budgets-create"
      :secondary-button-label="t('common.cancel')"
      data-test="ai-budgets-dialog"
      @click:primary="submit"
      @click:secondary="dialogOpen = false"
    >
      <div class="flex flex-col gap-3">
        <OInput
          v-model="draft.name"
          :label="t('aiBudgets.name')"
          :placeholder="raw('deep-research-daily')"
          :error="nameTaken"
          :error-message="t('aiBudgets.nameTaken', { name: draft.name.trim() })"
          data-test="ai-budgets-name"
        />
        <OSelect
          v-model="draft.scope"
          :options="SCOPES.map((s) => ({ value: s, label: t(`aiBudgets.scopes.${s}`) }))"
          :label="t('aiBudgets.limits')"
          :error="!!missingField"
          :error-message="
            missingField
              ? t('aiBudgets.fieldMissing', { stream: draft.stream, field: missingField })
              : undefined
          "
          data-test="ai-budgets-scope"
        />
        <!-- A value not seen yet (a feature before it ships) can still be typed in. -->
        <OSelect
          v-if="!isEach(draft.scope) && !missingField"
          v-model="draft.value"
          :options="valueSelectOptions"
          :label="t(`aiBudgets.scopes.${draft.scope}`)"
          :loading="valueOptionsLoading"
          :help-text="
            !valueOptionsLoading && !valueOptions.length ? t('aiBudgets.noValues') : undefined
          "
          searchable
          creatable
          data-test="ai-budgets-value"
          @create="(typed: string) => (draft.value = typed.trim())"
        />
        <div class="grid grid-cols-2 gap-3">
          <OInput
            v-model.number="draft.limitUsd"
            type="number"
            :label="t('aiBudgets.limit')"
            data-test="ai-budgets-limit"
          />
          <OSelect
            v-if="draft.scope !== 'session'"
            v-model="draft.period"
            :options="[
              { value: 'day', label: t('aiBudgets.periods.day') },
              { value: 'month', label: t('aiBudgets.periods.month') },
            ]"
            :label="t('aiBudgets.period')"
            data-test="ai-budgets-period"
          />
        </div>
        <OSelect
          v-model="destination"
          :options="destinationOptions"
          :label="t('aiBudgets.destination')"
          :help-text="t('aiBudgets.destinationHelp')"
          :placeholder="t('aiAlertPack.noDestination')"
          clearable
          data-test="ai-budgets-destination"
        />
      </div>
    </ODialog>
  </AiPageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import AiPageShell from "@/enterprise/components/AIObservability/AiPageShell.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import useStreams from "@/composables/useStreams";
import { createFolderByType, getFoldersListByType } from "@/utils/commons";
import { forbiddenState, type ForbiddenState } from "@/utils/featureGate";
import { useAiDateController } from "@/enterprise/composables/useAiDateController";
import { useLlmPageScope } from "@/enterprise/composables/useLlmPageScope";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import { pricingGapsRoute, type TimeWindow } from "@/plugins/traces/llmDataTrust.utils";
import { streamHasParentSpan } from "@/plugins/traces/llmStreamColumns";
import {
  BUDGET_COLUMNS,
  PERIOD_MINUTES,
  budgetAlertPayload,
  budgetAlertUpdate,
  budgetFromAlert,
  budgetMissingField,
  budgetNameTaken,
  budgetReading,
  budgetSql,
  budgetSummarySql,
  formatBudgetUsd,
  isEach,
  isLegacyBudgetAlert,
  mergeLegacyBudgets,
  spendError,
  type BudgetDef,
  type BudgetReading,
  type BudgetRow,
  type BudgetScope,
} from "@/utils/alerts/aiBudgets";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";

defineOptions({ name: "AIBudgetsPage" });

const FOLDER = "AI budgets";
const SCOPES: BudgetScope[] = ["agent", "feature", "oneUser", "user", "model", "session"];

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { getStream } = useStreams(t);
const { executeQuery } = useLLMStreamQuery();
const { confirm } = useConfirmDialog();
const { dateState, timeRange, onDateChange: onDateStateChange } = useAiDateController();
const { stream, availableStreams, load: loadScope } = useLlmPageScope(t);

const org = () => store.state.selectedOrganization?.identifier ?? "";
type Def = BudgetDef & {
  alertId: string;
  /** Every alert of the budget: one, or a legacy pair, which Delete removes together. */
  alertIds: string[];
  /** The stored alert's name; a legacy pair is `<x>_warn` and `<x>_over`. */
  alertName: string;
  /** A legacy two-alert budget, which cannot be edited (see isLegacyBudgetAlert). */
  legacy: boolean;
  /** The alert's first destination, the one the dialog shows. */
  destination: string | null;
};
type Row = Def & BudgetReading;
const rows = ref<Row[]>([]);
const loading = ref(false);
const lastRunAt = ref<number | null>(null);
const unpricedTraces = ref(0);
// The user cannot read alert folders, where budgets are stored.
const forbidden = ref<ForbiddenState>(false);
// Set once the stream list is read: the org has no LLM trace stream to budget.
const streamsLoaded = ref(false);
const noStream = computed(() => streamsLoaded.value && !availableStreams.value.length);
// The gaps page must use the banner's month; its 24h default missed older unpriced calls.
const unpricedWindow = ref<TimeWindow | null>(null);
const dialogOpen = ref(false);
const creating = ref(false);
// The budget the dialog edits; null while it creates one.
const editing = ref<Row | null>(null);
// The budgets folder, found on reload; the edit and delete calls name it.
const budgetFolder = ref<string | null>(null);
const destinations = ref<string[]>([]);
const destination = ref<string | null>(null);
const blankDraft = (): BudgetDef => ({
  name: "",
  scope: "agent",
  value: "",
  limitUsd: 100,
  period: "day",
  stream: "",
});
// `stream` is the budget's: the page's stream for a new one, its own when edited.
const draft = reactive<BudgetDef>(blankDraft());

const destinationOptions = computed(() =>
  destinations.value.map((d) => ({ value: d, label: raw(d) })),
);
const valueOptions = ref<string[]>([]);
// Offer the current value even if unseen lately, or the select would show it empty.
const valueSelectOptions = computed(() =>
  (draft.value && !valueOptions.value.includes(draft.value)
    ? [draft.value, ...valueOptions.value]
    : valueOptions.value
  ).map((v) => ({ value: v, label: raw(v) })),
);
const valueOptionsLoading = ref(false);
// The scope's column when the budget's stream has not received it; Create stays off.
const missingField = ref<string | null>(null);
let valueSeq = 0;
async function loadValueOptions() {
  const mine = ++valueSeq;
  valueOptions.value = [];
  missingField.value = null;
  if (!dialogOpen.value || !draft.stream) return;
  const col = BUDGET_COLUMNS[draft.scope];
  valueOptionsLoading.value = true;
  try {
    // Read fresh: a cached schema can predate the column, and a query naming a missing column fails.
    const schema = await getStream(draft.stream, "traces", true, true).catch(() => null);
    if (mine !== valueSeq || !schema) return;
    missingField.value = budgetMissingField(draft.scope, schema.schema ?? []);
    if (missingField.value || isEach(draft.scope)) return;
    const now = Date.now() * 1000;
    const hits = (await executeQuery(
      `SELECT ${col} AS v, COUNT(*) AS n FROM "${draft.stream}" WHERE ${col} IS NOT NULL AND ${col} != '' GROUP BY ${col} ORDER BY n DESC LIMIT 200`,
      now - PERIOD_MINUTES.month * 60_000_000,
      now,
    ).catch(() => [])) as any[];
    if (mine === valueSeq) valueOptions.value = hits.map((h) => String(h.v));
  } finally {
    if (mine === valueSeq) valueOptionsLoading.value = false;
  }
}
// Synchronous, so a prefill that sets the scope and then the value keeps the value.
watch(
  () => draft.scope,
  () => {
    draft.value = "";
  },
  { flush: "sync" },
);
watch(() => [dialogOpen.value, draft.scope, draft.stream], loadValueOptions);

// Two alerts of one name both fire and cannot be told apart here.
const nameTaken = computed(() => budgetNameTaken(draft.name, rows.value, editing.value?.name));

const canCreate = computed(
  () =>
    !!draft.name.trim() &&
    !nameTaken.value &&
    !missingField.value &&
    draft.limitUsd > 0 &&
    (isEach(draft.scope) || !!draft.value.trim()) &&
    !!draft.stream,
);

const columns: OTableColumnDef[] = [
  { id: "budget", header: t("aiBudgets.budget"), meta: { align: "left", flex: true } },
  {
    id: "spent",
    header: t("aiBudgets.spentLimit"),
    size: COL.description,
    meta: { align: "left" },
  },
  { id: "state", header: t("aiBudgets.state"), size: COL.type, meta: { align: "left" } },
  { id: "actions", header: raw(""), size: COL.count, meta: { align: "right" }, sortable: false },
];

function scopeLabel(b: BudgetDef) {
  const period = t(`aiBudgets.periods.${b.period}`);
  // The table lists every stream's budgets: each row names the stream it reads.
  return isEach(b.scope)
    ? t("aiBudgets.eachScope", {
        scope: t(`aiBudgets.scopes.${b.scope}`),
        period,
        stream: b.stream,
      })
    : t("aiBudgets.valueScope", {
        scope: t(`aiBudgets.scopes.${b.scope}`),
        value: b.value,
        period,
        stream: b.stream,
      });
}

function spentLabel(r: Row) {
  return isEach(r.scope)
    ? t("aiBudgets.spentEach", {
        limit: formatBudgetUsd(r.limitUsd),
        over: r.over,
        keys: r.keys,
        largest: formatBudgetUsd(r.shown),
      })
    : t("aiBudgets.spentOf", {
        spent: formatBudgetUsd(r.spent),
        limit: formatBudgetUsd(r.limitUsd),
        pct: r.limitUsd > 0 ? Math.round((r.spent / r.limitUsd) * 100) : 0,
      });
}

function stateVariant(r: Row): BadgeVariant {
  if (r.state === "over") return "error-soft";
  if (r.state === "warning") return "warning-soft";
  return r.state === "under" ? "success-soft" : "default-soft";
}

function stateLabel(r: Row) {
  if (!r.state) return t("aiBudgets.states.unknown");
  // "N over" counts keys of a per-key budget; a one-value budget is just "Over".
  const n = r.state === "over" && isEach(r.scope) ? r.over : 0;
  return t(`aiBudgets.states.${r.state}`, { n }, n);
}

// A plain-text error body (the alerts API's 422) is the message itself.
function errorText(e: any): string {
  const data = e?.response?.data;
  return (typeof data === "string" && data.trim()) || data?.message || String(e?.message ?? e);
}

async function folderId(create: boolean): Promise<string | null> {
  const folders: Array<{ folderId: string; name: string }> =
    (await getFoldersListByType(store, "alerts")) ?? [];
  const found = folders.find((f) => f.name === FOLDER);
  if (found || !create) return found?.folderId ?? null;
  const created: any = await createFolderByType(
    store,
    { name: FOLDER, description: t("aiBudgets.folderDescription") },
    "alerts",
  );
  return created?.data?.folderId ?? "default";
}

async function reload() {
  await loadScope(timeRange.value.startTime, timeRange.value.endTime);
  streamsLoaded.value = true;
  loading.value = true;
  forbidden.value = false;
  try {
    const id = await folderId(false);
    budgetFolder.value = id;
    const list = id
      ? ((await alertsService.listByFolderId(1, 500, "name", false, "", org(), id)).data?.list ??
        [])
      : [];
    const defs = mergeLegacyBudgets(
      (
        await Promise.all(
          list.map((a: { alert_id?: string; id?: string }) => {
            const alertId = String(a.alert_id ?? a.id);
            return alertsService
              .get_by_alert_id(org(), alertId, id)
              .then((r): Def | null => {
                const def = budgetFromAlert(r.data);
                return (
                  def && {
                    ...def,
                    alertId,
                    alertIds: [alertId],
                    alertName: String(r.data?.name ?? ""),
                    legacy: isLegacyBudgetAlert(r.data),
                    destination: r.data?.destinations?.[0] ?? null,
                  }
                );
              })
              .catch(() => null);
          }),
        )
      ).filter((d): d is Def => !!d),
    );
    const now = Date.now() * 1000;
    // A failed read is an unknown spend, never $0 "under".
    rows.value = await Promise.all(
      defs.map(async (b) => {
        const hasParentSpan = await streamHasParentSpan(org(), b.stream);
        const result = await executeQuery(
          isEach(b.scope) ? budgetSummarySql(b, hasParentSpan) : budgetSql(b, hasParentSpan),
          now - PERIOD_MINUTES[b.period] * 60_000_000,
          now,
        ).then((hits) => hits as BudgetRow[], spendError);
        return { ...b, ...budgetReading(b, result) };
      }),
    );
    await loadUnpriced(now);
  } catch (e) {
    // Budgets live in an alert folder: without access to it there is nothing to list or create.
    const denied = forbiddenState(e);
    if (!denied) throw e;
    forbidden.value = denied;
    rows.value = [];
  } finally {
    loading.value = false;
    lastRunAt.value = Date.now();
  }
}

// Budgets count priced calls only: name what is missing this month.
async function loadUnpriced(now: number) {
  unpricedTraces.value = 0;
  if (!stream.value) return;
  const start = now - PERIOD_MINUTES.month * 60_000_000;
  unpricedWindow.value = { start, end: now };
  const schema = await getStream(stream.value, "traces", true).catch(() => null);
  if (!(schema?.schema ?? []).some((f: any) => f.name === "gen_ai_usage_cost_status")) return;
  const hits = (await executeQuery(
    `SELECT COUNT(*) AS n FROM "${stream.value}" WHERE gen_ai_usage_cost_status = 'unpriced'`,
    start,
    now,
  ).catch(() => [])) as any[];
  unpricedTraces.value = Number(hits[0]?.n) || 0;
}

async function openNew() {
  editing.value = null;
  Object.assign(draft, blankDraft(), { stream: stream.value });
  destination.value = null;
  await openDialog();
}

function openEdit(row: Row) {
  editing.value = row;
  Object.assign(draft, {
    name: row.name,
    scope: row.scope,
    value: row.value,
    limitUsd: row.limitUsd,
    period: row.period === "hour" ? "day" : row.period,
    stream: row.stream,
  });
  destination.value = row.destination;
  return openDialog();
}

async function openDialog() {
  dialogOpen.value = true;
  try {
    const res: any = await destinationService.list({
      org_identifier: org(),
      page_num: 1,
      page_size: 100000,
      sort_by: "name",
      desc: false,
      module: "alert",
    });
    destinations.value = (Array.isArray(res?.data) ? res.data : [])
      .map((d: any) => d?.name)
      .filter(Boolean);
  } catch {
    destinations.value = [];
  }
}

async function submit() {
  if (!canCreate.value) return;
  creating.value = true;
  try {
    const b: BudgetDef = {
      ...draft,
      name: draft.name.trim(),
      value: draft.value.trim(),
      period: draft.scope === "session" ? "hour" : draft.period,
    };
    // The budget's SQL reads the stream's top-level agents through span parents.
    const hasParentSpan = await streamHasParentSpan(org(), b.stream);
    if (editing.value) {
      const folder = budgetFolder.value ?? undefined;
      const stored = (await alertsService.get_by_alert_id(org(), editing.value.alertId, folder))
        .data;
      await alertsService.update_by_alert_id(
        org(),
        budgetAlertUpdate({ ...stored, id: editing.value.alertId }, b, {
          destination: destination.value ?? "",
          editor: store.state.userInfo?.email ?? "",
          hasParentSpan,
        }),
        folder,
      );
      toast({ variant: "success", message: t("aiBudgets.updated", { name: b.name }) });
    } else {
      const id = (await folderId(true)) ?? "default";
      await alertsService.create_by_alert_id(
        org(),
        budgetAlertPayload(b, {
          folderId: id,
          destination: destination.value ?? "",
          owner: store.state.userInfo?.email ?? "",
          timezone: store.state.timezone || "UTC",
          hasParentSpan,
        }),
        id,
      );
      toast({ variant: "success", message: t("aiBudgets.created", { name: b.name }) });
    }
    dialogOpen.value = false;
    await reload();
  } catch (e: any) {
    toast({ variant: "error", message: raw(errorText(e)) });
  } finally {
    creating.value = false;
  }
}

async function remove(row: Row) {
  const ok = await confirm({
    title: t("aiBudgets.deleteTitle", { name: row.name }),
    message: t("aiBudgets.deleteMessage", { count: row.alertIds.length }, row.alertIds.length),
    confirmLabel: t("common.delete"),
    cancelLabel: t("common.cancel"),
    confirmVariant: "destructive",
    focusCancel: true,
  });
  if (!ok) return;
  try {
    for (const alertId of row.alertIds) {
      await alertsService.delete_by_alert_id(org(), alertId, budgetFolder.value ?? undefined);
    }
    toast({ variant: "success", message: t("aiBudgets.deleted", { name: row.name }) });
    await reload();
  } catch (e: any) {
    toast({ variant: "error", message: raw(errorText(e)) });
  }
}

onMounted(reload);
</script>
