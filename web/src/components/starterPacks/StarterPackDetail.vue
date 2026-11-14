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
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import OTag from "@/lib/core/Badge/OTag.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import ONoticeBar from "@/lib/feedback/NoticeBar/ONoticeBar.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import { STARTER_PACKS_ENABLED } from "@/constants/starterPacks";
import { adaptSavedView } from "@/composables/starterPacks/packAdapt";
import type { PackContentRow } from "@/composables/starterPacks/packContents";
import type { StarterPack } from "@/composables/starterPacks/types";
import { useStarterPackNotices } from "@/composables/starterPacks/useStarterPackNotices";
import { useStarterPackPage } from "@/composables/starterPacks/useStarterPackPage";
import { raw, useI18nTyped } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import { getImageURL } from "@/utils/zincutils";
import StarterPackAboutTab from "./StarterPackAboutTab.vue";
import StarterPackContentsTab from "./StarterPackContentsTab.vue";
import StarterPackDrawer from "./StarterPackDrawer.vue";
import StarterPackHeaderActions from "./StarterPackHeaderActions.vue";
import StarterPackItemDrawer from "./StarterPackItemDrawer.vue";
import StarterPackRepairPanel from "./StarterPackRepairPanel.vue";
import StarterPackStreamsTab from "./StarterPackStreamsTab.vue";
import StarterPackSummaryStrip from "./StarterPackSummaryStrip.vue";
import StarterPackUndoDialog from "./StarterPackUndoDialog.vue";
import StarterPackUpdateDrawer from "./StarterPackUpdateDrawer.vue";
import TurnOnAlertsDrawer from "./TurnOnAlertsDrawer.vue";

const props = defineProps<{ org: string; pack: StarterPack }>();

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const pack = props.pack;
const org = props.org;
const page = useStarterPackPage(org, pack);
const { flow, updates } = page;

const tab = ref("contents");
const turnOnOpen = ref(false);
const preselect = ref<string[] | undefined>();
const setupOpen = ref(false);
const removeOpen = ref(false);
const undoOpen = ref(false);
const updateOpen = ref(false);
const repairOpen = ref(false);
const itemOpen = ref(false);
const selected = ref<PackContentRow | null>(null);
const folderName = ref(pack.folder.name);

const title = computed(() => t(pack.titleKey));
const loading = computed(() => page.pageState.value === "loading");
const failed = computed(() => page.pageState.value === "error");
const showUpdateTag = computed(
  () =>
    STARTER_PACKS_ENABLED &&
    page.installed.value &&
    page.canManage.value &&
    updates.available.value,
);
const back = computed(() => ({
  label: t("starterPacks.page.back"),
  to: { name: "starterPacks", query: { org_identifier: org } },
  dataTest: "starter-pack-page-back",
}));

const go = (to: RouteLocationRaw, newTab = false) => {
  if (!newTab) return router.push(to).catch(() => {});
  window.open(router.resolve(to).href, "_blank", "noopener");
  return Promise.resolve();
};
const folderIdOf = (type: "alerts" | "dashboards") =>
  flow.record.value?.items.find(({ kind, itemId }) => kind === "folder" && itemId === type)?.id;

const routeOf = (row: PackContentRow, edit = false): RouteLocationRaw => {
  if (row.kind === "alert") {
    return {
      name: edit ? "editAlert" : "alertDetail",
      params: { alert_id: row.id ?? "" },
      query: { org_identifier: org, folder: row.folderId || "default" },
    };
  }
  if (row.kind === "dashboard") {
    const query = { org_identifier: org, dashboard: row.id ?? "", folder: row.folderId ?? "" };
    return { name: "viewDashboard", query: { ...query, pack: pack.id } };
  }
  // Logs has no link to a saved view, so Open runs the view's search on its stream.
  const view = pack.savedViews.find(({ id }) => id === row.itemId);
  const stream = view
    ? adaptSavedView(view.search, flow.record.value?.repairs ?? []).data?.stream
    : null;
  return {
    name: "logs",
    query: {
      org_identifier: org,
      ...(stream?.selectedStream?.length
        ? { stream_type: stream.streamType ?? "logs", stream: stream.selectedStream.join(",") }
        : {}),
    },
  };
};

const openRow = (row: PackContentRow, newTab = false) => go(routeOf(row), newTab);
// The dashboard has no edit-mode link yet, so Edit opens it.
const editRow = (row: PackContentRow) => go(routeOf(row, row.kind === "alert"));
const copyRowLink = (row: PackContentRow) => {
  const { href } = router.resolve(routeOf(row));
  void copyToClipboard(new URL(href, window.location.origin).href, t);
};
const openAlerts = () => go(flow.alertsRoute.value);
const openDashboards = () =>
  go({ name: "dashboards", query: { org_identifier: org, folder: folderIdOf("dashboards") } });
const openFolder = () => openAlerts();
const checkCollector = () => {
  if (pack.collectorRoute) void go({ name: pack.collectorRoute, query: { org_identifier: org } });
};
const selectRow = (row: PackContentRow) => {
  selected.value = row;
  itemOpen.value = true;
};
const addNow = async (row: PackContentRow) => {
  if (!(await page.addNow(row.itemId))) {
    toast({ variant: "error", message: t("starterPacks.page.addNowFailed") });
  }
};

const openTurnOn = (ids?: string[]) => {
  preselect.value = ids;
  turnOnOpen.value = true;
};

const { notices } = useStarterPackNotices(page, {
  retry: () => void page.retry(),
  repair: () => (repairOpen.value = true),
  routeAlerts: openAlerts,
  checkCollector,
  undo: () => (undoOpen.value = true),
});

// The Library card links here with ?turnOn=1 so one drawer host serves both pages.
const consumeTurnOnLink = () => {
  if (route.query.turnOn !== "1" || !page.installed.value || !page.canManage.value) return;
  if (!page.turn.listedRows.value.length) return;
  router.replace({ query: { ...route.query, turnOn: undefined } }).catch(() => {});
  openTurnOn();
};

onMounted(() => page.refresh());
// A Ready link can land while the rows reload, when it finds nothing to list yet.
watch(
  () => page.refreshing.value,
  (busy) => {
    if (!busy) consumeTurnOnLink();
  },
);
// The setup popup's Ready links add ?turnOn=1 to this same page, which does not remount it.
watch(
  () => route.query.turnOn,
  () => consumeTurnOnLink(),
);
watch(setupOpen, (isOpen) => {
  if (isOpen) void flow.loadPreview();
});
watch(turnOnOpen, (isOpen) => {
  if (!isOpen) preselect.value = undefined;
});
// A refused write turns the page view-only; the toast says why the buttons went away.
watch(
  () => flow.forbidden.value || page.turn.forbidden.value,
  (denied) => {
    if (denied) toast({ variant: "error", message: t("starterPacks.page.forbidden") });
  },
);
</script>

<template>
  <OPageLayout bleed :title="title" :back="back" title-data-test="starter-pack-page-title">
    <template #title>
      <span class="flex min-w-0 items-center gap-2">
        <img
          v-if="pack.logo"
          :src="getImageURL(pack.logo)"
          class="size-5 shrink-0 object-contain"
          alt=""
        />
        <span class="truncate">{{ title }}</span>
      </span>
    </template>
    <template #subtitle>{{ t(pack.descriptionKey) }}</template>
    <template #title-trail>
      <span v-if="loading" class="flex items-center gap-2">
        <OSkeleton type="text" class="h-5 w-20" />
      </span>
      <span v-else-if="!failed" class="flex shrink-0 items-center gap-2">
        <OTag
          type="starterPackStatus"
          :value="page.status.value"
          size="sm"
          class="ring-0!"
          data-test="starter-pack-page-status"
        />
        <span class="text-text-secondary text-compact" data-test="starter-pack-page-version">{{
          raw(`v${flow.record.value?.version ?? pack.version}`)
        }}</span>
        <OTag
          v-if="showUpdateTag"
          variant="primary-soft"
          icon="arrow-upward"
          size="sm"
          class="ring-0!"
          :label="t('starterPacks.page.chipUpdate')"
          data-test="starter-pack-page-update-tag"
        />
      </span>
    </template>
    <template v-if="!loading && !failed" #actions>
      <StarterPackHeaderActions
        v-model:folder-name="folderName"
        :page="page"
        @review="updateOpen = true"
        @remove="removeOpen = true"
        @turn-on="openTurnOn()"
        @set-up="setupOpen = true"
        @undo="undoOpen = true"
        @open-alerts="openAlerts"
        @open-folder="openFolder"
      />
    </template>

    <OContent v-if="loading" y class="flex flex-col gap-3" data-test="starter-pack-page-loading">
      <div class="flex gap-2">
        <OSkeleton
          v-for="index in 4"
          :key="index"
          type="rect"
          class="rounded-default h-16 flex-1"
        />
      </div>
      <OSkeleton v-for="index in 5" :key="`row-${index}`" type="text" class="h-9 w-full" />
    </OContent>
    <OEmptyState
      v-else-if="failed"
      size="block"
      variant="error"
      illustration="broken-panel"
      :title="t('starterPacks.page.loadFailed')"
      :action-label="t('common.retry')"
      action-icon="refresh"
      data-test="starter-pack-page-error"
      @action="page.refresh(true)"
    />
    <template v-else>
      <OContent class="flex shrink-0 flex-col gap-3 pt-3">
        <ONoticeBar :notices="notices" data-test="starter-pack-page-notices" />
        <StarterPackSummaryStrip :page="page" />
      </OContent>
      <OTabs v-model="tab" bordered class="shrink-0" data-test="starter-pack-page-tabs">
        <OTab
          name="contents"
          :label="t('starterPacks.page.tabs.contents')"
          data-test="starter-pack-page-tab-contents"
        />
        <OTab
          name="streams"
          :label="t('starterPacks.page.tabs.streams')"
          data-test="starter-pack-page-tab-streams"
        />
        <OTab
          name="about"
          :label="t('starterPacks.page.tabs.about')"
          data-test="starter-pack-page-tab-about"
        />
      </OTabs>
      <div class="min-h-0 flex-1">
        <OTabPanels v-model="tab" grow scroll="y" class="h-full min-h-0">
          <OTabPanel name="contents">
            <StarterPackContentsTab
              :page="page"
              @select="selectRow"
              @open="openRow"
              @edit="editRow"
              @copy-link="copyRowLink"
              @retry="page.retry()"
              @add-now="addNow"
              @open-alerts="openAlerts"
              @open-dashboards="openDashboards"
            />
          </OTabPanel>
          <OTabPanel name="streams">
            <StarterPackStreamsTab :page="page" />
          </OTabPanel>
          <OTabPanel name="about">
            <StarterPackAboutTab
              :page="page"
              @review="updateOpen = true"
              @open-folder="openFolder"
            />
          </OTabPanel>
        </OTabPanels>
      </div>
    </template>

    <StarterPackItemDrawer
      v-model:open="itemOpen"
      :page="page"
      :row="selected"
      @open="openRow"
      @edit="editRow"
      @retry="page.retry()"
      @add-now="addNow"
      @open-folder="openFolder"
    />
    <TurnOnAlertsDrawer
      v-model:open="turnOnOpen"
      :flow="flow"
      :clusters="page.matcher.clusters.value"
      :preselect-ids="preselect"
      @done="page.refresh()"
    />
    <StarterPackDrawer
      v-model:open="setupOpen"
      :flow="flow"
      :clusters="page.matcher.clusters.value"
      :folder-name="folderName === pack.folder.name ? undefined : folderName"
      :match-state="page.matcher.state.value"
      @installed="page.refresh()"
    />
    <StarterPackUpdateDrawer
      v-if="STARTER_PACKS_ENABLED"
      v-model:open="updateOpen"
      :updates="updates"
    />
    <StarterPackUndoDialog
      v-model:open="removeOpen"
      :flow="flow"
      mode="remove"
      @done="page.refresh()"
    />
    <StarterPackUndoDialog
      v-model:open="undoOpen"
      :flow="flow"
      mode="undo"
      @done="page.refresh()"
    />
    <StarterPackRepairPanel
      v-model:open="repairOpen"
      :repair="page.repair"
      :issue="page.repairIssue.value"
      :scope="{ packId: pack.id }"
      @repaired="page.refresh()"
    />
  </OPageLayout>
</template>
