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
    :title="t('fleet.fleets.changeVersion')"
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
        :disabled="!!fleetId || !!retryOf"
        required
        data-test="fleet-new-rollout-dialog-fleet"
        @update:model-value="onFleetPicked"
      />
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <OFormSelect
          name="config"
          :label="t('fleet.common.configuration')"
          :options="configOptions"
          :disabled="!!toVersion || !!retryOf"
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
        <OText :id="strategyLabelId" variant="label">{{ t("fleet.rollouts.strategy") }}</OText>
        <OFormToggleGroup
          name="strategy"
          :aria-labelledby="strategyLabelId"
          data-test="fleet-new-rollout-dialog-strategy"
        >
          <OToggleGroupItem
            v-for="s in strategies"
            :key="s.value"
            :value="s.value"
            size="sm"
            :disabled="s.value === 'scheduled' && emptyFleet"
          >
            {{ s.label }}
          </OToggleGroupItem>
        </OFormToggleGroup>
        <OText v-if="emptyFleet" variant="meta" data-test="fleet-new-rollout-dialog-empty-fleet">{{
          t("fleet.rollouts.emptyFleet")
        }}</OText>
      </div>
      <div v-if="batched" class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <OFormInput
          name="initial"
          type="number"
          :label="t('fleet.rollouts.initialBatch')"
          data-test="fleet-new-rollout-dialog-initial"
        />
        <template v-if="strategy === 'progressive'">
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
        </template>
      </div>
      <OFormInput
        v-if="strategy === 'scheduled'"
        name="when"
        type="datetime-local"
        :label="t('fleet.rollouts.startAt')"
        required
        data-test="fleet-new-rollout-dialog-when"
      />
      <div class="flex flex-col gap-2">
        <OText variant="label">{{ t("fleet.rollouts.safety") }}</OText>
        <template v-if="batched">
          <OFormSwitch
            name="gates"
            :label="t('fleet.rollouts.useGates')"
            :disabled="!gatesAllowed"
            data-test="fleet-new-rollout-dialog-gates"
            @change="gatesChoice = !!$event"
          />
          <OText v-if="!gatesAllowed && !emptyFleet" variant="meta">{{
            t("fleet.rollouts.gatesNeedPhases")
          }}</OText>
        </template>
        <OFormSwitch
          name="autoRollback"
          :label="t('fleet.rollouts.autoRollback')"
          data-test="fleet-new-rollout-dialog-auto-rollback"
        />
      </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { useMutation } from "@tanstack/vue-query";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormToggleGroup from "@/lib/core/ToggleGroup/OFormToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query/useOrgId";
import { setFleetDesiredMutation } from "@/services/fleet.queries";
import { raw, useI18nTyped } from "@/types/i18n";
import type { FleetSetDesiredRequest } from "@/services/fleet";
import { makeRolloutSchema, planHasPhases, type RolloutForm } from "./FleetNewRolloutDialog.schema";
import {
  isForbidden,
  serverMessage,
  useFleetConfigs,
  useFleetRollouts,
  useFleets,
  type RolloutRow,
} from "./useFleetApi";

const props = defineProps<{
  open: boolean;
  config?: string;
  /** Preselected version; the configuration is then fixed. */
  toVersion?: number;
  /** Preselected fleet, which is then fixed. */
  fleetId?: string;
  /** A halted revision to retry: its fleet and version are fixed, its strategy and safety kept. */
  retryOf?: RolloutRow | null;
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  submitted: [];
}>();

const FORM_ID = "fleet-new-rollout-form";

const { t } = useI18nTyped();
const orgId = useOrgId();
const setDesired = useMutation(() => setFleetDesiredMutation(orgId.value));
const configs = useFleetConfigs(() => props.open);
const fleets = useFleets(() => props.open);
const rollouts = useFleetRollouts(undefined, () => props.open);
const listsForbidden = computed(() => configs.forbidden.value || isForbidden(fleets.error.value));
const listsFailed = computed(
  () =>
    (!!configs.error.value && !configs.rows.value.length) ||
    (!!fleets.error.value && !fleets.rows.value.length),
);
const retryLists = () => Promise.all([configs.refetch(), fleets.refetch()]);

const defaults = (fleet: string, config: string, version: number): RolloutForm => ({
  fleet,
  members: membersOf(fleet),
  config,
  version,
  strategy: "immediate",
  initial: 1,
  multiplier: 5,
  max: 100,
  when: "",
  gates: planHasPhases(membersOf(fleet), 1),
  autoRollback: true,
});

const form = useOForm<RolloutForm>({
  defaultValues: {
    fleet: "",
    members: 0,
    config: "",
    version: 0,
    strategy: "immediate",
    initial: 1,
    multiplier: 5,
    max: 100,
    when: "",
    gates: false,
    autoRollback: true,
  },
  schema: makeRolloutSchema(t),
  onSubmit: submit,
});

const strategy = form.useStore((s) => s.values.strategy);
const batched = computed(() => strategy.value === "canary" || strategy.value === "progressive");
const members = form.useStore((s) => s.values.members);
const emptyFleet = computed(() => members.value === 0);
const gatesAllowed = form.useStore((s) => planHasPhases(s.values.members, s.values.initial));

const strategyLabelId = useId();
// The operator's explicit gates choice survives the plan dropping to one phase and back; untouched, gates default on.
const gatesChoice = ref<boolean | null>(null);
watch(gatesAllowed, (allowed) =>
  form.setFieldValue("gates", allowed ? (gatesChoice.value ?? true) : false),
);
// The server refuses a schedule for a fleet with no members.
watch(emptyFleet, (empty) => {
  if (empty && strategy.value === "scheduled") form.setFieldValue("strategy", "immediate");
});

const strategies = computed(() => [
  { value: "immediate", label: t("fleet.badge.immediate") },
  { value: "canary", label: t("fleet.badge.canary") },
  { value: "progressive", label: t("fleet.badge.progressive") },
  { value: "scheduled", label: t("fleet.badge.scheduledStrategy") },
]);

const readableFleets = computed(() => fleets.rows.value.filter((f) => f.readable));
const fleetOptions = computed(() =>
  readableFleets.value.map((f) => ({ label: raw(f.name), value: f.id })),
);
const membersOf = (id: string) => readableFleets.value.find((f) => f.id === id)?.collectors ?? 0;

const published = computed(() => configs.rows.value.filter((c) => c.version > 0));
const chosenConfig = form.useStore((s) => s.values.config);

const configOptions = computed(() =>
  published.value.map((c) => ({ label: raw(c.id), value: c.id })),
);
const versionOptions = computed(() => {
  const latest = published.value.find((c) => c.id === chosenConfig.value)?.version ?? 0;
  return Array.from({ length: latest }, (_, i) => latest - i).map((v) => ({
    label: hasFailed(chosenConfig.value, v)
      ? t("fleet.rollouts.versionFailedBefore", { version: v })
      : t("fleet.common.versionShort", { version: v }),
    value: v,
  }));
});

const latestOf = (id: string) => published.value.find((c) => c.id === id)?.version ?? 0;
// A rollout that halted, including one later auto-reverted, carries its failure.
const failedVersions = computed(
  () =>
    new Set(
      rollouts.rows.value
        .filter((r) => r.status === "halted" || r.failure)
        .map((r) => `${r.config}@${r.toVersion}`),
    ),
);
const hasFailed = (config: string, version: number) =>
  failedVersions.value.has(`${config}@${version}`);
function defaultVersion(fleetId: string, config: string) {
  // Without a fresh rollouts read the failed versions are unknown, so the user picks.
  if (rolloutsRead.value !== "done") return 0;
  const desired = readableFleets.value.find((f) => f.id === fleetId)?.desired;
  for (let v = latestOf(config); v > 0; v--) {
    const current = desired?.config === config && desired.version === v;
    if (!current && !hasFailed(config, v)) return v;
  }
  return 0;
}
const desiredOf = (id: string) => readableFleets.value.find((f) => f.id === id)?.desired?.config;

// Re-read on every opening: a cached list can miss a version that failed elsewhere moments ago.
const rolloutsRead = ref<"pending" | "done" | "failed">("pending");
let openings = 0;
watch(
  () => props.open,
  async (open) => {
    rolloutsRead.value = "pending";
    if (!open) return;
    const opening = ++openings;
    const res = await rollouts.refetch();
    if (opening === openings && props.open) rolloutsRead.value = res.isError ? "failed" : "done";
  },
  { immediate: true },
);

// Defaults depend on these lists, so the form is seeded once per opening, after they load.
const seeded = ref(false);
watch(
  () => [
    props.open,
    configs.loading.value,
    fleets.loading.value,
    rolloutsRead.value === "pending",
    listsFailed.value || listsForbidden.value,
  ],
  ([open, configsLoading, fleetsLoading, rolloutsPending, listsUnusable]) => {
    if (!open) {
      seeded.value = false;
      return;
    }
    if (seeded.value || configsLoading || fleetsLoading || rolloutsPending || listsUnusable) return;
    const r = props.retryOf;
    const ids = readableFleets.value.map((f) => f.id);
    const fleet =
      r?.fleetId ?? props.fleetId ?? (ids.includes("default") ? "default" : (ids[0] ?? "default"));
    const config = r?.config ?? props.config ?? desiredOf(fleet) ?? "";
    const seed = defaults(
      fleet,
      config,
      r?.toVersion ?? props.toVersion ?? defaultVersion(fleet, config),
    );
    form.reset(r ? { ...seed, ...retryValues(r) } : seed);
    gatesChoice.value = r ? r.gates.length > 0 : null;
    seeded.value = true;
  },
  { immediate: true },
);

// The response carries no batch, so a progressive retry re-enters its multiplier and cap.
function retryValues(r: RolloutRow): Partial<RolloutForm> {
  return {
    strategy: r.strategy,
    initial: r.phases[0]?.size ?? 1,
    gates: r.gates.length > 0,
    autoRollback: r.autoRollback,
  };
}

function onFleetPicked(id: unknown) {
  const fleet = String(id ?? "");
  form.setFieldValue("members", membersOf(fleet));
  if (props.toVersion == null && !props.retryOf)
    form.setFieldValue("version", defaultVersion(fleet, form.state.values.config));
}

function onConfigPicked(id: unknown) {
  form.setFieldValue("version", defaultVersion(form.state.values.fleet, String(id ?? "")));
}

// The server refuses a field its strategy does not take, so each strategy sends only its own.
function requestOf(value: RolloutForm): FleetSetDesiredRequest {
  const body: FleetSetDesiredRequest = {
    config: value.config,
    version: value.version,
    strategy: value.strategy,
  };
  if (value.strategy === "canary") body.batch = { initial: Number(value.initial) };
  if (value.strategy === "progressive")
    body.batch = {
      initial: Number(value.initial),
      multiplier: Number(value.multiplier),
      max: Number(value.max),
    };
  if (value.strategy === "canary" || value.strategy === "progressive") body.gates = value.gates;
  if (value.strategy === "scheduled") body.scheduled_for = new Date(value.when).getTime();
  body.auto_rollback = value.autoRollback;
  return body;
}

async function submit(value: RolloutForm) {
  try {
    await setDesired.mutateAsync({ fleet: value.fleet, body: requestOf(value) });
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
