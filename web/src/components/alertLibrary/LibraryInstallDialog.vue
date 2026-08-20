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
            :content="t('alert_library.install.destinationsLoadFailed')"
            data-test="alert-library-install-destinations-failed"
          />

          <template v-if="destinationMode === 'existing'">
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
                icon-left="add"
                data-test="alert-library-install-destination-create"
                @click="destinationMode = 'create'"
              >
                {{ t("alert_library.install.destinationCreate") }}
              </OButton>
            </div>
          </template>

          <template v-else>
            <PrebuiltDestinationSelector :model-value="createType" @select="onCreateTypeSelected" />

            <OBanner
              v-if="createType === 'custom'"
              variant="info"
              icon="info"
              data-test="alert-library-install-custom-hint"
            >
              <div class="flex flex-col gap-2">
                <span class="text-sm">{{ t("alert_library.install.customBody") }}</span>
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

            <template v-else-if="createFields.length > 0">
              <OInput
                :model-value="createName"
                size="sm"
                required
                :label="t('alert_library.install.destinationName')"
                data-test="alert-library-install-destination-name"
                @update:model-value="createName = String($event)"
              />

              <OSelect
                v-for="field in selectFields"
                :key="field.key"
                :model-value="credentialText(field.key)"
                :options="credentialOptions(field)"
                size="sm"
                :label="t(field.labelKey)"
                :error-message="credentialErrors[field.key]"
                :data-test="`alert-library-install-credential-${field.key}`"
                @update:model-value="setCredential(field.key, $event)"
              />

              <OCheckbox
                v-for="field in toggleFields"
                :key="field.key"
                :model-value="credentials[field.key] === true"
                size="sm"
                :label="t(field.labelKey)"
                :data-test="`alert-library-install-credential-${field.key}`"
                @update:model-value="setCredential(field.key, $event)"
              />

              <OInput
                v-for="field in textFields"
                :key="field.key"
                :model-value="credentialText(field.key)"
                :type="field.type === 'password' ? 'password' : 'text'"
                size="sm"
                :required="field.required"
                :label="t(field.labelKey)"
                :help-text="field.hintKey ? t(field.hintKey) : field.hint"
                :error-message="credentialErrors[field.key]"
                :data-test="`alert-library-install-credential-${field.key}`"
                @update:model-value="setCredential(field.key, $event)"
              />

              <div class="flex items-center gap-2">
                <OButton
                  variant="outline"
                  size="sm"
                  icon-left="send"
                  :loading="isTesting"
                  data-test="alert-library-install-destination-test"
                  @click="runTest"
                >
                  {{ t("alert_library.install.destinationTest") }}
                </OButton>
                <span
                  v-if="testMessage"
                  class="text-xs"
                  :class="testPassed ? 'text-status-positive' : 'text-status-negative'"
                  data-test="alert-library-install-destination-test-result"
                >
                  {{ testMessage }}
                </span>
              </div>
            </template>

            <div v-if="existingDestinations.length > 0">
              <OButton
                variant="ghost"
                size="sm"
                icon-left="arrow-back"
                data-test="alert-library-install-destination-existing"
                @click="destinationMode = 'existing'"
              >
                {{ t("alert_library.install.destinationUseExisting") }}
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
                :data-test="`alert-library-install-alert-${entry.id}`"
                @update:model-value="toggleEntry(entry.id, $event)"
              />
              <div class="min-w-0 flex-1">
                <div class="text-text-heading truncate text-sm">{{ entry.title }}</div>
                <div class="text-text-secondary truncate text-xs">{{ entry.id }}</div>
              </div>
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
          <SelectFolderDropDown
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
          :disabled="isInstalling || isCreatingDestination"
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
          :loading="isCreatingDestination"
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

import PrebuiltDestinationSelector from "@/components/alerts/PrebuiltDestinationSelector.vue";
import SelectFolderDropDown from "@/components/common/sidebar/SelectFolderDropDown.vue";
import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { usePrebuiltDestinations } from "@/composables/usePrebuiltDestinations";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
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
import { getPrebuiltConfig } from "@/utils/prebuilt-templates";
import type { CredentialField } from "@/utils/prebuilt-templates/types";

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
   * What this run actually created. Alerts created behind a dialog are
   * invisible on the list underneath it until something says they exist —
   * ImportAlert emits `update:alerts` for the same reason. Failures are
   * excluded: nothing was created for those.
   */
  (e: "installed", payload: { folderId: string; ids: string[] }): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const { loadAlertFile } = useAlertLibrary();

/** Optional-chained: a missing organization must not throw out of a click handler. */
const orgIdentifier = (): string => store.state.selectedOrganization?.identifier ?? "";
const { validateCredentials, testDestination, createDestination } = usePrebuiltDestinations();

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
const destinationMode = ref<"existing" | "create">("existing");
const chosenDestination = ref("");
const createType = ref("");
const createName = ref("");
const credentials = ref<Record<string, unknown>>({});
const credentialErrors = ref<Record<string, I18nText>>({});
const isCreatingDestination = ref(false);
const isTesting = ref(false);
const testMessage = ref<I18nText | "">("");
const testPassed = ref(false);

// ── selection, folder, tuning ──────────────────────────────────────────────
const selectedIds = ref<string[]>([]);
const folderId = ref("default");
const folderName = ref("");
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

const createFields = computed<CredentialField[]>(() =>
  createType.value ? (getPrebuiltConfig(createType.value)?.credentialFields ?? []) : [],
);

/** Credentials are held as `unknown`; the text and select fields render strings. */
const credentialText = (key: string): string => {
  const value = credentials.value[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

/**
 * The prebuilt configs already resolve these labels through `gt()`, but declare
 * them as plain `string`, which drops the `I18nText` brand OSelect requires.
 * `raw()` re-attaches it — it is not translating anything here.
 */
const credentialOptions = (field: CredentialField) =>
  (field.options ?? []).map((option) => ({ label: raw(option.label), value: option.value }));
const selectFields = computed(() => createFields.value.filter((f) => f.type === "select"));
const toggleFields = computed(() => createFields.value.filter((f) => f.type === "toggle"));
const textFields = computed(() =>
  createFields.value.filter((f) => f.type !== "select" && f.type !== "toggle"),
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

const failedIds = computed(() =>
  results.value.filter((result) => result.status === "failed").map((result) => result.id),
);

const canAdvance = computed(() => {
  if (step.value === 1) {
    if (destinationMode.value === "existing") return chosenDestination.value !== "";
    // A name plus a known prebuilt type — "custom" has no inline form.
    return createName.value.trim() !== "" && createFields.value.length > 0;
  }
  if (step.value === 2) return selectedIds.value.length > 0;
  return true;
});

// ── lifecycle ──────────────────────────────────────────────────────────────
const reset = () => {
  sessionToken += 1;
  step.value = 1;
  isCreatingDestination.value = false;
  isTesting.value = false;
  existingDestinations.value = [];
  destinationsFailed.value = false;
  destinationMode.value = "existing";
  chosenDestination.value = "";
  createType.value = "";
  createName.value = "";
  credentials.value = {};
  credentialErrors.value = {};
  testMessage.value = "";
  testPassed.value = false;
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
  // Nothing to pick means the picker is a dead end; open on creation instead.
  if (names.length === 0) destinationMode.value = "create";
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
  if (value === 3) {
    void getFoldersListByType(store, "alerts").catch(() => {
      // The picker still offers "default", which is a valid folder.
    });
  }
});

const onOpenChange = (value: boolean) => {
  if (!value && isInstalling.value) return;
  emit("update:open", value);
};

// ── destination step ───────────────────────────────────────────────────────
const onDestinationPicked = (value: unknown) => {
  chosenDestination.value = typeof value === "string" ? value : "";
};

const onCreateTypeSelected = (value: string) => {
  createType.value = value;
  credentials.value = {};
  credentialErrors.value = {};
  testMessage.value = "";
};

const setCredential = (key: string, value: unknown) => {
  credentials.value = { ...credentials.value, [key]: value };
  const { [key]: _cleared, ...rest } = credentialErrors.value;
  credentialErrors.value = rest;
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

const runTest = async () => {
  const token = sessionToken;
  isTesting.value = true;
  testMessage.value = "";
  try {
    const result = await testDestination(createType.value, credentials.value);
    if (token !== sessionToken) return;
    testPassed.value = result.success;
    testMessage.value = result.success
      ? t("alert_library.install.destinationTestPassed")
      : t("alert_library.install.destinationTestFailed", { error: result.error ?? "" });
  } catch (error) {
    if (token !== sessionToken) return;
    testPassed.value = false;
    testMessage.value = t("alert_library.install.destinationTestFailed", {
      error: String(errorText(error)),
    });
  } finally {
    if (token === sessionToken) isTesting.value = false;
  }
};

/** Creates the destination, and only advances once it exists. */
const createAndUse = async (): Promise<boolean> => {
  // The longest await in the wizard, and the most destructive to finish late:
  // a create that resolves after a close-and-reopen would adopt the CURRENT
  // (reset, empty) name as the destination and self-advance the step, so every
  // alert POSTs `destinations: [""]` behind a summary claiming all is well.
  const token = sessionToken;
  const name = createName.value.trim();

  isCreatingDestination.value = true;
  try {
    // Inside the try: an unknown type makes validateCredentials throw, and out
    // here that became an unhandled rejection with the wizard silently frozen.
    const validation = validateCredentials(createType.value, credentials.value);
    if (!validation.isValid) {
      credentialErrors.value = Object.fromEntries(
        Object.entries(validation.errors).map(([key, message]) => [key, raw(message)]),
      );
      return false;
    }

    await createDestination(createType.value, name, credentials.value);
    if (token !== sessionToken) return false;

    chosenDestination.value = name;
    destinationMode.value = "existing";
    await loadDestinations();
    return token === sessionToken;
  } catch (error) {
    if (token !== sessionToken) return false;
    toast({
      variant: "error",
      message: t("alert_library.install.destinationCreateFailed", {
        error: String(errorText(error)),
      }),
    });
    return false;
  } finally {
    // A stale session already had this cleared by `reset()`.
    if (token === sessionToken) isCreatingDestination.value = false;
  }
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

const goNext = async () => {
  // OButton already blocks a click while `loading`, but the guard belongs here
  // too: a second create means a second destination, silently.
  if (isCreatingDestination.value) return;
  const token = sessionToken;

  if (step.value === 1 && destinationMode.value === "create") {
    if (!(await createAndUse())) return;
    // Never advance a session the user has already left.
    if (token !== sessionToken) return;
  }
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

  const existing = new Map(results.value.map((result) => [result.id, result]));
  results.value = roster.value.map(
    (entry) =>
      (ids.includes(entry.id) ? undefined : existing.get(entry.id)) ?? {
        id: entry.id,
        title: raw(entry.title),
        status: "pending" as const,
      },
  );

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
    emit("installed", { folderId: folderId.value, ids: installedNow });
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
