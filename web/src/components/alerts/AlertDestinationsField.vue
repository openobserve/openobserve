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
  enterprise/config gate, the "create" routings (a destination drawer and a
  new-tab workflow editor), and the opt-in Send test.
-->
<template>
  <div class="flex items-start max-md:flex-col max-md:gap-1">
    <div class="text-text-heading flex h-7 w-47.5 items-center font-semibold max-md:w-auto">
      {{ labelText }}
      <template v-if="tooltipText">
        <OIcon name="info" size="sm" class="ms-1 cursor-pointer" />
        <OTooltip :content="tooltipText" side="right" />
      </template>
    </div>
    <div class="flex min-w-0 flex-col max-md:w-full">
      <div class="flex items-center max-md:flex-wrap max-md:gap-y-2">
        <AlertTargetsSelect
          :destinations="destinations"
          :workflows="workflows"
          :destination-options="destinationOptions"
          :workflow-options="workflowOptions"
          :workflows-enabled="workflowsEnabled"
          :workflows-locked="workflowsLocked"
          :workflows-lock-message="workflowsAccess.message"
          :placeholder="placeholder"
          :error="!!error"
          @update:destinations="emit('update:destinations', $event)"
          @update:workflows="emit('update:workflows', $event)"
          @refresh="refreshTargets"
          @create-destination="openDestinationDrawer"
          @create-workflow="routeToCreateWorkflow"
        />
        <!-- The span carries the reason: a disabled button gets no pointer events for its own tooltip. -->
        <span v-if="showSendTest" class="ms-2 inline-flex max-md:ms-0">
          <OButton
            data-test="alert-destinations-send-test-btn"
            variant="outline"
            size="sm"
            icon-left="send"
            :disabled="destinations.length === 0"
            :loading="isSendingTest"
            @click="sendTest"
          >
            {{ t("alert_templates.testSend") }}
          </OButton>
          <OTooltip
            v-if="destinations.length === 0"
            :content="t('alert_templates.testSendNoDestination')"
            data-test="alert-destinations-send-test-reason"
          />
        </span>
      </div>
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
      <!-- Always rendered when asked for, so picking or clearing a target only
           swaps the text and nothing below moves. Styled as a field hint. -->
      <div v-else-if="showStatus" class="flex flex-wrap items-center gap-x-2 pt-1">
        <p
          class="text-input-help-text text-xs"
          :data-test="
            notifiesNobody
              ? 'alert-settings-destinations-note'
              : 'alert-settings-destinations-status'
          "
        >
          {{ statusText }}
        </p>
        <OButton
          v-if="notifiesNobody"
          data-test="alert-destinations-note-add-btn"
          variant="ghost-primary"
          size="xs"
          @click="openDestinationDrawer"
        >
          {{ t("alerts.alertSettings.noDestinationAction") }}
        </OButton>
      </div>
    </div>
    <ODrawer
      v-model:open="showDestinationDrawer"
      size="xl"
      bleed
      :title="t('alert_destinations.addTitle')"
      data-test="alert-destinations-create-drawer"
    >
      <AddDestination
        v-if="showDestinationDrawer"
        drawer
        :templates="templates"
        @created="onDestinationCreated"
        @cancel:hideform="showDestinationDrawer = false"
      />
    </ODrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import AddDestination from "@/components/alerts/AddDestination.vue";
import AlertTargetsSelect from "@/components/alerts/AlertTargetsSelect.vue";
import destinationService from "@/services/alert_destination";
import { destinationsQuery } from "@/services/alert_destination.queries";
import { templatesQuery } from "@/services/alert_templates.queries";
import { workflowsQuery } from "@/services/workflows.queries";
import { queryClient } from "@/composables/query/queryClient";
import { useLockedAffordance } from "@/composables/useLockedAffordance";

type RawOption = string | { label: I18nText; value: string };

// Seeded in every org; the server falls back to the same content when nothing else is set.
const DEFAULT_TEST_TEMPLATE = "o2_default_content";

const props = withDefaults(
  defineProps<{
    destinations: string[];
    workflows: string[];
    destinationOptions: RawOption[];
    /** Validation message; presence tints the select and renders the row. */
    error?: string;
    /** Override the label; defaults to the alert form's "Destination". */
    label?: string;
    /** The alert has nowhere to send, so the status line says no destination is notified. */
    notifiesNobody?: boolean;
    /** Show the one-line status under the field: where the alert sends, or that it sends nowhere. */
    showStatus?: boolean;
    /** Shown in the empty picker. Omit where empty means something else (recovery destinations). */
    placeholder?: I18nText;
    /** Override the tooltip; pass "" for alert families that need none. */
    tooltip?: string;
    /** False for alert families with no workflow routing (e.g. synthetics
     *  checks): the Workflows group and its fetch are skipped even on
     *  enterprise, so the picker cannot offer options that would not save. */
    supportsWorkflows?: boolean;
    /** Offer "Send test" beside the picker. */
    showSendTest?: boolean;
    /** The alert's own template; a test uses it before the destination's. */
    alertTemplate?: string;
    /** On-call team set elsewhere on the form; the status line names it first. */
    oncallTeam?: string;
    /** The alert opens an incident; the status line names it after the on-call team. */
    createsIncident?: boolean;
    /** Turns planned names (Email me) into real destinations before a test; null stops the test. */
    resolveDestinations?: (names: string[]) => Promise<string[] | null>;
  }>(),
  { supportsWorkflows: true, notifiesNobody: false, showStatus: false, showSendTest: false },
);

const emit = defineEmits<{
  (e: "update:destinations", value: string[]): void;
  (e: "update:workflows", value: string[]): void;
  /** The user asked for fresh lists; the parent reloads destinations. */
  (e: "refresh"): void;
}>();

const { t, locale } = useI18nTyped();
const store = useStore();
const router = useRouter();

const labelText = computed<I18nText>(() =>
  props.label === undefined ? t("alerts.destination") : raw(props.label),
);
// `undefined` means "the default tooltip"; an explicit "" means "none".
const tooltipText = computed<I18nText>(() =>
  props.tooltip === undefined ? t("alerts.alertSettings.destinationsTooltip") : raw(props.tooltip),
);

// Edition entitlement and the backend /config runtime flag are separate
// gates — same split MainLayout's nav-rail Workflows entry uses: an edition
// that doesn't unlock workflows stays visible but LOCKED (upgrading fixes
// it); a deployment that simply hasn't turned the runtime flag on stays
// HIDDEN (upgrading wouldn't change that).
const workflowsAccess = useLockedAffordance("workflows");
const workflowsRuntimeEnabled = computed(() => store.state.zoConfig?.workflows_enabled === true);
const workflowsEnabled = computed(
  () => props.supportsWorkflows && workflowsAccess.value.allowed && workflowsRuntimeEnabled.value,
);
// Shown (disabled) instead of hidden outright when the family supports
// workflows but this edition doesn't unlock them.
const workflowsLocked = computed(() => props.supportsWorkflows && !workflowsAccess.value.allowed);

const workflowOptions = ref<{ label: I18nText; value: string }[]>([]);
const fetchWorkflows = async (force = false) => {
  if (!workflowsEnabled.value) return;
  try {
    const options = workflowsQuery(store.state.selectedOrganization.identifier);
    // A workflow created in the new tab never expires this tab's cache, so refresh must force.
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: options.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const list = await queryClient.fetchQuery(options);
    // Drafts aren't runnable/published, so they can't be linked to an alert —
    // only offer non-draft (published) workflows.
    workflowOptions.value = list
      .filter((wf: any) => !wf.is_draft)
      .map((wf: any) => ({ label: raw(wf.name), value: wf.id }));
  } catch {
    workflowOptions.value = [];
  }
};

// One name reads better than "1 destination"; more than one is a count.
const statusText = computed<I18nText>(() => {
  if (props.notifiesNobody) return t("alerts.alertSettings.noDestinationNote");
  const parts: string[] = [];
  if (props.oncallTeam?.trim()) parts.push(t("alerts.alertSettings.oncallTeamTarget"));
  if (props.createsIncident) parts.push(t("alerts.alertSettings.incidentTarget"));
  const { destinations } = props;
  if (destinations.length === 1) parts.push(destinations[0]);
  else if (destinations.length > 1) {
    parts.push(
      t(
        "alert_dependencies.countDestinations",
        { count: destinations.length },
        destinations.length,
      ),
    );
  }
  const workflows = workflowsEnabled.value ? props.workflows : [];
  const workflowName =
    workflows.length === 1
      ? workflowOptions.value.find((option) => option.value === workflows[0])?.label
      : undefined;
  if (workflowName) parts.push(workflowName);
  else if (workflows.length > 0) {
    parts.push(
      t("alert_dependencies.countWorkflow", { count: workflows.length }, workflows.length),
    );
  }
  // A target the picker does not show: the on-call team set on the Advanced tab.
  if (parts.length === 0) parts.push(t("alerts.alertSettings.oncallTeamTarget"));
  const targets = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(parts);
  return t("alerts.alertSettings.sendsToStatus", { targets });
});

onMounted(() => fetchWorkflows());

// The combined field's single refresh reloads both lists.
const refreshTargets = () => {
  emit("refresh");
  fetchWorkflows(true);
};

// A drawer, not navigation: leaving the form here would discard the alert being authored.
const showDestinationDrawer = ref(false);
const templates = ref<any[]>([]);
const openDestinationDrawer = async () => {
  showDestinationDrawer.value = true;
  try {
    templates.value = await queryClient.fetchQuery(
      templatesQuery(store.state.selectedOrganization.identifier),
    );
  } catch {
    templates.value = [];
  }
};

const onDestinationCreated = (name: string) => {
  emit("refresh");
  if (!props.destinations.includes(name)) {
    emit("update:destinations", [...props.destinations, name]);
  }
};

const routeToCreateWorkflow = () => {
  const url = router.resolve({
    name: "createWorkflow",
    query: { trigger: "alert_fired", org_identifier: store.state.selectedOrganization.identifier },
  }).href;
  window.open(url, "_blank");
};

const isSendingTest = ref(false);

const testTemplateFor = (name: string, known: { name: string; template?: string }[]) =>
  props.alertTemplate ||
  known.find((destination) => destination.name === name)?.template ||
  DEFAULT_TEST_TEMPLATE;

const reportTestResults = (names: string[], results: PromiseSettledResult<unknown>[]) => {
  let rateLimited = false;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    const response = (result.reason as any)?.response;
    if (response?.status === 429) {
      rateLimited = true;
    } else if (response?.status === 403) {
      toast({
        variant: "error",
        message: t("alerts.alertSettings.sendTestForbidden", { name: names[index] }),
      });
    } else {
      toast({
        variant: "error",
        message: response?.data?.message ?? response?.data?.error ?? String(result.reason),
      });
    }
  });
  if (rateLimited) toast({ variant: "error", message: t("alert_templates.testSendRateLimited") });
  if (results.some((result) => result.status === "fulfilled")) {
    toast({ variant: "success", message: t("alert_templates.testSendSuccess") });
  }
};

const resolveTestTargets = async (): Promise<string[] | null> => {
  const names = [...props.destinations];
  return props.resolveDestinations ? props.resolveDestinations(names) : names;
};

const sendTest = async () => {
  if (props.destinations.length === 0) return;
  const org = store.state.selectedOrganization.identifier;
  isSendingTest.value = true;
  try {
    const names = await resolveTestTargets();
    if (!names) return;
    let known: { name: string; template?: string }[] = [];
    if (!props.alertTemplate) {
      try {
        known = await queryClient.fetchQuery(destinationsQuery(org, "alert"));
      } catch {
        toast({ variant: "error", message: t("alerts.alertSettings.sendTestLookupFailed") });
        return;
      }
    }
    const results = await Promise.allSettled(
      names.map((name) =>
        destinationService.testSend({
          org_identifier: org,
          destination_name: name,
          data: { template_name: testTemplateFor(name, known) },
          // 403 gets its own message naming the destination.
          options: { skipAccessToast: true },
        }),
      ),
    );
    reportTestResults(names, results);
  } finally {
    isSendingTest.value = false;
  }
};
</script>
