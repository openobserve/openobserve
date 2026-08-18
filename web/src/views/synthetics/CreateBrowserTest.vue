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
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useRouter, useRoute, onBeforeRouteLeave } from "vue-router";
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
import { journeyToWireSteps } from "@/utils/synthetics/mapRecordedStep";
import { computeRunBudget, formatBudgetDuration, JOB_LEASE_MS } from "@/utils/synthetics/runBudget";
import { classifyPreflightFailure } from "@/utils/synthetics/replayFailure";
import {
  buildCreateBrowserTestPayload,
  mapResponseToBrowserCheck,
} from "@/utils/synthetics/buildPayload";
import {
  makeBrowserCheckGateSchema,
  makeBrowserCheckSaveSchema,
} from "@/components/synthetics/CreateBrowserTest.schema";
import { CHROME_UI_LABELS, SETUP_QUERY_PARAM } from "@/constants/synthetics";
import { getFoldersListByType } from "@/utils/commons";
import { syntheticsListRoute } from "@/utils/synthetics/routes";
import syntheticsService from "@/services/synthetics";
import destinationService from "@/services/alert_destination";
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

// Computed literals to avoid `{{` template delimiter conflicts in Vue templates.
// The i18n message "Supports {variables} like {baseUrl}." uses these params to
// show literal "{{variables}}" and "{{baseUrl}}" as user-facing syntax examples.
const variablesHintParams = computed(() => ({
  variables: "{{variables}}",
  baseUrl: "{{baseUrl}}",
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
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.getAgentSetup(org);
    agentSetup.value = (res.data ?? null) as AgentSetup | null;
  } catch {
    agentSetup.value = null;
  }
}

async function fetchLocations() {
  locationsLoading.value = true;
  try {
    const org = store.state.selectedOrganization.identifier;
    const res = await syntheticsService.getLocations(org);
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

async function fetchDestinations() {
  try {
    const res = await destinationService.list({
      org_identifier: store.state.selectedOrganization.identifier,
      page_num: 1,
      page_size: 1000,
      sort_by: "name",
      desc: false,
    });
    destinations.value = (res.data ?? []).map((d: any) => d.name as string);
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
    checkName.value = mapped.name;
    startUrl.value = mapped.url;
    journeyStepDone.value = true;
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
  fetchDestinations();

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
});

onBeforeRouteLeave((to, from, next) => {
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
});

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
    const org = store.state.selectedOrganization.identifier;
    if (props.editId) {
      await syntheticsService.update(org, props.editId, apiPayload.value, check.value.folder);
      dismiss();
      toast({ variant: "success", message: t("synthetics.newCheck.updated") });
    } else {
      await syntheticsService.create(org, apiPayload.value, check.value.folder);
      dismiss();
      toast({ variant: "success", message: t("synthetics.newCheck.saved") });
    }
    isDirty.value = false;
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
const journeySelectionState = ref({ count: 0, isRecording: false });
const showBulkDeleteDialog = ref(false);

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

/** Edit mode, Journey step: persist, then move on to Configure. */
async function onSaveAndContinue() {
  if (!(await persist())) return;
  journeyStepDone.value = true;
  currentStep.value = 2;
}

/** Persist, then return to the checks list. */
async function onSaveAndExit() {
  if (!(await persist())) return;
  router.push(backTo.value);
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

function runReplay(journey: BrowserStep[]) {
  const steps = journeyToWireSteps(journey);
  if (steps.length === 0) return;
  recorder
    .replay(
      steps,
      check.value.url,
      check.value.variables,
      check.value.auth,
      check.value.headers,
      check.value.cookies,
    )
    .catch((err) => {
      recorder.error.value = err instanceof Error ? err.message : String(err);
    });
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
          <small class="mt-1 block">{{
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
                    :start-url="check.url"
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
                    class="h-full!"
                    @toggle-variables-panel="variablesPanelOpen = !variablesPanelOpen"
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
                  class="border-border-default border-t"
                  @update:check="onConfigureUpdate"
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
              allow-private-locations
              class="border-border-default w-full! border-t"
              @refresh:destinations="fetchDestinations"
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
