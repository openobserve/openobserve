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
import { computed, shallowRef, watch } from "vue";
import { useStore } from "vuex";
import LibraryDrawer from "@/components/alertLibrary/LibraryDrawer.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import ODescriptionItem from "@/lib/lists/DescriptionList/ODescriptionItem.vue";
import ODescriptionList from "@/lib/lists/DescriptionList/ODescriptionList.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { adaptSavedView } from "@/composables/starterPacks/packAdapt";
import type { PackContentRow } from "@/composables/starterPacks/packContents";
import type { StarterPackPage } from "@/composables/starterPacks/useStarterPackPage";
import type { AlertLibraryEntry } from "@/types/alertLibrary";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";

const REASON_KEYS: Partial<Record<string, I18nKey>> = {
  no_data: "starterPacks.page.drawer.reasonNoData",
  unavailable: "starterPacks.page.drawer.reasonUnavailable",
  needs_plan: "starterPacks.page.drawer.reasonNeedsPlan",
  no_flavour: "starterPacks.page.drawer.reasonNoFlavour",
};

const props = defineProps<{ page: StarterPackPage; row: PackContentRow | null }>();
const emit = defineEmits<{
  open: [row: PackContentRow];
  edit: [row: PackContentRow];
  retry: [];
  addNow: [row: PackContentRow];
  openFolder: [];
}>();
const open = defineModel<boolean>("open", { default: false });

const { t } = useI18nTyped();
const store = useStore();
const { loadManifest } = useAlertLibrary();
const flow = props.page.flow;
const pack = flow.pack;

const entry = shallowRef<AlertLibraryEntry | null>(null);
const live = computed(
  () => !!props.row?.id && !["notCreated", "skipped", "willBeCreated"].includes(props.row.state),
);
const isAlert = computed(() => props.row?.kind === "alert" && live.value);
const folder = computed(() => flow.record.value?.folderName ?? pack.folder.name);

// A bundled entry needs no Library read; others come from the manifest the Library already caches.
const findEntry = async (itemId: string) => {
  const bundled = pack.bundledAlerts?.find(({ entry: candidate }) => candidate.id === itemId);
  if (bundled) return bundled.entry;
  const manifest = await loadManifest().catch(() => null);
  return manifest?.alerts.find(({ id }) => id === itemId) ?? null;
};
watch(
  () => [open.value, props.row?.key] as const,
  async ([isOpen]) => {
    entry.value = null;
    if (!isOpen || !isAlert.value || !props.row) return;
    const key = props.row.key;
    const found = await findEntry(props.row.itemId);
    if (props.row?.key === key) entry.value = found;
  },
  { immediate: true },
);

const health = computed(() => (props.row?.streams ?? []).map((name) => props.page.healthOf(name)));
// A stream with no health row yet, or whose read failed, is unchecked, never healthy.
const dataState = computed(() => {
  const states = health.value.map((row) => row?.state);
  if (states.includes("never")) return "never" as const;
  if (states.includes("stopped")) return "stale" as const;
  if (!states.length || states.some((state) => !state || state === "unknown")) {
    return "unknown" as const;
  }
  return "fresh" as const;
});
const lastIngested = computed(() => {
  const times = health.value.map((row) => row?.lastUs ?? 0).filter(Boolean);
  return times.length ? Math.min(...times) : null;
});

const notifies = computed(() => {
  const list: string[] = props.row?.alert?.alert.destinations ?? [];
  return list.length ? raw(list.join(", ")) : t("starterPacks.page.drawer.nobody");
});
const lastTriggered = computed(
  () => Number(props.row?.alert?.alert.last_triggered_at ?? 0) || null,
);
const alertSubtitle = computed(() =>
  t("starterPacks.page.drawer.alertSubtitle", {
    id: raw(props.row?.itemId ?? ""),
    folder: raw(folder.value),
    pack: t(pack.titleKey),
  }),
);
const view = computed(() => {
  if (props.row?.kind !== "savedView") return null;
  const found = pack.savedViews.find(({ id }) => id === props.row?.itemId);
  if (!found) return null;
  const search = adaptSavedView(found.search, flow.record.value?.repairs ?? []);
  return {
    stream: (search.data?.stream?.selectedStream ?? []).join(", "),
    type: String(search.data?.stream?.streamType ?? "logs"),
    query: String(search.data?.query ?? ""),
  };
});
const missingReason = computed(() => {
  const row = props.row;
  if (!row) return "";
  if (row.state === "notCreated") return t("starterPacks.page.drawer.reasonFailed");
  if (row.state === "willBeCreated") return t("starterPacks.page.drawer.reasonNotSetUp");
  const key = row.reason ? REASON_KEYS[row.reason] : undefined;
  return key ? t(key) : t("starterPacks.page.drawer.reasonNoData");
});
const drawerTitle = computed(() => raw(props.row?.name ?? ""));
const kindLabel = computed(() => {
  if (props.row?.kind === "dashboard") return t("starterPacks.page.drawer.kindDashboard");
  if (props.row?.kind === "savedView") return t("starterPacks.page.drawer.kindView");
  return t("starterPacks.page.drawer.kindAlert");
});
const subtitle = computed(() =>
  t("starterPacks.page.drawer.subtitle", { kind: kindLabel.value, folder: raw(folder.value) }),
);
</script>

<template>
  <LibraryDrawer
    v-if="isAlert"
    v-model:open="open"
    :entry="entry"
    :ready="true"
    :data-state="dataState"
    :last-ingested-micros="lastIngested"
    :subtitle="alertSubtitle"
    installed
  >
    <template #in-org>
      <section data-test="starter-pack-item-drawer-in-org">
        <h3 class="text-text-secondary pb-2 text-xs font-semibold">
          {{ t("starterPacks.page.drawer.inThisOrg") }}
        </h3>
        <ODescriptionList dense label-width="narrow">
          <ODescriptionItem :label="t('starterPacks.page.contents.colState')">
            <OTag v-if="row" type="starterPackItemState" :value="row.state" size="sm" />
          </ODescriptionItem>
          <ODescriptionItem :label="t('starterPacks.page.drawer.notifies')">{{
            notifies
          }}</ODescriptionItem>
          <ODescriptionItem :label="t('starterPacks.page.drawer.lastTriggered')">
            <OTimeCell
              :value="lastTriggered"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
              :empty-label="t('starterPacks.page.drawer.never')"
            />
          </ODescriptionItem>
          <ODescriptionItem :label="t('starterPacks.page.about.folder')">
            <OButton variant="ghost-primary" size="xs" @click="emit('openFolder')">{{
              raw(folder)
            }}</OButton>
          </ODescriptionItem>
        </ODescriptionList>
      </section>
    </template>
    <template #installed-footer>
      <OButton
        variant="outline"
        size="sm-action"
        icon-left="edit"
        data-test="starter-pack-item-drawer-edit"
        @click="row && emit('edit', row)"
      >
        {{ t("starterPacks.page.drawer.editAlert") }}
      </OButton>
      <OButton
        variant="primary"
        size="sm-action"
        icon-left="call-made"
        data-test="starter-pack-item-drawer-open"
        @click="row && emit('open', row)"
      >
        {{ t("starterPacks.page.drawer.openAlert") }}
      </OButton>
    </template>
  </LibraryDrawer>

  <ODrawer
    v-else
    v-model:open="open"
    size="md"
    :title="drawerTitle"
    :sub-title="subtitle"
    data-test="starter-pack-item-drawer"
  >
    <div v-if="row" class="flex flex-col gap-4 text-sm">
      <div class="flex flex-wrap items-center gap-1.5">
        <OTag type="starterPackItemState" :value="row.state" size="sm" />
      </div>
      <p v-if="!live" class="text-text-body" data-test="starter-pack-item-drawer-reason">
        {{ missingReason }}
      </p>
      <ODescriptionList v-if="row.kind === 'dashboard'" dense>
        <ODescriptionItem :label="t('starterPacks.page.drawer.fromPack')" stacked>{{
          t(pack.descriptionKey)
        }}</ODescriptionItem>
        <ODescriptionItem :label="t('starterPacks.page.drawer.streams')" stacked>
          <span v-if="row.streams.length" class="flex flex-wrap gap-1.5">
            <OTag
              v-for="stream in row.streams"
              :key="stream"
              variant="default-soft"
              size="sm"
              :label="raw(stream)"
            />
          </span>
        </ODescriptionItem>
        <ODescriptionItem :label="t('starterPacks.page.drawer.panels')">
          <template v-if="row.panels !== undefined">{{ raw(String(row.panels)) }}</template>
        </ODescriptionItem>
        <ODescriptionItem :label="t('starterPacks.page.about.folder')">{{
          raw(folder)
        }}</ODescriptionItem>
      </ODescriptionList>
      <ODescriptionList v-else-if="view" dense>
        <ODescriptionItem :label="t('starterPacks.page.drawer.stream')">{{
          raw(view.stream)
        }}</ODescriptionItem>
        <ODescriptionItem :label="t('starterPacks.page.drawer.streamType')">{{
          raw(view.type)
        }}</ODescriptionItem>
        <ODescriptionItem :label="t('starterPacks.page.drawer.query')" stacked>
          <code v-if="view.query" class="font-mono text-xs">{{ view.query }}</code>
        </ODescriptionItem>
      </ODescriptionList>
    </div>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <template v-if="row && live">
          <OButton
            v-if="row.kind === 'dashboard'"
            variant="outline"
            size="sm-action"
            icon-left="edit"
            data-test="starter-pack-item-drawer-edit"
            @click="emit('edit', row)"
          >
            {{ t("starterPacks.page.drawer.editDashboard") }}
          </OButton>
          <OButton
            variant="primary"
            size="sm-action"
            icon-left="call-made"
            data-test="starter-pack-item-drawer-open"
            @click="emit('open', row)"
          >
            {{
              row.kind === "dashboard"
                ? t("starterPacks.page.drawer.openDashboard")
                : t("starterPacks.page.drawer.openInLogs")
            }}
          </OButton>
        </template>
        <template v-else-if="row && page.canManage.value && page.installed.value">
          <OButton
            v-if="row.state === 'notCreated'"
            variant="primary"
            size="sm-action"
            data-test="starter-pack-item-drawer-retry"
            @click="emit('retry')"
          >
            {{ t("common.retry") }}
          </OButton>
          <OButton
            v-else-if="row.state === 'skipped'"
            variant="primary"
            size="sm-action"
            icon-left="add"
            :loading="page.adding.value === row.itemId"
            data-test="starter-pack-item-drawer-add-now"
            @click="emit('addNow', row)"
          >
            {{ t("starterPacks.page.contents.addNow") }}
          </OButton>
        </template>
      </div>
    </template>
  </ODrawer>
</template>
