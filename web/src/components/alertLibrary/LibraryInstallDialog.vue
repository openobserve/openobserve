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
  LibraryInstallDialog — the five answers an install needs, in the order the
  answer stops being obvious: Destination -> Alerts -> Folder -> Tune -> Install.

  Destination comes FIRST because it is the only step that can fail before
  anything is chosen: a library file names the destinations of the org it was
  exported from, so a customer org with none has nothing to install to. Asking
  last would mean picking twelve alerts and then being told to go elsewhere.

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
        :title="t('alert_library.install.stepDestination')"
        icon="send"
        :done="step > 1"
      >
        <div class="flex flex-col gap-3 pt-2" data-test="alert-library-install-destination-step">
          <p class="text-text-secondary text-sm">
            {{ t("alert_library.install.destinationIntro") }}
          </p>

          <OBanner
            v-if="destinationsFailed"
            variant="warning"
            dense
            icon="warning"
            data-test="alert-library-install-destinations-failed"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm">{{ t("alert_library.install.destinationsLoadFailed") }}</span>
              <OButton
                variant="outline"
                size="sm"
                icon-left="refresh"
                :loading="isLoadingDestinations"
                data-test="alert-library-install-destinations-retry"
                @click="loadDestinations()"
              >
                {{ t("alert_library.install.retry") }}
              </OButton>
            </div>
          </OBanner>

          <!-- Genuinely no destinations yet. Not an error, and not something
               this dialog can fix any more — say so and point somewhere real. -->
          <template v-if="!isLoadingDestinations && !destinationsFailed && !hasDestinations">
            <OBanner
              variant="info"
              icon="info"
              data-test="alert-library-install-destinations-empty"
            >
              <div class="flex flex-col gap-2">
                <span class="text-sm">{{ t("alert_library.install.destinationsNoneBody") }}</span>
                <div>
                  <OButton
                    variant="outline"
                    size="sm"
                    icon-left="open-in-new"
                    data-test="alert-library-install-open-destinations"
                    @click="openDestinationsPage"
                  >
                    {{ t("alert_library.install.openDestinations") }}
                  </OButton>
                </div>
              </div>
            </OBanner>
          </template>

          <template v-else>
            <OSelect
              :model-value="chosenDestination"
              :options="destinationOptions"
              size="sm"
              :label="t('alert_library.install.destinationLabel')"
              :placeholder="t('alert_library.install.destinationPlaceholder')"
              data-test="alert-library-install-destination"
              @update:model-value="onDestinationPicked"
            />
            <div>
              <OButton
                variant="ghost"
                size="sm"
                icon-left="open-in-new"
                data-test="alert-library-install-open-destinations"
                @click="openDestinationsPage"
              >
                {{ t("alert_library.install.openDestinations") }}
              </OButton>
            </div>
          </template>
        </div>
      </OStep>

      <OStep
        :name="2"
        :title="t('alert_library.install.stepAlerts')"
        icon="checklist"
        :done="step > 2"
      >
        <div class="flex flex-col gap-3 pt-2" data-test="alert-library-install-alerts-step">
          <div class="flex items-center justify-between gap-2">
            <span
              class="text-text-secondary text-sm"
              data-test="alert-library-install-count"
              :data-selected="selectedIds.length"
              :data-total="candidates.length"
            >
              {{
                t("alert_library.install.selectedCount", {
                  count: selectedIds.length,
                  total: candidates.length,
                })
              }}
            </span>
            <div class="flex items-center gap-1">
              <OButton
                variant="ghost"
                size="sm"
                data-test="alert-library-install-select-all"
                @click="selectAll"
              >
                {{ t("alert_library.install.selectAll") }}
              </OButton>
              <OButton
                variant="ghost"
                size="sm"
                data-test="alert-library-install-clear"
                @click="clearSelection"
              >
                {{ t("alert_library.install.clear") }}
              </OButton>
            </div>
          </div>

          <ul
            class="border-border-default rounded-default divide-border-default max-h-80 divide-y overflow-y-auto border"
          >
            <li
              v-for="entry in candidates"
              :key="entry.id"
              class="flex items-center gap-3 px-3 py-2"
            >
              <OCheckbox
                :model-value="isSelected(entry.id)"
                size="sm"
                :label="raw(entry.title)"
                class="min-w-0 flex-1"
                :data-test="`alert-library-install-alert-${entry.id}`"
                @update:model-value="toggleEntry(entry.id, $event)"
              />
              <span class="text-text-secondary hidden shrink-0 truncate text-xs sm:inline">{{
                entry.id
              }}</span>
              <OTag
                type="severity"
                size="xs"
                :value="severityBadgeValue(entry.severity)"
                :label="severityLabel(t, entry.severity)"
                class="shrink-0"
              />
            </li>
          </ul>
        </div>
      </OStep>

      <OStep
        :name="3"
        :title="t('alert_library.install.stepFolder')"
        icon="folder"
        :done="step > 3"
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

      <OStep :name="4" :title="t('alert_library.install.stepTune')" icon="tune" :done="step > 4">
        <div class="flex flex-col gap-3 pt-2" data-test="alert-library-install-tune-step">
          <p class="text-text-secondary text-sm">{{ t("alert_library.install.tuneHint") }}</p>
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

      <OStep :name="5" :title="t('alert_library.install.stepInstall')" icon="download">
        <div class="flex flex-col gap-3 pt-2" data-test="alert-library-install-review-step">
          <dl
            class="border-border-default rounded-default grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border p-3 text-sm"
            data-test="alert-library-install-summary"
          >
            <dt class="text-text-secondary">{{ t("alert_library.install.stepDestination") }}</dt>
            <dd class="text-text-heading">{{ chosenDestination }}</dd>
            <dt class="text-text-secondary">{{ t("alert_library.install.stepFolder") }}</dt>
            <dd class="text-text-heading">{{ folderLabel }}</dd>
            <dt class="text-text-secondary">{{ t("alert_library.install.stepAlerts") }}</dt>
            <dd class="text-text-heading">{{ selectedIds.length }}</dd>
            <dt class="text-text-secondary">{{ t("alert_library.install.stepTune") }}</dt>
            <dd class="text-text-heading">{{ tuningSummary }}</dd>
          </dl>

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
                <div class="text-text-heading truncate text-sm">{{ result.title }}</div>
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
          @click="step -= 1"
        >
          {{ t("alert_library.install.back") }}
        </OButton>
        <OButton
          v-if="step < 5"
          variant="primary"
          size="sm-action"
          :disabled="!canAdvance"
          data-test="alert-library-install-next"
          @click="goNext"
        >
          {{ t("alert_library.install.next") }}
        </OButton>
        <OButton
          v-if="step === 5 && !hasRun"
          variant="primary"
          size="sm-action"
          :loading="isInstalling"
          data-test="alert-library-install-run"
          @click="install(selectedIds)"
        >
          {{ t("alert_library.install.run", { count: selectedIds.length }, selectedIds.length) }}
        </OButton>
        <OButton
          v-if="step === 5 && hasRun && failedIds.length > 0"
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
          v-if="step === 5 && hasRun"
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
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import type { AlertLibraryEntry, AlertLibraryFile } from "@/types/alertLibrary";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getFoldersListByType } from "@/utils/commons";

import { severityBadgeValue, severityLabel } from "./libraryFacets";
import { buildInstallPayload, InstallPayloadError, type InstallOverrides } from "./libraryInstall";
import { coerceTunable, readTunables, DEFAULT_TUNABLES } from "./libraryTunables";

const props = defineProps<{
  open: boolean;
  /** What the Alerts step offers — the gallery's current, filtered view. */
  entries: AlertLibraryEntry[];
  /** The drawer's alert and the file it already tuned. */
  seed: { entry: AlertLibraryEntry; file: AlertLibraryFile } | null;
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

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { loadAlertFile } = useAlertLibrary();

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

// ── destination ────────────────────────────────────────────────────────────
const existingDestinations = ref<string[]>([]);
const destinationsFailed = ref(false);
const chosenDestination = ref("");
const isLoadingDestinations = ref(false);

// ── selection, folder, tuning ──────────────────────────────────────────────
const selectedIds = ref<string[]>([]);
const folderId = ref("default");
const folderName = ref("");
const foldersLoading = ref(false);
const tuneEnabled = ref(false);
const tuneFrequency = ref(DEFAULT_TUNABLES.frequency);
const tuneSilence = ref(DEFAULT_TUNABLES.silence);

// ── run ────────────────────────────────────────────────────────────────────
/**
 * The alert set this run reports on, frozen when it starts.
 *
 * `candidates` derives from `props.entries`, which the gallery recomputes as
 * its async stream load settles. Rebuilding the result rows from it mid-run
 * would drop rows the user has not read yet.
 */
const roster = ref<AlertLibraryEntry[]>([]);
const results = ref<InstallResult[]>([]);
const isInstalling = ref(false);
const hasRun = ref(false);

const minutesSuffix = computed(() => t("alert_library.install.minutes"));

/**
 * What the Alerts step offers, and the only list install ever walks.
 *
 * `entries` is the gallery's FILTERED view, so the alert the drawer was opened
 * on may not be in it — the user can narrow the filters after opening the
 * drawer. Dropping the seed there would install nothing while showing a
 * selected count of one.
 */
const candidates = computed<AlertLibraryEntry[]>(() => {
  const seedEntry = props.seed?.entry;
  const offered =
    seedEntry && !props.entries.some((entry) => entry.id === seedEntry.id)
      ? [seedEntry, ...props.entries]
      : props.entries;

  // Deduped by id: the install walks this list, so a manifest that repeats an
  // entry would create that alert twice.
  const seen = new Set<string>();
  return offered.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
});

const destinationOptions = computed(() =>
  existingDestinations.value.map((name) => ({ label: raw(name), value: name })),
);

const hasDestinations = computed(() => existingDestinations.value.length > 0);

const folderLabel = computed<I18nText>(() => raw(folderName.value || folderId.value));

const tuningSummary = computed<I18nText>(() =>
  tuneEnabled.value
    ? t("alert_library.install.summaryTuningOverride", {
        frequency: tuneFrequency.value,
        silence: tuneSilence.value,
      })
    : t("alert_library.install.summaryTuningNone"),
);

const failedIds = computed(() =>
  results.value.filter((result) => result.status === "failed").map((result) => result.id),
);

const canAdvance = computed(() => {
  if (step.value === 1) return chosenDestination.value !== "";
  if (step.value === 2) return selectedIds.value.length > 0;
  return true;
});

// ── lifecycle ──────────────────────────────────────────────────────────────
const reset = () => {
  sessionToken += 1;
  step.value = 1;
  isLoadingDestinations.value = false;
  foldersLoading.value = false;
  existingDestinations.value = [];
  destinationsFailed.value = false;
  chosenDestination.value = "";
  folderId.value = "default";
  folderName.value = "";
  tuneEnabled.value = false;
  results.value = [];
  roster.value = [];
  hasRun.value = false;
  isInstalling.value = false;

  selectedIds.value = props.seed ? [props.seed.entry.id] : [];
  // Seed the bulk pair from the alert the user was just looking at, so the
  // fields open on values that mean something rather than on a global default.
  const tunables = props.seed ? readTunables(props.seed.file) : DEFAULT_TUNABLES;
  tuneFrequency.value = tunables.frequency;
  tuneSilence.value = tunables.silence;
};

/**
 * Only the newest open may write the destination state.
 *
 * Close-and-reopen is fast, the list request is not, and a reply from the
 * previous open landing after `reset()` would repopulate the picker — or flip
 * it into create mode — behind the current one. Same guard the drawer uses.
 */
let destinationsToken = 0;

/**
 * Bumped by every `reset()`. Anything that awaits must re-check it afterwards:
 * a create started before a close-and-reopen would otherwise finish against the
 * NEW session, writing a destination name the user never chose.
 */
let sessionToken = 0;

const loadDestinations = async () => {
  const token = ++destinationsToken;
  isLoadingDestinations.value = true;
  let names: string[] = [];
  let failed = false;
  try {
    const response = await destinationService.list({
      org_identifier: orgIdentifier(),
      page_num: 1,
      page_size: 100000,
      sort_by: "name",
      desc: false,
      module: "alert",
    });
    const list = Array.isArray(response?.data) ? response.data : [];
    names = list
      .map((destination: { name?: string }) => destination?.name)
      .filter((name: unknown): name is string => typeof name === "string" && name !== "");
  } catch {
    failed = true;
  }

  if (token !== destinationsToken) return;

  destinationsFailed.value = failed;
  existingDestinations.value = names;
  isLoadingDestinations.value = false;
};

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reset();
    void loadDestinations();
  },
  { immediate: true },
);

// The folder picker reads the store and only refreshes itself on `onActivated`,
// which a dialog never fires. Fetch when the step is reached.
watch(step, (value) => {
  if (value !== 3) return;
  const token = sessionToken;
  foldersLoading.value = true;
  void getFoldersListByType(store, "alerts")
    .catch(() => {
      // The picker still offers "default", which is a valid folder.
    })
    .finally(() => {
      if (token === sessionToken) foldersLoading.value = false;
    });
});

const onOpenChange = (value: boolean) => {
  if (!value && isInstalling.value) return;
  emit("update:open", value);
};

// ── destination step ───────────────────────────────────────────────────────
const onDestinationPicked = (value: unknown) => {
  chosenDestination.value = typeof value === "string" ? value : "";
};

const errorText = (error: unknown): I18nText => {
  // The builder refuses a file it cannot read by CODE, because it has no `t`.
  // Resolving it here is what keeps that refusal translatable instead of
  // showing the user the literal string "unreadable_conditions".
  if (error instanceof InstallPayloadError) {
    return t("alert_library.install.unreadableConditions");
  }
  const response = (error as { response?: { data?: { message?: string } } })?.response;
  return (
    raw(response?.data?.message) ||
    raw((error as { message?: string })?.message) ||
    t("alert_library.install.unknownError")
  );
};

const openDestinationsPage = () => {
  const url = router.resolve({
    name: "alertDestinations",
    query: {
      action: "add",
      org_identifier: orgIdentifier(),
    },
  }).href;
  window.open(url, "_blank", "noopener");
};

const goNext = () => {
  step.value += 1;
};

// ── alerts step ────────────────────────────────────────────────────────────
const isSelected = (id: string) => selectedIds.value.includes(id);

const toggleEntry = (id: string, checked: unknown) => {
  if (checked === true) {
    if (!isSelected(id)) selectedIds.value = [...selectedIds.value, id];
  } else {
    selectedIds.value = selectedIds.value.filter((selected) => selected !== id);
  }
};

const selectAll = () => {
  selectedIds.value = candidates.value.map((entry) => entry.id);
};

const clearSelection = () => {
  selectedIds.value = [];
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

const install = async (ids: string[]) => {
  if (isInstalling.value) return;
  // Defensive: every path to step 5 sets this, but installing against an empty
  // destination is a guaranteed 400 for the whole batch, so never start one.
  if (!chosenDestination.value) return;

  // Freeze the roster on the FIRST run; a retry reports on the same set.
  if (!hasRun.value) {
    roster.value = candidates.value.filter((entry) => selectedIds.value.includes(entry.id));
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

  // Sequential on purpose: one rejected create must not take the rest of the
  // batch with it, and a burst of parallel POSTs is what rate limits.
  try {
    for (const entry of batch) {
      setResult(entry.id, { status: "running", message: undefined });
      try {
        const file =
          props.seed && props.seed.entry.id === entry.id
            ? props.seed.file
            : await loadAlertFile(entry);

        const payload = buildInstallPayload({
          entry,
          file,
          folderId: folderId.value,
          destination: chosenDestination.value,
          owner: store.state.userInfo?.email ?? "",
          timezone: store.state.timezone,
          overrides: batchOverrides,
        });

        await alertsService.create_by_alert_id(orgIdentifier(), payload, folderId.value);
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

  if (installedNow.length > 0) {
    emit("installed", { entryIds: installedNow });
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
