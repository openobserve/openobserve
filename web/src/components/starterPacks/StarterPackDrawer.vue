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
import { computed, markRaw, onMounted, ref, watch } from "vue";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { useStore } from "vuex";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
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
import { ALERT_LIBRARY_S3_BASE, type LibrarySeverity } from "@/constants/alertLibrary";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import { readQuery } from "@/composables/query/readQuery";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { detectPrebuiltType, PREBUILT_DESTINATION_TYPES } from "@/utils/prebuilt-templates";
import { ageText, packScopeValue } from "@/composables/starterPacks/packCopy";
import type { PackNotIncludedReason, PackRecordItem } from "@/composables/starterPacks/types";
import { useAdaptedData } from "@/composables/starterPacks/useAdaptedData";
import { useBrowserMatches } from "@/composables/starterPacks/useBrowserMatches";
import { packTitle } from "@/composables/starterPacks/usePackCatalog";
import type { StarterPackFlow } from "@/composables/starterPacks/useStarterPackFlow";
import type { PackReviewChoices } from "@/composables/starterPacks/useStarterPackPopup";
import { useEmailMeDestination } from "@/composables/starterPacks/useEmailMeDestination";
import StarterPackAdaptedRows from "./StarterPackAdaptedRows.vue";
import StarterPackAlertStep, { type AlertStepDestination } from "./StarterPackAlertStep.vue";
import StarterPackInlineConfirm from "./StarterPackInlineConfirm.vue";
import { KIND_CHIPS } from "./packKindChips";
import StarterPackProgress from "./StarterPackProgress.vue";
import StarterPackReady, { type ReadyAlerts } from "./StarterPackReady.vue";
import StarterPackStepSpinner from "./StarterPackStepSpinner.vue";

const props = defineProps<{
  flow: StarterPackFlow;
  clusters: string[];
  /** Ticks, expansion and alert options, kept by the popup while the app is open. */
  choices: PackReviewChoices;
  /** Back shows only when the pack was opened from the popup's list. */
  showBack?: boolean;
}>();
const emit = defineEmits<{ close: []; back: [] }>();

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
  /** The Library entry an alert row comes from; a Use all copy shares its source's. */
  libraryId: string;
  summary?: string;
  pill?: { label: I18nText; variant: "error-soft" | "warning-soft" | "default-soft" };
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
const GROUP_LOOKS: Partial<Record<GroupId, { chip: string; row: string }>> = {
  dashboard: { chip: KIND_CHIPS.dashboard, row: "text-icon-chip-info-text" },
  alert: { chip: KIND_CHIPS.alert, row: "text-icon-chip-orange-text" },
  savedView: { chip: KIND_CHIPS.savedView, row: "text-icon-chip-purple-text" },
  view: { chip: "bg-icon-chip-primary-bg text-icon-chip-primary-text", row: "" },
};
const SEVERITY: Record<
  LibrarySeverity,
  { variant: NonNullable<PackRow["pill"]>["variant"]; icon: IconName; iconClass: string }
> = {
  critical: { variant: "error-soft", icon: "error", iconClass: "text-status-error-text" },
  warning: { variant: "warning-soft", icon: "warning", iconClass: "text-status-warning-text" },
  info: { variant: "default-soft", icon: "info", iconClass: "text-text-secondary" },
};
const SEVERITY_ORDER: LibrarySeverity[] = ["critical", "warning", "info"];
const KINDS: ShownKind[] = ["dashboard", "alert", "savedView"];
const HOUR_US = 60 * 60 * 1_000_000;
const STEP_NUMBER: Record<Step, number> = { content: 1, setup: 2, ready: 3, installed: 1 };
const SPINNER = markRaw(StarterPackStepSpinner);

const flow = props.flow;
const pack = flow.pack;
const choices = props.choices;
const title = packTitle(pack);
const inlineConfirm = ref<"undo" | "remove" | null>(null);
const destinations = ref<AlertStepDestination[] | null>(null);
const destinationsFailed = ref(false);
let ownRun = false;
const preparing = ref(false);
const readyShown = ref(false);
const installedHere = ref(false);
// Items Undo or Remove left in place; a failed delete never reaches here, so all were kept on purpose.
const keptCount = ref(0);
const outcome = ref<ReadyAlerts>({ turnOn: false, sendTo: false });
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

const severityOf = (itemId: string) => preview.value?.severities?.[itemId];

const summaryOf = (item: PackRecordItem): string | undefined => {
  if (item.kind === "alert") return pack.alertSummaries?.[item.copyOf ?? item.itemId];
  if (item.kind === "dashboard")
    return pack.dashboards.find(({ id }) => id === item.itemId)?.summary;
  return pack.savedViews.find(({ id }) => id === item.itemId)?.summary;
};

const alertLook = (item: PackRecordItem): Partial<PackRow> => {
  const id = item.copyOf ?? item.itemId;
  const description = preview.value?.descriptions?.[id];
  const tip = description ? raw(description) : undefined;
  const level = severityOf(id);
  if (!level || !SEVERITY[level]) return { tip };
  const look = SEVERITY[level];
  return {
    tip,
    icon: look.icon,
    iconClass: look.iconClass,
    pill: { label: t(`starterPacks.severity.${level}`), variant: look.variant },
  };
};

const itemRow = (item: PackRecordItem, skipped: boolean): PackRow => {
  const kind = item.kind as ShownKind;
  const description = preview.value?.descriptions?.[item.itemId];
  const base: PackRow = {
    key: item.itemId,
    libraryId: item.copyOf ?? item.itemId,
    name: raw(flow.nameOf(item.itemId)),
    // Groups pass only items of a shown kind.
    icon: KIND_ICONS[kind],
    iconClass: GROUP_LOOKS[kind]?.row ?? "text-text-secondary",
    selectable: canPick.value && !skipped,
    skipped,
    summary: summaryOf(item),
    tip: description ? raw(description) : undefined,
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

const notIncludedGroup = (): PackGroup | null => {
  // A preview read after the install finds the pack's own items as existing.
  const madeIds = new Set(flow.made.value.map(({ itemId }) => itemId));
  const left = (preview.value?.notIncluded ?? []).filter(
    (row) => row.reason !== "already_have" && !madeIds.has(row.itemId),
  );
  const rows: PackRow[] = left.map((row) => ({
    key: row.itemId,
    libraryId: row.itemId,
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
      libraryId: "view",
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

const groups = computed<PackGroup[]>(() => {
  if (installed.value || !preview.value) return [];
  const items = preview.value.items;
  const kinds: PackGroup[] = KINDS.flatMap((kind) => {
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
  return [...(nativeShown.value ? [viewGroup()] : []), ...kinds, ...extra];
});

const selectableRows = (group: PackGroup) => group.rows.filter(({ selectable }) => selectable);
const isTicked = (row: PackRow) => !choices.unticked.has(row.key);
const pickedIn = (group: PackGroup) => selectableRows(group).filter(isTicked).length;
const picked = computed(() => groups.value.reduce((sum, group) => sum + pickedIn(group), 0));
const alertsPicked = computed(() => {
  const group = groups.value.find(({ id }) => id === "alert");
  return group ? pickedIn(group) : 0;
});
const startOn = computed(() => choices.turnOn && alertsPicked.value > 0);

/** "9 · 3 critical · 6 warning", from each alert's Library entry. */
const metaOf = (group: PackGroup) => {
  if (group.id !== "alert") return group.meta;
  const rows = group.rows.filter((row) =>
    canPick.value ? row.selectable && isTicked(row) : !row.skipped,
  );
  const parts = SEVERITY_ORDER.flatMap((level) => {
    const count = rows.filter(({ libraryId }) => severityOf(libraryId) === level).length;
    if (!count) return [];
    const keys = {
      critical: "starterPacks.popup.sevCritical",
      warning: "starterPacks.popup.sevWarning",
      info: "starterPacks.popup.sevInfo",
    } as const;
    return [t(keys[level], { count })];
  });
  if (!parts.length) return raw(String(rows.length));
  return t("starterPacks.drawer.alertsMetaLine", {
    count: rows.length,
    severity: raw(parts.join(" · ")),
  });
};
const excludedIds = computed(() =>
  groups.value.flatMap((group) =>
    selectableRows(group)
      .filter((row) => !isTicked(row))
      .map(({ key }) => key),
  ),
);
const skippedCount = computed(
  () => groups.value.flatMap(({ rows }) => rows.filter((row) => row.skipped)).length,
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
  const next = new Set(choices.unticked);
  for (const key of keys) {
    if (on) next.delete(key);
    else next.add(key);
  }
  choices.unticked = next;
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
  group.id === "dashboard" ||
  group.id === "alert" ||
  (group.id === "adapted" && adapted.open.value.length > 0);
const isOpen = (group: PackGroup) => choices.expanded[group.id] ?? openByDefault(group);
const toggleOpen = (group: PackGroup) => {
  if (expandable(group)) choices.expanded = { ...choices.expanded, [group.id]: !isOpen(group) };
};

const step = computed<Step>(() => {
  if (readyShown.value) return "ready";
  if (flow.running.value || flow.interrupted.value) return "setup";
  return installed.value ? "installed" : "content";
});
const sendMode = computed<"loading" | "select" | "email" | "none">(() => {
  if (destinationsFailed.value) return "none";
  if (destinations.value === null) return "loading";
  if (destinations.value.length) return "select";
  return smtpOff.value ? "none" : "email";
});
// A ticked Send to with nothing picked would quietly send nowhere, so Set up waits for a pick.
const destinationMissing = computed(
  () =>
    alertsPicked.value > 0 && sendMode.value === "select" && choices.sendTo && !choices.destination,
);
const waitingForDestinations = computed(
  () => alertsPicked.value > 0 && sendMode.value === "loading",
);
const made = computed(() => flow.made.value.length);
const total = computed(() => flow.toCreate.value.length);
const failedCount = computed(() => flow.failed.value.length);
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

/** "Set up by you 2 h ago": who set the pack up, and how long ago. */
const installedLine = computed((): I18nText | null => {
  const record = flow.record.value;
  if (!record?.installedAt) return null;
  const when = ageText(t, Date.now() - record.installedAt / 1000);
  if (!record.installedBy) return t("starterPacks.viewPack.setUpWhen", { when });
  return record.installedBy === userEmail.value
    ? t("starterPacks.viewPack.setUpByYou", { when })
    : t("starterPacks.viewPack.setUpBy", { who: raw(record.installedBy), when });
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
  const summary = t("starterPacks.progress.summary", counts);
  return {
    icon: "warning",
    text: failedCount.value
      ? t(
          "starterPacks.installDialog.attention",
          { title: summary, count: failedCount.value },
          failedCount.value,
        )
      : summary,
  };
};
const readyNote = (): { icon: IconName; text: I18nText } => {
  const counts = { made: made.value, total: total.value };
  if (failedCount.value) {
    return {
      icon: "warning",
      text: t("starterPacks.viewPack.partialSubtitle", { ...counts, failed: failedCount.value }),
    };
  }
  const done = (text: I18nText) => ({ icon: "check-circle" as IconName, text });
  if (!installedHere.value) return done(t("starterPacks.drawer.nothingToCreate"));
  if (alreadyHere.value) {
    return done(t("starterPacks.stepper.noteAlreadyHere", { ...counts, count: alreadyHere.value }));
  }
  if (!alertsMade.value) return done(t("starterPacks.progress.summary", counts));
  const on = outcome.value.turnOn && !outcome.value.failure;
  return done(
    on
      ? t(
          "starterPacks.stepper.noteAlertsOn",
          { ...counts, count: alertsMade.value },
          alertsMade.value,
        )
      : t("starterPacks.stepper.noteAlertsOff", counts),
  );
};
const note = computed<{ icon?: IconName; spin?: boolean; text: I18nText }>(() => {
  if (step.value === "setup") return setupNote();
  if (step.value === "ready") return readyNote();
  if (installed.value && installedLine.value) return { icon: "person", text: installedLine.value };
  if (loading.value) return { spin: true, text: t("starterPacks.drawer.loadingFit") };
  if (flow.forbidden.value) {
    return { icon: "lock", text: t("starterPacks.drawer.noteForbidden", { title }) };
  }
  if (allExist.value) {
    return {
      icon: "info",
      text: t("starterPacks.drawer.allExist", { count: existingCount.value }),
    };
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

/** The status line beside the footer buttons; failures live here, never in a banner. */
const footerNote = computed<{ icon?: IconName; error?: boolean; text: I18nText } | null>(() => {
  if (step.value === "setup") {
    if (flow.running.value) return { text: t("starterPacks.popup.keepsGoing") };
    const by = flow.interruptedBy.value;
    if (by !== null) {
      const text = by
        ? t("starterPacks.startedBy", { who: raw(by) })
        : t("starterPacks.startedBySomeone");
      return { icon: "person", text };
    }
    if (flow.installFailed.value) {
      return { icon: "error", error: true, text: t("starterPacks.progress.installError") };
    }
    return {
      icon: "warning",
      text: t("starterPacks.progress.interrupted", { made: made.value, total: total.value }),
    };
  }
  if (step.value !== "content") return null;
  if (keptCount.value) {
    const count = keptCount.value;
    return { icon: "info", text: t("starterPacks.undo.kept", { count }, count) };
  }
  const busyBy = flow.busyBy.value;
  if (busyBy !== null) {
    const text = busyBy
      ? t("starterPacks.busyBy", { who: raw(busyBy) })
      : t("starterPacks.busySomeone");
    return { icon: "schedule", text };
  }
  if (flow.forbidden.value) return { icon: "lock", text: t("starterPacks.noPermission") };
  if (flow.installFailed.value) {
    return { icon: "error", error: true, text: t("starterPacks.progress.installError") };
  }
  if (destinationMissing.value) {
    return { icon: "info", text: t("starterPacks.alertStep.pickDestination") };
  }
  return canPick.value && preview.value && !nothingToCreate.value
    ? { text: t("starterPacks.drawer.undoNote") }
    : null;
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
// The count waits for the plan, so the button never reads a zero it has not counted.
const setUpLabel = computed(() =>
  flow.previewState.value === "ready"
    ? t("starterPacks.drawer.setUpCount", { count: picked.value }, picked.value)
    : t("starterPacks.drawer.setUp"),
);
const routedTo = computed<I18nText | undefined>(() => {
  const { turnOn: on, sendTo: routed, failure, email, name } = outcome.value;
  if (!on || !routed || failure) return undefined;
  return email ? t("starterPacks.progress.emailMe", { email: raw(email) }) : raw(name ?? "");
});

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

// No destination is picked for the user; a remembered pick that is gone is dropped.
const loadDestinations = async () => {
  destinations.value = null;
  destinationsFailed.value = false;
  // A failed read is not an empty org, so it must not offer to create Email me.
  const rows = await readQuery(destinationsQuery(flow.org, "alert")).catch(() => {
    destinationsFailed.value = true;
    return [];
  });
  const usable = rows.filter((row) => !(smtpOff.value && row.type === "email"));
  destinations.value = usable.map((row) => ({ name: row.name, label: destinationLabel(row) }));
  if (!destinations.value.some(({ name }) => name === choices.destination))
    choices.destination = "";
  if (sendMode.value === "none") choices.sendTo = false;
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
    failure: record?.emailFailure,
  };
};

onMounted(() => {
  // A resumed run names its destination by the label step 1 would have shown.
  if (!installed.value && !flow.forbidden.value) void loadDestinations();
  ensurePreview();
});
// Undo or Remove turns a pack opened as set up back into a Review, which needs the destinations.
watch(installed, (now) => {
  if (!now && destinations.value === null && !flow.forbidden.value) void loadDestinations();
});
// A setup that ends while this shows moves to Ready, with any failures on their rows.
watch(
  () => flow.running.value,
  (now, before) => {
    if (!before || now) return;
    if (!ownRun) outcome.value = storedOutcome();
    ownRun = false;
    if (flow.installed.value || flow.failed.value.length) {
      readyShown.value = true;
      installedHere.value = true;
    }
  },
);
// Answering the last open question must not collapse the card the user is working in.
watch(
  () => adapted.open.value.length,
  (now, before) => {
    if (before && !now && choices.expanded.adapted === undefined) {
      choices.expanded = { ...choices.expanded, adapted: true };
    }
  },
);

const go = (to: RouteLocationRaw) => {
  emit("close");
  void router.push(to).catch(() => {});
};
const finishLanding = async () => {
  emit("close");
  await flow.land();
};

/** Settles where the alerts send before anything is created, so each alert is saved once. */
const resolveSendTo = async (): Promise<{ alerts: ReadyAlerts; name?: string }> => {
  const wantsOn = startOn.value;
  if (!alertsPicked.value || !choices.sendTo || sendMode.value === "none") {
    return { alerts: { turnOn: wantsOn, sendTo: false } };
  }
  if (sendMode.value === "email") {
    // Off alerts get no new destination; only a picked existing one is attached for later.
    if (!wantsOn) return { alerts: { turnOn: false, sendTo: false } };
    const result = await emailMe.ensure(userEmail.value);
    if ("failure" in result) {
      return { alerts: { turnOn: wantsOn, sendTo: true, failure: result.failure } };
    }
    const alerts = { turnOn: wantsOn, sendTo: true, destination: raw(result.name) };
    return { alerts: { ...alerts, email: userEmail.value, name: result.name }, name: result.name };
  }
  const chosen = destinations.value?.find(({ name }) => name === choices.destination);
  return {
    alerts: { turnOn: wantsOn, sendTo: !!chosen, destination: chosen?.label, name: chosen?.name },
    name: chosen?.name,
  };
};
const startSetup = async () => {
  keptCount.value = 0;
  preparing.value = true;
  const { alerts, name } = await resolveSendTo().finally(() => (preparing.value = false));
  outcome.value = alerts;
  ownRun = true;
  const done = await flow.install(undefined, {
    exclude: excludedIds.value,
    enableAlerts: alerts.turnOn && !alerts.failure,
    destination: name,
    emailFailure: alerts.failure,
  });
  if (!done) return;
  useBrowserMatches(flow.org).markInstalled(pack.id, pack.id);
};
const retry = async () => {
  outcome.value = storedOutcome();
  ownRun = true;
  if (await flow.retry()) useBrowserMatches(flow.org).markInstalled(pack.id, pack.id);
};
const showReady = () => {
  readyShown.value = true;
};
// Undo and Remove take the pack away, so the popup goes back to the list unless items stayed.
const confirmDone = () => {
  inlineConfirm.value = null;
  readyShown.value = false;
  keptCount.value = flow.removal.value?.kept.length ?? 0;
  if (!keptCount.value) emit("back");
};
</script>

<template>
  <div
    class="grid h-full min-h-0 grid-rows-[3.75rem_minmax(0,1fr)_3.625rem]"
    data-test="starter-pack-drawer"
  >
    <header class="border-border-default flex min-w-0 items-center gap-3 border-b px-4">
      <span
        class="border-border-default bg-surface-base rounded-default flex size-9 shrink-0 items-center justify-center border"
      >
        <img v-if="pack.logo" :src="getImageURL(pack.logo)" class="size-5 object-contain" alt="" />
        <OIcon v-else name="inventory-2" size="sm" class="text-text-secondary" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <span class="text-text-heading truncate text-base font-semibold">{{
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
      <OButton
        variant="ghost-muted"
        size="icon"
        icon-left="close"
        :aria-label="t('components.dialog.closeDialog')"
        data-test="starter-pack-popup-close-btn"
        @click="emit('close')"
      />
    </header>

    <div
      class="min-h-0 [scrollbar-gutter:stable] overflow-y-auto"
      data-test="starter-pack-drawer-body"
    >
      <StarterPackReady
        v-if="step === 'installed'"
        :flow="flow"
        :clusters="clusters"
        mode="installed"
        @go="go"
        @retry="retry"
      />
      <OStepper
        v-else
        class="pt-3"
        :model-value="STEP_NUMBER[step]"
        :animated="false"
        data-test="starter-pack-drawer-stepper"
      >
        <OStep
          :name="1"
          :title="t('starterPacks.stepper.content')"
          :done="step !== 'content'"
          data-test="starter-pack-drawer-step-content"
        >
          <div
            class="flex flex-col gap-2 px-4 pt-1 pb-3.5 text-sm"
            data-test="starter-pack-drawer-items"
          >
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
                  expandable(group) && 'cursor-pointer',
                ]"
                :data-test="`starter-pack-drawer-group-header-${group.id}`"
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
                  @click.stop
                  @update:model-value="toggleGroup(group)"
                />
                <span v-else-if="canPick" class="size-4 shrink-0" />
                <span
                  :class="[
                    'rounded-default flex size-7 shrink-0 items-center justify-center',
                    group.id === 'not'
                      ? 'bg-surface-subtle text-text-secondary'
                      : group.warn
                        ? 'bg-icon-chip-warning-bg text-icon-chip-warning-text'
                        : (GROUP_LOOKS[group.id]?.chip ??
                          'bg-icon-chip-primary-bg text-icon-chip-primary-text'),
                  ]"
                  :data-test="`starter-pack-drawer-group-chip-${group.id}`"
                >
                  <OIcon :name="group.icon" size="sm" />
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
                :turn-on="choices.turnOn"
                :send-to="choices.sendTo"
                :destination="choices.destination"
                class="border-border-default border-t"
                :count="alertsPicked"
                :destinations="destinations"
                :destinations-failed="destinationsFailed"
                :smtp-off="smtpOff"
                :email="userEmail"
                @update:turn-on="choices.turnOn = $event"
                @update:send-to="choices.sendTo = $event"
                @update:destination="choices.destination = $event"
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
                      @click.stop
                      @update:model-value="toggleRow(row)"
                    />
                    <span class="flex w-7 shrink-0 justify-center">
                      <OIcon :name="row.icon" size="sm" :class="row.iconClass" />
                    </span>
                    <span
                      :class="[
                        'shrink-0 font-medium',
                        row.skipped && 'line-through',
                        row.skipped || (row.selectable && !isTicked(row))
                          ? 'text-text-muted'
                          : 'text-text-heading',
                      ]"
                      >{{ row.name }}</span
                    >
                    <OText
                      variant="meta"
                      class="min-w-0 flex-1 truncate"
                      data-test="starter-pack-drawer-row-summary"
                      >{{ row.summary ? raw(row.summary) : "" }}</OText
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

            <div
              v-if="preview && !allExist"
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
          </div>
        </OStep>
        <OStep
          :name="2"
          :title="
            flow.running.value
              ? t('starterPacks.stepper.settingUp')
              : t('starterPacks.stepper.setup')
          "
          :icon="flow.running.value ? SPINNER : undefined"
          :description="flow.interrupted.value ? t('starterPacks.stepper.interrupted') : undefined"
          :done="step === 'ready'"
          data-test="starter-pack-drawer-step-setup"
        >
          <StarterPackProgress
            class="px-4 pt-1 pb-3.5"
            :flow="flow"
            :routed-to="routedTo"
            :turn-on="outcome.turnOn && !outcome.failure"
          />
        </OStep>
        <OStep
          :name="3"
          :title="t('starterPacks.stepper.ready')"
          data-test="starter-pack-drawer-step-ready"
        >
          <StarterPackReady
            :flow="flow"
            :clusters="clusters"
            mode="ready"
            :alerts="outcome"
            @go="go"
            @retry="retry"
          />
        </OStep>
      </OStepper>
    </div>

    <footer class="border-border-default flex min-w-0 items-center gap-2 border-t px-4">
      <StarterPackInlineConfirm
        v-if="inlineConfirm"
        :flow="flow"
        :mode="inlineConfirm"
        data-test="starter-pack-drawer-confirm"
        @cancel="inlineConfirm = null"
        @done="confirmDone"
      />
      <template v-else>
        <template v-if="step === 'ready' && installedHere && flow.canUndo.value">
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
        <template v-else-if="step === 'installed'">
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
          :class="[
            'flex min-w-0 flex-1 items-center gap-1.5 text-xs',
            footerNote?.error ? 'text-status-error-text' : 'text-text-secondary',
          ]"
          data-test="starter-pack-drawer-summary"
        >
          <template v-if="footerNote">
            <OIcon v-if="footerNote.icon" :name="footerNote.icon" size="sm" class="shrink-0" />
            <span class="truncate">{{ footerNote.text }}</span>
          </template>
        </span>
        <OButton
          v-if="showBack && (step !== 'setup' || !flow.running.value)"
          variant="outline"
          size="sm-action"
          data-test="starter-pack-drawer-back-btn"
          @click="emit('back')"
        >
          {{
            step === "ready" ? t("starterPacks.popup.backToPacks") : t("starterPacks.popup.back")
          }}
        </OButton>
        <OButton
          v-if="step === 'setup' && flow.running.value"
          variant="primary"
          size="sm-action"
          class="min-w-35"
          disabled
          loading
          :spinner="false"
          data-test="starter-pack-progress-running-btn"
        >
          <template #icon-left><StarterPackStepSpinner /></template>
          {{ t("starterPacks.stepper.settingUp") }}
        </OButton>
        <OButton
          v-else-if="
            (step === 'setup' || step === 'ready') &&
            failedCount &&
            !flow.forbidden.value &&
            flow.interruptedBy.value === null
          "
          variant="primary"
          size="sm-action"
          class="min-w-35"
          icon-left="refresh"
          data-test="starter-pack-progress-retry-btn"
          @click="retry"
        >
          {{ t("starterPacks.progress.retry", { count: failedCount }, failedCount) }}
        </OButton>
        <OButton
          v-else-if="step === 'setup' && !failedCount && flow.interruptedBy.value === null"
          variant="primary"
          size="sm-action"
          class="min-w-35"
          data-test="starter-pack-progress-finish-btn"
          @click="retry"
        >
          {{ t("starterPacks.progress.finish") }}
        </OButton>
        <OButton
          v-else-if="step === 'installed' && flow.dashboardItem.value?.id"
          variant="primary"
          size="sm-action"
          class="min-w-35"
          data-test="starter-pack-drawer-open-btn"
          @click="finishLanding"
        >
          {{ t("starterPacks.drawer.openDashboard") }}
        </OButton>
        <template v-else-if="step === 'content' && !flow.forbidden.value">
          <OButton
            v-if="nothingToCreate"
            variant="primary"
            size="sm-action"
            class="min-w-35"
            data-test="starter-pack-drawer-continue-btn"
            @click="showReady"
          >
            {{ t("starterPacks.drawer.continue") }}
          </OButton>
          <OButton
            v-else
            variant="primary"
            size="sm-action"
            class="min-w-35"
            :loading="preparing"
            :disabled="
              flow.previewState.value !== 'ready' ||
              picked === 0 ||
              waitingForDestinations ||
              destinationMissing
            "
            data-test="starter-pack-drawer-submit-btn"
            @click="startSetup"
          >
            {{ setUpLabel }}
          </OButton>
        </template>
      </template>
    </footer>
  </div>
</template>
