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
  <ODrawer
    v-if="enterprise"
    :open="state.open"
    side="right"
    size="xxl"
    :close-guard="() => !running"
    :return-focus-to="() => state.opener"
    :title="title"
    :sub-title="rule"
    title-data-test="bulk-review-title"
    sub-title-data-test="bulk-review-rule"
    data-test="bulk-review-drawer"
    @update:open="(open: boolean) => !open && closeBulkReview()"
  >
    <div class="flex min-h-0 flex-col gap-3">
      <div class="flex flex-wrap items-center gap-3">
        <div class="w-44 max-md:w-full">
          <OSelect
            size="sm"
            label-position="inside"
            :label="t('insight.bulk.groupBy')"
            :model-value="state.groupBy"
            :options="groupByOptions"
            :disabled="locked"
            data-test="bulk-review-group-by"
            @update:model-value="(v) => setGroupBy(v as GroupBy)"
          />
        </div>
        <span class="text-text-secondary text-xs" data-test="bulk-review-group-hint">{{
          state.groupBy === "team" ? t("insight.bulk.groupHint") : t("insight.bulk.groupHintOther")
        }}</span>
      </div>

      <OBanner
        v-if="rights"
        variant="default"
        icon="lock"
        dense
        role="status"
        data-test="bulk-review-rights"
      >
        {{ rights }}
      </OBanner>

      <OBanner
        v-if="failures.length"
        ref="failureBanner"
        variant="error-soft"
        icon="error-outline"
        role="alert"
        data-test="bulk-review-failures"
      >
        <p class="font-semibold">{{ partialBanner(t, failures.length, attempted) }}</p>
        <ul class="mt-1 flex flex-col gap-0.5">
          <li
            v-for="f in failures"
            :key="f.row.key"
            :data-test="`bulk-review-failure-${f.row.key}`"
          >
            {{ failureLine(t, label(f.row), f.reason) }}
          </li>
        </ul>
        <p v-if="createdFolders.length" class="text-text-secondary mt-1">
          {{ createdLine(t, locale, createdFolders, createdCount) }}
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <OButton
            v-for="f in retryable"
            :key="f.row.key"
            variant="outline"
            size="sm"
            :disabled="running"
            :data-test="`bulk-review-retry-${f.row.key}`"
            @click="retry([f.row.key])"
          >
            {{ t("insight.bulk.retryOne", { service: label(f.row) }) }}
          </OButton>
          <OButton
            v-if="retryable.length > 1"
            variant="outline"
            size="sm"
            :disabled="running"
            data-test="bulk-review-retry-all"
            @click="retry(retryable.map((f) => f.row.key))"
          >
            {{ t("insight.bulk.retryAll", { count: retryable.length }) }}
          </OButton>
          <OButton
            v-for="f in duplicates"
            :key="`open-${f.row.key}`"
            variant="ghost-primary"
            size="sm"
            :data-test="`bulk-review-open-existing-${f.row.key}`"
            @click="openExisting(f.row)"
          >
            {{ t("insight.bulk.openExisting") }}
          </OButton>
        </div>
      </OBanner>

      <OTable
        :data="tableRows"
        :columns="columns"
        :frame="false"
        :fill-height="false"
        row-key="key"
        pagination="none"
        :show-global-filter="false"
        :cell-overflow-tooltip="false"
        :row-section="(row: ReviewRow) => sectionOf.get(row.key) ?? null"
        :section-order="groups.map((g) => g.key)"
        :row-tone="(row: ReviewRow) => (isTickable(row) ? null : 'muted')"
        :row-class="(row: ReviewRow) => (hidden.has(row.key) ? 'hidden' : '')"
        data-test="bulk-review-table"
      >
        <template #group-header="{ sectionKey }">
          <BulkReviewGroupHeader
            v-if="groupOf(sectionKey)"
            :group="groupOf(sectionKey)!"
            :all="reviewRows"
            :ticked="state.ticked"
            :collapsible="collapsible"
            :collapsed="state.collapsed.has(sectionKey)"
            :folders="folderChoices"
            :destinations="state.destinations"
            :disabled="locked"
            :reach-gap="reachGap"
            @toggle="(on: boolean) => toggleGroup(groupOf(sectionKey)!, on)"
            @collapse="toggleCollapsed(sectionKey)"
            @change="(f: FolderRef, d: string[]) => changeGroup(groupOf(sectionKey)!, f, d)"
            @edit="loadDestinations(org()).catch(() => undefined)"
          />
        </template>
        <template #cell-tick="{ row }">
          <BulkRowMark
            :result="results[row.key]"
            :checked="state.ticked.has(row.key) && isTickable(row)"
            :disabled="locked || !isTickable(row)"
            :label="t('insight.bulk.tickRow', { service: label(row), alert: alertName(row) })"
            :data-test="`bulk-review-tick-${row.key}`"
            @update="(on: boolean) => toggleRow(row.key, on)"
          />
        </template>
        <template #cell-service="{ row }">
          <div class="flex min-w-0 flex-col py-1 whitespace-normal">
            <span class="text-text-heading" :data-test="`bulk-review-service-${row.key}`">
              {{ label(row) }}
            </span>
            <span
              v-if="isMobile && row.prefill"
              class="text-text-secondary text-xs"
              :data-test="`bulk-review-compact-${row.key}`"
            >
              {{ compactLine(row) }}
            </span>
            <div
              v-if="row.block?.code === 'exists'"
              class="flex min-w-0 items-center gap-2"
              :data-test="`bulk-review-exists-${row.key}`"
            >
              <OTruncatedText :lines="1" class="text-text-secondary min-w-0 text-xs">
                {{ blockLine(t, row, reviewRows) }}
              </OTruncatedText>
              <OButton
                variant="ghost-primary"
                size="xs"
                class="shrink-0"
                :data-test="`bulk-review-open-added-${row.key}`"
                @click="openAdded(row.block.alert)"
              >
                {{ t("insight.bulk.openExisting") }}
              </OButton>
            </div>
            <!-- On a wide screen a waiting or threshold row stays one line; Fires when and Usually say why. -->
            <OTruncatedText
              v-else-if="
                (!row.prefill || row.block) && (isMobile || !(waits(row) || asksThreshold(row)))
              "
              :lines="isMobile ? 2 : 1"
              :class="[
                'text-xs',
                row.block?.code === 'schemaFailed' || row.block?.code === 'existsFailed'
                  ? 'text-status-error-text'
                  : 'text-text-secondary',
              ]"
              :data-test="`bulk-review-cant-${row.key}`"
            >
              <i18n-t
                v-if="!row.block"
                keypath="insight.bulk.cantBuildIn"
                tag="span"
                scope="global"
              >
                <template #alerts>
                  <router-link
                    :to="{ name: 'alertList', query: { org_identifier: org() } }"
                    class="text-text-link hover:underline"
                    data-test="bulk-review-open-alerts"
                    @click="closeBulkReview()"
                    >{{ t("insight.bulk.alertsPage") }}</router-link
                  >
                </template>
              </i18n-t>
              <template v-else>{{ blockLine(t, row, reviewRows) }}</template>
            </OTruncatedText>
            <OInput
              v-if="isMobile && asksThreshold(row)"
              :model-value="thresholdText(row)"
              type="number"
              size="sm"
              class="mt-1 max-w-52"
              :label="t('insight.threshold.label')"
              :placeholder="t('insight.threshold.placeholder')"
              :suffix="String(t(`insight.threshold.${thresholdKind(row)}Suffix`))"
              :disabled="locked"
              :error="!!thresholdError(row)"
              :error-message="thresholdError(row)"
              :data-test="`bulk-review-threshold-${row.key}`"
              @update:model-value="(v: string | number) => typeThreshold(row.key, v)"
            />
            <span
              v-else-if="row.row.unsure"
              class="text-text-secondary text-xs"
              :data-test="`bulk-review-unsure-${row.key}`"
            >
              {{ `${row.row.unsure.reason} ${t("insight.bulk.unsureTail")}` }}
            </span>
          </div>
        </template>
        <template #cell-stream="{ row }">
          <span class="text-text-body">{{ row.stream.name }}</span>
        </template>
        <template #cell-firesWhen="{ row }">
          <div
            class="text-text-body block py-1 whitespace-normal"
            :data-test="`bulk-review-firesWhen-${row.key}`"
          >
            <OInput
              v-if="asksThreshold(row)"
              :model-value="thresholdText(row)"
              type="number"
              size="xs"
              :aria-label="t('insight.threshold.label')"
              :placeholder="t('insight.threshold.placeholderShort')"
              :suffix="String(t(`insight.threshold.${thresholdKind(row)}Suffix`))"
              :disabled="locked"
              :error="!!thresholdError(row)"
              :error-message="thresholdError(row)"
              :data-test="`bulk-review-threshold-${row.key}`"
              @update:model-value="(v: string | number) => typeThreshold(row.key, v)"
            />
            <OSkeleton
              v-else-if="waits(row)"
              animation="pulse"
              class="h-4 w-36"
              role="status"
              :aria-label="
                measuring(row) ? t('insight.threshold.measuring') : t('insight.bulk.block.checking')
              "
              :data-test="`bulk-review-measuring-${row.key}`"
            />
            <template v-else>{{ firesWhenOf(t, kind, row) }}</template>
          </div>
        </template>
        <template #cell-usually="{ row }">
          <OSkeleton v-if="waits(row)" animation="pulse" class="h-4 w-20" aria-hidden="true" />
          <span
            v-else-if="asksThreshold(row)"
            class="text-text-secondary"
            :data-test="`bulk-review-no-usual-${row.key}`"
            >{{ t("insight.threshold.noUsual") }}</span
          >
          <span v-else class="text-text-body tabular-nums">{{
            usuallyOf(t, locale, row, kind)
          }}</span>
        </template>
      </OTable>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p
          v-if="unreachable.length && !done"
          :id="FOOTER_ID"
          class="text-status-error-text flex min-w-0 flex-1 items-start gap-1.5 text-xs text-pretty"
          data-test="bulk-review-no-destination"
        >
          <OIcon name="error" size="xs" class="mt-0.5 shrink-0" />
          <span
            >{{ unreachableLine(t, reachGap, unreachable.length) }}
            <OButton
              v-if="reachGap === 'noTeam'"
              variant="ghost-primary"
              size="xs"
              icon-right="arrow-forward"
              data-test="bulk-review-setup-oncall"
              @click="openSetup()"
              >{{ t("alerts.reach.setUpOncall") }}</OButton
            >
            <OButton
              v-if="reachGap === 'noTeam'"
              variant="ghost-primary"
              size="xs"
              :loading="checkingReach"
              data-test="bulk-review-check-oncall"
              @click="checkAgain()"
              >{{ t("alerts.reach.checkAgain") }}</OButton
            ></span
          >
        </p>
        <p
          v-else
          :id="FOOTER_ID"
          class="text-text-body min-w-0 flex-1 text-xs text-pretty"
          data-test="bulk-review-footer"
        >
          {{ footer }}
          <span
            v-if="silent.length && !done"
            class="text-text-secondary"
            data-test="bulk-review-via-incident"
            >{{ viaIncidentLine(t, silent.length) }}</span
          >
          <template v-else-if="tickedRows.length && !done">
            {{ t("insight.bulk.footerOrigin") }}
          </template>
        </p>
        <div class="flex shrink-0 items-center gap-2">
          <OButton
            variant="outline"
            size="sm-action"
            :disabled="running"
            data-test="bulk-review-cancel"
            @click="closeBulkReview()"
          >
            {{ done ? t("insight.bulk.close") : t("insight.bulk.cancel") }}
          </OButton>
          <OButton
            v-if="!done"
            variant="primary"
            size="sm-action"
            :disabled="toCreate.length === 0 || checking || unreachable.length > 0"
            :loading="running"
            :aria-describedby="FOOTER_ID"
            data-test="bulk-review-create"
            @click="createTicked()"
          >
            {{ t("insight.bulk.create") }}
          </OButton>
        </div>
      </div>
    </template>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, provide, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { incidentReachGap, unreachableLine, viaIncidentLine } from "@/utils/alerts/deliveryTarget";
import { useOnCallSetup } from "@/composables/useOnCallSetup";
import { typedThreshold, usableThreshold } from "../targets/thresholds";
import config from "@/aws-exports";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import alertsService from "@/services/alerts";
import useBreakpoint from "@/composables/useBreakpoint";
import { raw, useI18nTyped } from "@/types/i18n";
import BulkReviewGroupHeader from "./BulkReviewGroupHeader.vue";
import BulkRowMark from "./BulkRowMark.vue";
import {
  blockLine,
  createdLine,
  existingFooter,
  failureLine,
  firesWhenOf,
  footerOf,
  needsThresholdLine,
  partialBanner,
  rightsBanner,
  ruleOf,
  serviceLabel,
  titleOf,
  usuallyOf,
  type FailureReason,
} from "./bulkCopy";
import { useBulkCreate } from "./useBulkCreate";
import { existingAlertRoute, type ExistingAlert } from "./existingAlerts";
import {
  DEFAULT_FOLDER,
  asksThreshold,
  changeGroup,
  closeBulkReview,
  countByFolder,
  isTickable,
  loadDestinations,
  loadReviewContext,
  setGroupBy,
  setRowThreshold,
  toggleCollapsed,
  toggleGroup,
  toggleRow,
  useBulkReview,
  COLLAPSE_ROWS,
  type FolderRef,
  type GroupBy,
  type ReviewRow,
} from "./useBulkReview";

// It opens from the service drawer as well as the page, so it must stack one layer above any drawer.
provide("o2DrawerDepth", 1);
const { t, locale: i18nLocale } = useI18nTyped();
const store = useStore();
const router = useRouter();
const enterprise = config.isEnterprise === "true";
const { isMobile } = useBreakpoint();
const { state, reviewRows, groups, toCreate, tickedRows, checking, silent } = useBulkReview();
const locale = computed(() => String(i18nLocale.value));
// What the user typed in each threshold field, so a value the review can't use stays visible with its reason.
const typed = reactive<Record<string, string>>({});
const typeThreshold = (key: string, value: string | number) => {
  typed[key] = String(value ?? "");
  setRowThreshold(key, typedThreshold(value));
};
watch(
  () => state.request,
  () => Object.keys(typed).forEach((key) => delete typed[key]),
);
const thresholdText = (row: ReviewRow) =>
  typed[row.key] ?? (row.threshold === null ? "" : String(row.threshold));
const thresholdError = (row: ReviewRow) => {
  if (!(row.key in typed)) return undefined;
  if (typed[row.key].trim() === "") return t("insight.threshold.required");
  const kind = thresholdKind(row);
  if (usableThreshold(kind, typedThreshold(typed[row.key])) !== null) return undefined;
  return kind === "errors" ? t("insight.threshold.invalidErrors") : t("insight.threshold.invalid");
};
const ALERT_NAME: Record<string, "errors" | "latency" | "absence"> = {
  errors: "errors",
  latency: "latency",
  no_data: "absence",
  source: "absence",
};
const alertName = (row: ReviewRow) =>
  t(`insight.kind.classes.name.${ALERT_NAME[row.row.kind ?? kind.value] ?? "absence"}`);
const reachGap = computed(() => incidentReachGap(store.state.zoConfig));
// Every AutoObserve draft opens an incident, so a row with no destination is blocked only when that pages no one.
const unreachable = computed(() => (reachGap.value === null ? [] : silent.value));
const { openSetup, checkAgain, checking: checkingReach } = useOnCallSetup();
const FOOTER_ID = "bulk-review-footer-reason";
const org = () => String(store.state.selectedOrganization?.identifier ?? "");

const { results, running, create, retry, reset, expire, hideUndo, showUndo } = useBulkCreate({
  org,
  store,
  router,
  t,
  locale: () => locale.value,
  floorMinutes: () =>
    Math.max(1, Math.ceil(Number(store.state.zoConfig?.min_auto_refresh_interval ?? 0) / 60)),
});

const kind = computed(() => state.request?.kind ?? "no_data");
const done = computed(() => Object.keys(results).length > 0 && !running.value);
const locked = computed(() => running.value || done.value);

const title = computed(() =>
  state.request?.title ? raw(state.request.title) : titleOf(t, kind.value, reviewRows.value.length),
);
const rule = computed(() => ruleOf(t, kind.value, reviewRows.value));
const rights = computed(() => rightsBanner(t, locale.value, reviewRows.value));
const footer = computed(() => {
  if (done.value) return raw("");
  const existing = existingFooter(t, reviewRows.value);
  // When every draft already exists, that is the reason nothing can be added.
  if (existing && reviewRows.value.every((r) => r.block?.code === "exists")) return existing;
  const needs = reviewRows.value.filter((r) => !r.locked && r.block?.code === "noBaseline").length;
  const parts = [
    needs ? needsThresholdLine(t, needs) : null,
    footerOf(t, locale.value, countByFolder(tickedRows.value)),
    existing,
  ];
  return raw(parts.filter(Boolean).join(" "));
});

const groupByOptions = computed(() =>
  (["team", "folder", "cluster"] as GroupBy[]).map((value) => ({
    label: t(`insight.bulk.groupByOption.${value}`),
    value,
  })),
);

const folderChoices = computed<FolderRef[]>(() => {
  const list = state.folders.length ? state.folders : [DEFAULT_FOLDER];
  return list.some((f) => f.id === DEFAULT_FOLDER.id) ? list : [DEFAULT_FOLDER, ...list];
});

const groupMap = computed(() => new Map(groups.value.map((g) => [g.key, g])));
const groupOf = (key: string) => groupMap.value.get(key);
const sectionOf = computed(
  () => new Map(groups.value.flatMap((g) => g.rows.map((r) => [r.key, g.key] as const))),
);
const tableRows = computed(() => groups.value.flatMap((g) => g.rows));
const collapsible = computed(() => reviewRows.value.length > COLLAPSE_ROWS);
const hidden = computed(
  () =>
    new Set(
      groups.value
        .filter((g) => state.collapsed.has(g.key))
        .flatMap((g) => g.rows.map((r) => r.key)),
    ),
);

const label = (row: ReviewRow) => serviceLabel(t, row, reviewRows.value);

const thresholdKind = (row: ReviewRow) =>
  (row.row.kind ?? kind.value) === "latency" ? "latency" : "errors";

const compactLine = (row: ReviewRow) =>
  [row.stream.name, firesWhenOf(t, kind.value, row), usuallyOf(t, locale.value, row, kind.value)]
    .filter(Boolean)
    .join(" · ");

const measuring = (row: ReviewRow) => row.block?.code === "measuring";

const waits = (row: ReviewRow) => measuring(row) || row.block?.code === "checking";

const columns = computed<OTableColumnDef<ReviewRow>[]>(() => [
  { id: "tick", header: raw(""), size: 44 },
  // `max-w-0` keeps a long line out of the auto-layout width, so Service takes only the room left.
  {
    id: "service",
    header: t("insight.bulk.column.service"),
    meta: { autoWidth: true, cellClass: "max-w-0" },
  },
  ...(isMobile.value
    ? []
    : [
        { id: "stream", header: t("insight.bulk.column.stream"), size: 120 },
        { id: "firesWhen", header: t("insight.bulk.column.firesWhen"), size: 220 },
        { id: "usually", header: t("insight.bulk.column.usually"), size: 130 },
      ]),
]);

interface Failure {
  row: ReviewRow;
  reason: FailureReason;
  retryable: boolean;
}

const rowByKey = computed(() => new Map(reviewRows.value.map((r) => [r.key, r])));
const failures = computed<Failure[]>(() =>
  Object.entries(results).flatMap(([key, result]) => {
    const row = rowByKey.value.get(key);
    return result.status === "failed" && row && result.reason
      ? [{ row, reason: result.reason, retryable: !!result.retryable }]
      : [];
  }),
);
const retryable = computed(() => failures.value.filter((f) => f.retryable));
const duplicates = computed(() => failures.value.filter((f) => f.reason.code === "duplicate"));
const attempted = computed(() => Object.keys(results).length);
const createdRows = computed(() =>
  Object.entries(results).flatMap(([key, r]) =>
    r.status === "created" && rowByKey.value.has(key) ? [rowByKey.value.get(key)!] : [],
  ),
);
const createdCount = computed(() => createdRows.value.length);
const createdFolders = computed(() => countByFolder(createdRows.value).map((c) => c.folder));

const failureBanner = ref<{ $el?: HTMLElement } | null>(null);

// The banner sits above rows the user may have scrolled past while results came in.
watch(
  () => failures.value.length > 0 && !running.value,
  async (show) => {
    if (!show) return;
    await nextTick();
    failureBanner.value?.$el?.scrollIntoView?.({ block: "nearest" });
  },
);

const createTicked = () => create(kind.value, toCreate.value);

const openAdded = (alert: ExistingAlert) => {
  closeBulkReview();
  router.push(existingAlertRoute(org(), alert));
};

const openExisting = async (row: ReviewRow) => {
  const name = row.prefill?.name ?? "";
  let alertId = "";
  try {
    const res = await alertsService.listByFolderId(
      1,
      20,
      "name",
      false,
      "",
      org(),
      row.folder.id,
      name,
      undefined,
      false,
      { silentForbidden: true },
    );
    alertId = (res.data?.list ?? []).find((a: any) => a.name === name)?.alert_id ?? "";
  } catch {
    alertId = "";
  }
  const query: Record<string, string> = { folder: row.folder.id, org_identifier: org() };
  if (alertId) Object.assign(query, { action: "update", alert_id: alertId });
  closeBulkReview();
  router.push({ name: "alertList", query });
};

watch(
  () => state.open && state.request,
  (request) => {
    if (!request) return;
    reset();
    // On a phone the earlier batch's Undo toast sits over this review's Create button.
    hideUndo();
    void loadReviewContext(org());
  },
);

watch(
  () => state.open,
  (open) => !open && showUndo(),
);

// The review and its Undo belong to the org they were opened in.
watch(
  () => org(),
  (now, before) => {
    if (now === before) return;
    expire();
    closeBulkReview();
  },
);

onBeforeUnmount(() => {
  expire();
  closeBulkReview();
});
</script>
