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
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { ALERT_LIBRARY_S3_BASE } from "@/constants/alertLibrary";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import { packScope, packScopeValue } from "@/composables/starterPacks/packCopy";
import type { PackNotIncludedReason, PackRecordItem } from "@/composables/starterPacks/types";
import { useAdaptedData } from "@/composables/starterPacks/useAdaptedData";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import StarterPackInstallDialog from "./StarterPackInstallDialog.vue";
import StarterPackAdaptedRows from "./StarterPackAdaptedRows.vue";
import StarterPackUndoDialog from "./StarterPackUndoDialog.vue";

const props = defineProps<{
  flow: StarterPackFlow;
  clusters: string[];
}>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ "copy-link": [] }>();

type ShownKind = "dashboard" | "alert" | "savedView";
type GroupId = "view" | ShownKind | "not" | "adapted";
type CheckState = boolean | "indeterminate";

interface PackRow {
  key: string;
  name: I18nText;
  icon: IconName;
  iconClass: string;
  selectable: boolean;
  skipped: boolean;
  pill?: { label: I18nText; variant: "error-soft" | "warning-soft" };
  note?: I18nText;
  tip?: I18nText;
}

interface PackGroup {
  id: GroupId;
  title: I18nText;
  meta: I18nText;
  icon: IconName;
  rows: PackRow[];
  notice?: I18nText;
  warn?: boolean;
}

const { t } = useI18nTyped();
const router = useRouter();

const REASON_KEYS: Record<PackNotIncludedReason, I18nKey> = {
  already_have: "starterPacks.drawer.reasonAlreadyHave",
  no_data: "starterPacks.drawer.reasonNoData",
  no_flavour: "starterPacks.drawer.reasonNoFlavour",
  unavailable: "starterPacks.drawer.reasonUnavailable",
  needs_plan: "starterPacks.drawer.reasonNeedsPlan",
};
const TAG_KEYS: Record<PackNotIncludedReason, I18nKey> = {
  already_have: "starterPacks.manifest.tagHaveIt",
  no_data: "starterPacks.whatGetsCreated.notSeenYet",
  no_flavour: "starterPacks.manifest.tagNeedsData",
  unavailable: "starterPacks.manifest.tagUnavailable",
  needs_plan: "starterPacks.manifest.tagEnterprise",
};
const REASON_ICONS: Record<PackNotIncludedReason, IconName> = {
  already_have: "check",
  no_data: "schedule",
  no_flavour: "schedule",
  unavailable: "block",
  needs_plan: "lock",
};
const KIND_ICONS: Record<ShownKind, IconName> = {
  dashboard: "dashboard",
  alert: "notifications",
  savedView: "manage-search",
};
const GROUP_ICONS: Record<GroupId, IconName> = {
  ...KIND_ICONS,
  savedView: "bookmark",
  view: "hub",
  not: "block",
  adapted: "tune",
};
const SEVERITY = {
  critical: { variant: "error-soft", icon: "error", iconClass: "text-status-error-text" },
  warning: { variant: "warning-soft", icon: "warning", iconClass: "text-status-warning-text" },
} as const;
const KINDS: ShownKind[] = ["dashboard", "alert", "savedView"];

const flow = props.flow;
const pack = flow.pack;
const title = t(pack.titleKey);
const confirmMode = ref<"undo" | "remove">("undo");
const confirmOpen = ref(false);
const unticked = ref(new Set<string>());
const startAlerts = ref(false);
const expanded = ref<Partial<Record<GroupId, boolean>>>({});
const adapted = useAdaptedData(flow);

const showProgress = computed(() => flow.running.value || flow.interrupted.value);
const modalOpen = computed({
  get: () => open.value && !showProgress.value,
  set: (value) => (open.value = value),
});
const dialogOpen = computed({
  get: () => open.value && showProgress.value,
  set: (value) => (open.value = value),
});
const host = computed(() => raw(new URL(ALERT_LIBRARY_S3_BASE).host));
const preview = computed(() => flow.preview.value);
const installed = computed(() => flow.installed.value);
const loading = computed(
  () => !installed.value && ["idle", "loading"].includes(flow.previewState.value) && !preview.value,
);
const failedToLoad = computed(() => !installed.value && flow.previewState.value === "error");
const canPick = computed(() => !installed.value && !flow.forbidden.value);
const nativeShown = computed(() => !!pack.nativeView && flow.licensed.value);

const entryOf = (itemId: string) =>
  pack.bundledAlerts?.find(({ entry }) => entry.id === itemId)?.entry;

const alertLook = (item: PackRecordItem): Partial<PackRow> => {
  const entry = entryOf(item.copyOf ?? item.itemId);
  const tip = entry?.description ? raw(entry.description) : undefined;
  const level = entry?.severity;
  if (level !== "critical" && level !== "warning") return { tip };
  const look = SEVERITY[level];
  return {
    tip,
    icon: look.icon,
    iconClass: look.iconClass,
    pill: { label: t(`starterPacks.severity.${level}`), variant: look.variant },
  };
};

const itemRow = (item: PackRecordItem, skipped: boolean): PackRow => {
  const base: PackRow = {
    key: item.itemId,
    name: raw(flow.nameOf(item.itemId)),
    // Groups pass only items of a shown kind.
    icon: KIND_ICONS[item.kind as ShownKind],
    iconClass: "text-text-secondary",
    selectable: canPick.value && !skipped,
    skipped,
    ...(item.kind === "alert" ? alertLook(item) : {}),
  };
  if (!skipped) return base;
  return {
    ...base,
    icon: "block",
    iconClass: "text-text-muted",
    pill: undefined,
    note: t("starterPacks.whatGetsCreated.skipped"),
  };
};

const installedRow = (item: PackRecordItem): PackRow => {
  const row = itemRow(item, item.status === "skipped");
  if (item.kind !== "alert" || item.status !== "created") return { ...row, pill: undefined };
  const on = !!item.id && flow.enabledAlertIds.value.has(item.id);
  return {
    ...row,
    pill: undefined,
    icon: on ? "notifications-active" : "notifications-off",
    iconClass: "text-text-secondary",
    note: t(on ? "starterPacks.page.statusOn" : "starterPacks.page.statusSilent"),
  };
};

const viewGroup = (): PackGroup => ({
  id: "view",
  title: t("starterPacks.drawer.view"),
  meta: t("starterPacks.drawer.viewPath"),
  icon: GROUP_ICONS.view,
  rows: [],
});

const panelNote = computed(() => {
  const kept = preview.value?.panels.kept;
  return kept
    ? t("starterPacks.drawer.panelsFit", { count: kept }, kept)
    : t("starterPacks.drawer.dashboardNote");
});

const kindTitle = (kind: ShownKind) =>
  ({
    dashboard: t("starterPacks.installDialog.kindDashboards"),
    alert: t("starterPacks.installDialog.kindAlerts"),
    savedView: t("starterPacks.drawer.savedViews"),
  })[kind];

// The alerts meta follows the start switch, so the template reads it rather than the groups.
const planMeta = (kind: ShownKind) =>
  kind === "dashboard" ? panelNote.value : t("starterPacks.drawer.savedViewsNote");

const installedMeta = (kind: ShownKind, items: PackRecordItem[]) => {
  if (kind === "dashboard") {
    return t("starterPacks.drawer.folderValue", { name: raw(pack.folder.name) });
  }
  if (kind === "alert") {
    const made = items.filter(({ status }) => status === "created");
    const on = made.filter(({ id }) => !!id && flow.enabledAlertIds.value.has(id)).length;
    return t("starterPacks.page.alertsMeta", { on, silent: made.length - on });
  }
  return t("starterPacks.drawer.savedViewsNote");
};

const notIncludedGroup = (): PackGroup | null => {
  // A preview read after the install finds the pack's own items as existing.
  const madeIds = new Set(flow.made.value.map(({ itemId }) => itemId));
  const left = (preview.value?.notIncluded ?? []).filter(
    (row) => row.reason !== "already_have" && !madeIds.has(row.itemId),
  );
  const rows: PackRow[] = left.map((row) => ({
    key: row.itemId,
    name: raw(row.name),
    icon: REASON_ICONS[row.reason],
    iconClass: "text-text-muted",
    selectable: false,
    skipped: false,
    note: t(TAG_KEYS[row.reason]),
    tip: t(REASON_KEYS[row.reason], { name: raw(row.name) }),
  }));
  if (pack.nativeView && !flow.licensed.value) {
    const name = t("starterPacks.drawer.view");
    rows.unshift({
      key: "view",
      name,
      icon: REASON_ICONS.needs_plan,
      iconClass: "text-text-muted",
      selectable: false,
      skipped: false,
      note: t(TAG_KEYS.needs_plan),
      tip: t(REASON_KEYS.needs_plan, { name }),
    });
  }
  if (!rows.length) return null;
  return {
    id: "not",
    title: t("starterPacks.drawer.notIncluded"),
    meta: t("starterPacks.manifest.leftOut", { count: rows.length }, rows.length),
    icon: GROUP_ICONS.not,
    rows,
  };
};

const adaptedGroup = (): PackGroup | null =>
  adapted.hasAny.value
    ? {
        id: "adapted",
        title: t("starterPacks.manifest.adapted"),
        meta: adapted.meta.value,
        icon: GROUP_ICONS.adapted,
        rows: [],
        warn: adapted.warn.value,
      }
    : null;

const planGroups = (): PackGroup[] => {
  const items = preview.value?.items ?? [];
  const groups: PackGroup[] = KINDS.flatMap((kind) => {
    const rows = items
      .filter((item) => item.kind === kind)
      .map((item) => itemRow(item, item.status === "existing"));
    if (!rows.length) return [];
    const clashes = rows.filter(({ skipped }) => skipped).map(({ name }) => name);
    const notice = clashes.length
      ? t("starterPacks.whatGetsCreated.nameInUse", { name: raw(clashes.join(", ")) })
      : undefined;
    return [
      {
        id: kind,
        title: kindTitle(kind),
        meta: planMeta(kind),
        icon: GROUP_ICONS[kind],
        rows,
        notice,
      },
    ];
  });
  const extra = [notIncludedGroup(), adaptedGroup()].filter((group) => group !== null);
  return [...(nativeShown.value ? [viewGroup()] : []), ...groups, ...extra];
};

const installedGroups = (): PackGroup[] => {
  const groups: PackGroup[] = KINDS.flatMap((kind) => {
    const items = flow.items.value.filter(
      (item) => item.kind === kind && item.status !== "existing",
    );
    if (!items.length) return [];
    return [
      {
        id: kind,
        title: kindTitle(kind),
        meta: installedMeta(kind, items),
        icon: GROUP_ICONS[kind],
        rows: items.map(installedRow),
      },
    ];
  });
  return [...(nativeShown.value ? [viewGroup()] : []), ...groups];
};

const groups = computed<PackGroup[]>(() => {
  if (installed.value) return installedGroups();
  return preview.value ? planGroups() : [];
});

const selectableRows = (group: PackGroup) => group.rows.filter(({ selectable }) => selectable);
const isTicked = (row: PackRow) => !unticked.value.has(row.key);
const pickedIn = (group: PackGroup) => selectableRows(group).filter(isTicked).length;
const picked = computed(() => groups.value.reduce((sum, group) => sum + pickedIn(group), 0));
const alertsPicked = computed(() => {
  const group = groups.value.find(({ id }) => id === "alert");
  return group ? pickedIn(group) : 0;
});
const startOn = computed(() => startAlerts.value && alertsPicked.value > 0);
const metaOf = (group: PackGroup) => {
  if (group.id !== "alert" || installed.value) return group.meta;
  const count = group.rows.filter(({ skipped }) => !skipped).length;
  return startOn.value
    ? t("starterPacks.whatGetsCreated.alertsStart", { count })
    : t("starterPacks.whatGetsCreated.alertsSilent", { count });
};
const excludedIds = computed(() =>
  groups.value.flatMap((group) =>
    selectableRows(group)
      .filter((row) => !isTicked(row))
      .map(({ key }) => key),
  ),
);
const skippedCount = computed(() =>
  installed.value
    ? 0
    : groups.value.flatMap(({ rows }) => rows.filter((row) => row.skipped)).length,
);
const creatable = (group: PackGroup) =>
  group.id !== "not" && group.rows.some(({ skipped }) => !skipped);
const nothingToCreate = computed(() => !!preview.value && !groups.value.some(creatable));

const groupState = (group: PackGroup): CheckState => {
  const on = pickedIn(group);
  if (on === 0) return false;
  return on === selectableRows(group).length ? true : "indeterminate";
};

const setTicked = (keys: string[], on: boolean) => {
  const next = new Set(unticked.value);
  for (const key of keys) {
    if (on) next.delete(key);
    else next.add(key);
  }
  unticked.value = next;
};
const toggleRow = (row: PackRow) => {
  if (row.selectable) setTicked([row.key], !isTicked(row));
};
const toggleGroup = (group: PackGroup) =>
  setTicked(
    selectableRows(group).map(({ key }) => key),
    groupState(group) !== true,
  );

// The adapted card has no item rows; its body is the adapted rows component.
const expandable = (group: PackGroup) => group.rows.length > 0 || group.id === "adapted";
const openByDefault = (group: PackGroup) =>
  group.id === "alert" || (group.id === "adapted" && adapted.open.value.length > 0);
const isOpen = (group: PackGroup) => expanded.value[group.id] ?? openByDefault(group);
const toggleOpen = (group: PackGroup) => {
  if (expandable(group)) expanded.value = { ...expanded.value, [group.id]: !isOpen(group) };
};

const installedLine = computed(() => {
  const record = flow.record.value;
  if (!record) return "";
  const date = raw(
    record.installedAt
      ? new Date(record.installedAt / 1000).toLocaleString()
      : t("starterPacks.libraryTabs.unknownDate"),
  );
  return record.installedBy
    ? t("starterPacks.libraryTabs.installedBy", { who: raw(record.installedBy), date })
    : t("starterPacks.libraryTabs.installedByUnknown", { date });
});
const defaultNote = computed(() =>
  props.clusters.length
    ? t("starterPacks.whatGetsCreated.subtitleScoped", {
        title,
        scope: raw(props.clusters.join(", ")),
      })
    : t("starterPacks.whatGetsCreated.subtitle", { title }),
);
const note = computed<{ icon?: IconName; spin?: boolean; text: I18nText }>(() => {
  if (installed.value && installedLine.value) return { icon: "person", text: installedLine.value };
  if (loading.value) return { spin: true, text: t("starterPacks.drawer.loadingFit") };
  if (flow.forbidden.value) return { icon: "lock", text: t("starterPacks.noPermission") };
  if (skippedCount.value) {
    const count = skippedCount.value;
    return { icon: "info", text: t("starterPacks.whatGetsCreated.skippedNote", { count }, count) };
  }
  if (pack.nativeView && !flow.licensed.value) {
    const folder = t("starterPacks.drawer.folderValue", { name: raw(pack.folder.name) });
    return { icon: "folder", text: t("starterPacks.whatGetsCreated.savedIn", { folder }) };
  }
  return { text: defaultNote.value };
});

// A started alert runs queries, so the "none for now" line would no longer be true.
const reachLine = computed(() => {
  const scope = raw(packScopeValue(t, props.clusters));
  if (startOn.value) {
    return pack.clusterScoped
      ? t("starterPacks.whatGetsCreated.reachStartedScoped", { scope })
      : t("starterPacks.whatGetsCreated.reachStarted");
  }
  return pack.clusterScoped
    ? t("starterPacks.drawer.reachScoped", { scope })
    : t("starterPacks.drawer.reach");
});
const installedScope = computed(() => (pack.clusterScoped ? packScope(t, props.clusters) : ""));
const ctaLabel = computed(() =>
  t("starterPacks.whatGetsCreated.cta", { title, count: picked.value }),
);

const ensurePreview = () => {
  if (flow.previewState.value === "idle" || flow.previewState.value === "error") {
    void flow.loadPreview();
  }
};
watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    unticked.value = new Set();
    startAlerts.value = false;
    expanded.value = {};
    ensurePreview();
  },
  { immediate: true },
);
// Answering the last open question must not collapse the card the user is working in.
watch(
  () => adapted.open.value.length,
  (now, before) => {
    if (before && !now && expanded.value.adapted === undefined) {
      expanded.value = { ...expanded.value, adapted: true };
    }
  },
);

const choice = () => ({ exclude: excludedIds.value, enableAlerts: startOn.value });
const finishLanding = async () => {
  open.value = false;
  await flow.land();
};
const manage = () => {
  open.value = false;
  void router.push(flow.packRoute.value).catch(() => {});
};
const startSetup = async () => {
  if (await flow.install(undefined, choice())) await finishLanding();
};
const askConfirm = (mode: "undo" | "remove") => {
  confirmMode.value = mode;
  confirmOpen.value = true;
};
</script>

<template>
  <ODialog
    v-model:open="modalOpen"
    size="md"
    :aria-title="t('starterPacks.drawer.title')"
    data-test="starter-pack-drawer"
  >
    <template #header>
      <div class="flex min-w-0 items-center gap-3">
        <span
          class="border-border-default rounded-default flex size-9 shrink-0 items-center justify-center border"
        >
          <img
            v-if="pack.logo"
            :src="getImageURL(pack.logo)"
            class="size-5 object-contain"
            alt=""
          />
          <OIcon v-else name="inventory-2" size="sm" class="text-text-secondary" />
        </span>
        <div class="flex min-w-0 flex-col">
          <span class="text-text-heading text-base font-semibold">{{
            t("starterPacks.drawer.title")
          }}</span>
          <span
            class="text-text-secondary flex min-w-0 items-center gap-1.5 text-xs"
            data-test="starter-pack-drawer-note"
          >
            <OSpinner v-if="note.spin" size="xs" class="shrink-0" />
            <OIcon v-else-if="note.icon" :name="note.icon" size="sm" class="shrink-0" />
            <span class="truncate">{{ note.text }}</span>
          </span>
        </div>
      </div>
    </template>

    <div class="flex flex-col gap-2 text-sm" data-test="starter-pack-drawer-items">
      <OBanner
        v-if="flow.installFailed.value"
        variant="error-soft"
        dense
        :content="t('starterPacks.progress.installError')"
        data-test="starter-pack-drawer-install-error"
      />

      <template v-if="loading">
        <div
          v-for="index in 4"
          :key="index"
          class="border-border-default rounded-default flex items-center gap-3 border px-3 py-2.5"
          data-test="starter-pack-drawer-loading"
        >
          <OSkeleton class="rounded-default size-7 shrink-0" />
          <div class="flex flex-1 flex-col gap-2">
            <OSkeleton type="text" class="h-2.5 w-2/5" />
            <OSkeleton type="text" class="h-2 w-1/2" />
          </div>
        </div>
      </template>

      <div v-else-if="failedToLoad" class="flex items-center justify-between gap-3">
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

      <section
        v-for="group in groups"
        :key="group.id"
        class="border-border-default rounded-default overflow-hidden border"
        :data-test="`starter-pack-drawer-group-${group.id}`"
      >
        <div
          :class="[
            'flex items-center gap-3 px-3 py-2.5',
            expandable(group) && 'hover:bg-surface-subtle cursor-pointer',
          ]"
          @click="toggleOpen(group)"
        >
          <OCheckbox
            v-if="canPick && selectableRows(group).length"
            size="md"
            :model-value="groupState(group)"
            :aria-label="t('starterPacks.whatGetsCreated.selectGroup', { group: group.title })"
            data-test="starter-pack-drawer-group-check"
            @update:model-value="toggleGroup(group)"
          />
          <span v-else-if="canPick" class="size-4 shrink-0" />
          <span
            :class="[
              'rounded-default flex size-7 shrink-0 items-center justify-center',
              installed
                ? 'bg-icon-chip-success-bg text-icon-chip-success-text'
                : group.id === 'not'
                  ? 'bg-surface-subtle text-text-secondary'
                  : group.warn
                    ? 'bg-icon-chip-warning-bg text-icon-chip-warning-text'
                    : 'bg-icon-chip-primary-bg text-icon-chip-primary-text',
            ]"
          >
            <OIcon :name="installed ? 'check' : group.icon" size="sm" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col">
            <span
              :class="[
                'truncate font-semibold',
                group.id === 'not' ? 'text-text-secondary' : 'text-text-heading',
              ]"
              >{{ group.title }}</span
            >
            <span
              v-if="group.warn"
              class="text-status-warning-text truncate text-xs leading-none font-normal"
              data-test="starter-pack-drawer-group-meta"
              >{{ metaOf(group) }}</span
            >
            <OText
              v-else
              variant="meta"
              class="truncate"
              data-test="starter-pack-drawer-group-meta"
              >{{ metaOf(group) }}</OText
            >
          </div>
          <span v-if="group.id === 'alert' && canPick" class="shrink-0" @click.stop>
            <OSwitch
              v-model="startAlerts"
              size="sm"
              label-position="left"
              :label="t('starterPacks.whatGetsCreated.startAlerts')"
              :disabled="alertsPicked === 0"
              data-test="starter-pack-drawer-start-alerts"
            />
          </span>
          <OButton
            v-if="expandable(group)"
            variant="ghost-muted"
            size="icon-xs"
            :icon-left="isOpen(group) ? 'expand-less' : 'expand-more'"
            :aria-label="isOpen(group) ? t('common.collapse') : t('common.expand')"
            :aria-expanded="isOpen(group)"
            @click.stop="toggleOpen(group)"
          />
        </div>

        <div v-if="expandable(group) && isOpen(group)" class="border-border-default border-t">
          <StarterPackAdaptedRows
            v-if="group.id === 'adapted'"
            :flow="flow"
            class="ps-13 pe-3 pb-1"
          />
          <OInlineNotice
            v-else-if="group.notice"
            variant="warning"
            :text="group.notice"
            class="px-3 py-2"
            data-test="starter-pack-drawer-name-in-use"
          />
          <OTooltip
            v-for="row in group.rows"
            :key="row.key"
            side="bottom"
            align="start"
            max-width="17.5rem"
            :disabled="!row.tip"
          >
            <div
              :tabindex="row.tip ? 0 : undefined"
              :class="[
                'border-border-default flex min-h-9 items-center gap-3 border-t px-3 outline-none first:border-t-0',
                'focus-visible:bg-surface-subtle hover:bg-surface-subtle',
                row.selectable && 'cursor-pointer',
              ]"
              :data-test="`starter-pack-drawer-${group.id}-row`"
              @click="toggleRow(row)"
            >
              <OCheckbox
                v-if="canPick && selectableRows(group).length"
                size="md"
                :class="!row.selectable && 'invisible'"
                :model-value="row.selectable && isTicked(row)"
                :disabled="!row.selectable"
                :aria-label="t('starterPacks.whatGetsCreated.selectRow', { name: row.name })"
                data-test="starter-pack-drawer-row-check"
                @update:model-value="toggleRow(row)"
              />
              <span class="flex w-7 shrink-0 justify-center">
                <OIcon :name="row.icon" size="sm" :class="row.iconClass" />
              </span>
              <span
                :class="[
                  'min-w-0 flex-1 truncate',
                  row.skipped && 'text-text-muted line-through',
                  row.selectable && !isTicked(row) && 'text-text-muted',
                ]"
                >{{ row.name }}</span
              >
              <OBadge
                v-if="row.pill"
                :variant="row.pill.variant"
                size="sm"
                class="shrink-0"
                data-test="starter-pack-drawer-alert-severity"
                >{{ row.pill.label }}</OBadge
              >
              <OText v-else-if="row.note" variant="meta" class="shrink-0 text-right">{{
                row.note
              }}</OText>
            </div>
            <template #content>
              <div class="flex flex-col gap-0.5">
                <strong>{{ row.name }}</strong>
                <span>{{ row.tip }}</span>
              </div>
            </template>
          </OTooltip>
        </div>
      </section>

      <span
        v-if="installed && installedScope"
        class="text-text-secondary flex items-center gap-2 px-1 pt-2 text-xs"
      >
        <OIcon name="public" size="sm" class="shrink-0" />
        <span data-test="starter-pack-progress-scope">{{ installedScope }}</span>
      </span>

      <div
        v-if="!installed && preview"
        class="text-text-secondary flex flex-col gap-1.5 px-1 pt-2 text-xs"
      >
        <span class="text-text-label font-semibold">{{
          t("starterPacks.whatGetsCreated.footprint")
        }}</span>
        <span class="flex items-center gap-2">
          <OIcon name="public" size="sm" class="shrink-0" />
          <span data-test="starter-pack-drawer-reach-line">{{ reachLine }}</span>
        </span>
        <span class="flex items-center gap-2">
          <OIcon name="info" size="sm" class="shrink-0" />
          <span data-test="starter-pack-drawer-source">{{
            t(
              preview?.offline ? "starterPacks.drawer.sourceOffline" : "starterPacks.drawer.source",
              { host },
            )
          }}</span>
        </span>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full items-center gap-2">
        <template v-if="installed">
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
        <span class="flex-1" />
        <OButton
          variant="outline"
          size="sm-action"
          data-test="starter-pack-drawer-close-btn"
          @click="open = false"
        >
          {{ t("starterPacks.drawer.close") }}
        </OButton>
        <OButton
          v-if="flow.forbidden.value"
          variant="primary"
          size="sm-action"
          icon-left="content-copy"
          data-test="starter-pack-drawer-copy-link-btn"
          @click="emit('copy-link')"
        >
          {{ t("starterPacks.copyLink") }}
        </OButton>
        <OButton
          v-else-if="installed || nothingToCreate"
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
          :disabled="flow.previewState.value !== 'ready' || picked === 0"
          data-test="starter-pack-drawer-submit-btn"
          @click="startSetup"
        >
          {{ ctaLabel }}
        </OButton>
      </div>
    </template>
  </ODialog>
  <StarterPackInstallDialog
    v-model:open="dialogOpen"
    :flow="flow"
    @open-landing="finishLanding"
    @manage="manage"
    @undo="askConfirm('undo')"
    @retry="startSetup"
    @copy-link="emit('copy-link')"
  />
  <StarterPackUndoDialog
    v-model:open="confirmOpen"
    :flow="flow"
    :mode="confirmMode"
    @done="open = false"
  />
</template>
