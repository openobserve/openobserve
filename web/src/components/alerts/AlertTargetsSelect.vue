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
  Combined alert "Destinations" target selector — a single grouped multi-select
  covering both alert Destinations and (enterprise-only) Workflows, replacing the
  two separate dropdowns. The backend keeps two fields (`destinations: string[]`
  of names, `workflows: string[]` of ids), so option values are TYPE-TAGGED
  (`dest:<name>` / `wf:<id>`) and split back apart on change — the payload wiring,
  validation, and backend contract are unchanged.

  When `workflowsEnabled` is false — OSS, or an enterprise/cloud deployment with
  the backend `/config` flag `workflows_enabled` off — no Workflows group is
  built, no group headers are shown, and the control behaves exactly like the old
  Destinations dropdown.
  Only the control row lives here; the field label + inline required-error stay
  in the parent (AlertSettings) so the two alert-type layouts keep their chrome.
-->
<template>
  <div class="flex items-center">
    <OSelect
      :model-value="model"
      :options="options"
      multiple
      :error="error"
      :collapsible-groups="workflowsEnabled"
      class="min-w-[11.25rem] max-w-[18.75rem]"
      data-test="alert-destinations-select"
      @update:model-value="onUpdate"
    >
      <template #empty>{{
        workflowsEnabled
          ? t("alerts.alertSettings.noTargetsAvailable")
          : t("alerts.alertSettings.noDestinationsAvailable")
      }}</template>
    </OSelect>

    <OButton
      data-test="alert-settings-refresh-destinations-btn"
      class="ml-1"
      variant="ghost"
      size="icon-circle-sm"
      :title="t('alerts.alertSettings.refreshDestinations')"
      @click="emit('refresh')"
    >
      <OIcon name="refresh" size="sm" />
    </OButton>
    <OButton
      data-test="create-destination-btn"
      variant="outline"
      size="sm"
      class="ml-2"
      @click="emit('create-destination')"
    >
      {{ t("alerts.alertSettings.addNewDestination") }}
    </OButton>
    <OButton
      v-if="workflowsEnabled"
      data-test="create-workflow-btn"
      variant="outline"
      size="sm"
      class="ml-2"
      @click="emit('create-workflow')"
    >
      {{ t("workflow.create") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

interface Option {
  label: string;
  value: string;
}
// Option lists may be plain strings (destinations = `getFormattedDestinations`
// returns names) or `{label,value}` objects (workflows). Normalized below.
type RawOption = string | Option;
const props = defineProps<{
  destinations: string[];
  workflows: string[];
  destinationOptions: RawOption[];
  workflowOptions: RawOption[];
  workflowsEnabled: boolean;
  error?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:destinations", value: string[]): void;
  (e: "update:workflows", value: string[]): void;
  (e: "refresh"): void;
  (e: "create-destination"): void;
  (e: "create-workflow"): void;
}>();

const { t } = useI18n();

const DEST = "dest:";
const WF = "wf:";

// Every list below is API-backed, so a failed or partially-loaded fetch can hand
// us null/undefined entries — `getFormattedDestinations` maps `destination.name`,
// which is `undefined` for any malformed row, and an unreachable backend yields
// exactly that. These lists are read inside computeds during render, so ONE bad
// entry used to throw and blank the whole alert form. Drop bad entries instead: a
// missing option is a missing row, never a broken page.
const isFilled = <T,>(v: T | null | undefined): v is T => v !== null && v !== undefined && v !== "";

// The selection as one tagged array, derived from the two backend fields.
const propsCombined = computed<string[]>(() => [
  ...(props.destinations || []).filter(isFilled).map((d) => `${DEST}${d}`),
  ...(props.workflows || []).filter(isFilled).map((w) => `${WF}${w}`),
]);

// Internal ORDERED model the OSelect binds to. We keep our own copy so the
// round-trip (onUpdate → parent → props → propsCombined) doesn't feed a
// reordered array back into the control. `propsCombined` forces "destinations
// first, then workflows", which differs from the user's click order; binding
// that directly makes reka re-reconcile every change — the visible "shake" once
// both groups have a selection. So we sync from props only when the value SET
// actually changes (external reset / edit load), never on our own echo.
const model = ref<string[]>(propsCombined.value);
const sameSet = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((v) => s.has(v));
};
watch(propsCombined, (next) => {
  if (!sameSet(next, model.value)) model.value = next;
});

// Grouped, type-tagged options. Headers + Workflows group only when enterprise;
// in OSS this is a plain destinations list (unchanged behavior).
// Normalize a raw option (string or {label,value}) to a { name, label } pair.
// Returns null for anything unusable (see the isFilled note above) so the caller
// can drop it rather than render a `dest:undefined` row or throw.
const norm = (o: RawOption): { name: string; label: string } | null => {
  if (!isFilled(o)) return null;
  if (typeof o === "string") return { name: o, label: o };
  if (!isFilled((o as Option).value)) return null;
  const value = String((o as Option).value);
  return { name: value, label: (o as Option).label ?? value };
};

const toTagged = (list: RawOption[] | undefined, tag: string) =>
  (list || [])
    .map(norm)
    .filter(isFilled)
    .map(({ name, label }) => ({ label, value: `${tag}${name}` }));

const options = computed(() => {
  const dests = toTagged(props.destinationOptions, DEST);
  if (!props.workflowsEnabled) return dests;
  const wfs = toTagged(props.workflowOptions, WF);
  return [
    { header: true, label: t("alerts.alertSettings.targetsDestinationsGroup") },
    ...dests,
    { header: true, label: t("alerts.alertSettings.targetsWorkflowsGroup") },
    ...wfs,
  ];
});

// Split the tagged selection back into the two backend fields. Keep the control's
// own order in `model` so the chips don't jump when props round-trip back.
const onUpdate = (vals: unknown) => {
  // Strings only — `v.startsWith` below would throw on a null the control ever
  // handed back, taking the form down on a click rather than on load.
  const arr = (Array.isArray(vals) ? vals : []).filter((v): v is string => typeof v === "string");
  model.value = arr;
  const dests = arr.filter((v) => v.startsWith(DEST)).map((v) => v.slice(DEST.length));
  const wfs = arr.filter((v) => v.startsWith(WF)).map((v) => v.slice(WF.length));
  emit("update:destinations", dests);
  emit("update:workflows", wfs);
};
</script>
