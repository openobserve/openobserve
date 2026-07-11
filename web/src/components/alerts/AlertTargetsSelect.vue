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

  In OSS `isEnterprise` is false: no Workflows group is built, no group headers
  are shown, and the control behaves exactly like the old Destinations dropdown.
  Only the control row lives here; the field label + inline required-error stay
  in the parent (AlertSettings) so the two alert-type layouts keep their chrome.
-->
<template>
  <div class="tw:flex tw:items-center">
    <OSelect
      :model-value="combined"
      :options="options"
      multiple
      :error="error"
      class="tw:min-w-[180px] tw:max-w-[300px]"
      data-test="alert-destinations-select"
      @update:model-value="onUpdate"
    >
      <template #empty>{{
        isEnterprise
          ? t("alerts.alertSettings.noTargetsAvailable")
          : t("alerts.alertSettings.noDestinationsAvailable")
      }}</template>
    </OSelect>

    <OButton
      data-test="alert-settings-refresh-destinations-btn"
      class="tw:ml-1"
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
      class="tw:ml-2"
      @click="emit('create-destination')"
    >
      {{ t("alerts.alertSettings.addNewDestination") }}
    </OButton>
    <OButton
      v-if="isEnterprise"
      data-test="create-workflow-btn"
      variant="outline"
      size="sm"
      class="tw:ml-2"
      @click="emit('create-workflow')"
    >
      {{ t("workflow.create") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
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
  isEnterprise: boolean;
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

// Current selection as one tagged array (what the OSelect binds to).
const combined = computed<string[]>(() => [
  ...(props.destinations || []).map((d) => `${DEST}${d}`),
  ...(props.workflows || []).map((w) => `${WF}${w}`),
]);

// Grouped, type-tagged options. Headers + Workflows group only when enterprise;
// in OSS this is a plain destinations list (unchanged behavior).
// Normalize a raw option (string or {label,value}) to a { name, label } pair.
const norm = (o: RawOption): { name: string; label: string } => {
  if (typeof o === "string") return { name: o, label: o };
  return { name: String(o.value), label: o.label ?? String(o.value) };
};

const options = computed(() => {
  const dests = (props.destinationOptions || []).map((o) => {
    const { name, label } = norm(o);
    return { label, value: `${DEST}${name}` };
  });
  if (!props.isEnterprise) return dests;
  const wfs = (props.workflowOptions || []).map((o) => {
    const { name, label } = norm(o);
    return { label, value: `${WF}${name}` };
  });
  return [
    { header: true, label: t("alerts.alertSettings.targetsDestinationsGroup") },
    ...dests,
    { header: true, label: t("alerts.alertSettings.targetsWorkflowsGroup") },
    ...wfs,
  ];
});

// Split the tagged selection back into the two backend fields.
const onUpdate = (vals: unknown) => {
  const arr = Array.isArray(vals) ? (vals as string[]) : [];
  const dests = arr
    .filter((v) => v.startsWith(DEST))
    .map((v) => v.slice(DEST.length));
  const wfs = arr
    .filter((v) => v.startsWith(WF))
    .map((v) => v.slice(WF.length));
  emit("update:destinations", dests);
  emit("update:workflows", wfs);
};
</script>
