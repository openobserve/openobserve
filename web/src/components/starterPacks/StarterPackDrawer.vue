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
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { ALERT_LIBRARY_S3_BASE } from "@/constants/alertLibrary";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { packScope, packScopeValue } from "@/composables/starterPacks/packCopy";
import type { PackItemKind, PackNotIncludedReason } from "@/composables/starterPacks/types";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import StarterPackUndoDialog from "./StarterPackUndoDialog.vue";

const props = defineProps<{
  flow: StarterPackFlow;
  clusters: string[];
  cluster?: string;
}>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ "copy-link": [] }>();

const { t } = useI18nTyped();

const REASON_KEYS: Record<PackNotIncludedReason, I18nKey> = {
  already_have: "starterPacks.drawer.reasonAlreadyHave",
  no_data: "starterPacks.drawer.reasonNoData",
  unavailable: "starterPacks.drawer.reasonUnavailable",
  needs_plan: "starterPacks.drawer.reasonNeedsPlan",
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
const showRows = computed(() => showProgress.value || flow.installed.value);
const scope = computed(() => packScope(t, props.clusters));
const host = computed(() => raw(new URL(ALERT_LIBRARY_S3_BASE).host));
const preview = computed(() => flow.preview.value);
const namesOf = (kind: PackItemKind) =>
  (preview.value?.items ?? [])
    .filter((item) => item.kind === kind && item.status !== "existing")
    .map((item) => flow.nameOf(item.itemId))
    .join(" · ");
const notIncluded = computed(() => {
  // A preview read after the install finds the pack's own items as existing.
  const madeIds = new Set(flow.made.value.map(({ itemId }) => itemId));
  const left = (preview.value?.notIncluded ?? []).filter((row) => !madeIds.has(row.itemId));
  const rows = left.map((row) => ({
    key: row.itemId,
    text: t(REASON_KEYS[row.reason], { name: raw(row.name) }),
  }));
  if (flow.licensed.value) return rows;
  const name = t("starterPacks.drawer.view");
  return [
    { key: "view", text: t(REASON_KEYS.needs_plan, { name: raw(name) }) as I18nText },
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
const percent = computed(() => (total.value ? (made.value / total.value) * 100 : 0));
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
  await flow.land(props.cluster);
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
    v-model:open="open"
    size="md"
    :title="
      showProgress
        ? t('starterPacks.progress.title')
        : flow.installed.value
          ? t('starterPacks.drawer.packTitle')
          : t('starterPacks.drawer.title')
    "
    :sub-title="showProgress ? undefined : t('starterPacks.drawer.subtitle')"
    data-test="starter-pack-drawer"
  >
    <div v-if="showRows" class="flex flex-col gap-3 text-sm" data-test="starter-pack-progress">
      <strong data-test="starter-pack-progress-summary">{{ summary }}</strong>
      <div v-if="showProgress" class="bg-surface-subtle rounded-default h-1 overflow-hidden">
        <div
          class="h-full"
          :class="flow.failed.value.length ? 'bg-warning' : 'bg-primary'"
          :style="{ width: `${percent}%` }"
        />
      </div>
      <OText variant="meta" data-test="starter-pack-progress-scope">{{ scope }}</OText>
      <OBanner
        v-if="flow.interrupted.value && !flow.failed.value.length"
        variant="warning"
        dense
        :content="t('starterPacks.progress.interrupted', { made, total })"
      />
      <OBanner
        v-if="flow.forbidden.value"
        variant="default"
        dense
        :content="t('starterPacks.noPermission')"
      />
      <OBanner
        v-else-if="flow.installFailed.value"
        variant="error-soft"
        dense
        :content="t('starterPacks.progress.installError')"
      />
      <ul class="flex flex-col" data-test="starter-pack-progress-list">
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
        <li
          v-for="item in flow.failed.value"
          :key="item.itemId"
          class="border-border-default flex items-center gap-2 border-b py-2"
          data-test="starter-pack-progress-failed-row"
        >
          <OIcon name="error" size="sm" />
          <strong>{{ t("starterPacks.progress.failed") }}</strong>
          <span>{{
            t("starterPacks.progress.failedRow", { name: raw(flow.nameOf(item.itemId)) })
          }}</span>
        </li>
      </ul>
      <div v-if="notIncluded.length" class="flex flex-col gap-1">
        <strong>{{ t("starterPacks.drawer.notIncluded") }}</strong>
        <OText v-for="row in notIncluded" :key="row.key" variant="meta">{{ row.text }}</OText>
      </div>
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

    <div v-else class="flex flex-col gap-3 text-sm">
      <OBanner
        v-if="flow.installFailed.value"
        variant="error-soft"
        dense
        :content="t('starterPacks.progress.installError')"
        data-test="starter-pack-drawer-install-error"
      />
      <div class="flex flex-col" data-test="starter-pack-drawer-items">
        <div
          v-if="pack.dashboards.length && flow.licensed.value"
          class="border-border-default flex justify-between gap-3 border-b py-2"
        >
          <div class="flex flex-col">
            <span>{{ t("starterPacks.drawer.view") }}</span>
            <OText variant="meta">{{ t("starterPacks.drawer.viewPath") }}</OText>
          </div>
          <span>{{ t("starterPacks.drawer.viewInPlan") }}</span>
        </div>
        <div v-else class="border-border-default flex justify-between gap-3 border-b py-2">
          <div class="flex flex-col">
            <span>{{ t("starterPacks.drawer.dashboard") }}</span>
            <OText variant="meta" data-test="starter-pack-drawer-panels">{{ panelNote }}</OText>
          </div>
          <span>{{ raw(flow.dashboardCount.value) }}</span>
        </div>
        <div class="border-border-default flex justify-between gap-3 border-b py-2">
          <div class="flex min-w-0 flex-col">
            <span>{{ t("starterPacks.drawer.alerts") }}</span>
            <OText variant="meta" data-test="starter-pack-drawer-alert-names">{{
              raw(namesOf("alert"))
            }}</OText>
          </div>
          <span>{{ raw(flow.alertCount.value) }}</span>
        </div>
        <div class="border-border-default flex justify-between gap-3 border-b py-2">
          <div class="flex min-w-0 flex-col">
            <span>{{ t("starterPacks.drawer.savedViews") }}</span>
            <OText variant="meta"
              >{{ raw(namesOf("savedView")) }}{{ raw(" · ")
              }}{{ t("starterPacks.drawer.savedViewsNote") }}</OText
            >
          </div>
          <span>{{ raw(flow.viewCount.value) }}</span>
        </div>
        <div class="border-border-default flex justify-between gap-3 border-b py-2">
          <span>{{ t("starterPacks.drawer.folder") }}</span>
          <span>{{ t("starterPacks.drawer.folderValue", { name: raw(pack.folder.name) }) }}</span>
        </div>
      </div>

      <div class="flex flex-col" data-test="starter-pack-drawer-reach">
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
      </div>

      <div
        v-if="notIncluded.length"
        class="flex flex-col gap-1"
        data-test="starter-pack-drawer-not-included"
      >
        <strong>{{ t("starterPacks.drawer.notIncluded") }}</strong>
        <OText v-for="row in notIncluded" :key="row.key" variant="meta">{{ row.text }}</OText>
      </div>

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
        <template v-else-if="showProgress">
          <OButton
            v-if="flow.canUndo.value && !flow.running.value"
            variant="ghost-destructive"
            size="sm-action"
            data-test="starter-pack-progress-undo-btn"
            @click="askConfirm('undo')"
          >
            {{ t("starterPacks.landing.undo") }}
          </OButton>
          <span class="flex-1" />
          <OButton
            v-if="flow.failed.value.length && !flow.running.value"
            variant="primary"
            size="sm-action"
            data-test="starter-pack-progress-retry-btn"
            @click="retry"
          >
            {{
              t(
                "starterPacks.progress.retry",
                { count: flow.failed.value.length },
                flow.failed.value.length,
              )
            }}
          </OButton>
          <OButton
            v-else-if="flow.interrupted.value"
            variant="primary"
            size="sm-action"
            data-test="starter-pack-progress-finish-btn"
            @click="retry"
          >
            {{ t("starterPacks.progress.finish") }}
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
          <OText variant="meta" class="flex-1">{{
            nothingToCreate
              ? t("starterPacks.drawer.nothingToCreate")
              : t("starterPacks.drawer.summary", { count: createCount }, createCount)
          }}</OText>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="starter-pack-drawer-close-btn"
            @click="open = false"
          >
            {{ t("common.close") }}
          </OButton>
          <OButton v-if="nothingToCreate" variant="primary" size="sm-action" @click="finishLanding">
            {{
              t(
                flow.licensed.value
                  ? "starterPacks.drawer.openKubernetes"
                  : "starterPacks.drawer.openDashboard",
              )
            }}
          </OButton>
          <OButton
            v-else
            variant="primary"
            size="sm-action"
            :disabled="flow.previewState.value !== 'ready'"
            data-test="starter-pack-drawer-submit-btn"
            @click="startSetup"
          >
            {{ t("starterPacks.setUp") }}
          </OButton>
        </template>
      </div>
    </template>
  </ODrawer>
  <StarterPackUndoDialog
    v-model:open="confirmOpen"
    :flow="flow"
    :mode="confirmMode"
    @done="open = false"
  />
</template>
