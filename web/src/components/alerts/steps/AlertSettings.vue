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
  <div
    class="step-alert-conditions w-full rounded-default mx-auto bg-surface-overlay border border-border-default"
  >
    <!-- Section header -->
    <div
      class="flex items-center py-2.5 px-3 border-b border-border-default"
    >
      <div class="w-0.75 h-4 rounded-default mr-2 shrink-0 bg-theme-accent" />
      <span
        class="text-compact font-semibold tracking-[0.01em] text-text-heading"
      >{{
        t("alerts.alertSettings.sectionTitle")
      }}</span>
    </div>

    <!-- The AddAlert orchestrator owns the ONE <OForm> and provides
         FORM_CONTEXT_KEY. The OForm* fields below inject that form and bind by
         nested `name=` (trigger_condition.*, destinations, creates_incident); the
         composed schema in AddAlert.schema.ts validates them on save. -->
    <div class="px-3 py-2">
      <div>
        <!-- For Real-Time Alerts -->
        <template v-if="isRealTime === 'true'">
          <!-- Silence Notification (Cooldown) -->
          <div class="flex justify-start items-start pb-3 mb-4">
            <div
              class="font-semibold flex items-center w-47.5 h-7 text-text-heading"
            >
              {{ t("alerts.silenceNotification") + " *" }}
              <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
              <OTooltip
                :content="t('alerts.alertSettings.cooldownTooltip')"
                side="right"
              />
            </div>
            <div class="flex flex-col gap-1 mr-2 w-fit">
              <div class="flex items-center">
                <div class="w-21.75">
                  <OFormInput
                    name="trigger_condition.silence"
                    type="number"
                    min="0"
                    data-test="alert-settings-silence-duration-input"
                  >
                    <!-- Message rendered below at pair width — see silenceError. -->
                    <template #error />
                  </OFormInput>
                </div>
                <div
                  class="flex justify-center items-center bg-input-addon-bg text-input-addon-text min-w-22.5 h-8.5 text-compact"
                >
                  {{ t("alerts.minutes") }}
                </div>
              </div>
              <div
                v-if="silenceError"
                class="text-xs text-input-error-text whitespace-nowrap"
                data-test="alert-settings-silence-error"
                role="alert"
              >
                {{ silenceError }}
              </div>
            </div>
          </div>

          <!-- Destinations -->
          <div class="flex items-start pb-4 mb-4">
            <div
              class="font-semibold flex items-center w-47.5 h-7 text-text-heading"
            >
              {{ t("alerts.destination") + " *" }}
              <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
              <OTooltip
                :content="t('alerts.alertSettings.destinationsTooltip')"
                side="right"
              />
            </div>
            <!-- Combined destinations + (enterprise) workflows picker. It owns its
                 refresh / add buttons and keeps the original data-test hooks; the
                 label above and the error below stay here. Deliberately NOT
                 name=-bound: one control writes two form fields, so both go up
                 through the parent's setFieldValue via the events below. -->
            <div class="flex flex-col">
              <AlertTargetsSelect
                :destinations="destinations"
                :workflows="workflows"
                :destination-options="formattedDestinations"
                :workflow-options="workflowOptions"
                :workflows-enabled="workflowsEnabled"
                :error="!!destinationsError"
                @update:destinations="$emit('update:destinations', $event)"
                @update:workflows="$emit('update:workflows', $event)"
                @refresh="refreshTargets"
                @create-destination="routeToCreateDestination"
                @create-workflow="routeToCreateWorkflow"
              />
              <div
                v-if="destinationsError"
                class="text-red-8 pt-1 text-2xs leading-3"
              >
                {{ destinationsError }}
              </div>
            </div>
          </div>
        </template>

        <!-- For Scheduled Alerts -->
        <template v-else>
          <!-- Period -->
          <div ref="periodFieldRef" class="flex items-start mr-2 mb-4!">
            <div
              class="font-semibold flex items-center w-47.5 h-7 text-text-heading"
            >
              {{ t("alerts.period") + " *" }}
              <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
              <OTooltip
                :content="t('alerts.alertSettings.periodTooltip')"
                side="right"
              />
            </div>
            <div class="flex flex-col gap-1 mr-2 w-fit">
              <div class="flex items-center">
                <div class="w-21.75">
                  <OFormInput
                    name="trigger_condition.period"
                    type="number"
                    min="1"
                    :debounce="300"
                    data-test="alert-settings-period-input"
                    @update:model-value="handlePeriodChange"
                  >
                    <!-- Message rendered below at pair width — see periodError. -->
                    <template #error />
                  </OFormInput>
                </div>
                <div
                  class="flex justify-center items-center bg-input-addon-bg text-input-addon-text min-w-22.5 h-8.5 text-compact"
                >
                  {{ t("alerts.minutes") }}
                </div>
              </div>
              <div
                v-if="periodError"
                class="text-xs text-input-error-text whitespace-nowrap"
                data-test="alert-settings-period-error"
                role="alert"
              >
                {{ periodError }}
              </div>
            </div>
          </div>

          <!-- Silence Notification (Cooldown) for Scheduled Alerts -->
          <div ref="silenceFieldRef" class="flex items-start mr-2 mb-4!">
            <div
              class="font-semibold flex items-center w-47.5 h-7 text-text-heading"
            >
              {{ t("alerts.silenceNotification") + " *" }}
              <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
              <OTooltip
                :content="t('alerts.alertSettings.cooldownTooltip')"
                side="right"
              />
            </div>
            <div class="flex flex-col gap-1 mr-2 w-fit">
              <div class="flex items-center">
                <div class="w-21.75">
                  <OFormInput
                    name="trigger_condition.silence"
                    type="number"
                    min="0"
                    :debounce="300"
                    data-test="alert-settings-silence-duration-input"
                  >
                    <!-- Message rendered below at pair width — see silenceError. -->
                    <template #error />
                  </OFormInput>
                </div>
                <div
                  class="flex justify-center items-center bg-input-addon-bg text-input-addon-text min-w-22.5 h-8.5 text-compact"
                >
                  {{ t("alerts.minutes") }}
                </div>
              </div>
              <div
                v-if="silenceError"
                class="text-xs text-input-error-text whitespace-nowrap"
                data-test="alert-settings-silence-error"
                role="alert"
              >
                {{ silenceError }}
              </div>
            </div>
          </div>

          <!-- Destinations -->
          <div ref="destinationsFieldRef" class="flex items-start mr-2 mb-4!">
            <div
              class="font-semibold flex items-center w-47.5 h-7 text-text-heading"
            >
              {{ t("alerts.destination") + " *" }}
              <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
              <OTooltip
                :content="t('alerts.alertSettings.destinationsTooltip')"
                side="right"
              />
            </div>
            <!-- Combined destinations + (enterprise) workflows picker. It owns its
                 refresh / add buttons and keeps the original data-test hooks; the
                 label above and the error below stay here. Deliberately NOT
                 name=-bound: one control writes two form fields, so both go up
                 through the parent's setFieldValue via the events below. -->
            <div class="flex flex-col">
              <AlertTargetsSelect
                :destinations="destinations"
                :workflows="workflows"
                :destination-options="formattedDestinations"
                :workflow-options="workflowOptions"
                :workflows-enabled="workflowsEnabled"
                :error="!!destinationsError"
                @update:destinations="$emit('update:destinations', $event)"
                @update:workflows="$emit('update:workflows', $event)"
                @refresh="refreshTargets"
                @create-destination="routeToCreateDestination"
                @create-workflow="routeToCreateWorkflow"
              />
              <div
                v-if="destinationsError"
                class="text-red-8 pt-1 text-2xs leading-3"
              >
                {{ destinationsError }}
              </div>
            </div>
          </div>
        </template>

        <!-- Creates Incident toggle — shown for all alert types -->
        <div class="flex items-start mb-4!">
          <div
            class="font-semibold flex items-center w-47.5 h-7 text-text-heading"
          >
            {{ t("alerts.alertSettings.createsIncident") }}
            <OIcon name="info" size="sm" class="ml-1 cursor-pointer" />
            <OTooltip
              :content="t('alerts.alertSettings.createsIncidentTooltip')"
              side="right"
            />
          </div>
          <OFormSwitch
            name="creates_incident"
            data-test="alert-creates-incident-toggle"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  inject,
  onMounted,
  ref,
  type PropType,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import OButton from "@/lib/core/Button/OButton.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSwitch from "@/lib/forms/Switch/OFormSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import AlertTargetsSelect from "@/components/alerts/AlertTargetsSelect.vue";
import workflowService from "@/services/workflows";
import { isWorkflowsEnabled } from "@/utils/featureGates";
import config from "@/aws-exports";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import { convertMinutesToCron } from "@/utils/zincutils";

export default defineComponent({
  name: "Step3AlertConditions",
  components: {
    OButton,
    OFormInput,
    OFormSwitch,
    OTooltip,
    OIcon,
    AlertTargetsSelect,
  },
  props: {
    formData: {
      type: Object as PropType<any>,
      required: true,
    },
    isRealTime: {
      type: String,
      default: "false",
    },
    // Passed by the parent but not consumed here (kept to avoid attr fallthrough).
    columns: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    isAggregationEnabled: {
      type: Boolean,
      default: false,
    },
    destinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    // Enterprise-only: workflow ids linked to this alert. Read-view off the ONE
    // form (AddAlert passes `formData.workflows`); writes go back up through
    // `update:workflows` → the parent's setFieldValue, never mutated here.
    workflows: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
    formattedDestinations: {
      type: Array as PropType<any[]>,
      default: () => [],
    },
  },
  emits: [
    "update:trigger",
    "update:aggregation",
    "update:isAggregationEnabled",
    "update:destinations",
    "refresh:destinations",
    "update:workflows",
    "update:promqlCondition",
  ],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const router = useRouter();

    // Field refs consumed by the parent's AlertFocusManager (registered off the
    // step ref). Scheduled-only.
    const periodFieldRef = ref<any>(null);
    const silenceFieldRef = ref<any>(null);
    const destinationsFieldRef = ref<any>(null);

    // Period / silence are composite "number + Minutes addon" fields: a 5.4rem
    // OFormInput glued to a unit block. OFormInput renders its message INSIDE
    // that narrow width, wrapping it into a ragged column and growing the field,
    // which pushes the addon out of line. Empty #error slot suppresses the inline
    // text (the field keeps its red border) and we render the message in a
    // full-width sibling below the pair. Reads the same R3-timed field errors
    // OFormInput would have surfaced — single source of truth, wider display.
    const form: any = inject(FORM_CONTEXT_KEY, null);
    const fieldError = (path: string) =>
      form
        ? form.useStore((s: any) =>
            firstFieldError(s.fieldMeta?.[path]?.errors ?? []),
          )
        : computed(() => undefined);
    const periodError = fieldError("trigger_condition.period");
    const silenceError = fieldError("trigger_condition.silence");
    // Destinations is NOT an OFormSelect any more (AlertTargetsSelect below is a
    // plain controlled component covering destinations + workflows), so its
    // schema error has no wrapper to render it — surface it the same way period
    // and silence do. The rule is "at least one destination OR workflow" and is
    // keyed on `destinations` in AddAlert.schema.ts, so it lands on this path.
    const destinationsError = fieldError("destinations");

    // ── Workflows (enterprise/cloud only) ────────────────────────────────────
    // Options are self-fetched here rather than threaded down the whole alert-form
    // chain like destinations. In OSS the group is never built, no list is
    // fetched, and — since `workflows` stays [] — the "destination OR workflow"
    // rule reduces to the original "destination required".
    // "Are workflows available here" — the only thing this flag has ever gated
    // in this component (the picker's Workflows group + the list fetch below).
    // It was build-only; it now also respects the backend /config flag
    // `workflows_enabled`, via the same shared gate the sidebar and routes use.
    // Renamed from `workflowsEnabled` because it no longer means "enterprise build":
    // on an enterprise deployment with workflows switched off this is false.
    const workflowsEnabled = computed(() => isWorkflowsEnabled());
    const workflowOptions = ref<{ label: string; value: string }[]>([]);
    const fetchWorkflows = async () => {
      if (!workflowsEnabled.value) return;
      try {
        const res = await workflowService.listWorkflows(
          store.state.selectedOrganization.identifier,
        );
        const list = Array.isArray(res.data) ? res.data : (res.data?.list ?? []);
        workflowOptions.value = list.map((wf: any) => ({
          label: wf.name,
          value: wf.id,
        }));
      } catch {
        workflowOptions.value = [];
      }
    };
    onMounted(fetchWorkflows);

    // The combined field's single refresh reloads both lists.
    const refreshTargets = () => {
      emit("refresh:destinations");
      fetchWorkflows();
    };

    const routeToCreateWorkflow = () => {
      const url = router.resolve({
        name: "createWorkflow",
        query: {
          trigger: "alert_fired",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }).href;
      window.open(url, "_blank");
    };

    const getBrowserTimezone = (): string => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      } catch {
        return "UTC";
      }
    };

    // Period typed → cross-step CASCADE (period drives frequency / cron /
    // timezone / silence). The ancestor AddAlert listens to @update:trigger
    // (updateTriggerCondition → setFieldValue) and writes the whole
    // trigger_condition into the ONE form, so the visible silence field
    // auto-fills. The period field value itself is already written into the form
    // by its own OFormInput binding; it rides on the emit so the parent write
    // does not revert it.
    const handlePeriodChange = (val: unknown) => {
      const periodValue = Number(val);
      // Spread the FRESH form value, not `props.formData.trigger_condition`.
      // The prop is a `form.useStore` read-view that only refreshes on the next
      // render, and the parent's @update:trigger handler is a WHOLE-OBJECT
      // `setFieldValue("trigger_condition", …)` — so spreading the stale prop
      // round-trips a pre-write snapshot and silently clobbers any field written
      // earlier in the same tick.
      const currentTrigger =
        form?.getFieldValue?.("trigger_condition") ??
        props.formData.trigger_condition;
      const nextTrigger: Record<string, any> = {
        ...currentTrigger,
        period: val,
      };
      if (periodValue && periodValue > 0) {
        const minFrequency =
          Math.ceil(store.state?.zoConfig?.min_auto_refresh_interval / 60) || 10;
        if (periodValue >= minFrequency) nextTrigger.frequency = periodValue;
        nextTrigger.cron = convertMinutesToCron(periodValue);
        if (!nextTrigger.timezone) nextTrigger.timezone = getBrowserTimezone();
        nextTrigger.silence = periodValue;
      }
      emit("update:trigger", nextTrigger);
    };

    const routeToCreateDestination = () => {
      const url = router.resolve({
        name: "alertDestinations",
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }).href;
      window.open(url, "_blank");
    };

    return {
      t,
      store,
      handlePeriodChange,
      routeToCreateDestination,
      // Field refs for the parent focus manager
      periodFieldRef,
      silenceFieldRef,
      destinationsFieldRef,
      periodError,
      silenceError,
      destinationsError,
      workflowsEnabled,
      workflowOptions,
      fetchWorkflows,
      refreshTargets,
      routeToCreateWorkflow,
    };
  },
});
</script>
