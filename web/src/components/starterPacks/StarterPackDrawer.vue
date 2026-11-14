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
import { computed, markRaw, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OInlineNotice from "@/lib/feedback/InlineNotice/OInlineNotice.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import { ALERT_LIBRARY_S3_BASE } from "@/constants/alertLibrary";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import { readQuery } from "@/composables/query/readQuery";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { detectPrebuiltType, PREBUILT_DESTINATION_TYPES } from "@/utils/prebuilt-templates";
import { packScope, packScopeValue } from "@/composables/starterPacks/packCopy";
import type { PackNotIncludedReason, PackRecordItem } from "@/composables/starterPacks/types";
import { useAdaptedData } from "@/composables/starterPacks/useAdaptedData";
import { useBrowserMatches } from "@/composables/starterPacks/useBrowserMatches";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import type { PackMatchState } from "@/composables/starterPacks/useStarterPackMatcher";
import { useEmailMeDestination } from "@/composables/starterPacks/useEmailMeDestination";
import StarterPackAdaptedRows from "./StarterPackAdaptedRows.vue";
import StarterPackAlertStep, { type AlertStepDestination } from "./StarterPackAlertStep.vue";
import StarterPackInlineConfirm from "./StarterPackInlineConfirm.vue";
import StarterPackProgress from "./StarterPackProgress.vue";
import StarterPackReady, { type ReadyAlerts } from "./StarterPackReady.vue";
import StarterPackStepSpinner from "./StarterPackStepSpinner.vue";

const props = defineProps<{
  flow: StarterPackFlow;
  clusters: string[];
  /** Whether the pack's data is arriving, for the Ready data line; absent hides that line. */
  matchState?: PackMatchState;
  /** The folder the host's own picker chose; absent means the pack's folder. */
  folderName?: string;
}>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ "copy-link": []; done: []; installed: [] }>();

type ShownKind = "dashboard" | "alert" | "savedView";
type GroupId = "view" | ShownKind | "not" | "adapted";
type CheckState = boolean | "indeterminate";
type Step = "content" | "setup" | "ready" | "installed";

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
const store = useStore();
const emailMe = useEmailMeDestination(props.flow.org);

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
const HOUR_US = 60 * 60 * 1_000_000;
const STEP_NUMBER: Record<Step, number> = { content: 1, setup: 2, ready: 3, installed: 1 };
const SPINNER = markRaw(StarterPackStepSpinner);

const flow = props.flow;
const pack = flow.pack;
const title = t(pack.titleKey);
const inlineConfirm = ref<"undo" | "remove" | null>(null);
const unticked = ref(new Set<string>());
const turnOn = ref(false);
const sendTo = ref(false);
const destination = ref("");
const destinations = ref<AlertStepDestination[] | null>(null);
const touched = { turnOn: false, sendTo: false };
let destinationsRun = 0;
let ownRun = false;
const preparing = ref(false);
const readyShown = ref(false);
const installedHere = ref(false);
const outcome = ref<ReadyAlerts>({ turnOn: false, sendTo: false });
const expanded = ref<Partial<Record<GroupId, boolean>>>({});
const adapted = useAdaptedData(flow);
const userEmail = computed<string>(() => store.state.userInfo?.email ?? "");
// Unknown (an older server without the flag) counts as on, so Email me is still offered.
const smtpOff = computed(() => store.state.zoConfig?.smtp_enabled === false);
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
const startOn = computed(() => turnOn.value && alertsPicked.value > 0);
const metaOf = (group: PackGroup) => {
  if (group.id !== "alert" || installed.value) return group.meta;
  const rows = group.rows.filter((row) =>
    canPick.value ? row.selectable && isTicked(row) : !row.skipped,
  );
  const level = (name: "critical" | "warning") =>
    rows.filter(({ key }) => entryOf(key)?.severity === name).length;
  return t("starterPacks.drawer.alertsMeta", {
    count: rows.length,
    critical: level("critical"),
    warning: level("warning"),
  });
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
const existingCount = computed(
  () =>
    (preview.value?.items ?? []).filter(
      ({ kind, status }) => kind !== "folder" && status === "existing",
    ).length,
);
const allExist = computed(() => nothingToCreate.value && existingCount.value > 0);

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
const alertBlockShown = (group: PackGroup) =>
  group.id === "alert" && canPick.value && groupState(group) !== false;

// The adapted card has no item rows; its body is the adapted rows component.
const expandable = (group: PackGroup) => group.rows.length > 0 || group.id === "adapted";
const openByDefault = (group: PackGroup) =>
  group.id === "alert" || (group.id === "adapted" && adapted.open.value.length > 0);
const isOpen = (group: PackGroup) => expanded.value[group.id] ?? openByDefault(group);
const toggleOpen = (group: PackGroup) => {
  if (expandable(group)) expanded.value = { ...expanded.value, [group.id]: !isOpen(group) };
};

const step = computed<Step>(() => {
  if (readyShown.value) return "ready";
  if (flow.running.value || flow.interrupted.value) return "setup";
  return installed.value ? "installed" : "content";
});
const sendMode = computed<"loading" | "select" | "email" | "none">(() => {
  if (destinations.value === null) return "loading";
  if (destinations.value.length) return "select";
  return smtpOff.value ? "none" : "email";
});
const waitingForDestinations = computed(
  () => alertsPicked.value > 0 && sendMode.value === "loading",
);
const made = computed(() => flow.made.value.length);
const total = computed(() => flow.toCreate.value.length);
const alertsMade = computed(() => flow.made.value.filter(({ kind }) => kind === "alert").length);
const alreadyHere = computed(
  () => flow.items.value.filter(({ status }) => status === "existing").length,
);
const undoLabel = computed(() => {
  const hours = Math.floor(flow.undoLeftUs.value / HOUR_US);
  return hours > 0
    ? t("starterPacks.landing.available", { hours })
    : t("starterPacks.landing.availableSoon");
});
const dataState = computed<"receiving" | "waiting" | null>(() => {
  if (props.matchState === "matched") return "receiving";
  if (props.matchState === "waiting" || props.matchState === "none") return "waiting";
  return null;
});
const routedTo = computed<I18nText | undefined>(() => {
  const { turnOn: on, sendTo: routed, failure, email, name } = outcome.value;
  if (!on || !routed || failure) return undefined;
  return email ? t("starterPacks.progress.emailMe", { email: raw(email) }) : raw(name ?? "");
});

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
const setupNote = (): { icon?: IconName; spin?: boolean; text: I18nText } => {
  const counts = { made: made.value, total: total.value };
  if (flow.running.value)
    return { spin: true, text: t("starterPacks.stepper.noteRunning", counts) };
  const count = flow.failed.value.length;
  const summary = t("starterPacks.progress.summary", counts);
  return {
    icon: "warning",
    text: count
      ? t("starterPacks.installDialog.attention", { title: summary, count }, count)
      : summary,
  };
};
const readyNote = (): I18nText => {
  const counts = { made: made.value, total: total.value };
  if (!installedHere.value) return t("starterPacks.drawer.nothingToCreate");
  if (alreadyHere.value) {
    return t("starterPacks.stepper.noteAlreadyHere", { ...counts, count: alreadyHere.value });
  }
  if (!alertsMade.value) return t("starterPacks.progress.summary", counts);
  const on = outcome.value.turnOn && !outcome.value.failure;
  return on
    ? t(
        "starterPacks.stepper.noteAlertsOn",
        { ...counts, count: alertsMade.value },
        alertsMade.value,
      )
    : t("starterPacks.stepper.noteAlertsOff", counts);
};
const note = computed<{ icon?: IconName; spin?: boolean; text: I18nText }>(() => {
  if (step.value === "setup") return setupNote();
  if (step.value === "ready") return { icon: "check-circle", text: readyNote() };
  if (installed.value && installedLine.value) return { icon: "person", text: installedLine.value };
  if (loading.value) return { spin: true, text: t("starterPacks.drawer.loadingFit") };
  if (flow.forbidden.value) {
    return { icon: "lock", text: t("starterPacks.drawer.noteForbidden", { title }) };
  }
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
const openLabel = computed(() =>
  t(
    flow.dashboardItem.value?.id
      ? "starterPacks.drawer.openDashboard"
      : "starterPacks.libraryTabs.openPack",
  ),
);
const summaryLine = computed(() =>
  t("starterPacks.drawer.summary", { count: picked.value }, picked.value),
);

const ensurePreview = () => {
  if (flow.previewState.value === "idle" || flow.previewState.value === "error") {
    void flow.loadPreview();
  }
};
const typeName = (row: Record<string, any>): I18nText => {
  const prebuilt = detectPrebuiltType(row);
  const known = PREBUILT_DESTINATION_TYPES.find(({ id }) => id === prebuilt);
  if (known) return raw(known.name);
  if (row.type === "email") return t("alert_destinations.customEmail");
  return row.type === "http"
    ? t("alert_destinations.customWebhook")
    : t("alert_destinations.custom");
};
const destinationLabel = (row: Record<string, any>) => raw(`${row.name} · ${typeName(row)}`);

const setTurnOn = (on: boolean) => {
  turnOn.value = on;
  touched.turnOn = true;
};
const setSendTo = (on: boolean) => {
  sendTo.value = on;
  touched.sendTo = true;
};
// Both boxes start ticked only when there is somewhere to send; a box the user already changed keeps its value.
const loadDestinations = async () => {
  destinationsRun += 1;
  const run = destinationsRun;
  touched.turnOn = false;
  touched.sendTo = false;
  destinations.value = null;
  turnOn.value = true;
  sendTo.value = true;
  const rows = await readQuery(destinationsQuery(flow.org, "alert")).catch(() => []);
  if (run !== destinationsRun) return;
  const usable = rows.filter((row) => !(smtpOff.value && row.type === "email"));
  destinations.value = usable.map((row) => ({ name: row.name, label: destinationLabel(row) }));
  const canSend = sendMode.value !== "none";
  if (!canSend || !touched.sendTo) sendTo.value = canSend;
  if (!touched.turnOn) turnOn.value = canSend;
  destination.value = destinations.value[0]?.name ?? "";
};
/** The alert choice an install record carries, for a run this popup did not start. */
const storedOutcome = (): ReadyAlerts => {
  const record = flow.record.value;
  const name = record?.destination;
  const label = destinations.value?.find((row) => row.name === name)?.label;
  return {
    turnOn: !!record?.enableAlerts,
    sendTo: !!name,
    destination: label ?? (name ? raw(name) : undefined),
    name,
  };
};

const resetChoices = () => {
  unticked.value = new Set();
  turnOn.value = false;
  sendTo.value = false;
  destination.value = "";
  readyShown.value = false;
  installedHere.value = false;
  outcome.value = { turnOn: false, sendTo: false };
  expanded.value = {};
};
watch(
  open,
  (isOpen) => {
    if (!isOpen) {
      readyShown.value = false;
      return;
    }
    if (!flow.running.value && !flow.interrupted.value) resetChoices();
    // A resumed run names its destination by the label step 1 would have shown.
    if (!installed.value && !flow.forbidden.value) void loadDestinations();
    ensurePreview();
  },
  { immediate: true },
);
// A setup that finishes while the popup is open moves it to Ready; nothing navigates by itself.
watch(
  () => flow.running.value,
  (now, before) => {
    if (before && !now) {
      if (!ownRun) outcome.value = storedOutcome();
      ownRun = false;
    }
    if (before && !now && flow.installed.value && open.value) {
      readyShown.value = true;
      installedHere.value = true;
    }
  },
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

const finishLanding = async () => {
  open.value = false;
  await flow.land();
};
const manage = () => {
  open.value = false;
  void router.push(flow.packRoute.value).catch(() => {});
};
const openView = () => {
  const view = pack.nativeView;
  open.value = false;
  if (view)
    void router.push({ name: view.route, query: { org_identifier: flow.org } }).catch(() => {});
};
// The pack page owns the Turn on drawer and opens it from this query.
const openTurnOn = () => {
  open.value = false;
  const route = flow.packRoute.value;
  void router.push({ ...route, query: { ...route.query, turnOn: "1" } }).catch(() => {});
};

/** Settles where the alerts send before anything is created, so each alert is saved once. */
const resolveSendTo = async (): Promise<{ alerts: ReadyAlerts; name?: string }> => {
  const wantsOn = startOn.value;
  if (!alertsPicked.value || !sendTo.value || sendMode.value === "none") {
    return { alerts: { turnOn: wantsOn, sendTo: false } };
  }
  if (sendMode.value === "email") {
    const result = await emailMe.ensure(userEmail.value);
    if ("failure" in result) {
      return { alerts: { turnOn: wantsOn, sendTo: true, failure: result.failure } };
    }
    const alerts = { turnOn: wantsOn, sendTo: true, destination: raw(result.name) };
    return { alerts: { ...alerts, email: userEmail.value, name: result.name }, name: result.name };
  }
  const picked = destinations.value?.find(({ name }) => name === destination.value);
  return {
    alerts: { turnOn: wantsOn, sendTo: !!picked, destination: picked?.label, name: picked?.name },
    name: picked?.name,
  };
};
const startSetup = async () => {
  preparing.value = true;
  const { alerts, name } = await resolveSendTo().finally(() => (preparing.value = false));
  outcome.value = alerts;
  ownRun = true;
  const done = await flow.install(props.folderName, {
    exclude: excludedIds.value,
    enableAlerts: alerts.turnOn && !alerts.failure,
    destination: name,
  });
  if (!done) return;
  useBrowserMatches(flow.org).markInstalled(pack.id, pack.id);
  emit("installed");
};
const retry = async () => {
  outcome.value = storedOutcome();
  ownRun = true;
  if (await flow.retry()) emit("installed");
};
const showReady = () => {
  readyShown.value = true;
};
const confirmDone = () => {
  inlineConfirm.value = null;
  open.value = false;
  emit("done");
};
watch(open, (isOpen) => {
  if (!isOpen) inlineConfirm.value = null;
});
</script>

<template>
  <ODialog
    v-model:open="open"
    size="md"
    :persistent="flow.busy.value || flow.running.value || preparing"
    :aria-title="t('starterPacks.drawer.packTitle', { title })"
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
            t("starterPacks.drawer.packTitle", { title })
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

    <OStepper
      :model-value="STEP_NUMBER[step]"
      :hide-header="step === 'installed'"
      :animated="false"
      data-test="starter-pack-drawer-stepper"
    >
      <OStep
        :name="1"
        :title="t('starterPacks.stepper.content')"
        :done="step !== 'content'"
        data-test="starter-pack-drawer-step-content"
      >
        <div class="flex flex-col gap-2 pt-2 text-sm" data-test="starter-pack-drawer-items">
          <template v-if="allExist">
            <OBanner
              variant="info"
              icon="info"
              dense
              :content="t('starterPacks.drawer.allExist', { count: existingCount })"
              data-test="starter-pack-drawer-all-exist"
            />
          </template>
          <template v-else>
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
                  :aria-label="
                    t('starterPacks.whatGetsCreated.selectGroup', { group: group.title })
                  "
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

              <StarterPackAlertStep
                v-if="alertBlockShown(group)"
                :turn-on="turnOn"
                :send-to="sendTo"
                @update:turn-on="setTurnOn"
                @update:send-to="setSendTo"
                v-model:destination="destination"
                class="border-border-default border-t"
                :count="alertsPicked"
                :destinations="destinations"
                :smtp-off="smtpOff"
                :email="userEmail"
              />
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
                    preview?.offline
                      ? "starterPacks.drawer.sourceOffline"
                      : "starterPacks.drawer.source",
                    { host },
                  )
                }}</span>
              </span>
            </div>
          </template>
        </div>
      </OStep>
      <OStep
        :name="2"
        :title="
          flow.running.value ? t('starterPacks.stepper.settingUp') : t('starterPacks.stepper.setup')
        "
        :icon="flow.running.value ? SPINNER : undefined"
        :description="flow.interrupted.value ? t('starterPacks.stepper.interrupted') : undefined"
        :done="step === 'ready'"
        data-test="starter-pack-drawer-step-setup"
      >
        <StarterPackProgress
          class="pt-2"
          :flow="flow"
          :routed-to="routedTo"
          @copy-link="emit('copy-link')"
        />
      </OStep>
      <OStep
        :name="3"
        :title="t('starterPacks.stepper.ready')"
        data-test="starter-pack-drawer-step-ready"
      >
        <StarterPackReady
          class="pt-2"
          :flow="flow"
          :alerts="outcome"
          :data="dataState"
          :clusters="clusters"
          @open-view="openView"
          @open-dashboard="finishLanding"
          @turn-on="openTurnOn"
        />
      </OStep>
    </OStepper>

    <template #footer>
      <StarterPackInlineConfirm
        v-if="inlineConfirm"
        :flow="flow"
        :mode="inlineConfirm"
        data-test="starter-pack-drawer-confirm"
        @cancel="inlineConfirm = null"
        @done="confirmDone"
      />
      <div v-else-if="step === 'setup'" class="flex w-full items-center justify-end gap-2">
        <OButton
          v-if="flow.running.value"
          variant="primary"
          size="sm-action"
          disabled
          loading
          :spinner="false"
          data-test="starter-pack-progress-running-btn"
        >
          <template #icon-left><StarterPackStepSpinner /></template>
          {{ t("starterPacks.stepper.settingUp") }}
        </OButton>
        <template v-else>
          <OButton
            variant="outline"
            size="sm-action"
            data-test="starter-pack-progress-manage-btn"
            @click="manage"
          >
            {{ t("starterPacks.installDialog.manage") }}
          </OButton>
          <OButton
            v-if="flow.failed.value.length && !flow.forbidden.value"
            variant="primary"
            size="sm-action"
            icon-left="refresh"
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
            v-else-if="!flow.failed.value.length"
            variant="primary"
            size="sm-action"
            data-test="starter-pack-progress-finish-btn"
            @click="retry"
          >
            {{ t("starterPacks.progress.finish") }}
          </OButton>
        </template>
      </div>
      <div v-else-if="step === 'ready'" class="flex w-full items-center gap-2">
        <template v-if="installedHere && flow.canUndo.value">
          <OButton
            variant="ghost"
            size="sm-action"
            data-test="starter-pack-ready-undo-btn"
            @click="inlineConfirm = 'undo'"
          >
            {{ t("starterPacks.landing.undo") }}
          </OButton>
          <OText variant="meta" data-test="starter-pack-ready-undo-left">{{ undoLabel }}</OText>
        </template>
        <span class="flex-1" />
        <OButton
          variant="outline"
          size="sm-action"
          data-test="starter-pack-ready-close-btn"
          @click="open = false"
        >
          {{ t("starterPacks.drawer.close") }}
        </OButton>
      </div>
      <div v-else class="flex w-full items-center gap-2">
        <template v-if="installed">
          <OButton
            v-if="flow.canUndo.value"
            variant="ghost-destructive"
            size="sm-action"
            data-test="starter-pack-progress-undo-btn"
            @click="inlineConfirm = 'undo'"
          >
            {{ t("starterPacks.landing.undo") }}
          </OButton>
          <OButton
            v-else-if="flow.canManage.value"
            variant="ghost-destructive"
            size="sm-action"
            data-test="starter-pack-page-remove-btn"
            @click="inlineConfirm = 'remove'"
          >
            {{ t("starterPacks.landing.remove") }}
          </OButton>
        </template>
        <span
          v-else-if="flow.forbidden.value"
          class="text-text-secondary flex min-w-0 items-center gap-2 text-xs"
          data-test="starter-pack-drawer-forbidden"
        >
          <OIcon name="lock" size="sm" class="shrink-0" />
          <span class="truncate">{{ t("starterPacks.noPermission") }}</span>
        </span>
        <OText
          v-else-if="canPick && preview && !nothingToCreate"
          variant="meta"
          class="truncate"
          data-test="starter-pack-drawer-summary"
          >{{ summaryLine }}</OText
        >
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
          v-else-if="installed"
          variant="primary"
          size="sm-action"
          data-test="starter-pack-drawer-open-btn"
          @click="finishLanding"
        >
          {{ openLabel }}
        </OButton>
        <OButton
          v-else-if="nothingToCreate"
          variant="primary"
          size="sm-action"
          data-test="starter-pack-drawer-continue-btn"
          @click="showReady"
        >
          {{ t("starterPacks.drawer.continue") }}
        </OButton>
        <OButton
          v-else
          variant="primary"
          size="sm-action"
          :loading="preparing"
          :disabled="flow.previewState.value !== 'ready' || picked === 0 || waitingForDestinations"
          data-test="starter-pack-drawer-submit-btn"
          @click="startSetup"
        >
          {{ t("starterPacks.drawer.setUp") }}
        </OButton>
      </div>
    </template>
  </ODialog>
</template>
