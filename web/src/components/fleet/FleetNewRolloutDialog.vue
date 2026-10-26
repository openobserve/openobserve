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

<template>
  <ODialog
    :open="open"
    size="md"
    :title="t('fleet.fleets.deployVersion')"
    :form-id="FORM_ID"
    :primary-button-label="t('fleet.fleets.changeVersion')"
    :primary-button-disabled="!seeded || listsForbidden || listsFailed"
    :secondary-button-label="t('common.cancel')"
    data-test="fleet-new-rollout-dialog"
    @update:open="emit('update:open', $event)"
    @click:secondary="emit('update:open', false)"
  >
    <OEmptyState
      v-if="open && listsForbidden"
      size="block"
      preset="no-access"
      data-test="fleet-new-rollout-dialog-forbidden"
    />
    <OEmptyState
      v-else-if="open && listsFailed"
      size="block"
      preset="load-error"
      data-test="fleet-new-rollout-dialog-error"
      @action="retryLists"
    />
    <div
      v-else-if="open && !seeded"
      class="flex justify-center py-6"
      data-test="fleet-new-rollout-dialog-loading"
    >
      <OSpinner />
    </div>
    <OForm v-else-if="open" :id="FORM_ID" class="flex flex-col gap-5" :form="form">
      <OFormSelect
        name="fleet"
        :label="t('fleet.collectors.fleet')"
        :options="fleetOptions"
        :disabled="!!fleetId"
        required
        data-test="fleet-new-rollout-dialog-fleet"
        @update:model-value="onFleetPicked"
      />
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <OFormSelect
          name="config"
          :label="t('fleet.common.configuration')"
          :options="configOptions"
          :disabled="!!toVersion"
          required
          data-test="fleet-new-rollout-dialog-config"
          @update:model-value="onConfigPicked"
        />
        <OFormSelect
          name="version"
          :label="t('fleet.rollouts.version')"
          :options="versionOptions"
          :searchable="false"
          required
          data-test="fleet-new-rollout-dialog-version"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <OText :id="startLabelId" variant="label">{{ t("fleet.rollouts.start") }}</OText>
        <OFormToggleGroup
          name="start"
          :aria-labelledby="startLabelId"
          data-test="fleet-new-rollout-dialog-start"
        >
          <OToggleGroupItem value="now" size="sm">{{
            t("fleet.rollouts.startNow")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="at" size="sm" :disabled="emptyFleet">{{
            t("fleet.rollouts.startAt")
          }}</OToggleGroupItem>
        </OFormToggleGroup>
        <OFormInput
          v-if="start === 'at'"
          name="when"
          type="datetime-local"
          :label="t('fleet.rollouts.startTime')"
          required
          data-test="fleet-new-rollout-dialog-when"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <OText :id="batchLabelId" variant="label">{{ t("fleet.rollouts.batching") }}</OText>
        <OFormToggleGroup
          name="batching"
          :aria-labelledby="batchLabelId"
          data-test="fleet-new-rollout-dialog-batching"
        >
          <OToggleGroupItem value="one" size="sm">{{
            t("fleet.rollouts.oneBatch")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="canary" size="sm">{{
            t("fleet.badge.canary")
          }}</OToggleGroupItem>
          <OToggleGroupItem value="progressive" size="sm">{{
            t("fleet.badge.progressive")
          }}</OToggleGroupItem>
        </OFormToggleGroup>
        <div v-if="batching === 'canary'" class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <OFormInput
            name="first"
            type="number"
            :label="t('fleet.rollouts.firstBatch')"
            data-test="fleet-new-rollout-dialog-first"
          />
        </div>
        <div v-else-if="batching === 'progressive'" class="grid grid-cols-1 gap-4 md:grid-cols-3">
          <OFormInput
            name="initial"
            type="number"
            :label="t('fleet.rollouts.initialBatch')"
            data-test="fleet-new-rollout-dialog-initial"
          />
          <OFormInput
            name="multiplier"
            type="number"
            :label="t('fleet.rollouts.multiplier')"
            data-test="fleet-new-rollout-dialog-multiplier"
          />
          <OFormInput
            name="max"
            type="number"
            :label="t('fleet.rollouts.maxBatch')"
            data-test="fleet-new-rollout-dialog-max"
          />
        </div>
        <div
          class="rounded-default border-border-default flex flex-col gap-0.5 border px-3 py-2"
          aria-live="polite"
          data-test="fleet-new-rollout-dialog-plan"
        >
          <OText variant="body-strong" class="tabular-nums">{{ planLine }}</OText>
          <OText
            v-if="preview.preview.value?.collapsed"
            variant="meta"
            data-test="fleet-new-rollout-dialog-collapsed"
            >{{ t("fleet.rollouts.collapsed") }}</OText
          >
          <OText variant="meta" data-test="fleet-new-rollout-dialog-timeout">{{
            t("fleet.rollouts.phaseTimeoutNote", { minutes: phaseTimeoutMin })
          }}</OText>
        </div>
      </div>

      <div class="flex flex-col gap-3">
        <OText variant="label">{{ t("fleet.rollouts.safety") }}</OText>
        <div class="flex flex-col gap-0.5">
          <OFormCheckbox
            name="verify"
            :label="t('fleet.rollouts.verify')"
            data-test="fleet-new-rollout-dialog-verify"
          />
          <OText variant="meta">{{ t("fleet.rollouts.verifyHelp") }}</OText>
        </div>
        <div class="flex flex-col gap-0.5">
          <OFormCheckbox
            name="autoRollback"
            :label="t('fleet.rollouts.autoRollback')"
            data-test="fleet-new-rollout-dialog-auto-rollback"
          />
          <OText variant="meta">{{ t("fleet.rollouts.autoRollbackHelp") }}</OText>
        </div>
      </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query/useOrgId";
import { setFleetDesiredMutation } from "@/services/fleet.queries";
import type { FleetSetDesiredRequest } from "@/services/fleet";
import { raw, useI18nTyped } from "@/types/i18n";
import { makeRolloutSchema, requestOf, type RolloutForm } from "./FleetNewRolloutDialog.schema";
import { useRolloutText } from "./rolloutText";
import {
  isForbidden,
  serverMessage,
  useFleetConfigs,
  useFleetRollouts,
  useFleetSettings,
  useFleets,
  usePlanPreview,
} from "./useFleetApi";

const props = defineProps<{
  open: boolean;
  config?: string;
  /** Preselected version; the configuration is then fixed. */
  toVersion?: number;
  /** Preselected fleet, which is then fixed. */
  fleetId?: string;
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  submitted: [];
}>();

const FORM_ID = "fleet-new-rollout-form";
// The preview is a server round trip, so typing in a count waits for a pause.
const PREVIEW_DEBOUNCE_MS = 300;
const DEFAULT_PHASE_TIMEOUT_SECS = 1800;

const { t } = useI18nTyped();
const { planText } = useRolloutText();
const orgId = useOrgId();
const setDesired = useMutation(() => setFleetDesiredMutation(orgId.value));
const configs = useFleetConfigs(() => props.open);
const fleets = useFleets(() => props.open);
const rollouts = useFleetRollouts(undefined, () => props.open);
const orgSettings = useFleetSettings();
const listsForbidden = computed(() => configs.forbidden.value || isForbidden(fleets.error.value));
const listsFailed = computed(
  () =>
    (!!configs.error.value && !configs.rows.value.length) ||
    (!!fleets.error.value && !fleets.rows.value.length),
);
const retryLists = () => Promise.all([configs.refetch(), fleets.refetch()]);

const blank = (fleet: string, config: string, version: number): RolloutForm => ({
  fleet,
  config,
  version,
  start: "now",
  when: "",
  batching: "one",
  first: 1,
  initial: 1,
  multiplier: 3,
  max: 100,
  verify: true,
  autoRollback: true,
});

const form = useOForm<RolloutForm>({
  defaultValues: blank("", "", 0),
  schema: makeRolloutSchema(t),
  onSubmit: submit,
});

const start = form.useStore((s) => s.values.start);
const batching = form.useStore((s) => s.values.batching);
const values = form.useStore((s) => s.values);
const chosenFleet = form.useStore((s) => s.values.fleet);
const chosenConfig = form.useStore((s) => s.values.config);

const startLabelId = useId();
const batchLabelId = useId();

const readableFleets = computed(() => fleets.rows.value.filter((f) => f.readable));
const fleetOptions = computed(() =>
  readableFleets.value.map((f) => ({ label: raw(f.name), value: f.id })),
);
const fleetRow = computed(() => readableFleets.value.find((f) => f.id === chosenFleet.value));
const emptyFleet = computed(() => (fleetRow.value?.collectors ?? 0) === 0);

// The server refuses a schedule for a fleet with no members.
watch(emptyFleet, (empty) => {
  if (empty && start.value === "at") form.setFieldValue("start", "now");
});

const phaseTimeoutMin = computed(() => {
  const secs =
    fleetRow.value?.settings.phase_timeout_secs ??
    orgSettings.settings.value?.fleet_defaults?.phase_timeout_secs ??
    DEFAULT_PHASE_TIMEOUT_SECS;
  return Math.round(secs / 60);
});

const published = computed(() => configs.rows.value.filter((c) => c.version > 0));
const configOptions = computed(() =>
  published.value.map((c) => ({ label: raw(c.id), value: c.id })),
);
const latestOf = (id: string) => published.value.find((c) => c.id === id)?.version ?? 0;

// A version whose rollout halted or was rolled back is marked, so it is not picked again by accident.
const failedVersions = computed(
  () =>
    new Set(
      rollouts.rows.value
        .filter((r) => r.status === "halted" || r.status === "rolled_back")
        .map((r) => `${r.config}@${r.toVersion}`),
    ),
);
const hasFailed = (config: string, version: number) =>
  failedVersions.value.has(`${config}@${version}`);

const versionOptions = computed(() => {
  const latest = latestOf(chosenConfig.value);
  return Array.from({ length: latest }, (_, i) => latest - i).map((v) => ({
    label: hasFailed(chosenConfig.value, v)
      ? t("fleet.rollouts.versionFailedBefore", { version: v })
      : t("fleet.common.versionShort", { version: v }),
    value: v,
  }));
});

function defaultVersion(fleetId: string, config: string) {
  const desired = readableFleets.value.find((f) => f.id === fleetId)?.desired;
  for (let v = latestOf(config); v > 0; v--) {
    const current = desired?.config === config && desired.version === v;
    if (!current && !hasFailed(config, v)) return v;
  }
  return 0;
}
const desiredOf = (id: string) => readableFleets.value.find((f) => f.id === id)?.desired?.config;

// Defaults depend on these lists, so the form is seeded once per opening, after they load.
const seeded = ref(false);
watch(
  () => [
    props.open,
    configs.loading.value,
    fleets.loading.value,
    rollouts.loading.value,
    listsFailed.value || listsForbidden.value,
  ],
  ([open, configsLoading, fleetsLoading, rolloutsLoading, listsUnusable]) => {
    if (!open) {
      seeded.value = false;
      return;
    }
    if (seeded.value || configsLoading || fleetsLoading || rolloutsLoading || listsUnusable) return;
    const ids = readableFleets.value.map((f) => f.id);
    const fleet = props.fleetId ?? (ids.includes("default") ? "default" : (ids[0] ?? "default"));
    const config = props.config ?? desiredOf(fleet) ?? "";
    form.reset(blank(fleet, config, props.toVersion ?? defaultVersion(fleet, config)));
    seeded.value = true;
  },
  { immediate: true },
);

function onFleetPicked(id: unknown) {
  if (props.toVersion != null) return;
  form.setFieldValue("version", defaultVersion(String(id ?? ""), form.state.values.config));
}

function onConfigPicked(id: unknown) {
  form.setFieldValue("version", defaultVersion(form.state.values.fleet, String(id ?? "")));
}

const previewBody = ref<FleetSetDesiredRequest | null>(null);
let previewTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  values,
  (v) => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      previewBody.value = seeded.value ? requestOf(v) : null;
    }, PREVIEW_DEBOUNCE_MS);
  },
  { deep: true, immediate: true },
);
onBeforeUnmount(() => clearTimeout(previewTimer));

const preview = usePlanPreview(
  () => chosenFleet.value || null,
  () => previewBody.value,
  () => props.open && seeded.value,
);

const planLine = computed(() => {
  const p = preview.preview.value;
  if (emptyFleet.value) return t("fleet.rollouts.emptyFleet");
  if (!p) return preview.error.value ? t("fleet.rollouts.planUnavailable") : raw("—");
  return planText(p.phases);
});

async function submit(value: RolloutForm) {
  const body = requestOf(value);
  if (!body) return;
  try {
    await setDesired.mutateAsync({ fleet: value.fleet, body });
    emit("update:open", false);
    emit("submitted");
    toast({ variant: "success", message: t("fleet.configs.rolloutCreated") });
  } catch (err) {
    toast({
      variant: "error",
      message: raw(serverMessage(err)) || t("fleet.common.requestFailed"),
    });
  }
}
</script>
