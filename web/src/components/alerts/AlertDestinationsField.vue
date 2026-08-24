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
  The complete "Destination" form field — side label + tooltip, the combined
  destinations/workflows picker, and the inline error — shared by the generic
  alert form (AlertSettings, twice) and the SLO alert form so the field cannot
  drift between them.

  Ownership split: the PARENT owns the destinations list (options + reload on
  `refresh`) because every parent already fetches it for its own reasons; this
  field owns everything parent-agnostic — the workflows list and its
  enterprise/config gate, and the "create" routings, which are plain
  navigation identical from anywhere.
-->
<template>
  <div class="flex items-start">
    <div class="text-text-heading flex h-7 w-47.5 items-center font-semibold">
      {{ required ? labelText + " *" : labelText }}
      <template v-if="tooltipText">
        <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
        <OTooltip :content="tooltipText" side="right" />
      </template>
    </div>
    <div class="flex flex-col">
      <AlertTargetsSelect
        :destinations="destinations"
        :workflows="workflows"
        :destination-options="destinationOptions"
        :workflow-options="workflowOptions"
        :workflows-enabled="workflowsEnabled"
        :error="!!error"
        @update:destinations="emit('update:destinations', $event)"
        @update:workflows="emit('update:workflows', $event)"
        @refresh="refreshTargets"
        @create-destination="routeToCreateDestination"
        @create-workflow="routeToCreateWorkflow"
      />
      <!-- role="alert": focusOnFirstError finds stranded errors by this marker.
           The data-test predates the extraction and is asserted by
           AlertSettings.spec, so it keeps its historical name everywhere. -->
      <div
        v-if="error"
        class="text-red-8 text-2xs pt-1 leading-3"
        data-test="alert-settings-destinations-error"
        role="alert"
      >
        {{ error }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AlertTargetsSelect from "@/components/alerts/AlertTargetsSelect.vue";
import workflowService from "@/services/workflows";
import config from "@/aws-exports";

type RawOption = string | { label: I18nText; value: string };

const props = withDefaults(
  defineProps<{
    destinations: string[];
    workflows: string[];
    destinationOptions: RawOption[];
    /** Validation message; presence tints the select and renders the row. */
    error?: string;
    /** Override the label; defaults to the alert form's "Destination". */
    label?: string;
    /** Whether this alert family requires a destination; drives the "*". */
    required?: boolean;
    /** Override the tooltip; pass "" for alert families that need none. */
    tooltip?: string;
    /** False for alert families with no workflow routing (e.g. synthetics
     *  checks): the Workflows group and its fetch are skipped even on
     *  enterprise, so the picker cannot offer options that would not save. */
    supportsWorkflows?: boolean;
  }>(),
  { required: true, supportsWorkflows: true },
);

const emit = defineEmits<{
  (e: "update:destinations", value: string[]): void;
  (e: "update:workflows", value: string[]): void;
  /** The user asked for fresh lists; the parent reloads destinations. */
  (e: "refresh"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const labelText = computed<I18nText>(() =>
  props.label === undefined ? t("alerts.destination") : raw(props.label),
);
// `undefined` means "the default tooltip"; an explicit "" means "none".
const tooltipText = computed<I18nText>(() =>
  props.tooltip === undefined ? t("alerts.alertSettings.destinationsTooltip") : raw(props.tooltip),
);

// The family must support workflows AND the deployment must serve them —
// build gate plus the backend /config flag, the same combined test the
// sidebar and routes use.
const workflowsEnabled = computed(
  () =>
    props.supportsWorkflows &&
    (config.isEnterprise === "true" || config.isCloud === "true") &&
    store.state.zoConfig?.workflows_enabled === true,
);

const workflowOptions = ref<{ label: I18nText; value: string }[]>([]);
const fetchWorkflows = async () => {
  if (!workflowsEnabled.value) return;
  try {
    const res = await workflowService.listWorkflows(store.state.selectedOrganization.identifier);
    const list = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
    // Drafts aren't runnable/published, so they can't be linked to an alert —
    // only offer non-draft (published) workflows.
    workflowOptions.value = list
      .filter((wf: any) => !wf.is_draft)
      .map((wf: any) => ({ label: raw(wf.name), value: wf.id }));
  } catch {
    workflowOptions.value = [];
  }
};
onMounted(fetchWorkflows);

// The combined field's single refresh reloads both lists.
const refreshTargets = () => {
  emit("refresh");
  fetchWorkflows();
};

// New tab, not navigation: leaving the form here would discard the alert
// being authored.
const routeToCreateDestination = () => {
  const url = router.resolve({
    name: "alertDestinations",
    query: { action: "add", org_identifier: store.state.selectedOrganization.identifier },
  }).href;
  window.open(url, "_blank");
};

const routeToCreateWorkflow = () => {
  const url = router.resolve({
    name: "createWorkflow",
    query: { trigger: "alert_fired", org_identifier: store.state.selectedOrganization.identifier },
  }).href;
  window.open(url, "_blank");
};
</script>
