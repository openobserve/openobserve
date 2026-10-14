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

<!-- The Dashboards-list offer: one banner for every detected source, the Choose… and Import checklists, and the install flow behind both. -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OGlyph from "@/lib/forms/EmojiPicker/OGlyph.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import analytics from "@/services/product_analytics";
import { getFoldersList, getFoldersListByType } from "@/utils/commons";
import {
  READY_MADE_SOURCES,
  getReadyMadeSource,
  type ReadyMadeSourceId,
} from "@/composables/readyMade/catalog";
import { installReadyMade } from "@/composables/readyMade/installReadyMade";
import {
  describeReadyMadeInstall,
  isReadyMadeGapFill,
  joinReadyMadeNames,
  primaryReadyMadeDashboard,
  type ReadyMadeInstallSuccess as InstallSuccess,
} from "@/composables/readyMade/readyMadeMessages";
import { useReadyMadeOffers } from "@/composables/readyMade/useReadyMadeOffers";
import ReadyMadeDialog from "./ReadyMadeDialog.vue";
import type { ReadyMadeDialogMode, ReadyMadeDialogRow } from "./readyMade.types";

const emit = defineEmits<{
  /** Something was created or found; the list and folder rail may have changed. */
  (e: "installed"): void;
}>();

const store = useStore();
const router = useRouter();
const { t, locale } = useI18nTyped();
const offers = useReadyMadeOffers();

const busy = ref(false);
const progress = ref<{ done: number; count: number } | null>(null);
const forbiddenNotice = ref(false);
const dialogOpen = ref(false);
const dialogMode = ref<ReadyMadeDialogMode>("choose");
const dialogSources = ref<ReadyMadeSourceId[]>([]);
const dialogLoading = ref(false);

const nameOf = (id: ReadyMadeSourceId) => getReadyMadeSource(id).name;
const joinList = (names: string[], type: "conjunction" | "unit") =>
  joinReadyMadeNames(names, locale.value, type);

const offered = computed(() => offers.offered.value);
const single = computed(() =>
  offered.value.length === 1 ? getReadyMadeSource(offered.value[0]) : null,
);
const bannerVisible = computed(() => forbiddenNotice.value || offered.value.length > 0);

const foundText = computed<I18nText>(() =>
  single.value
    ? t("dashboard.readyMade.foundOne", { name: single.value.name })
    : t("dashboard.readyMade.foundMany", {
        list: joinList(offered.value.map(nameOf), "conjunction"),
      }),
);
const askText = computed<I18nText>(() =>
  single.value
    ? t(single.value.askKey, { name: single.value.name })
    : t("dashboard.readyMade.askMany"),
);
const folderText = computed<I18nText>(() =>
  single.value
    ? t(single.value.folderSentenceKey, { folder: single.value.folderName })
    : t("dashboard.readyMade.folderSentenceMany"),
);

/** Detected sources with no copy yet — the Import menu tags itself with "Data found" while any exist. */
const hasDataFound = computed(
  () => offers.detected.value?.some((id) => offers.copiesOf(id)?.length === 0) ?? false,
);

// ── Navigation ──────────────────────────────────────────────────────────────

const orgQuery = () => ({ org_identifier: offers.orgId.value });

const openDashboard = (target: { dashboardId: string; folderId: string }) =>
  router.push({
    path: "/dashboards/view",
    query: { ...orgQuery(), dashboard: target.dashboardId, folder: target.folderId },
  });

const openFolder = (folderId: string) =>
  router.push({ path: "/dashboards", query: { ...orgQuery(), folder: folderId } });

const openSource = (id: ReadyMadeSourceId) => {
  const first = getReadyMadeSource(id).dashboards[0].key;
  const copies = offers.copiesOf(id) ?? [];
  const copy = copies.find((candidate) => candidate.key === first) ?? copies[0];
  if (!copy) return;
  dialogOpen.value = false;
  void openDashboard(copy);
};

const setUpSource = (id: ReadyMadeSourceId) => {
  dialogOpen.value = false;
  void router.push({ name: getReadyMadeSource(id).setupRoute, query: orgQuery() });
};

// ── Install flow ────────────────────────────────────────────────────────────

const toastSingle = (result: InstallSuccess, withOpen: boolean) => {
  toast({
    variant: "success",
    message: describeReadyMadeInstall(result, t, locale.value),
    action: withOpen
      ? {
          label: t("dashboard.readyMade.open"),
          handler: () => void openDashboard(primaryReadyMadeDashboard(result)),
        }
      : undefined,
  });
};

const toastMany = (results: InstallSuccess[]) => {
  const count = results.reduce((sum, result) => sum + result.dashboards.length, 0);
  const folders = [...new Set(results.map((result) => result.folderName))];
  const first = results[0];
  toast({
    variant: "success",
    message: t("dashboard.readyMade.addedMany", {
      count,
      folderCount: folders.length,
      list: joinList(folders, "unit"),
    }),
    timeout: 10000,
    action: {
      label: t("dashboard.readyMade.openFolder", { folder: first.folderName }),
      handler: () => void openFolder(first.folderId),
    },
  });
};

const refreshFolderRail = () =>
  Promise.all([getFoldersListByType(store, "dashboards"), getFoldersList(store)]).catch(
    () => undefined,
  );

const reportOutcome = (ok: InstallSuccess[], failed: ReadyMadeSourceId[], openSingle: boolean) => {
  if (failed.length > 0) {
    toast({
      variant: "error",
      message: t("dashboard.readyMade.failed", {
        list: joinList(failed.map(nameOf), "conjunction"),
      }),
      action: {
        label: t("common.retry"),
        handler: () => void addSources(failed, { openSingle }),
      },
    });
  }
  if (ok.length === 0) return;
  if (ok.length === 1) {
    const navigate = openSingle && failed.length === 0;
    toastSingle(ok[0], !navigate);
    if (navigate) void openDashboard(primaryReadyMadeDashboard(ok[0]));
    return;
  }
  // A folder count would hide which dashboards came back into a set that already existed, so those are named one by one.
  const whole = ok.filter((result) => result.status === "created" && !isReadyMadeGapFill(result));
  for (const result of ok) if (!whole.includes(result)) toastSingle(result, true);
  if (whole.length === 1) toastSingle(whole[0], true);
  else if (whole.length > 1) toastMany(whole);
};

/** Installs one source at a time; a 403 stops the run and dismisses what it could not add. */
const addSources = async (list: ReadyMadeSourceId[], { openSingle }: { openSingle: boolean }) => {
  if (list.length === 0 || busy.value) return;
  const org = offers.orgId.value;
  const userId = offers.userId.value;
  const ok: InstallSuccess[] = [];
  const failed: ReadyMadeSourceId[] = [];
  let forbidden = false;
  busy.value = true;
  progress.value = { done: 0, count: list.length };
  try {
    for (const id of list) {
      const result = await installReadyMade(org, id, { userId });
      progress.value = { done: progress.value.done + 1, count: list.length };
      if (result.status !== "error") {
        ok.push(result);
        if (result.status === "created") analytics.track("dashboard_created");
      } else if (result.kind === "forbidden") {
        forbidden = true;
        break;
      } else {
        failed.push(id);
      }
    }
  } finally {
    busy.value = false;
    progress.value = null;
  }
  dialogOpen.value = false;
  if (ok.length > 0) {
    await refreshFolderRail();
    emit("installed");
  }
  if (forbidden) {
    const blocked = list.filter((id) => !ok.some((result) => result.sourceId === id));
    forbiddenNotice.value = true;
    await offers.remember(Object.fromEntries(blocked.map((id) => [id, "dismissed" as const])));
  }
  void offers.refresh();
  reportOutcome(ok, failed, openSingle);
};

const addOffered = () => addSources([...offered.value], { openSingle: true });
const addAll = () => addSources([...offered.value], { openSingle: false });

const noThanks = () => {
  const list = [...offered.value];
  void offers.remember(Object.fromEntries(list.map((id) => [id, "dismissed" as const])));
  toast({ variant: "info", message: t("dashboard.readyMade.dismissedToast") });
};

// ── Dialog ──────────────────────────────────────────────────────────────────

// Both checklists decide what gets created, so they open on the server's copy: a folder made or a dashboard moved elsewhere is not in this tab's cache.
const openChoose = async () => {
  dialogMode.value = "choose";
  dialogSources.value = [...offered.value];
  dialogOpen.value = true;
  dialogLoading.value = true;
  try {
    await offers.loadFolders({ force: true });
  } finally {
    dialogLoading.value = false;
  }
};

/** Import ▾ → Ready-made dashboards: every source, regardless of earlier "No thanks". */
const openImport = async () => {
  dialogMode.value = "import";
  dialogOpen.value = true;
  dialogLoading.value = true;
  try {
    if (!offers.loaded.value) await offers.refresh();
    await offers.loadAll({ force: true });
  } finally {
    dialogLoading.value = false;
  }
};

const destinationOf = (id: ReadyMadeSourceId): I18nText => {
  const folder = getReadyMadeSource(id).folderName;
  const known = offers.folderNames.value;
  if (!known) return t("dashboard.readyMade.destinationUnknown", { folder });
  return known.has(folder)
    ? t("dashboard.readyMade.destinationExisting", { folder })
    : t("dashboard.readyMade.destinationNew", { folder });
};

const dialogRows = computed<ReadyMadeDialogRow[]>(() => {
  const ids =
    dialogMode.value === "choose"
      ? dialogSources.value
      : [...READY_MADE_SOURCES]
          .map((source) => source.id)
          .sort((a, b) => Number(offers.isDetected(b)) - Number(offers.isDetected(a)));
  return ids.map((id) => {
    const source = getReadyMadeSource(id);
    const detected = dialogMode.value === "choose" || offers.isDetected(id);
    const copies = dialogMode.value === "import" ? (offers.copiesOf(id) ?? []) : [];
    // A partial set (an earlier install failed midway) stays tickable, so adding it fills the gaps.
    const complete = source.dashboards.every((ref) => copies.some((c) => c.key === ref.key));
    const copy = complete ? copies[0] : undefined;
    return {
      id,
      name: raw(source.name),
      glyph: source.glyph,
      detected,
      installedIn: copy ? raw(copy.folderName) : null,
      contents: t(source.contentsKey),
      destination: destinationOf(id),
      defaultSelected: detected && !copy,
    };
  });
});

const onConfirm = async (selected: ReadyMadeSourceId[], unselected: ReadyMadeSourceId[]) => {
  // Unticking in the Import list is just "not now"; only the banner's checklist remembers it.
  const declined = dialogMode.value === "choose" ? unselected : [];
  if (declined.length > 0) {
    void offers.remember(Object.fromEntries(declined.map((id) => [id, "dismissed" as const])));
  }
  await addSources(selected, { openSingle: true });
  if (declined.length === 0) return;
  toast({
    variant: "info",
    message: t(
      "dashboard.readyMade.notAddedToast",
      { list: joinList(declined.map(nameOf), "conjunction") },
      declined.length,
    ),
    timeout: 10000,
  });
};

onMounted(() => {
  void offers.refresh();
});

defineExpose({
  openImport,
  hasDataFound,
  refresh: (force = false) => offers.refresh({ force }),
});
</script>

<template>
  <OContent
    v-if="bannerVisible"
    class="bg-card-glass-bg shrink-0 pt-2"
    data-test="dashboards-ready-made-offers"
  >
    <OBanner
      v-if="forbiddenNotice"
      variant="error-soft"
      dense
      inline-actions
      data-test="dashboards-ready-made-banner-forbidden"
      :content="t('dashboard.readyMade.forbidden')"
    >
      <template #actions>
        <OButton
          variant="ghost"
          size="icon-xs-sq"
          icon-left="close"
          :title="t('common.close')"
          data-test="dashboards-ready-made-banner-close"
          @click="forbiddenNotice = false"
        />
      </template>
    </OBanner>
    <OBanner v-else variant="info" dense inline-actions data-test="dashboards-ready-made-banner">
      <template #icon>
        <OGlyph v-if="single" :token="single.glyph" size="md" />
        <OIcon v-else name="dashboard-customize" size="sm" />
      </template>
      <span data-test="dashboards-ready-made-banner-text">
        <strong class="font-semibold">{{ foundText }}</strong>
        {{ askText }}
        <span class="text-text-secondary">{{ folderText }}</span>
      </span>
      <template #actions>
        <div class="flex flex-wrap items-center gap-2">
          <OButton
            v-if="single"
            variant="primary"
            size="sm"
            :loading="busy"
            data-test="dashboards-ready-made-banner-add"
            @click="addOffered"
          >
            {{ t("dashboard.readyMade.add") }}
          </OButton>
          <template v-else>
            <OButton
              variant="primary"
              size="sm"
              :loading="busy"
              data-test="dashboards-ready-made-banner-add-all"
              @click="addAll"
            >
              {{
                progress
                  ? t("dashboard.readyMade.adding", progress)
                  : t("dashboard.readyMade.addAll", { count: offered.length })
              }}
            </OButton>
            <OButton
              variant="outline"
              size="sm"
              :disabled="busy"
              data-test="dashboards-ready-made-banner-choose"
              @click="openChoose"
            >
              {{ t("dashboard.readyMade.choose") }}
            </OButton>
          </template>
          <OButton
            variant="ghost"
            size="sm"
            :disabled="busy"
            data-test="dashboards-ready-made-banner-no-thanks"
            @click="noThanks"
          >
            {{ t("dashboard.readyMade.noThanks") }}
          </OButton>
        </div>
      </template>
    </OBanner>
  </OContent>
  <ReadyMadeDialog
    v-model:open="dialogOpen"
    :mode="dialogMode"
    :rows="dialogRows"
    :busy="busy"
    :loading="dialogLoading"
    @confirm="onConfirm"
    @open-source="openSource"
    @set-up="setUpSource"
  />
</template>
