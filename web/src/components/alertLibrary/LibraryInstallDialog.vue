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

<!--
  LibraryInstallDialog — the answers an install needs: Folder -> Tune -> Add.

  The page already chose the alerts, so every one passed in is added. They are
  added with no destination: they evaluate and record their history, and notify
  once someone attaches a destination in the alert editor.

  The batch arrives as `seed` from one alert's drawer or card, or `preselect`
  from the gallery's selection. The seed wins.

  Installs run SEQUENTIALLY and one failure never stops the rest — a duplicate
  name in the middle of a batch of twelve must not cost the other eleven. Each
  alert gets its own row and the failures get a retry.
-->
<template>
  <ODialog
    :open="open"
    size="lg"
    :title="t('alert_library.install.title')"
    :sub-title="t('alert_library.install.subtitle')"
    :persistent="isInstalling"
    :show-close="!isInstalling"
    data-test="alert-library-install-dialog"
    @update:open="onOpenChange"
  >
    <!-- Animation is off on purpose: the panels differ in height by a lot, so
         the height tween reads as the dialog lurching. Navigation back to a
         completed step closes once the batch has run — the run is not undoable
         and re-entering the wizard behind it would suggest it is. -->
    <OStepper
      v-model="step"
      orientation="horizontal"
      :animated="false"
      :navigable="!hasRun"
      data-test="alert-library-install-stepper"
    >
      <OStep
        :name="1"
        :title="t('alert_library.install.stepFolder')"
        icon="folder"
        :done="step > 1"
      >
        <div class="flex flex-col gap-3 pt-2" data-test="alert-library-install-folder-step">
          <p class="text-text-secondary text-sm">{{ t("alert_library.install.folderIntro") }}</p>
          <OSkeleton
            v-if="foldersLoading"
            type="rect"
            class="rounded-default h-9 w-full"
            data-test="alert-library-install-folder-loading"
          />
          <SelectFolderDropDown
            v-else
            :active-folder-id="folderId"
            type="alerts"
            @folder-selected="onFolderSelected"
          />
        </div>
      </OStep>

      <!-- Frequency and silence are scheduled-alert fields; an anomaly-only batch skips the step. -->
      <OStep
        v-if="batchHasScheduled"
        :name="2"
        :title="t('alert_library.install.stepTune')"
        icon="tune"
        :done="step > 2"
      >
        <div class="flex flex-col gap-3 pt-2" data-test="alert-library-install-tune-step">
          <p
            v-if="batchHasAnomaly"
            class="text-text-secondary text-sm"
            data-test="alert-library-install-tune-threshold-only"
          >
            {{ t("alert_library.install.tuneThresholdOnly") }}
          </p>
          <!-- The two settings are named from their own field labels: the fields
               themselves are hidden until the toggle below is ticked. -->
          <p class="text-text-secondary text-sm" data-test="alert-library-install-tune-hint">
            {{
              t("alert_library.install.tuneHint", {
                frequency: t("alert_library.install.frequency"),
                silence: t("alert_library.install.silence"),
              })
            }}
          </p>
          <OCheckbox
            :model-value="tuneEnabled"
            size="sm"
            :label="t('alert_library.install.tuneToggle')"
            data-test="alert-library-install-tune-toggle"
            @update:model-value="tuneEnabled = $event === true"
          />
          <div v-if="tuneEnabled" class="grid gap-3 sm:grid-cols-2">
            <OInput
              :model-value="tuneFrequency"
              type="number"
              size="sm"
              :label="t('alert_library.install.frequency')"
              :suffix="minutesSuffix"
              data-test="alert-library-install-tune-frequency"
              @update:model-value="tuneFrequency = coerceTunable('frequency', $event)"
            />
            <OInput
              :model-value="tuneSilence"
              type="number"
              size="sm"
              :label="t('alert_library.install.silence')"
              :suffix="minutesSuffix"
              data-test="alert-library-install-tune-silence"
              @update:model-value="tuneSilence = coerceTunable('silence', $event)"
            />
          </div>
        </div>
      </OStep>

      <OStep :name="3" :title="t('alert_library.install.stepInstall')" icon="download">
        <div class="flex flex-col gap-3 pt-2" data-test="alert-library-install-review-step">
          <dl
            class="border-border-default rounded-default grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border p-3 text-sm"
            data-test="alert-library-install-summary"
          >
            <dt class="text-text-secondary">{{ t("alert_library.install.stepFolder") }}</dt>
            <dd class="text-text-heading">{{ folderLabel }}</dd>
            <dt class="text-text-secondary">{{ t("alert_library.install.stepAlerts") }}</dt>
            <dd class="text-text-heading">{{ candidates.length }}</dd>
            <template v-if="batchHasScheduled">
              <dt class="text-text-secondary">{{ t("alert_library.install.stepTune") }}</dt>
              <dd class="text-text-heading">{{ tuningSummary }}</dd>
            </template>
          </dl>

          <OBanner
            v-if="anomalyInstalled"
            variant="info"
            icon="query-stats"
            dense
            :content="t('alert_library.install.anomalyTrainingNote')"
            data-test="alert-library-install-anomaly-note"
          />

          <!-- Select-all-in-view is one click, so the biggest runs are made deliberate. -->
          <OCheckbox
            v-if="needsLargeBatchConfirm"
            size="sm"
            :model-value="largeBatchConfirmed"
            :label="largeBatchPrompt"
            :aria-label="largeBatchPrompt"
            data-test="alert-library-install-confirm-large"
            @update:model-value="largeBatchConfirmed = $event === true"
          />

          <ul
            v-if="results.length > 0"
            class="border-border-default rounded-default divide-border-default max-h-80 divide-y overflow-y-auto border"
          >
            <li
              v-for="result in results"
              :key="result.id"
              class="flex items-start gap-3 px-3 py-2"
              :data-test="`alert-library-install-result-${result.id}`"
              :data-status="result.status"
            >
              <OIcon
                :name="statusIcon(result.status)"
                size="sm"
                class="mt-0.5 shrink-0"
                :class="statusClass(result.status)"
              />
              <div class="min-w-0 flex-1">
                <OTruncatedText as="div" class="text-text-heading text-sm">{{
                  result.title
                }}</OTruncatedText>
                <div
                  v-if="result.message"
                  class="text-status-negative text-xs"
                  :data-test="`alert-library-install-error-${result.id}`"
                >
                  {{ result.message }}
                </div>
              </div>
            </li>
          </ul>
        </div>
      </OStep>
    </OStepper>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          :disabled="isInstalling"
          data-test="alert-library-install-cancel"
          @click="onOpenChange(false)"
        >
          {{ t("alert_library.install.cancel") }}
        </OButton>
        <OButton
          v-if="step > 1 && !hasRun"
          variant="outline"
          size="sm-action"
          :disabled="isInstalling"
          data-test="alert-library-install-back"
          @click="goBack"
        >
          {{ t("alert_library.install.back") }}
        </OButton>
        <OButton
          v-if="step < 3"
          variant="primary"
          size="sm-action"
          data-test="alert-library-install-next"
          @click="goNext"
        >
          {{ t("alert_library.install.next") }}
        </OButton>
        <OButton
          v-if="step === 3 && !hasRun"
          variant="primary"
          size="sm-action"
          :loading="isInstalling"
          :disabled="candidates.length === 0 || (needsLargeBatchConfirm && !largeBatchConfirmed)"
          data-test="alert-library-install-run"
          @click="install(candidates.map((entry) => entry.id))"
        >
          {{ t("alert_library.install.run", { count: candidates.length }, candidates.length) }}
        </OButton>
        <OButton
          v-if="step === 3 && hasRun && failedIds.length > 0"
          variant="primary"
          size="sm-action"
          :loading="isInstalling"
          icon-left="refresh"
          data-test="alert-library-install-retry"
          @click="install(failedIds)"
        >
          {{
            t("alert_library.install.retryFailed", { count: failedIds.length }, failedIds.length)
          }}
        </OButton>
        <OButton
          v-if="step === 3 && hasRun"
          :variant="failedIds.length > 0 ? 'outline' : 'primary'"
          size="sm-action"
          :disabled="isInstalling"
          data-test="alert-library-install-done"
          @click="onOpenChange(false)"
        >
          {{ t("alert_library.install.done") }}
        </OButton>
      </div>
    </template>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";

import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import { useAlertLibrary, useAnomalyLibraryAccess } from "@/composables/alerts/useAlertLibrary";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { saveAlertMutation } from "@/services/alerts.queries";
import { alertKeys } from "@/services/alerts.querykeys";
import { saveAnomalyConfigMutation } from "@/services/anomaly_detection.queries";
import { useMutation } from "@tanstack/vue-query";
import analytics from "@/services/product_analytics";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getFoldersListByType } from "@/utils/commons";

import { alertTypeOf } from "./libraryFacets";
import {
  buildAnomalyInstallPayload,
  buildInstallPayload,
  InstallPayloadError,
  type InstallOverrides,
} from "./libraryInstall";
import { coerceTunable, readTunables, DEFAULT_TUNABLES } from "./libraryTunables";

const props = defineProps<{
  open: boolean;
  /** The drawer's or card's alert and the file it already tuned. */
  seed: { entry: AlertLibraryEntry; file: AlertLibraryFile } | null;
  /** The gallery's frozen batch — entries, not ids, since it may hold alerts the filters now hide. */
  preselect: AlertLibraryEntry[];
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  /**
   * Library ENTRY ids (`<pack>/<name>`) this run installed — not alert ids, and
   * not a list-refresh signal.
   *
   * Phase 5 uses it to mark those entries as installed in the gallery without
   * re-reading provenance off the server: the run already knows what it just
   * created. Failures are excluded; nothing was created for those.
   */
  (e: "installed", payload: { entryIds: string[] }): void;
}>();

// A product call, not a derived number: a pack is 10-30 alerts, the catalog is over a thousand.
const LARGE_BATCH = 50;

const { t } = useI18nTyped();
const store = useStore();
const { loadAlertFile } = useAlertLibrary();
const anomalyAccess = useAnomalyLibraryAccess();

/** Optional-chained: a missing organization must not throw out of a click handler. */
const orgIdentifier = (): string => store.state.selectedOrganization?.identifier ?? "";

type InstallStatus = "pending" | "running" | "installed" | "failed";

interface InstallResult {
  id: string;
  title: I18nText;
  status: InstallStatus;
  /** Server text on failure — shown verbatim, so never a catalogue key. */
  message?: I18nText;
}

const step = ref(1);

// ── folder, tuning ─────────────────────────────────────────────────────────
const folderId = ref("default");
const folderName = ref("");
const foldersLoading = ref(false);
const tuneEnabled = ref(false);
const largeBatchConfirmed = ref(false);
const tuneFrequency = ref(DEFAULT_TUNABLES.frequency);
const tuneSilence = ref(DEFAULT_TUNABLES.silence);

// ── run ────────────────────────────────────────────────────────────────────
/**
 * The alert set this run reports on, frozen when it starts.
 *
 * `candidates` derives from props the gallery can rewrite mid-run (its catalog
 * refresh prunes `preselect`). Rebuilding the result rows from it would drop
 * rows the user has not read yet.
 */
const roster = ref<AlertLibraryEntry[]>([]);
const results = ref<InstallResult[]>([]);
const isInstalling = ref(false);
const hasRun = ref(false);
const anomalyInstalled = ref(false);

// A locked anomaly alert stays out of the batch even if a caller hands one in.
const canInstallKind = (entry: AlertLibraryEntry): boolean =>
  alertTypeOf(entry) !== "anomaly" || anomalyAccess.value === "enabled";

const minutesSuffix = computed(() => t("alert_library.install.minutes"));

/** Every alert this open adds, and the only list install ever walks. */
const candidates = computed<AlertLibraryEntry[]>(() => {
  const offered = props.seed ? [props.seed.entry] : props.preselect;
  // Deduped by id: the install walks this list, so a batch that repeats an
  // entry would create that alert twice.
  const seen = new Set<string>();
  return offered.filter((entry) => {
    if (!canInstallKind(entry)) return false;
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
});

const batchHasScheduled = computed(() =>
  candidates.value.some((entry) => alertTypeOf(entry) === "scheduled"),
);
const batchHasAnomaly = computed(() =>
  candidates.value.some((entry) => alertTypeOf(entry) === "anomaly"),
);

const folderLabel = computed<I18nText>(() => raw(folderName.value || folderId.value));

const tuningSummary = computed<I18nText>(() =>
  tuneEnabled.value
    ? t("alert_library.install.summaryTuningOverride", {
        frequency: tuneFrequency.value,
        silence: tuneSilence.value,
      })
    : t("alert_library.install.summaryTuningNone"),
);

const needsLargeBatchConfirm = computed(() => candidates.value.length > LARGE_BATCH);

const largeBatchPrompt = computed(() =>
  t("alert_library.install.confirmLargeNoDestination", {
    count: candidates.value.length,
    folder: folderLabel.value,
  }),
);

// The tick acknowledges THIS batch in THIS folder; a change to either re-arms it.
watch([candidates, folderId], () => {
  largeBatchConfirmed.value = false;
});

const failedIds = computed(() =>
  results.value.filter((result) => result.status === "failed").map((result) => result.id),
);

// ── lifecycle ──────────────────────────────────────────────────────────────
const reset = () => {
  sessionToken += 1;
  step.value = 1;
  foldersLoading.value = false;
  folderId.value = "default";
  folderName.value = "";
  tuneEnabled.value = false;
  results.value = [];
  roster.value = [];
  hasRun.value = false;
  isInstalling.value = false;
  anomalyInstalled.value = false;
  largeBatchConfirmed.value = false;
  // Seed the bulk pair from the alert the user was just looking at, so the
  // fields open on values that mean something rather than on a global default.
  const tunables = props.seed ? readTunables(props.seed.file) : DEFAULT_TUNABLES;
  tuneFrequency.value = tunables.frequency;
  tuneSilence.value = tunables.silence;
};

/**
 * Bumped by every `reset()`. Anything that awaits must re-check it afterwards:
 * a folder fetch started before a close-and-reopen would otherwise clear the
 * NEW session's loading state.
 */
let sessionToken = 0;

// The folder picker refreshes itself only on `onActivated`, which a dialog never fires.
const loadFolders = () => {
  const token = sessionToken;
  foldersLoading.value = true;
  void getFoldersListByType(store, "alerts")
    .catch(() => {
      // The picker still offers "default", which is a valid folder.
    })
    .finally(() => {
      if (token === sessionToken) foldersLoading.value = false;
    });
};

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    loadFolders();
  },
  { immediate: true },
);

const onOpenChange = (value: boolean) => {
  if (!value && isInstalling.value) return;
  emit("update:open", value);
};

const errorText = (error: unknown): I18nText => {
  // The builder refuses a file it cannot read by CODE, because it has no `t`.
  // Resolving it here is what keeps that refusal translatable instead of
  // showing the user the literal string "unreadable_conditions".
  if (error instanceof InstallPayloadError) {
    return error.code === "anomaly_unavailable"
      ? t("alert_library.install.anomalyUnavailable")
      : t("alert_library.install.unreadableConditions");
  }
  const response = (error as { response?: { data?: { message?: string } } })?.response;
  return (
    raw(response?.data?.message) ||
    raw((error as { message?: string })?.message) ||
    t("alert_library.install.unknownError")
  );
};

// Tune exists only for scheduled alerts, so an anomaly-only batch steps over it.
const goNext = () => {
  step.value = step.value === 1 && !batchHasScheduled.value ? 3 : step.value + 1;
};

const goBack = () => {
  step.value = step.value === 3 && !batchHasScheduled.value ? 1 : step.value - 1;
};

// ── folder step ────────────────────────────────────────────────────────────
const onFolderSelected = (folder: { label?: string; value?: string }) => {
  folderId.value = folder?.value ?? "default";
  folderName.value = folder?.label ?? "";
};

// ── install ────────────────────────────────────────────────────────────────
const statusIcon = (status: InstallStatus) => {
  if (status === "installed") return "check-circle";
  if (status === "failed") return "error-outline";
  return "schedule";
};

const statusClass = (status: InstallStatus) => {
  if (status === "installed") return "text-status-positive";
  if (status === "failed") return "text-status-negative";
  return "text-text-secondary";
};

const setResult = (id: string, patch: Partial<InstallResult>) => {
  results.value = results.value.map((result) =>
    result.id === id ? { ...result, ...patch } : result,
  );
};

// Each create drops the scope itself, so nothing refreshes after the batch.
const installAlert = useMutation(() => saveAlertMutation(orgIdentifier(), () => false));
// The Alerts list shows anomaly configs too, and the shared mutation drops only the anomaly scope.
const installAnomaly = useMutation(() => {
  const options = saveAnomalyConfigMutation(orgIdentifier(), () => undefined);
  return {
    ...options,
    meta: {
      ...options.meta,
      invalidates: [...(options.meta?.invalidates ?? []), alertKeys.all(orgIdentifier())],
    },
  };
});

const installOne = async (
  entry: AlertLibraryEntry,
  overrides: InstallOverrides | undefined,
): Promise<boolean> => {
  const file =
    props.seed && props.seed.entry.id === entry.id ? props.seed.file : await loadAlertFile(entry);

  // The file is checked too: on OSS an anomaly body is stored as a broken scheduled alert.
  const isAnomaly = alertTypeOf(entry) === "anomaly" || file.alert_type === "anomaly_detection";
  if (isAnomaly) {
    if (anomalyAccess.value !== "enabled") throw new InstallPayloadError("anomaly_unavailable");
    const payload = buildAnomalyInstallPayload({
      entry,
      file,
      folderId: folderId.value,
    });
    await installAnomaly.mutateAsync({ payload, folderId: folderId.value });
    return true;
  }

  const payload = buildInstallPayload({
    entry,
    file,
    folderId: folderId.value,
    owner: store.state.userInfo?.email ?? "",
    timezone: store.state.timezone,
    overrides,
  });
  await installAlert.mutateAsync({ payload, folderId: folderId.value });
  return false;
};

const install = async (ids: string[]) => {
  if (isInstalling.value) return;

  // Freeze the roster on the FIRST run; a retry reports on the same set.
  if (!hasRun.value) {
    roster.value = [...candidates.value];
  }

  const batch = roster.value.filter((entry) => ids.includes(entry.id));
  // `batch`, not `ids`: an id with no entry behind it would otherwise flip
  // `hasRun` and toast a result for a run that never happened.
  if (batch.length === 0) return;

  // Rows in this batch restart at pending; rows outside it keep the verdict the
  // earlier pass gave them.
  const previous = new Map(results.value.map((result) => [result.id, result]));
  results.value = roster.value.map((entry) => {
    const carried = previous.get(entry.id);
    if (!ids.includes(entry.id) && carried) return carried;
    return { id: entry.id, title: raw(entry.title), status: "pending" as const };
  });

  isInstalling.value = true;
  hasRun.value = true;
  // Read once, so a batch cannot change tuning halfway through itself.
  const batchOverrides: InstallOverrides | undefined = tuneEnabled.value
    ? { frequency: tuneFrequency.value, silence: tuneSilence.value }
    : undefined;

  // Only what this pass created. Re-announcing everything in `results` would
  // make a retry repeat ids the parent already counted.
  const installedNow: string[] = [];
  let anomalyNow = 0;

  // Sequential on purpose: one rejected create must not take the rest of the
  // batch with it, and a burst of parallel POSTs is what rate limits.
  try {
    for (const entry of batch) {
      setResult(entry.id, { status: "running", message: undefined });
      try {
        if (await installOne(entry, batchOverrides)) anomalyNow += 1;
        setResult(entry.id, { status: "installed" });
        installedNow.push(entry.id);
      } catch (error) {
        setResult(entry.id, { status: "failed", message: errorText(error) });
      }
    }
  } finally {
    // Nothing escapes the per-alert catch today, but if anything ever did the
    // dialog would become uncloseable by every path at once.
    isInstalling.value = false;
  }

  if (anomalyNow > 0) anomalyInstalled.value = true;
  if (installedNow.length > 0) {
    emit("installed", { entryIds: installedNow });
    analytics.track("library_alert_installed", {
      count: installedNow.length,
      anomaly_count: anomalyNow,
    });
  }

  const failed = failedIds.value.length;
  toast(
    failed === 0
      ? {
          variant: "success",
          message: t(
            "alert_library.install.allInstalled",
            { count: results.value.length },
            results.value.length,
          ),
        }
      : {
          variant: "error",
          message: t("alert_library.install.someFailed", {
            installed: results.value.length - failed,
            failed,
          }),
        },
  );
};
</script>
