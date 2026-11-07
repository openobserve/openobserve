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
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { ALERT_LIBRARY_S3_BASE } from "@/constants/alertLibrary";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { packScope, packScopeValue } from "@/composables/starterPacks/packCopy";
import type { PackItemKind, PackNotIncludedReason } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import StarterPackInstallDialog from "./StarterPackInstallDialog.vue";
import StarterPackUndoDialog from "./StarterPackUndoDialog.vue";

const props = defineProps<{
  flow: StarterPackFlow;
  clusters: string[];
}>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ "copy-link": [] }>();

const { t } = useI18nTyped();
const router = useRouter();

const REASON_KEYS: Record<PackNotIncludedReason, I18nKey> = {
  already_have: "starterPacks.drawer.reasonAlreadyHave",
  no_data: "starterPacks.drawer.reasonNoData",
  unavailable: "starterPacks.drawer.reasonUnavailable",
  needs_plan: "starterPacks.drawer.reasonNeedsPlan",
};
const TAG_KEYS: Record<PackNotIncludedReason, I18nKey> = {
  already_have: "starterPacks.manifest.tagHaveIt",
  no_data: "starterPacks.manifest.tagNeedsData",
  unavailable: "starterPacks.manifest.tagUnavailable",
  needs_plan: "starterPacks.manifest.tagEnterprise",
};
const ROW_KEYS: Partial<Record<PackItemKind, I18nKey>> = {
  dashboard: "starterPacks.progress.rowDashboards",
  alert: "starterPacks.progress.rowAlerts",
  savedView: "starterPacks.progress.rowViews",
};

const flow = props.flow;
const pack = flow.pack;
const confirmMode = ref<"undo" | "remove">("undo");
const confirmOpen = ref(false);

const showProgress = computed(() => flow.running.value || flow.interrupted.value);
const drawerOpen = computed({
  get: () => open.value && !showProgress.value,
  set: (value) => (open.value = value),
});
const dialogOpen = computed({
  get: () => open.value && showProgress.value,
  set: (value) => (open.value = value),
});
const scope = computed(() => packScope(t, props.clusters));
const host = computed(() => raw(new URL(ALERT_LIBRARY_S3_BASE).host));
const preview = computed(() => flow.preview.value);
const planned = (kind: PackItemKind) =>
  (preview.value?.items ?? []).filter((item) => item.kind === kind && item.status !== "existing");
const streamOf = (itemId: string) =>
  pack.bundledAlerts?.find(({ entry }) => entry.id === itemId)?.entry.stream ?? "";
const packName = computed(() => t(pack.titleKey));
const notIncluded = computed(() => {
  // A preview read after the install finds the pack's own items as existing.
  const madeIds = new Set(flow.made.value.map(({ itemId }) => itemId));
  const left = (preview.value?.notIncluded ?? []).filter((row) => !madeIds.has(row.itemId));
  const rows = left.map((row) => ({
    key: row.itemId,
    tag: t(TAG_KEYS[row.reason]),
    text: t(REASON_KEYS[row.reason], { name: raw(row.name) }),
  }));
  if (flow.licensed.value) return rows;
  const name = t("starterPacks.drawer.view");
  return [
    {
      key: "view",
      tag: t(TAG_KEYS.needs_plan),
      text: t(REASON_KEYS.needs_plan, { name: raw(name) }) as I18nText,
    },
    ...rows,
  ];
});
const createCount = computed(
  () => flow.alertCount.value + flow.viewCount.value + flow.dashboardCount.value,
);
const nothingToCreate = computed(() => !!preview.value && createCount.value === 0);

const panelNote = computed(() => {
  const kept = preview.value?.panels.kept;
  return kept
    ? t("starterPacks.drawer.panelsFit", { count: kept }, kept)
    : t("starterPacks.drawer.dashboardNote");
});

const total = computed(() => flow.toCreate.value.length);
const made = computed(() => flow.made.value.length);
const summary = computed(() =>
  flow.failed.value.length
    ? t("starterPacks.progress.summaryRetry", {
        made: made.value,
        total: total.value,
        failed: flow.failed.value.length,
      })
    : t("starterPacks.progress.summary", { made: made.value, total: total.value }),
);
const rows = computed(() => {
  const firstPending = flow.toCreate.value.find(({ status }) => status === "pending")?.kind;
  return (["dashboard", "alert", "savedView"] as const).flatMap((kind) => {
    const items = flow.toCreate.value.filter((item) => item.kind === kind);
    if (!items.length) return [];
    const created = items.filter(({ status }) => status === "created").length;
    const pending = items.some(({ status }) => status === "pending");
    let word = t("starterPacks.progress.created");
    if (pending) {
      word = t(
        flow.running.value && kind === firstPending
          ? "starterPacks.progress.creating"
          : "starterPacks.progress.waiting",
      );
    }
    const label = t(ROW_KEYS[kind]!, { made: created, total: items.length });
    return [
      {
        kind,
        word,
        done: !pending,
        label,
        off: kind === "alert" && !pending,
      },
    ];
  });
});

const ensurePreview = () => {
  if (flow.previewState.value === "idle" || flow.previewState.value === "error") {
    void flow.loadPreview();
  }
};
watch(open, (isOpen) => isOpen && ensurePreview(), { immediate: true });

const finishLanding = async () => {
  open.value = false;
  await flow.land();
};
const manage = () => {
  open.value = false;
  void router.push(flow.packRoute.value).catch(() => {});
};
const retry = async () => {
  if (await flow.install()) await finishLanding();
};
const startSetup = async () => {
  if (await flow.install()) await finishLanding();
};
const askConfirm = (mode: "undo" | "remove") => {
  confirmMode.value = mode;
  confirmOpen.value = true;
};
</script>

<template>
  <ODrawer
    v-model:open="drawerOpen"
    size="md"
    :title="
      flow.installed.value
        ? t('starterPacks.drawer.packTitle')
        : t('starterPacks.manifest.title', { pack: packName })
    "
    :sub-title="
      flow.installed.value
        ? undefined
        : t(
            'starterPacks.manifest.subtitle',
            { count: createCount, folder: raw(pack.folder.name) },
            createCount,
          )
    "
    data-test="starter-pack-drawer"
  >
    <div
      v-if="flow.installed.value"
      class="flex flex-col gap-3 text-sm"
      data-test="starter-pack-installed"
    >
      <strong data-test="starter-pack-progress-summary">{{ summary }}</strong>
      <OText variant="meta" data-test="starter-pack-progress-scope">{{ scope }}</OText>
      <ul class="flex flex-col" data-test="starter-pack-installed-list">
        <li
          v-for="row in rows"
          :key="row.kind"
          class="border-border-default flex items-center gap-2 border-b py-2"
        >
          <OIcon :name="row.done ? 'check-circle' : 'schedule'" size="sm" />
          <strong>{{ row.word }}</strong>
          <span>{{ row.label }}</span>
          <OText v-if="row.off" variant="meta">{{ t("starterPacks.progress.alertsOff") }}</OText>
        </li>
      </ul>
    </div>

    <div
      v-else-if="flow.previewState.value === 'loading'"
      class="flex flex-col gap-3"
      data-test="starter-pack-drawer-loading"
    >
      <OSkeleton class="h-5 w-full" />
      <OSkeleton class="h-5 w-full" />
      <OSkeleton class="h-5 w-3/4" />
      <OSkeleton class="h-5 w-1/2" />
    </div>

    <div
      v-else-if="flow.previewState.value === 'error'"
      class="flex items-center justify-between gap-3 text-sm"
    >
      <span>{{ t("starterPacks.drawer.error") }}</span>
      <OButton
        variant="outline"
        size="sm-action"
        data-test="starter-pack-drawer-retry-btn"
        @click="flow.loadPreview()"
      >
        {{ t("common.retry") }}
      </OButton>
    </div>

    <div v-else class="flex flex-col gap-4 text-sm" data-test="starter-pack-drawer-items">
      <OBanner
        v-if="flow.installFailed.value"
        variant="error-soft"
        dense
        :content="t('starterPacks.progress.installError')"
        data-test="starter-pack-drawer-install-error"
      />

      <section
        v-if="planned('dashboard').length"
        class="flex flex-col gap-2"
        data-test="starter-pack-drawer-dashboards"
      >
        <OText variant="section">{{
          t(
            "starterPacks.manifest.dashboards",
            { count: planned("dashboard").length },
            planned("dashboard").length,
          )
        }}</OText>
        <div class="grid grid-cols-3 gap-2">
          <div
            v-for="item in planned('dashboard')"
            :key="item.itemId"
            class="border-border-default rounded-default flex flex-col overflow-hidden border"
            data-test="starter-pack-drawer-dashboard-card"
          >
            <div
              class="bg-surface-subtle text-text-secondary flex h-14 items-center justify-center"
            >
              <OIcon name="dashboard" size="md" />
            </div>
            <span class="truncate px-2 py-1">{{ raw(flow.nameOf(item.itemId)) }}</span>
          </div>
        </div>
        <OText variant="meta" data-test="starter-pack-drawer-panels">{{ panelNote }}</OText>
      </section>

      <section
        v-if="planned('alert').length"
        class="flex flex-col"
        data-test="starter-pack-drawer-alerts"
      >
        <OText variant="section" class="pb-1">{{
          t(
            "starterPacks.manifest.alerts",
            { count: planned("alert").length },
            planned("alert").length,
          )
        }}</OText>
        <div
          v-for="item in planned('alert')"
          :key="item.itemId"
          class="border-border-default flex items-center justify-between gap-3 border-b py-2"
          data-test="starter-pack-drawer-alert-row"
        >
          <span class="min-w-0 truncate">{{ raw(flow.nameOf(item.itemId)) }}</span>
          <OText variant="mono" class="shrink-0">{{ raw(streamOf(item.itemId)) }}</OText>
        </div>
      </section>

      <section
        v-if="planned('savedView').length"
        class="flex flex-col"
        data-test="starter-pack-drawer-saved-searches"
      >
        <OText variant="section" class="pb-1">{{
          t(
            "starterPacks.manifest.savedSearches",
            { count: planned("savedView").length },
            planned("savedView").length,
          )
        }}</OText>
        <div
          v-for="item in planned('savedView')"
          :key="item.itemId"
          class="border-border-default flex items-center justify-between gap-3 border-b py-2"
        >
          <span class="min-w-0 truncate">{{ raw(flow.nameOf(item.itemId)) }}</span>
          <OText variant="meta">{{ t("starterPacks.manifest.savedSearch") }}</OText>
        </div>
      </section>

      <section
        v-if="notIncluded.length"
        class="flex flex-col"
        data-test="starter-pack-drawer-not-included"
      >
        <OText variant="section" class="pb-1">{{
          t("starterPacks.manifest.leftOut", { count: notIncluded.length }, notIncluded.length)
        }}</OText>
        <div
          v-for="row in notIncluded"
          :key="row.key"
          class="border-border-default flex items-center gap-2 border-b py-2"
        >
          <OBadge variant="default-soft" size="sm">{{ row.tag }}</OBadge>
          <OText variant="meta">{{ row.text }}</OText>
        </div>
      </section>

      <section class="flex flex-col" data-test="starter-pack-drawer-reach">
        <OText variant="section" class="pb-1">{{ t("starterPacks.manifest.adapted") }}</OText>
        <div class="border-border-default flex justify-between gap-3 border-b py-2">
          <div class="flex flex-col">
            <span>{{ t("starterPacks.drawer.scope") }}</span>
            <OText variant="meta">{{ t("starterPacks.drawer.scopeNote") }}</OText>
          </div>
          <span class="text-right">{{ packScopeValue(t, clusters) }}</span>
        </div>
        <div class="border-border-default flex justify-between gap-3 border-b py-2">
          <div class="flex flex-col">
            <span>{{ t("starterPacks.drawer.background") }}</span>
            <OText variant="meta">{{ t("starterPacks.drawer.backgroundNote") }}</OText>
          </div>
          <span class="shrink-0">{{ t("starterPacks.drawer.backgroundValue") }}</span>
        </div>
      </section>

      <OText variant="meta" data-test="starter-pack-drawer-source">{{
        t(preview?.offline ? "starterPacks.drawer.sourceOffline" : "starterPacks.drawer.source", {
          host,
        })
      }}</OText>
    </div>

    <template #footer>
      <div class="flex w-full items-center gap-2">
        <template v-if="flow.forbidden.value">
          <OText class="flex-1">{{ t("starterPacks.noPermission") }}</OText>
          <OButton
            variant="outline"
            size="sm-action"
            icon-left="content-copy"
            data-test="starter-pack-drawer-copy-link-btn"
            @click="emit('copy-link')"
          >
            {{ t("starterPacks.copyLink") }}
          </OButton>
        </template>
        <template v-else-if="flow.installed.value">
          <span class="flex-1" />
          <OButton
            v-if="flow.canUndo.value"
            variant="ghost-destructive"
            size="sm-action"
            data-test="starter-pack-progress-undo-btn"
            @click="askConfirm('undo')"
          >
            {{ t("starterPacks.landing.undo") }}
          </OButton>
          <OButton
            v-else-if="flow.canManage.value"
            variant="ghost-destructive"
            size="sm-action"
            data-test="starter-pack-page-remove-btn"
            @click="askConfirm('remove')"
          >
            {{ t("starterPacks.landing.remove") }}
          </OButton>
        </template>
        <template v-else>
          <OButton
            v-if="nothingToCreate"
            variant="primary"
            size="sm-action"
            data-test="starter-pack-drawer-open-btn"
            @click="finishLanding"
          >
            {{ t("starterPacks.drawer.openDashboard") }}
          </OButton>
          <OButton
            v-else
            variant="primary"
            size="sm-action"
            :disabled="flow.previewState.value !== 'ready'"
            data-test="starter-pack-drawer-submit-btn"
            @click="startSetup"
          >
            {{ t("starterPacks.card.install", { count: createCount }, createCount) }}
          </OButton>
          <OText variant="meta" class="flex-1 text-right" data-test="starter-pack-drawer-note">{{
            nothingToCreate
              ? t("starterPacks.drawer.nothingToCreate")
              : t("starterPacks.manifest.footerNote")
          }}</OText>
        </template>
      </div>
    </template>
  </ODrawer>
  <StarterPackInstallDialog
    v-model:open="dialogOpen"
    :flow="flow"
    @open-landing="finishLanding"
    @manage="manage"
    @undo="askConfirm('undo')"
    @retry="retry"
    @copy-link="emit('copy-link')"
  />
  <StarterPackUndoDialog
    v-model:open="confirmOpen"
    :flow="flow"
    :mode="confirmMode"
    @done="open = false"
  />
</template>
