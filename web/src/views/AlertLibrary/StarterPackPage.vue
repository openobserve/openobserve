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

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import config from "@/aws-exports";
import StarterPackDrawer from "@/components/starterPacks/StarterPackDrawer.vue";
import StarterPackFindMore from "@/components/starterPacks/StarterPackFindMore.vue";
import StarterPackHealthLine from "@/components/starterPacks/StarterPackHealthLine.vue";
import StarterPackRepairChip from "@/components/starterPacks/StarterPackRepairChip.vue";
import StarterPackUpdateDrawer from "@/components/starterPacks/StarterPackUpdateDrawer.vue";
import StarterPackUndoDialog from "@/components/starterPacks/StarterPackUndoDialog.vue";
import TurnOnAlertsDrawer from "@/components/starterPacks/TurnOnAlertsDrawer.vue";
import QuickMuteDialog from "@/components/alerts/downtimes/QuickMuteDialog.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { readQuery } from "@/composables/query/readQuery";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import { KUBERNETES_PACK } from "@/composables/starterPacks/kubernetesPack";
import { packScopeValue } from "@/composables/starterPacks/packCopy";
import { useStarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import { useStarterPackMatcher } from "@/composables/starterPacks/useStarterPackMatcher";
import { usePackHealth } from "@/composables/starterPacks/usePackHealth";
import { usePackUpdates } from "@/composables/starterPacks/usePackUpdates";
import { alertStreams } from "@/composables/starterPacks/useRepairLater";
import { useTurnOnAlerts, type TurnOnRow } from "@/composables/starterPacks/useTurnOnAlerts";
import { queriesPerDay } from "@/composables/starterPacks/wouldFire";
import { alertHistoryQuery } from "@/services/alerts.queries";
import { permittedFoldersQuery } from "@/services/common.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { toast } from "@/lib/feedback/Toast/useToast";

const FIRED_WINDOW_US = 7 * 24 * 60 * 60 * 1_000_000;

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();
const org = String(route.query.org_identifier ?? store.state.selectedOrganization?.identifier);
const pack = KUBERNETES_PACK;
const packsEnabled = STARTER_PACKS_ENABLED;
const flow = useStarterPackFlow(org, pack);
const matcher = useStarterPackMatcher(org);
const turn = useTurnOnAlerts(org, flow);
const health = usePackHealth(org);
const updates = usePackUpdates(org, flow);

const turnOnOpen = ref(false);
const setupOpen = ref(false);
const removeOpen = ref(false);
const updateOpen = ref(false);
const muteRow = ref<TurnOnRow | null>(null);
const editRow = ref<TurnOnRow | null>(null);
const thresholdDraft = ref<string | number>("");
const fired = shallowRef<Record<string, number>>({});
const folderNames = ref<string[]>([]);
const folderName = ref(pack.folder.name);

const enterprise = computed(
  () => store.state.zoConfig?.build_type !== "opensource" && config.isEnterprise === "true",
);
const rows = computed(() => turn.rows.value);
const offCount = computed(() => rows.value.filter(({ enabled }) => !enabled).length);
const onRows = computed(() => rows.value.filter(({ enabled }) => enabled));
const folderId = computed(
  () => flow.record.value?.items.find(({ kind }) => kind === "folder")?.id ?? "",
);
const folderLabel = computed(() => flow.record.value?.folderName ?? pack.folder.name);
const installedOn = computed(() => {
  const at = flow.record.value?.installedAt;
  return at ? new Date(at / 1000).toLocaleString() : "";
});
const perDay = computed(() => queriesPerDay(onRows.value.map(({ alert }) => alert)));
// A repaired alert's query reads the new stream while its stream setting keeps the name it was created with.
const readsOf = ({ alert }: TurnOnRow): string[] => {
  const reads = packsEnabled ? [...alertStreams(alert)] : [];
  return reads.length ? reads : [alert.stream_name];
};
const movedFrom = (row: TurnOnRow) => {
  const reads = readsOf(row);
  return reads.includes(row.alert.stream_name) ? null : reads.join(", ");
};
const isStale = (row: TurnOnRow) =>
  readsOf(row).some((name) => health.staleStreams.value.has(name));
const streams = computed(() => [...new Set(rows.value.flatMap(readsOf))]);
const ITEM_KINDS = ["dashboard", "alert", "savedView"] as const;
const itemGroups = computed(() =>
  ITEM_KINDS.map((kind) => ({
    kind,
    items: flow.items.value.filter((item) => item.kind === kind),
  })).filter(({ items }) => items.length),
);
const silentFired = computed(() =>
  onRows.value.filter(({ id, alert }) => (fired.value[id] ?? 0) > 0 && !alert.destinations?.length),
);
const silentFiredTimes = computed(() =>
  silentFired.value.reduce((sum, { id }) => sum + (fired.value[id] ?? 0), 0),
);
const packVersion = computed(() => flow.record.value?.version ?? pack.version);
const showAsk = computed(() => flow.forbidden.value || turn.forbidden.value);
const pageState = computed(() => {
  if (!flow.loaded.value) return "loading";
  if (flow.loadFailed.value) return "error";
  return flow.record.value ? "installed" : "empty";
});
const folderOptions = computed(() =>
  [...new Set([pack.folder.name, ...folderNames.value])].map((name) => ({
    label: raw(name),
    value: name,
  })),
);
const columns = computed<OTableColumnDef<TurnOnRow>[]>(() => [
  { id: "name", header: t("starterPacks.turnOn.colAlert"), accessorKey: "name", size: 280 },
  { id: "state", header: t("starterPacks.page.colState"), size: 110 },
  { id: "fired", header: t("starterPacks.page.colFired"), size: 110 },
  { id: "notifies", header: t("starterPacks.page.colNotifies"), size: 170 },
  { id: "actions", header: raw(""), isAction: true, size: 300 },
]);

const readFired = async () => {
  const end = Date.now() * 1000;
  const counts = await Promise.all(
    onRows.value.map(async ({ id }) => {
      const query = {
        alert_id: id,
        status: "firing",
        start_time: end - FIRED_WINDOW_US,
        end_time: end,
        from: 0,
        size: 1,
      };
      const reply = await readQuery(alertHistoryQuery(org, query)).catch(() => null);
      return [id, Number(reply?.total ?? 0)] as const;
    }),
  );
  fired.value = Object.fromEntries(counts);
};

const refresh = async () => {
  await flow.load();
  if (!flow.record.value) {
    if (flow.isAdmin.value) {
      const folders = await readQuery(permittedFoldersQuery(org, "alerts")).catch(() => []);
      folderNames.value = folders.map(({ name }) => name);
    }
    return;
  }
  await turn.load({ count: false });
  if (packsEnabled) void updates.check();
  await Promise.all([
    flow.loadPreview(),
    readFired(),
    health.check(streams.value),
    matcher.check(),
  ]);
};

onMounted(refresh);
watch(setupOpen, (isOpen) => {
  if (isOpen) void flow.loadPreview();
});

const setUp = async () => {
  setupOpen.value = true;
  if (await flow.install(folderName.value === pack.folder.name ? undefined : folderName.value)) {
    setupOpen.value = false;
    await refresh();
  }
};
const manageAccess = () =>
  router
    .push({ name: "alertList", query: { org_identifier: org, folder: folderId.value } })
    .catch(() => {});
const openView = () => flow.land();
const copyLink = () => copyToClipboard(flow.packLink(), t);
const thresholdOf = ({ alert }: TurnOnRow) =>
  alert.query_condition?.type === "promql"
    ? alert.query_condition.promql_condition?.value
    : alert.trigger_condition?.threshold;
const startEdit = (row: TurnOnRow) => {
  editRow.value = row;
  thresholdDraft.value = thresholdOf(row);
};
const saveThreshold = async () => {
  const value = Number(thresholdDraft.value);
  if (!editRow.value || !Number.isFinite(value)) return;
  if (await turn.setThreshold(editRow.value.id, value, { count: false })) {
    editRow.value = null;
    return;
  }
  toast({ variant: "error", message: t("starterPacks.page.thresholdFailed") });
};
const turnOff = async (targets: TurnOnRow[]) => {
  await turn.turnOff(targets);
};
const muteSelection = computed(() =>
  muteRow.value ? [{ module: "alerts" as const, ids: [muteRow.value.id] }] : [],
);
const muteContext = computed(() =>
  muteRow.value
    ? { alertId: muteRow.value.id, name: muteRow.value.name, folderId: muteRow.value.folderId }
    : null,
);
</script>

<template>
  <OPageLayout
    bleed
    :title="t('starterPacks.page.title', { title: t(pack.titleKey) })"
    icon="hub"
    :subtitle="
      t('starterPacks.page.breadcrumb', { pack: t(pack.titleKey), version: raw(packVersion) })
    "
    title-data-test="starter-pack-page-title"
  >
    <template #actions>
      <StarterPackFindMore v-if="packsEnabled" :org="org" @changed="flow.load()" />
      <StarterPackRepairChip
        v-if="packsEnabled && pageState === 'installed' && flow.canManage.value"
        :org="org"
        :scope="{ packId: pack.id }"
        @repaired="refresh"
      />
      <template v-if="pageState === 'installed' && flow.canManage.value">
        <OButton
          variant="ghost-destructive"
          size="sm-action"
          data-test="starter-pack-page-remove-btn"
          @click="removeOpen = true"
        >
          {{ t("starterPacks.landing.remove") }}
        </OButton>
        <OButton
          v-if="onRows.length"
          variant="outline"
          size="sm-action"
          data-test="starter-pack-page-turn-off-all-btn"
          @click="turnOff(onRows)"
        >
          {{ t("starterPacks.page.turnOffAll") }}
        </OButton>
        <OButton
          v-if="offCount"
          variant="primary"
          size="sm-action"
          data-test="starter-pack-page-turn-on-btn"
          @click="turnOnOpen = true"
        >
          {{ t("starterPacks.turnOn.submit", { count: offCount }, offCount) }}
        </OButton>
      </template>
    </template>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 text-sm">
      <OBanner v-if="showAsk" variant="default" dense inline-actions icon="lock">
        {{ t("starterPacks.page.askAdmin", { folder: raw(folderLabel) }) }}
        <template #actions>
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="content-copy"
            data-test="starter-pack-page-copy-link-btn"
            @click="copyLink"
          >
            {{ t("starterPacks.copyLink") }}
          </OButton>
        </template>
      </OBanner>

      <div v-if="pageState === 'loading'" class="flex flex-col gap-2">
        <OSkeleton class="h-6 w-full" />
        <OSkeleton class="h-6 w-full" />
      </div>
      <OBanner v-else-if="pageState === 'error'" variant="default" dense inline-actions>
        {{ t("starterPacks.page.loadFailed") }}
        <template #actions>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="starter-pack-page-retry-btn"
            @click="refresh"
          >
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>
      <div
        v-else-if="pageState === 'empty'"
        class="border-border-default rounded-default flex flex-wrap items-end gap-3 border p-3"
      >
        <p class="min-w-0 flex-1">{{ t("starterPacks.page.notSetUp") }}</p>
        <OSelect
          v-if="flow.isAdmin.value"
          v-model="folderName"
          class="w-64"
          :label="t('starterPacks.page.setUpIn')"
          :options="folderOptions"
          label-key="label"
          value-key="value"
          data-test="starter-pack-page-folder-select"
        />
        <OButton
          variant="outline"
          size="sm-action"
          data-test="starter-pack-page-details-btn"
          @click="setupOpen = true"
        >
          {{ t("starterPacks.details") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          data-test="starter-pack-page-setup-btn"
          @click="setUp"
        >
          {{ t("starterPacks.setUp") }}
        </OButton>
      </div>
      <template v-else>
        <OBanner
          v-if="silentFired.length"
          variant="error-soft"
          dense
          data-test="starter-pack-page-silent-banner"
        >
          {{
            t(
              "starterPacks.page.silentFired",
              { count: silentFired.length, times: silentFiredTimes },
              silentFired.length,
            )
          }}
        </OBanner>
        <StarterPackHealthLine :org="org" />
        <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1" data-test="starter-pack-page-tiles">
          <div
            class="border-border-default rounded-default flex flex-col gap-1 border p-3"
            data-test="starter-pack-page-tile-installed"
          >
            <OText variant="meta">{{ t("starterPacks.page.tileInstalled") }}</OText>
            <strong class="text-lg">{{
              t("starterPacks.page.installedOf", {
                made: flow.made.value.length,
                total: flow.items.value.length,
              })
            }}</strong>
          </div>
          <div
            class="border-border-default rounded-default flex flex-col gap-1 border p-3"
            data-test="starter-pack-page-tile-data"
          >
            <OText variant="meta">{{ t("starterPacks.page.tileData") }}</OText>
            <strong class="text-lg">{{
              t("starterPacks.page.streamCount", { count: streams.length }, streams.length)
            }}</strong>
          </div>
          <div
            class="border-border-default rounded-default flex flex-col gap-1 border p-3"
            data-test="starter-pack-page-tile-version"
          >
            <OText variant="meta">{{ t("starterPacks.page.tileVersion") }}</OText>
            <strong class="text-lg">{{ packVersion }}</strong>
          </div>
        </div>
        <div
          class="border-border-default rounded-default flex flex-col border"
          data-test="starter-pack-page-items"
        >
          <div class="flex items-center justify-between px-3 py-2">
            <strong>{{ t("starterPacks.page.items") }}</strong>
            <OButton
              variant="ghost-primary"
              size="sm-action"
              data-test="starter-pack-page-open-btn"
              @click="openView"
            >
              {{ t("starterPacks.page.open") }}
            </OButton>
          </div>
          <template v-for="group in itemGroups" :key="group.kind">
            <OText
              variant="meta"
              class="bg-surface-subtle px-3 py-1"
              :data-test="`starter-pack-page-group-${group.kind}`"
              >{{
                t(`starterPacks.page.group.${group.kind}`, { count: group.items.length })
              }}</OText
            >
            <div
              v-for="item in group.items"
              :key="item.itemId"
              class="border-border-default flex items-center justify-between gap-2 border-t px-3 py-1.5"
              :class="{ 'bg-banner-error-bg': item.status === 'failed' }"
              :data-test="`starter-pack-page-item-${item.status}`"
            >
              <span class="min-w-0 truncate">{{ flow.nameOf(item.itemId) }}</span>
              <OBadge
                v-if="item.status === 'failed' || item.status === 'skipped'"
                :variant="item.status === 'failed' ? 'error-outline' : 'default-outline'"
              >
                {{ t(`starterPacks.page.status.${item.status}`) }}
              </OBadge>
            </div>
          </template>
          <OText
            v-for="repair in flow.record.value?.repairs ?? []"
            :key="repair.from"
            variant="meta"
            class="border-border-default border-t px-3 py-1.5"
            data-test="starter-pack-page-repair"
          >
            {{ t("starterPacks.page.repair", { from: raw(repair.from), to: raw(repair.to) }) }}
          </OText>
        </div>
        <template v-if="packsEnabled && flow.canManage.value">
          <OBanner
            v-if="updates.available.value"
            variant="info"
            dense
            inline-actions
            data-test="starter-pack-page-update"
          >
            {{ t("starterPacks.update.available") }}
            <template #actions>
              <OButton
                variant="outline"
                size="sm-action"
                data-test="starter-pack-page-update-btn"
                @click="updateOpen = true"
              >
                {{ t("starterPacks.update.review") }}
              </OButton>
            </template>
          </OBanner>
          <OBanner
            v-if="updates.needsDashboard.value"
            variant="info"
            dense
            inline-actions
            data-test="starter-pack-page-add-dashboard"
          >
            {{ t("starterPacks.page.addDashboard") }}
            <template #actions>
              <OButton
                variant="primary"
                size="sm-action"
                :loading="updates.state.value === 'applying'"
                data-test="starter-pack-page-add-dashboard-btn"
                @click="updates.addDashboard()"
              >
                {{ t("starterPacks.page.addDashboardBtn") }}
              </OButton>
            </template>
          </OBanner>
        </template>
        <OBanner
          v-if="!onRows.length && offCount"
          variant="info"
          dense
          data-test="starter-pack-page-off"
        >
          {{ t("starterPacks.home.reminder", { count: offCount }, offCount) }}
        </OBanner>
        <div class="grid min-h-0 grid-cols-[minmax(0,1fr)_20rem] gap-3 max-lg:grid-cols-1">
          <div class="min-h-80" data-test="starter-pack-page-alerts-table">
            <OTable
              :data="rows"
              :columns="columns"
              row-key="id"
              :loading="turn.loadState.value === 'loading'"
            >
              <template #cell-name="{ row }">
                <span class="flex min-w-0 flex-col items-start gap-0.5">
                  <span class="flex items-center gap-2">
                    {{ row.name }}
                    <OBadge
                      :variant="row.severity === 'critical' ? 'error-outline' : 'warning-outline'"
                    >
                      {{ t(`starterPacks.severity.${row.severity as "critical" | "warning"}`) }}
                    </OBadge>
                  </span>
                  <OText
                    v-if="packsEnabled && movedFrom(row)"
                    variant="meta"
                    :title="
                      t('starterPacks.page.readsInsteadTip', {
                        stream: raw(movedFrom(row) ?? ''),
                        name: raw(row.alert.stream_name),
                      })
                    "
                    data-test="starter-pack-page-reads-instead"
                  >
                    {{
                      t("starterPacks.page.readsInstead", {
                        stream: raw(movedFrom(row) ?? ""),
                        name: raw(row.alert.stream_name),
                      })
                    }}
                  </OText>
                </span>
              </template>
              <template #cell-state="{ row }">
                <OBadge
                  v-if="isStale(row)"
                  variant="default"
                  data-test="starter-pack-page-no-data-tag"
                >
                  {{ t("starterPacks.turnOn.noData") }}
                </OBadge>
                <OBadge v-else :variant="row.enabled ? 'success-outline' : 'default-outline'">
                  {{ t(row.enabled ? "starterPacks.page.watching" : "starterPacks.page.off") }}
                </OBadge>
              </template>
              <template #cell-fired="{ row }">
                {{ row.enabled ? (fired[row.id] ?? 0) : raw("—") }}
              </template>
              <template #cell-notifies="{ row }">
                {{ row.alert.destinations?.join(", ") || raw("—") }}
              </template>
              <template #cell-actions="{ row }">
                <span v-if="flow.canManage.value" class="flex items-center justify-end gap-1">
                  <OButton
                    variant="ghost-primary"
                    size="sm-action"
                    data-test="starter-pack-page-edit-threshold-btn"
                    @click="startEdit(row)"
                  >
                    {{ t("starterPacks.turnOn.editThreshold") }}
                  </OButton>
                  <OButton
                    v-if="enterprise && row.enabled"
                    variant="ghost-primary"
                    size="sm-action"
                    data-test="starter-pack-page-mute-btn"
                    @click="muteRow = row"
                  >
                    {{ t("starterPacks.page.muteFor") }}
                  </OButton>
                  <OButton
                    v-if="row.enabled"
                    variant="ghost-primary"
                    size="sm-action"
                    @click="turnOff([row])"
                  >
                    {{ t("starterPacks.page.turnOff") }}
                  </OButton>
                  <OButton
                    v-else
                    variant="ghost-primary"
                    size="sm-action"
                    @click="turnOnOpen = true"
                  >
                    {{ t("starterPacks.page.turnOn") }}
                  </OButton>
                </span>
              </template>
            </OTable>
          </div>
          <div class="flex flex-col gap-3">
            <div
              class="border-border-default rounded-default flex flex-col gap-1 border p-3"
              data-test="starter-pack-page-about"
            >
              <strong>{{ t("starterPacks.page.about") }}</strong>
              <span>{{
                t("starterPacks.page.setUpBy", { who: raw(flow.record.value?.installedBy ?? "") })
              }}</span>
              <span>{{ t("starterPacks.page.date", { date: raw(installedOn) }) }}</span>
              <span>{{ t("starterPacks.page.queries", { count: perDay.toLocaleString() }) }}</span>
              <OText variant="meta">{{ t("starterPacks.page.scanNote") }}</OText>
              <OButton
                v-if="packsEnabled && flow.canManage.value && updates.canRevert.value"
                class="self-start"
                variant="ghost-primary"
                size="sm-action"
                :loading="updates.state.value === 'applying'"
                data-test="starter-pack-page-revert-btn"
                @click="updates.revert()"
              >
                {{ t("starterPacks.update.revert") }}
              </OButton>
            </div>
            <div
              class="border-border-default rounded-default flex flex-col gap-1 border p-3"
              data-test="starter-pack-page-reach"
            >
              <strong>{{ t("starterPacks.page.reads") }}</strong>
              <span>{{ packScopeValue(t, matcher.clusters.value) }}</span>
              <span>{{ t("starterPacks.page.streams", { count: streams.length }) }}</span>
            </div>
            <div
              class="border-border-default rounded-default flex flex-col items-start gap-1 border p-3"
              data-test="starter-pack-page-access"
            >
              <strong>{{ t("starterPacks.page.whoCanSee") }}</strong>
              <span>{{ t("starterPacks.page.folderAccess", { folder: raw(folderLabel) }) }}</span>
              <OButton
                variant="ghost-primary"
                size="sm-action"
                data-test="starter-pack-page-access-btn"
                @click="manageAccess"
              >
                {{ t("starterPacks.page.manageAccess") }}
              </OButton>
            </div>
          </div>
        </div>
      </template>
    </div>

    <TurnOnAlertsDrawer
      v-model:open="turnOnOpen"
      :flow="flow"
      :clusters="matcher.clusters.value"
      @done="refresh"
    />
    <StarterPackDrawer v-model:open="setupOpen" :flow="flow" :clusters="matcher.clusters.value" />
    <StarterPackUpdateDrawer v-if="packsEnabled" v-model:open="updateOpen" :updates="updates" />
    <StarterPackUndoDialog v-model:open="removeOpen" :flow="flow" mode="remove" @done="refresh" />
    <ODialog
      :open="!!editRow"
      size="xs"
      :title="t('starterPacks.turnOn.editThreshold')"
      :primary-button-label="t('common.save')"
      primary-button-data-test="starter-pack-page-threshold-save-btn"
      :secondary-button-label="t('common.cancel')"
      @update:open="editRow = null"
      @click:primary="saveThreshold"
      @click:secondary="editRow = null"
    >
      <OInput
        v-model="thresholdDraft"
        type="number"
        :label="t('starterPacks.page.threshold')"
        data-test="starter-pack-page-threshold-input"
      />
    </ODialog>
    <QuickMuteDialog
      v-if="enterprise && muteRow"
      :open="true"
      :selection="muteSelection"
      :alert="muteContext"
      @update:open="muteRow = null"
      @muted="muteRow = null"
    />
  </OPageLayout>
</template>
