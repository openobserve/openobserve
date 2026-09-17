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
import { saveMonitorMutation } from "@/services/synthetics.queries";
import { useOrgId } from "@/composables/query/useOrgId";
import { useMutation } from "@tanstack/vue-query";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { queryClient } from "@/composables/query/queryClient";
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { cloneDeep } from "lodash-es";
import {
  useRouter,
  useRoute,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  type NavigationGuard,
} from "vue-router";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import type {
  BrowserCheck,
  BrowserStep,
  SyntheticsLocation,
  SyntheticsDevice,
  SyntheticsFolder,
  AgentSetup,
  BlockedReason,
  ReplayResponse,
} from "@/types/synthetics";
import useSyntheticsRecorder from "@/composables/useSyntheticsRecorder";
import { journeyToWireSteps, mapWireSteps } from "@/utils/synthetics/mapRecordedStep";
import type { WireStep } from "@/types/synthetics";
import { buildResolvedGrouped } from "@/components/synthetics/variables/resolved";
import {
  defaultReplayEnvironmentId,
  replayInputs,
  sharedPlainValues,
} from "@/components/synthetics/variables/replayInputs";
import { useSharedVariables } from "@/components/synthetics/variables/useSharedVariables";
import {
  expandJourney,
  loadChildren,
  type ChildJourney,
  type ExpansionMap,
} from "@/utils/synthetics/expandJourney";
import {
  computeRunBudget,
  formatBudgetDuration,
  JOB_LEASE_MS,
  MAX_STEPS,
} from "@/utils/synthetics/runBudget";
import { classifyPreflightFailure } from "@/utils/synthetics/replayFailure";
import {
  buildCreateBrowserTestPayload,
  mapResponseToBrowserCheck,
} from "@/utils/synthetics/buildPayload";
import {
  extractEligibility,
  type ExtractEligibility,
  type ReferencedByState,
} from "@/utils/synthetics/extractEligibility";
import {
  buildExtractedChildCheck,
  splitVariablesForChild,
} from "@/utils/synthetics/buildExtractedChild";
import {
  makeBrowserCheckGateSchema,
  makeBrowserCheckSaveSchema,
} from "@/components/synthetics/CreateBrowserTest.schema";
import { CHROME_UI_LABELS, SETUP_QUERY_PARAM } from "@/constants/synthetics";
import { getFoldersListByType } from "@/utils/commons";
import { syntheticsEditRoute, syntheticsListRoute } from "@/utils/synthetics/routes";
import syntheticsService from "@/services/synthetics";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import ExtensionSetupChecklist from "@/components/synthetics/ExtensionSetupChecklist.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import BrowserJourney from "@/components/synthetics/journey/BrowserJourney.vue";
import ExtractSubtestDialog from "@/components/synthetics/journey/ExtractSubtestDialog.vue";
import type { ExtractForm } from "@/components/synthetics/journey/ExtractSubtestDialog.schema";
import CheckConfigure from "@/components/synthetics/configure/CheckConfigure.vue";
import CheckVariablesPanel from "@/components/synthetics/configure/CheckVariablesPanel.vue";
import useCheckWizardUi, {
  VARIABLES_SPLITTER_LIMITS,
} from "@/composables/synthetics/useCheckWizardUi";
import AgentSetupDrawer from "@/components/synthetic-monitoring/AgentSetupDrawer.vue";
import CreateBrowserTestSkeleton from "@/components/synthetics/CreateBrowserTestSkeleton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyBrowserCheck from "@/lib/core/EmptyState/illustrations/EmptyBrowserCheck.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";

const router = useRouter();
const route = useRoute();
const store = useStore();
const orgIdForWrites = useOrgId();
const saveMonitor = useMutation(() => saveMonitorMutation(orgIdForWrites.value));

// Private locations are served by agents deployed inside the customer's network,
// the one enterprise part of synthetics. Gated on its own /config flag so an OSS
// build still offers public, Lambda-served locations.
const privateLocationsEnabled = computed(() =>
  Boolean(store.state.zoConfig?.synthetics_private_locations_enabled),
);
const { t } = useI18nTyped();
// Shared with CheckConfigure so a drag on either page carries to the other.
const { variablesSplitter } = useCheckWizardUi();

// Journey-only: the toggle lives in the journey toolbar, so sharing the flag
// would hide the panel on Configure with no control there to bring it back.
// Collapsed by default — the journey is the point of this page, and the
// labelled toolbar button is there to bring the panel in when it is needed.
const variablesPanelOpen = ref(false);
const journeySplitter = computed({
  get: () => (variablesPanelOpen.value ? variablesSplitter.value : 100),
  set: (v: number) => (variablesSplitter.value = v),
});
const journeySplitterLimits = computed<[number, number]>(() =>
  variablesPanelOpen.value ? VARIABLES_SPLITTER_LIMITS : [100, 100],
);

const variablesHintParams = computed(() => ({
  variables: "{{variables}}",
  baseUrl: "{{BASE_URL}}",
}));

// Three top-level phases:
//   gate            → URL + name inputs
//   extension-setup → install extension checklist (only when extension not yet installed)
//   editor          → tabbed check editor
const phase = ref<"gate" | "extension-setup" | "editor">("gate");
const headerTitle = computed(() => {
  if (phase.value === "gate") return t("synthetics.createBrowserTest.newBrowserCheck");
  if (phase.value === "extension-setup") return t("synthetics.createBrowserTest.setupRecorder");
  if (isLoadingEdit.value) return t("synthetics.createBrowserTest.loading");
  if (loadError.value) return t("synthetics.createBrowserTest.loadFailedTitle");
  return check.value.name || t("synthetics.createBrowserTest.untitledCheck");
});
const folderName = computed(() => {
  const fid = check.value.folder;
  if (!fid || fid === "default") return "";
  return folders.value.find((f) => f.folderId === fid)?.name ?? "";
});
/**
 * Where every exit from this wizard lands.
 *
 * Tracks `check.folder` rather than `?folder=` so that changing the folder in
 * the Configure step and then backing out returns to the folder the check now
 * lives in. `org_identifier` comes from the store, matching the app-wide
 * convention — reading it back off the URL is what let it go missing.
 */
const backTo = computed(() =>
  syntheticsListRoute({ orgIdentifier: orgIdentifier.value, folderId: check.value.folder }),
);
const currentStep = ref(1);
const journeyStepDone = ref(false);
const checkName = ref("");
const startUrl = ref("");
const props = defineProps<{ editId?: string | null }>();
const isLoadingEdit = ref(false);
const loadError = ref(false);
const urlError = ref("");
const validationErrors = ref<Record<string, string>>({});

/**
 * What one scheduled fire of this check would cost in the worst case, against
 * the lease the server holds for it. Recomputed live so the Configure step can
 * show the number before the author hits Save.
 */
const runBudget = computed(() =>
  computeRunBudget({
    combos: check.value.browserDevices?.length ?? 1,
    retries: check.value.retries ?? 0,
    waitBeforeRetrySecs: check.value.waitBeforeRetrySecs ?? 0,
  }),
);

const gateSchema = computed(() => makeBrowserCheckGateSchema(t));
const saveSchema = computed(() => makeBrowserCheckSaveSchema(t));

// Extension setup state — persists across phases in this session.
// `extensionInstalled` is now driven by a real runtime probe (not a manual click).
const recorder = useSyntheticsRecorder(t);
const extensionInstalled = ref(false);
// Session-only on purpose: persisting the attestations would keep tasks
// pre-completed after the extension is removed. After the connect step's
// page refresh, the install task re-completes itself through live detection.
const installAck = ref(false);
const incognitoAllowed = ref(false);

const setupInstallDone = computed(() => extensionReady.value || installAck.value);
const setupAllDone = computed(() => extensionReady.value && incognitoAllowed.value);
const setupCtaLabel = computed(() =>
  setupAllDone.value
    ? t("synthetics.createBrowserTest.setupOpenRecord")
    : t("synthetics.createBrowserTest.setupCtaLocked", {
        action: t("synthetics.createBrowserTest.setupOpenRecord"),
      }),
);
const setupBlockingHint = computed(() => {
  if (!setupInstallDone.value) return t("synthetics.createBrowserTest.setupHintInstall");
  if (!incognitoAllowed.value)
    return t("synthetics.createBrowserTest.setupHintIncognito", {
      setting: CHROME_UI_LABELS.allowIncognito,
    });
  if (!setupAllDone.value)
    return t("synthetics.createBrowserTest.setupHintConnect", {
      action: t("synthetics.createBrowserTest.setupOpenRecord"),
    });
  return null;
});
const extensionReady = ref(false);
const checkingExtension = ref(false);

/**
 * Whether the installed extension can restore the journey before recording.
 *
 * Computed here because this component owns the recorder instance that probed, and
 * read as a capability rather than a version so an older extension degrades to plain
 * recording instead of getting a command it would refuse.
 */
const canRecordFrom = computed(() => extensionReady.value && recorder.hasCapability("recordFrom"));

/**
 * Whether it can also record on the session a FAILED restore left open.
 *
 * A separate capability from `recordFrom`, and read separately, because the two
 * shipped in different extension builds — an installed base that updates on the Web
 * Store's schedule always contains both.
 */
const canRecordFromFailure = computed(
  () => extensionReady.value && recorder.hasCapability("recordFromFailure"),
);

async function probeExtension() {
  checkingExtension.value = true;
  try {
    extensionInstalled.value = await recorder.detectExtension();
  } finally {
    checkingExtension.value = false;
  }
  return extensionInstalled.value;
}

/**
 * Toggling "Allow in Incognito" RELOADS the extension, orphaning this tab's
 * bridge — the old content script's chrome.* APIs die and it answers nothing
 * (see the takeover handshake in the extension's content script). So a
 * connection proven before the toggle proves nothing after it: invalidate and
 * re-probe, keeping the checklist's connect task open until a fresh probe
 * passes. Only the connection is in doubt — the install fact is latched first
 * so task 1 does not regress. Recovery paths if the probe finds the bridge
 * dead: the toolbar-icon click or page refresh the connect task suggests.
 */
function reverifyExtension() {
  if (extensionReady.value) installAck.value = true;
  extensionReady.value = false;
  probeExtension()
    .then((ok) => {
      if (ok) extensionReady.value = true;
    })
    .catch(() => {
      /* bridge orphaned — the connect task guides recovery */
    });
}

watch(incognitoAllowed, (val, old) => {
  if (val && !old) reverifyExtension();
});

// Server-driven lists fetched once here and threaded down to CheckConfigure.
const locations = ref<SyntheticsLocation[]>([]);
const locationsLoading = ref(false);
const browsers = ref<string[]>([]);
const devices = ref<SyntheticsDevice[]>([]);
const destinations = ref<string[]>([]);
const folders = ref<SyntheticsFolder[]>([]);
const foldersLoading = ref(false);

const orgIdentifier = computed<string>(
  () => (store.state as any).selectedOrganization?.identifier ?? "",
);

/** Resolves once orgIdentifier is populated — on a hard reload or browser
 *  back-navigation onto this route the store is not hydrated synchronously yet.
 *  Mirrors waitForOrgIdentifier in SyntheticMonitoring.vue. */
function waitForOrgIdentifier(): Promise<void> {
  if (orgIdentifier.value) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const stop = watch(orgIdentifier, (val) => {
      if (val) {
        stop();
        resolve();
      }
    });
  });
}

async function fetchFolders() {
  foldersLoading.value = true;
  try {
    // Without this wait a reload of /synthetics/add?folder=… fires the request
    // against an empty org, and the single catch below would pin the list to []
    // for the rest of the session — leaving the folder select unable to resolve
    // the preselected id and rendering it raw.
    await waitForOrgIdentifier();
    const res = await getFoldersListByType(store, "synthetics");
    folders.value = (res ?? []) as SyntheticsFolder[];
  } catch (err) {
    console.error("[synthetics] failed to load folders", err);
    folders.value = [];
  } finally {
    foldersLoading.value = false;
  }
}

// ── Private agent setup (drawer opened from the locations card) ──────────
const showAgentSetup = ref(false);
const agentSetup = ref<AgentSetup | null>(null);
const agentSetupLocationId = ref<string | null>(null);
const agentSetupLocationName = ref<string | null>(null);

async function openAgentSetup(locationId?: string) {
  agentSetupLocationId.value = locationId ?? null;
  agentSetupLocationName.value = locationId
    ? (locations.value.find((l) => l.id === locationId)?.label ?? null)
    : null;
  showAgentSetup.value = true;
  if (agentSetup.value) return;
  try {
    const res = await syntheticsService.getAgentSetup(orgIdForWrites.value);
    agentSetup.value = (res.data ?? null) as AgentSetup | null;
  } catch {
    agentSetup.value = null;
  }
}

async function fetchLocations() {
  locationsLoading.value = true;
  try {
    const res = await syntheticsService.getLocations(orgIdForWrites.value);
    const data = res.data ?? {};
    // Public browser locations (Lambda) plus private locations whose agents
    // advertise `browser` (self-hosted browser agent). A protocol-only private
    // location is excluded — it can't run browser checks.
    locations.value = ((data.locations ?? []) as SyntheticsLocation[]).filter(
      (l) => l.enabled !== false && (l.kind !== "private" || (l.types ?? []).includes("browser")),
    );
    browsers.value = (data.browsers ?? []) as string[];
    devices.value = (data.devices ?? []) as SyntheticsDevice[];
  } catch (err: any) {
    // A 403 means the endpoint isn't available on this build; fall back to
    // empty silently for those, and only surface real failures.
    locations.value = [];
    browsers.value = [];
    devices.value = [];
    if (err?.response?.status !== 403) {
      toast({ variant: "error", message: t("synthetics.locations.fetchFailed") });
    }
  } finally {
    locationsLoading.value = false;
  }
}

async function loadDestinations(force = false) {
  try {
    const options = destinationsQuery(store.state.selectedOrganization.identifier);
    // A destination created in another tab never expires this tab's cache, so refresh forces.
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: options.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const list = await queryClient.fetchQuery(options);
    destinations.value = list.map((d: any) => d.name as string);
  } catch {
    destinations.value = [];
  }
}

async function loadForEdit(id: string) {
  isLoadingEdit.value = true;
  loadError.value = false;
  phase.value = "editor";
  try {
    const org = store.state.selectedOrganization.identifier;
    if (!org) {
      throw new Error("Organization not available");
    }
    const res = await syntheticsService.get(org, id, String(route.query.folder ?? ""));
    const mapped = mapResponseToBrowserCheck(res.data as Record<string, unknown>);
    check.value = mapped;
    savedCheck.value = cloneDeep(mapped);
    // Not on `BrowserCheck`: `buildCreateBrowserTestPayload` spreads it, and the form never sends it.
    journeyBudgetMs.value = (res.data as any).config?.journey_budget_ms;
    checkName.value = mapped.name;
    startUrl.value = mapped.url;
    journeyStepDone.value = true;
    void loadReferencedBy(id);
  } catch (err) {
    console.error("[synthetics] failed to load check for edit", err);
    if ((err as any)?.response?.status === 404) {
      router.push(backTo.value);
      toast({ variant: "warning", message: t("synthetics.newCheck.notFoundInOrg") });
      isLoadingEdit.value = false;
      return;
    }
    loadError.value = true;
    toast({
      variant: "error",
      message: t("synthetics.createBrowserTest.loadFailed"),
    });
  } finally {
    isLoadingEdit.value = false;
  }
}

function onLoadRetry(actionId?: string) {
  if (!actionId) return;
  if (actionId === "retry" && props.editId) {
    loadForEdit(props.editId);
  }
}

onMounted(() => {
  // Warm detection so an already-installed extension lets Record skip setup.
  const warmProbe = probeExtension()
    .then((installed) => {
      if (installed) {
        extensionInstalled.value = true;
        extensionReady.value = true;
      }
      return installed;
    })
    .catch(() => false /* extension messaging unavailable — handled in setup screen */);

  // Auto-detect when the content script is injected on demand (toolbar icon click
  // after mid-session install). The content script sends 'oo-bridge-ready' when
  // chrome.scripting.executeScript injects it, and the composable calls this back.
  recorder.registerAutoDetect(() => {
    extensionInstalled.value = true;
    extensionReady.value = true;
  });

  fetchFolders();
  fetchLocations();
  loadDestinations();

  if (props.editId) {
    loadForEdit(props.editId).catch(console.error);
  } else {
    // Preselect the folder the user came from (New Monitor within a folder).
    const folderQuery = route.query.folder;
    if (typeof folderQuery === "string" && folderQuery) {
      check.value = { ...check.value, folder: folderQuery };
    }

    // Restore the gate fields written to the query on entering the setup
    // phase, so its "refresh this page" step doesn't restart the wizard.
    // The attestation checkboxes deliberately reset — install re-verifies
    // through live detection, incognito is re-confirmed with one click.
    const urlQuery = route.query.url;
    const nameQuery = route.query.name;
    if (typeof urlQuery === "string" && urlQuery) startUrl.value = urlQuery;
    if (typeof nameQuery === "string" && nameQuery) checkName.value = nameQuery;
    if (route.query[SETUP_QUERY_PARAM] === "1" && isGateUrlValid.value) {
      commitGate();
      phase.value = "extension-setup";
    } else if (
      typeof urlQuery === "string" &&
      urlQuery &&
      typeof nameQuery === "string" &&
      nameQuery &&
      isGateUrlValid.value
    ) {
      // Both gate fields arrived via the query (the setup flow's refresh, or a
      // prefilled deep link): once the warm probe confirms the extension, the
      // gate has nothing left to ask — skip it. The phase guard keeps a slow
      // probe from yanking the author out of a gate they started editing past.
      warmProbe.then((installed) => {
        if (installed && phase.value === "gate") {
          commitGate();
          phase.value = "editor";
        }
      });
    }
  }
});

// When true, BrowserJourney starts recording immediately on mount
const autoRecord = ref(false);

/** The check as last loaded or saved, which is what server-side moves act on. */
const savedCheck = ref<BrowserCheck | null>(null);

const check = ref<BrowserCheck>({
  name: "",
  url: "",
  enabled: true,
  folder: "default",
  tags: [],
  journey: [],
  schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
  locations: [],
  // New browser monitors retry once before declaring failure (spec P1.3).
  // A single slow render should never page an on-call engineer; passing on retry
  // is reported as `warning` (flaky), which never alerts. Deliberately changed
  // ONLY here — the buildPayload fallbacks are absent-field defaults, and
  // raising those would silently re-interpret existing monitors stored without
  // a retries value (P1.3.3).
  retries: 1,
  waitBeforeRetrySecs: 5,
  alertIfFails: 1,
  cooldownMins: 5,
  notifications: { destinations: [] },
  rum: { collect: true, sessionReplay: false },
  capture: { screenshot: "on-fail" as const, trace: "on-fail" as const },
  variables: [],
});

/**
 * The ONE cache of fetched child journeys, referenced by this check's subtest
 * steps (§7.3). `BrowserJourney` reads and writes through this exact `Map`
 * instance via a prop, rather than keeping a cache of its own, so a child
 * fetched to preview a reference row is immediately visible to
 * `executedStepCount` below and vice versa.
 */
const childrenCache = ref<Map<string, ChildJourney>>(new Map());

/** Child ids the prefetch was refused (403) — the journey marks them without a second GET. */
const refusedChildIds = ref<Set<string>>(new Set());

/** The saved check's run-time allowance; undefined in create mode means the server default. */
const journeyBudgetMs = ref<number | undefined>();

const variableNames = computed(() => check.value.variables?.map((v) => v.name.trim()));

/**
 * Composed-child-id → authored-row map for the run currently on screen — set by
 * `runReplay` before it ships the expanded journey, so `BrowserJourney` can fold a
 * child's replay result back onto the reference row it belongs to (§7.3).
 */
const expansionMap = ref<ExpansionMap | undefined>(undefined);

/**
 * How many steps this journey actually runs, expanding every subtest
 * reference — the number `SubtestPicker`'s insertion warning and the
 * server's 50-step cap are both measured in.
 */
const executedStepCount = computed(() => {
  try {
    return expandJourney(check.value.journey, childrenCache.value).steps.length;
  } catch {
    // `journey.length` is an AUTHORED count and cannot answer a question asked in executed steps.
    return undefined;
  }
});

/**
 * The set of referenced-check ids the journey currently names, as a stable
 * string — so the watcher below only re-fetches when that SET actually
 * changes, not on every unrelated journey edit.
 */
const subtestIdsSignature = computed(() =>
  [
    ...new Set(
      check.value.journey.filter((s) => s.action === "subtest").map((s) => s.subtest?.id ?? ""),
    ),
  ]
    .filter(Boolean)
    .sort()
    .join(","),
);

/**
 * Loads referenced checks into `childrenCache` as soon as they are named,
 * rather than waiting for `runReplay` (§7.3) — which is too late for the
 * variables usage count, the insertion warning's step count and the
 * reference row's preview, all of which render before any replay runs.
 * Fires once for the check as it loads (edit mode) and again whenever a
 * subtest step is added or removed. A failed fetch is logged, not fatal: the
 * affected surfaces fall back on their own (usage count 0, no step delta,
 * preview unavailable).
 */
watch(
  subtestIdsSignature,
  async () => {
    try {
      const loaded = await loadChildren(check.value.journey, fetchChildJourney);
      for (const [id, child] of loaded) childrenCache.value.set(id, child);
    } catch (err) {
      console.error("[synthetics] failed to load referenced check(s)", err);
    }
  },
  { immediate: true },
);

/**
 * Reconcile the selected folder against the folders this org actually has.
 *
 * `check.folder` arrives from `?folder=` (New Monitor opened inside a folder)
 * or from a stored check, and neither source is validated: a bookmarked link, a
 * folder deleted since, or a link from another org all leave an id no option can
 * resolve. The select then renders that id verbatim, and `persist` sends it
 * straight back as `?folder=` — which the server treats as authoritative for
 * both the destination folder and the RBAC gate, so the save fails on a folder
 * the author never picked. Fall back to the default folder and say why.
 *
 * Skipped while the list is empty: that means the fetch has not landed (or
 * failed), and a valid id must not be discarded on the strength of a list we
 * do not have.
 */
watch(
  [folders, () => check.value.folder],
  () => {
    if (!folders.value.length) return;
    const folderId = check.value.folder;
    if (!folderId || folders.value.some((f) => f.folderId === folderId)) return;
    check.value = { ...check.value, folder: "default" };
    validationErrors.value = {
      ...validationErrors.value,
      folder: t("synthetics.validation.folderUnavailable", { folder: folderId }),
    };
  },
  { immediate: true },
);

function commitGate() {
  check.value = { ...check.value, url: startUrl.value, name: checkName.value };
  isDirty.value = true;
}

function validateGateUrl() {
  const result = gateSchema.value.shape.url.safeParse(startUrl.value.trim());
  urlError.value = result.success ? "" : (result.error.issues[0]?.message ?? "");
  return result.success;
}

function clearUrlError() {
  urlError.value = "";
}

const isGateUrlValid = computed(() => {
  const trimmed = startUrl.value.trim();
  if (!trimmed) return false;
  return gateSchema.value.shape.url.safeParse(trimmed).success;
});

async function onRecordClick() {
  if (!validateGateUrl()) return;
  commitGate();
  const installed = await probeExtension();
  extensionReady.value = installed;
  if (installed) {
    autoRecord.value = true;
    phase.value = "editor";
  } else {
    // Mirror the gate fields into the query so the setup flow's own
    // "refresh this page" step restores them and returns to this phase.
    router.replace({
      query: {
        ...route.query,
        url: startUrl.value.trim(),
        name: checkName.value.trim() || undefined,
        [SETUP_QUERY_PARAM]: "1",
      },
    });
    phase.value = "extension-setup";
  }
}

function buildManually() {
  if (!validateGateUrl()) return;
  commitGate();
  autoRecord.value = false;
  phase.value = "editor";
}

function onExtensionSetupRecord() {
  extensionReady.value = true;
  autoRecord.value = true;
  phase.value = "editor";
}

function onExtensionSetupSkip() {
  autoRecord.value = false;
  phase.value = "editor";
}

const isSaving = ref(false);
const apiPayload = computed(() => buildCreateBrowserTestPayload(check.value));

// ── Unsaved changes guard ───────────────────────────────────────────────────
const isDirty = ref(false);
const showUnsavedDialog = ref(false);
let pendingLeavePath: string | null = null;
let forceLeave = false;

watch(
  () => check.value.journey.length,
  (len) => {
    if (len > 0) isDirty.value = true;
  },
);

function onConfigureUpdate(val: BrowserCheck) {
  check.value = val;
  isDirty.value = true;
}

function stopActiveExtension() {
  const journey = journeyRef.value;
  // BrowserJourney owns the recorder instance — check and stop via exposed methods
  if (journey?.stopActiveRecording()) {
    /* recording was stopped */
  }
  // "stopping" counts as live: the extension has been asked to stop but has not confirmed,
  // so navigating away without the fire-and-forget stop can still orphan the replay.
  if (recorder.replayPhase.value === "running" || recorder.replayPhase.value === "stopping") {
    recorder.stopReplayAndForget();
  }
}

function onConfirmLeave() {
  stopActiveExtension();
  showUnsavedDialog.value = false;
  forceLeave = true;
  if (pendingLeavePath) {
    router.push(pendingLeavePath);
    pendingLeavePath = null;
  }
}

onMounted(() => {
  window.addEventListener("beforeunload", beforeUnloadHandler);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", beforeUnloadHandler);
  recorder.cleanup();
});

// Registered for updates too: opening a child is a param-only push on this same route record.
const guardUnsavedChanges: NavigationGuard = (to, from, next) => {
  if (forceLeave) {
    forceLeave = false;
    next();
    return;
  }
  if (!isDirty.value) {
    next();
    return;
  }
  // Cancel the route; show a Vue dialog instead
  next(false);
  pendingLeavePath = to.fullPath;
  showUnsavedDialog.value = true;
};
onBeforeRouteLeave(guardUnsavedChanges);
// Only an id change leaves this check: a query-only update (the setup `router.replace`) must pass.
onBeforeRouteUpdate((to, from, next) =>
  to.params.id === from.params.id ? next() : guardUnsavedChanges(to, from, next),
);

function beforeUnloadHandler(e: BeforeUnloadEvent) {
  if (!isDirty.value) return;
  // Sync stop the extension before the page goes away
  stopActiveExtension();
  e.preventDefault();
}

/**
 * Validates and persists the check. Owns validation, the API call and all
 * toasts — but deliberately NOT navigation, so the footer buttons can decide
 * where to go afterwards (stay on Configure vs. return to the checks list).
 * Returns true only when the check was actually written.
 */
async function persist(): Promise<boolean> {
  // ── Pre-save validation ───────────────────────────────────────────
  validationErrors.value = {};
  const toValidate = {
    name: check.value.name,
    url: check.value.url,
    locations: check.value.locations,
    journey: check.value.journey,
  };
  const result = saveSchema.value.safeParse(toValidate);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      if (!errors[path]) errors[path] = issue.message;
    }
    validationErrors.value = errors;
    // Switch to the relevant tab so inline errors are visible
    if (errors["name"] || errors["url"] || errors["locations"]) {
      currentStep.value = 2;
    } else if (Object.keys(errors).some((k) => k.startsWith("journey."))) {
      // Step errors — switch to the Journey tab so the expanded rows are on screen.
      currentStep.value = 1;
    }
    // Hand every step-scoped issue to the journey so it renders against the field
    // it names, rather than only as the toast below. Done unconditionally: a
    // journey issue can coexist with a Details-tab one, and the author should find
    // both waiting when they switch tabs.
    //
    // State, not a method call. OStepper is a wizard, so BrowserJourney is not
    // mounted unless the Journey step is active — and create mode's only Save
    // button lives on Configure. `journeyRef` was null there, so the push was
    // swallowed by `?.` and the toast fired alone. Assigning the issues lets them
    // wait for whenever the journey next renders.
    journeyFieldIssues.value = result.error.issues;
    toast({
      variant: "error",
      message: t("synthetics.validation.fixHighlightedFields"),
    });
    return false;
  }

  // ── Run budget vs. job lease ──────────────────────────────────────────
  // The server rejects this too, but as unattached prose in a toast whose
  // leading remedy names a field this form does not have. Catching it here puts
  // the error on the two controls the author can actually change, and says what
  // the run would cost in minutes.
  if (runBudget.value.exceedsLease) {
    const message = t("synthetics.validation.runBudgetExceeded", {
      worstCase: formatBudgetDuration(runBudget.value.worstCaseMs),
      limit: formatBudgetDuration(JOB_LEASE_MS),
      combos: runBudget.value.combos,
      attempts: runBudget.value.attempts,
      perAttempt: formatBudgetDuration(runBudget.value.perAttemptMs),
    });
    validationErrors.value = {
      retries: t("synthetics.validation.runBudgetRetriesHint", {
        limit: formatBudgetDuration(JOB_LEASE_MS),
      }),
      browserDevices: message,
    };
    currentStep.value = 2;
    toast({ variant: "error", message });
    return false;
  }

  isSaving.value = true;
  validationErrors.value = {};
  // The parse just succeeded, so any message a previous failed save left on a
  // step field is now false. It was only ever written on the failure branch, so
  // without this it stayed red — and, since a field error force-expands its row,
  // kept re-opening steps that are correct.
  journeyFieldIssues.value = [];
  const dismiss = toast({
    variant: "loading",
    message: t("synthetics.newCheck.saving"),
    timeout: 0,
  });
  try {
    if (props.editId) {
      await saveMonitor.mutateAsync({
        id: props.editId,
        payload: apiPayload.value,
        folderId: check.value.folder,
      });
      dismiss();
      toast({ variant: "success", message: t("synthetics.newCheck.updated") });
    } else {
      await saveMonitor.mutateAsync({
        payload: apiPayload.value,
        folderId: check.value.folder,
      });
      dismiss();
      toast({ variant: "success", message: t("synthetics.newCheck.saved") });
    }
    isDirty.value = false;
    savedCheck.value = cloneDeep(check.value);
    return true;
  } catch (err: any) {
    dismiss();
    if (err?.response?.status === 404) {
      // Already navigated away — the caller must not push on top of this.
      forceLeave = true;
      router.push(backTo.value);
      toast({ variant: "warning", message: t("synthetics.newCheck.notFoundInOrg") });
      return false;
    }
    if (mapCompositionSaveError(err)) return false;
    toast({
      variant: "error",
      message: err?.response?.data?.message || t("synthetics.newCheck.saveFailed"),
    });
    console.error("[synthetics] save failed", err);
    return false;
  } finally {
    isSaving.value = false;
  }
}

/**
 * The editor's zod schema validates the AUTHORED journey; the server rejects a
 * composition failure with an index into the EXPANDED one, which the zod path
 * mapper (`applyStepFieldErrors` in BrowserJourney.vue) cannot resolve back to
 * an authored row. So this does not try to map the index: it scans the
 * server's message for a referenced child's name and attaches the failure to
 * that reference row instead, falling back to a plain toast when no name
 * matches. Returns whether the error was a composition failure at all.
 */
function mapCompositionSaveError(err: any): boolean {
  const message: string = err?.response?.data?.message ?? "";
  if (
    err?.response?.status !== 400 ||
    !(
      message.startsWith("validation: config.steps") ||
      message.startsWith("validation: expanded journey")
    )
  ) {
    return false;
  }
  const matched = check.value.journey.find((step) => {
    if (step.action !== "subtest") return false;
    const name = step.subtest?.name || childrenCache.value.get(step.subtest?.id ?? "")?.name;
    return !!name && message.includes(name);
  });
  if (matched) {
    const idx = check.value.journey.indexOf(matched);
    journeyFieldIssues.value = [{ path: ["journey", idx], message }];
    toast({
      variant: "error",
      message: t("synthetics.validation.compositionChildFailed", {
        name: matched.subtest?.name || matched.name || "",
      }),
    });
  } else {
    toast({
      variant: "error",
      message: message ? raw(message) : t("synthetics.newCheck.saveFailed"),
    });
  }
  return true;
}

// ── Selection state (synced from BrowserJourney) ───────────────────────────
const journeyRef = ref<InstanceType<typeof BrowserJourney>>();

/**
 * Save-time zod issues for the journey, handed down as a prop.
 *
 * Owned here rather than pushed into the child because the child is unmounted
 * whenever the Journey step is not the active one (OStepper is a wizard). See the
 * assignment in `persist`.
 */
const journeyFieldIssues = ref<{ path: PropertyKey[]; message: string }[]>([]);
const journeySelectionState = ref<{ count: number; isRecording: boolean; ids: string[] }>({
  count: 0,
  isRecording: false,
  ids: [],
});
const showBulkDeleteDialog = ref(false);

// ── Extract to subtest (§14) ───────────────────────────────────────────────
// `=== true` so an unknown flag hides the action — the journey editor's stance for its Subtest option.
const isCompositionEnabled = computed(
  () => store.state.zoConfig?.synthetics_composition_enabled === true,
);

/** Load-time lookup only; the save-time `checkUsageThenSave` asks again on its own. */
const referencedByState = ref<ReferencedByState>("none");
const showExtractDialog = ref(false);

async function loadReferencedBy(id: string) {
  referencedByState.value = "pending";
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.referencedBy(org, id);
    const count = (res.data?.references?.length ?? 0) + (res.data?.hidden_reference_count ?? 0);
    referencedByState.value = count > 0 ? "some" : "none";
  } catch (err) {
    console.error("[synthetics] referencedBy lookup failed", err);
    referencedByState.value = "unknown";
  }
}

function retryReferencedBy() {
  if (props.editId) void loadReferencedBy(props.editId);
}

const extractEligibilityResult = computed<ExtractEligibility>(() =>
  extractEligibility({
    steps: check.value.journey,
    selectedIds: new Set(journeySelectionState.value.ids),
    filterActive: journeyRef.value?.filterActive ?? false,
    referencedBy: props.editId ? referencedByState.value : "none",
    definedNames: new Set(
      [...(check.value.variables ?? []), ...(check.value.secrets ?? [])].map((v) => v.name.trim()),
    ),
  }),
);
const extractRange = computed(() =>
  extractEligibilityResult.value.ok ? extractEligibilityResult.value.range : [],
);
const extractAnchor = computed(() =>
  extractEligibilityResult.value.ok ? extractEligibilityResult.value.anchor : 0,
);
const extractVariables = computed(() => splitVariablesForChild(check.value, extractRange.value));

function openExtractDialog() {
  if (extractEligibilityResult.value.ok) showExtractDialog.value = true;
}

function extractCreateError(err: unknown, folderId: string): Error {
  const response = (err as { response?: { status?: number; data?: { message?: string } } })
    .response;
  if (response?.status === 403) {
    const folder = folders.value.find((f) => f.folderId === folderId)?.name ?? folderId;
    return new Error(t("synthetics.journey.extract.folderForbidden", { folder }));
  }
  return new Error(raw(response?.data?.message) || t("synthetics.newCheck.saveFailed"));
}

/** Rejects so the dialog shows the message and stays open; the parent is only touched after the child exists. */
async function onExtractSubmit(values: ExtractForm) {
  const elig = extractEligibilityResult.value;
  if (!elig.ok) return;
  const org = store.state.selectedOrganization.identifier;
  const child = buildExtractedChildCheck({
    parent: check.value,
    range: elig.range,
    name: values.name,
    folder: values.folder,
    locations: values.locations ?? check.value.locations,
    schedule: values.schedule ?? check.value.schedule,
  });
  let id: string;
  try {
    const res = await syntheticsService.create(
      org,
      buildCreateBrowserTestPayload(child),
      values.folder,
    );
    id = res.data.id;
  } catch (err) {
    throw extractCreateError(err, values.folder);
  }
  childrenCache.value.set(id, {
    id,
    name: child.name,
    folderId: values.folder,
    steps: child.journey,
  });
  try {
    journeyRef.value!.replaceRangeWithSubtest(
      { anchor: elig.anchor, count: elig.range.length },
      { id, name: child.name },
    );
  } catch (err) {
    await syntheticsService.delete(org, id, values.folder).catch(() => {
      toast({
        variant: "error",
        message: t("synthetics.journey.extract.orphan", { name: child.name }),
      });
    });
    throw err;
  }
  // The length watcher misses a one-step range, whose splice keeps the length.
  isDirty.value = true;
  toast({
    variant: "success",
    message: t("synthetics.journey.extract.created", { name: child.name }),
  });
  showExtractDialog.value = false;
}

function onDeleteSelected() {
  journeyRef.value?.deleteSelectedSteps();
  showBulkDeleteDialog.value = false;
}

function onContinueToConfigure() {
  // Validate step selectors before allowing transition
  const valid = journeyRef.value?.validateStepSelectors?.() ?? true;
  if (!valid) return;
  journeyStepDone.value = true;
  currentStep.value = 2;
}

// ── Usage confirmation (§5.3) ────────────────────────────────────────────
// Saving a check that other checks reference as a subtest changes what THEY
// run too, on their next fire — the author should see that before it happens,
// not discover it from an unrelated check's next run.
interface UsedByReference {
  id: string;
  name: string;
  folder_id: string;
}
const usedByInfo = ref<{ references: UsedByReference[]; hidden: number } | null>(null);
const usedByDialogOpen = computed({
  get: () => usedByInfo.value !== null,
  set: (open: boolean) => {
    if (!open) {
      usedByInfo.value = null;
      pendingSaveAction = null;
    }
  },
});
let pendingSaveAction: (() => Promise<void>) | null = null;

/**
 * Runs `afterPersist` directly in create mode or when nothing references this
 * check. Otherwise holds it behind the confirmation dialog. A failed
 * `referencedBy` lookup must not block the save — it is logged and the save
 * proceeds as if nothing was referencing it.
 */
async function checkUsageThenSave(afterPersist: () => Promise<void>) {
  // Before the usage lookup, so an over-cap save sends no request at all.
  if (executedStepCount.value !== undefined && executedStepCount.value > MAX_STEPS) {
    currentStep.value = 1;
    toast({ variant: "error", message: t("synthetics.validation.subtestCap") });
    nextTick(() => journeyRef.value?.revealCapNotice());
    return;
  }
  if (!check.value.id) {
    await afterPersist();
    return;
  }
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.referencedBy(org, check.value.id);
    const references = (res.data?.references ?? []) as UsedByReference[];
    const hidden = res.data?.hidden_reference_count ?? 0;
    if (references.length + hidden > 0) {
      usedByInfo.value = { references, hidden };
      pendingSaveAction = afterPersist;
      return;
    }
  } catch (err) {
    console.error("[synthetics] referencedBy check failed", err);
  }
  await afterPersist();
}

async function confirmUsedBySave() {
  const action = pendingSaveAction;
  usedByInfo.value = null;
  pendingSaveAction = null;
  if (action) await action();
}

/** Edit mode, Journey step: persist, then move on to Configure. */
async function onSaveAndContinue() {
  await checkUsageThenSave(async () => {
    if (!(await persist())) return;
    journeyStepDone.value = true;
    currentStep.value = 2;
  });
}

/** Persist, then return to the checks list. */
async function onSaveAndExit() {
  await checkUsageThenSave(async () => {
    if (!(await persist())) return;
    router.push(backTo.value);
  });
}

// ── Replay — uses the composable's phase-based state machine ────────────────
/** Local unwraps so the template can read these without `.value`. */
const replayPhase = computed(() => recorder.replayPhase.value);
const stepResults = computed(() => recorder.stepResults);
const activeStepId = computed(() => recorder.activeStepId.value);
/**
 * The replay failed BEFORE any step ran — nothing streamed back, so this is a
 * pre-flight problem (window, permissions, an unmappable step) rather than a
 * journey that failed on the page.
 */
const preflightFailure = computed<ReplayResponse | null>(() => {
  const res = recorder.replayResult.value;
  return recorder.replayPhase.value === "idle" &&
    res != null &&
    !res.success &&
    !res.stopped &&
    recorder.stepResults.size === 0
    ? res
    : null;
});

/** WHICH pre-flight problem — see `classifyPreflightFailure`. */
const blockedReason = computed<BlockedReason | null>(() =>
  preflightFailure.value ? classifyPreflightFailure(preflightFailure.value.error) : null,
);

/** The raw extension message, shown verbatim on the generic pre-flight card. */
const blockedDetail = computed(() => preflightFailure.value?.error ?? "");

function onReplay() {
  // Replay ships the journey to the extension as-is, so a step with no locator
  // reaches Playwright as an empty selector and kills the run before step 1 —
  // which then surfaced as a pre-flight failure with a misleading cause. This
  // is the same gate "Continue to configure" already applies; it points at the
  // offending step instead.
  if (!validateJourneyBeforeReplay()) return;
  runReplay(check.value.journey);
}

/**
 * Replay only the first `upTo` steps (1-based, inclusive).
 *
 * A single step cannot be replayed on its own: journey state is cumulative and the
 * extension starts every replay from the target URL, so step 5 alone would run
 * against a fresh page with none of the preceding state. A prefix IS runnable, and
 * `replay()` already takes an arbitrary WireStep[] — so slicing the journey is the
 * whole implementation, with no extension change.
 */
function onReplayUpTo(upTo: number) {
  if (!validateJourneyBeforeReplay()) return;
  runReplay(check.value.journey.slice(0, Math.max(1, upTo)));
}

/**
 * Block replay on the same target/first-step rules the Continue button uses.
 *
 * Deliberately the whole journey even for a prefix replay: `validateStepSelectors`
 * reports against the journey the editor is showing, and a partial pass would
 * leave the untouched later steps looking valid.
 */
function validateJourneyBeforeReplay(): boolean {
  return journeyRef.value?.validateStepSelectors?.() ?? true;
}

const {
  environments: sharedEnvironments,
  globals: sharedGlobals,
  loaded: sharedVariablesLoaded,
  refresh: fetchSharedVariables,
} = useSharedVariables();
onMounted(fetchSharedVariables);

function onVariablePromoted(name: string) {
  // The promoted row is now shared, so replay and the unbound warning need the fresh lists.
  void fetchSharedVariables();
  if (!savedCheck.value) return;
  savedCheck.value = {
    ...savedCheck.value,
    variables: (savedCheck.value.variables ?? []).filter((v) => v.name !== name),
  };
}

/** Written by the environment selector when it lands; until then the default rule decides. */
const replayEnvironmentOverride = ref<string | undefined>();
/** Replay resolves one environment: the override, else the check's first, else the org's first. */
const replayEnvironmentId = computed(
  () =>
    replayEnvironmentOverride.value ??
    defaultReplayEnvironmentId(check.value.environments ?? [], sharedEnvironments.value),
);

/** The url and variables replay and recording run with, resolved against that environment. */
const replayInputsForCheck = computed(() =>
  replayInputs(
    check.value.url,
    check.value.variables ?? [],
    sharedPlainValues(sharedEnvironments.value, sharedGlobals.value, replayEnvironmentId.value),
  ),
);

/** Every name the check resolves in any of its environments; undefined until the shared tiers load. */
const knownVariableNames = computed(() => {
  if (!sharedVariablesLoaded.value) return undefined;
  const grouped = buildResolvedGrouped(
    sharedEnvironments.value,
    sharedGlobals.value,
    check.value.environments ?? [],
    check.value.variables ?? [],
  );
  return new Set(
    Object.values(grouped.resolved)
      .flat()
      .map((v) => v.name),
  );
});

/**
 * Expand subtest references before shipping the journey to the extension, so the
 * runner never sees a `subtest` step — it sees the child's own steps, spliced in
 * (§7.3). `expansionMap` is what lets `BrowserJourney` fold their results back
 * onto the reference row afterwards.
 */
async function runReplay(journey: BrowserStep[]) {
  let expanded = journey;
  expansionMap.value = undefined;
  try {
    const children = await loadChildren(journey, fetchChildJourney);
    const result = expandJourney(journey, children);
    expanded = result.steps;
    expansionMap.value = result.map;
  } catch (err) {
    recorder.error.value = err instanceof Error ? err.message : String(err);
    return;
  }
  const steps = journeyToWireSteps(expanded);
  if (steps.length === 0) return;
  startReplay(steps);
}

function startReplay(steps: WireStep[]) {
  const { url, variables } = replayInputsForCheck.value;
  recorder
    .replay(steps, url, variables, check.value.auth, check.value.headers, check.value.cookies)
    .catch((err) => {
      recorder.error.value = err instanceof Error ? err.message : String(err);
    });
}

/** Reuses the shared cache before hitting the network — see `childrenCache` doc. */
async function fetchChildJourney(id: string): Promise<ChildJourney> {
  const cached = childrenCache.value.get(id);
  if (cached) return cached;
  const res = await syntheticsService.get(orgIdentifier.value, id).catch((err: any) => {
    if (err?.response?.status === 403) {
      refusedChildIds.value = new Set([...refusedChildIds.value, id]);
    }
    throw err;
  });
  const child: ChildJourney = {
    id,
    name: res.data.name ?? "",
    folderId: res.data.folder_id,
    steps: mapWireSteps(res.data.config?.steps ?? []),
  };
  // A reference re-added after access was granted must not stay "no access".
  refusedChildIds.value = new Set([...refusedChildIds.value].filter((r) => r !== id));
  childrenCache.value.set(id, child);
  return child;
}

function onOpenChild(child: ChildJourney) {
  router.push(
    syntheticsEditRoute({ orgIdentifier: orgIdentifier.value, folderId: child.folderId }, child.id),
  );
}

function onStopReplay() {
  // The composable owns the stopping → stopped transition, the same way replay() owns
  // running → passed/failed. Flipping straight to "stopped" here used to claim the run
  // was over while the extension was still winding down, and left the mid-flight step
  // showing as in-progress because nothing cleared activeStepId.
  recorder.stopReplay().catch(() => {});
}

function onClearResults() {
  // Reset replay state through the composable
  recorder.replayPhase.value = "idle";
  recorder.replayResult.value = null;
  recorder.stepResults.clear();
}
</script>

<template>
  <!-- ── Non-loading: shared wrapper with page header ── -->
  <OPageLayout
    class="bg-surface-base"
    :subtitle="raw(folderName)"
    :back="{
      label: t('synthetics.newCheck.back'),
      to: backTo,
      dataTest: 'synthetics-create-back-btn',
    }"
    bleed
  >
    <template #title>
      <span class="inline-flex min-w-0 items-center gap-2">
        <span class="truncate">{{ headerTitle }}</span>
        <BetaBadge />
      </span>
    </template>
    <!-- ── Gate phase: URL + name ── -->
    <main v-if="phase === 'gate'" class="flex flex-1 flex-col items-center justify-center">
      <div class="mx-auto w-full max-w-[48rem] px-4 py-4">
        <div class="mb-6 flex justify-center">
          <EmptyBrowserCheck :width="140" />
        </div>
        <p class="mb-4 pb-4">
          {{ t("synthetics.createBrowserTest.gateDescription") }}
        </p>

        <div class="mb-6">
          <label for="synthetics-start-url" class="mb-1 block">
            {{ t("synthetics.createBrowserTest.startingUrl") }}
            <span class="text-status-error-text">*</span>
          </label>
          <OInput
            id="synthetics-start-url"
            v-model="startUrl"
            :placeholder="t('synthetics.checkDetails.startingUrlPlaceholder')"
            :error="!!urlError"
            :error-message="raw(urlError)"
            data-test="synthetics-create-url-input"
            @update:model-value="clearUrlError"
            @blur="validateGateUrl"
          >
            <template #prefix>
              <OIcon name="link" size="sm" />
            </template>
          </OInput>
          <small class="mt-1 block" data-test="synthetics-create-url-hint">{{
            t("synthetics.createBrowserTest.variablesHint", variablesHintParams)
          }}</small>
        </div>

        <div class="mb-4">
          <label for="synthetics-check-name" class="mb-1 block">{{
            t("synthetics.checkDetails.name")
          }}</label>
          <OInput
            id="synthetics-check-name"
            v-model="checkName"
            :placeholder="t('synthetics.checkDetails.namePlaceholder')"
            data-test="synthetics-create-name-input"
          />
          <small class="mt-1 block">{{ t("synthetics.createBrowserTest.nameHint") }}</small>
        </div>

        <div class="mb-6 flex gap-3">
          <OButton
            variant="primary"
            :disabled="!isGateUrlValid"
            :loading="checkingExtension"
            data-test="synthetics-create-record-btn"
            @click="onRecordClick"
          >
            <template #icon-left>
              <OIcon name="smart-display" size="sm" />
            </template>
            {{ t("synthetics.journey.recordJourney") }}
          </OButton>
          <OButton
            variant="outline"
            :disabled="!isGateUrlValid"
            data-test="synthetics-create-build-btn"
            @click="buildManually"
          >
            <template #icon-left>
              <OIcon name="edit" size="sm" />
            </template>
            {{ t("synthetics.createBrowserTest.buildManually") }}
          </OButton>
        </div>

        <small class="flex items-center gap-1">
          <OIcon name="bolt" size="sm" aria-hidden="true" />
          {{ t("synthetics.createBrowserTest.gateFooter") }}
        </small>
      </div>
    </main>

    <!-- ── Extension setup phase (only when extension not yet installed) ── -->
    <main
      v-else-if="phase === 'extension-setup'"
      class="flex flex-1 flex-col items-center justify-center"
    >
      <div class="mx-auto w-full max-w-[48rem] px-4 py-4">
        <div class="mb-6 flex justify-center">
          <div
            class="rounded-default border-border-default bg-surface-base flex items-center justify-center border p-6"
          >
            <OIcon name="open-in-browser" size="xl" class="text-accent" aria-hidden="true" />
          </div>
        </div>

        <p class="mb-2 pb-4 text-left">
          {{ t("synthetics.createBrowserTest.setupDescription", { url: check.url }) }}
        </p>

        <ExtensionSetupChecklist
          v-model:install-ack="installAck"
          v-model:incognito-done="incognitoAllowed"
          :connected="extensionReady"
          class="mb-6"
        />

        <OButton
          variant="primary"
          size="lg"
          class="mb-3 w-full"
          :disabled="!setupAllDone"
          data-test="synthetics-setup-open-record-btn"
          icon-left="smart-display"
          @click="onExtensionSetupRecord"
        >
          {{ setupCtaLabel }}
        </OButton>

        <p v-if="setupBlockingHint" class="text-text-secondary m-0 mb-3 text-center text-xs">
          {{ setupBlockingHint }}
        </p>

        <div class="text-center">
          <OButton
            variant="ghost"
            size="sm"
            class="text-text-link text-sm underline"
            data-test="synthetics-setup-skip-link"
            @click="onExtensionSetupSkip"
          >
            {{ t("synthetics.createBrowserTest.setupSkip") }}
          </OButton>
        </div>
      </div>
    </main>

    <!-- ── Editor phase ── -->
    <template v-else>
      <CreateBrowserTestSkeleton v-if="isLoadingEdit" :rows="10" />
      <div v-else-if="loadError" class="flex flex-1 flex-col items-center justify-center">
        <OEmptyState
          preset="load-error"
          size="block"
          data-test="synthetics-create-load-error"
          @action="onLoadRetry"
        />
      </div>
      <div v-else class="flex min-h-0 flex-1 flex-col">
        <OStepper
          v-model="currentStep"
          :navigable="true"
          class="my-2 h-full min-h-0 flex-1 overflow-y-auto"
        >
          <OStep
            :name="1"
            :title="t('synthetics.createBrowserTest.stepJourney')"
            icon="stacked-line-chart"
            :done="journeyStepDone"
            class="h-full!"
          >
            <!-- Journey editor + Variables panel; the steps list scrolls in its
                 own region so the panel stays pinned. -->
            <OSplitter
              v-model="journeySplitter"
              :limits="journeySplitterLimits"
              :disable="!variablesPanelOpen"
              :separator="variablesPanelOpen"
              class="h-full min-h-0"
            >
              <template #before>
                <div class="border-border-default h-full min-h-0 overflow-y-auto border-t">
                  <BrowserJourney
                    ref="journeyRef"
                    v-model="check.journey"
                    :start-url="replayInputsForCheck.url"
                    :known-variables="knownVariableNames"
                    :extension-ready="extensionReady"
                    :can-record-from="canRecordFrom"
                    :can-record-from-failure="canRecordFromFailure"
                    :auto-record="autoRecord"
                    :replay-phase="replayPhase"
                    :step-results="stepResults"
                    :active-step-id="activeStepId"
                    :blocked-reason="blockedReason"
                    :blocked-detail="blockedDetail"
                    :field-issues="journeyFieldIssues"
                    :variables-panel-open="variablesPanelOpen"
                    :own-check-id="check.id"
                    :own-step-count="executedStepCount"
                    :journey-budget-ms="journeyBudgetMs"
                    :variable-names="variableNames"
                    :children-cache="childrenCache"
                    :refused-child-ids="refusedChildIds"
                    :expansion-map="expansionMap"
                    class="h-full!"
                    @toggle-variables-panel="variablesPanelOpen = !variablesPanelOpen"
                    @open-child="onOpenChild"
                    @replay="onReplay"
                    @verify-extension="reverifyExtension"
                    @replay-up-to="onReplayUpTo"
                    @stop-replay="onStopReplay"
                    @clear-results="onClearResults"
                    @auto-record-consumed="autoRecord = false"
                    @selection-changed="journeySelectionState = $event"
                  />
                </div>
              </template>
              <template #separator>
                <div
                  class="hover:bg-table-resize-handle h-full w-1 border-t bg-transparent transition-colors duration-300"
                />
              </template>
              <template #after>
                <CheckVariablesPanel
                  v-if="variablesPanelOpen"
                  :check="check"
                  :check-id="check.id"
                  :saved="savedCheck"
                  :child-journeys="childrenCache"
                  class="border-border-default border-t"
                  @update:check="onConfigureUpdate"
                  @promoted="onVariablePromoted"
                />
              </template>
            </OSplitter>
          </OStep>
          <OStep
            :name="2"
            :title="t('synthetics.createBrowserTest.stepConfigure')"
            icon="tune"
            :done="false"
            class="h-full!"
          >
            <CheckConfigure
              :check="check"
              check-type="browser"
              :locations="locations"
              :loading-locations="locationsLoading"
              :browsers="browsers"
              :devices="devices"
              :destinations="destinations"
              :folders="folders"
              :folders-loading="foldersLoading"
              :validation-errors="validationErrors"
              :allow-private-locations="privateLocationsEnabled"
              class="border-border-default w-full! border-t"
              @refresh:destinations="loadDestinations(true)"
              @update:check="onConfigureUpdate"
              @new-location="openAgentSetup()"
              @add-agent="(id: string) => openAgentSetup(id)"
              @refresh-locations="fetchLocations"
            />
          </OStep>
        </OStepper>

        <!-- Private browser-agent setup drawer; locations reload on close so a
           freshly registered location becomes selectable without leaving. -->
        <AgentSetupDrawer
          v-if="privateLocationsEnabled"
          v-model:open="showAgentSetup"
          agent-type="browser"
          :token="agentSetup?.token"
          :org="agentSetup?.org"
          :o2-url="agentSetup?.o2_url"
          :script-url="agentSetup?.script_url"
          :install="agentSetup?.install"
          :location-id="agentSetupLocationId"
          :location-name="agentSetupLocationName"
          @update:open="
            (open: boolean) => {
              if (!open) {
                agentSetupLocationId = null;
                agentSetupLocationName = null;
              }
            }
          "
        />

        <!-- Sticky footer — tab-aware, always visible -->
        <div
          class="border-border-default bg-surface-base flex shrink-0 items-center gap-2 border-t px-3 py-2.5"
        >
          <!-- Journey step: Selection actions (left) | Cancel + save/continue actions (right) -->
          <template v-if="currentStep === 1">
            <!-- Selection actions — moved from BrowserJourney, kept on the left -->
            <template v-if="journeySelectionState.count > 0 && !journeySelectionState.isRecording">
              <span class="text-text-secondary text-sm whitespace-nowrap">{{
                t("synthetics.journey.selectedCount", { count: journeySelectionState.count })
              }}</span>
              <OButton
                variant="outline-destructive"
                size="sm"
                data-test="synthetics-journey-delete-selected-btn"
                @click="showBulkDeleteDialog = true"
              >
                <template #icon-left><OIcon name="delete" size="sm" /></template>
                {{ t("synthetics.journey.delete") }}
              </OButton>
              <template v-if="isCompositionEnabled">
                <OButton
                  variant="outline"
                  size="sm"
                  :aria-disabled="!extractEligibilityResult.ok"
                  data-test="synthetics-extract-open-btn"
                  @click="openExtractDialog"
                >
                  <template #icon-left><OIcon name="git-branch" size="sm" /></template>
                  {{ t("synthetics.journey.extract.action") }}
                </OButton>
                <span
                  v-if="!extractEligibilityResult.ok"
                  class="text-text-secondary text-xs"
                  data-test="synthetics-extract-reason"
                >
                  {{
                    t(`synthetics.journey.extract.reason.${extractEligibilityResult.reason}`, {
                      name: extractEligibilityResult.placeholder,
                    })
                  }}
                  <OButton
                    v-if="extractEligibilityResult.reason === 'referenced-unknown'"
                    variant="ghost"
                    size="sm"
                    data-test="synthetics-extract-retry-btn"
                    @click="retryReferencedBy"
                  >
                    {{ t("common.retry") }}
                  </OButton>
                </span>
              </template>
            </template>
            <span class="flex-1" aria-hidden="true" />

            <OButton
              variant="ghost"
              size="sm"
              data-test="synthetics-create-cancel-btn"
              @click="router.push(backTo)"
            >
              {{ t("common.cancel") }}
            </OButton>
            <!-- Create mode: nothing to save yet — Configure holds the required fields -->
            <OButton
              v-if="!props.editId"
              variant="outline"
              size="sm"
              data-test="synthetics-create-continue-btn"
              @click="onContinueToConfigure"
            >
              {{ t("synthetics.createBrowserTest.continue") }}
            </OButton>
            <template v-else>
              <OButton
                variant="outline"
                size="sm"
                :loading="isSaving"
                data-test="synthetics-create-save-continue-btn"
                @click="onSaveAndContinue"
              >
                {{ t("synthetics.newCheck.saveAndContinue") }}
              </OButton>
              <OButton
                variant="primary"
                size="sm"
                :loading="isSaving"
                data-test="synthetics-create-save-exit-btn"
                @click="onSaveAndExit"
              >
                {{ t("synthetics.newCheck.saveAndExit") }}
              </OButton>
            </template>
          </template>

          <!-- Configure step: Cancel | Back + Save -->
          <template v-else-if="currentStep === 2">
            <span class="flex-1" aria-hidden="true" />
            <OButton
              variant="ghost"
              size="sm"
              data-test="synthetics-create-cancel-btn"
              @click="router.push(backTo)"
            >
              {{ t("common.cancel") }}
            </OButton>
            <OButton
              variant="outline"
              size="sm"
              data-test="synthetics-create-back-to-journey-btn"
              @click="currentStep = 1"
            >
              {{ t("common.goBack") }}
            </OButton>
            <OButton
              variant="primary"
              size="sm"
              :loading="isSaving"
              data-test="synthetics-create-save-btn"
              @click="onSaveAndExit"
            >
              {{ t("synthetics.newCheck.saveAndExit") }}
            </OButton>
          </template>
        </div>

        <ExtractSubtestDialog
          v-if="isCompositionEnabled && extractEligibilityResult.ok"
          v-model:open="showExtractDialog"
          :range="extractRange"
          :anchor="extractAnchor"
          :authored-count="check.journey.length"
          :executed-count="executedStepCount ?? check.journey.length"
          :parent-name="check.name"
          :default-folder="check.folder ?? 'default'"
          :folders="folders"
          :needs-schedule="check.locations.length === 0"
          :parent-locations="check.locations"
          :parent-schedule="check.schedule"
          :location-options="locations"
          :variables="extractVariables"
          :on-submit="onExtractSubmit"
        />

        <!-- Bulk delete confirmation dialog — moved from BrowserJourney -->
        <ODialog
          v-model:open="showBulkDeleteDialog"
          size="sm"
          :title="t('synthetics.journey.bulkDeleteStepsTitle')"
          :primary-button-label="t('synthetics.journey.delete')"
          :secondary-button-label="t('common.cancel')"
          primary-button-variant="destructive"
          data-test="synthetics-journey-bulk-delete-dialog"
          @click:primary="onDeleteSelected"
          @click:secondary="showBulkDeleteDialog = false"
        >
          <p class="py-2">
            {{
              t("synthetics.journey.bulkDeleteStepsBody", { count: journeySelectionState.count })
            }}
          </p>
        </ODialog>
      </div>
    </template>

    <!-- Usage confirmation (§5.3) — other checks reference this one, so
         saving changes what they run too, on their next fire. -->
    <ODialog
      v-model:open="usedByDialogOpen"
      size="sm"
      :title="
        t('synthetics.save.usedByTitle', {
          name: check.name,
          count: (usedByInfo?.references.length ?? 0) + (usedByInfo?.hidden ?? 0),
        })
      "
      :primary-button-label="t('common.save')"
      :secondary-button-label="t('common.cancel')"
      data-test="synthetics-create-used-by-dialog"
      @click:primary="confirmUsedBySave"
      @click:secondary="usedByDialogOpen = false"
    >
      <div class="flex flex-col gap-3 py-1">
        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          <li v-for="ref in usedByInfo?.references ?? []" :key="ref.id">
            <span class="text-sm">{{ ref.name }}</span>
          </li>
        </ul>
        <p v-if="(usedByInfo?.hidden ?? 0) > 0" class="text-text-secondary m-0 text-xs">
          {{ t("synthetics.delete.hiddenReferences", { count: usedByInfo?.hidden ?? 0 }) }}
        </p>
        <p class="m-0">{{ t("synthetics.save.usedByBody") }}</p>
      </div>
    </ODialog>

    <!-- Unsaved changes dialog (route leave) — rendered at top level so it's
       available in ALL phases (gate, extension-setup, editor), not just editor. -->
    <ODialog
      v-model:open="showUnsavedDialog"
      size="sm"
      :title="t('synthetics.newCheck.unsavedTitle')"
      :primary-button-label="t('synthetics.newCheck.leave')"
      :secondary-button-label="t('synthetics.newCheck.stay')"
      data-test="synthetics-create-unsaved-dialog"
      @click:primary="onConfirmLeave"
      @click:secondary="showUnsavedDialog = false"
    >
      <p class="py-2">{{ t("synthetics.newCheck.unsavedBody") }}</p>
    </ODialog>
  </OPageLayout>
</template>
