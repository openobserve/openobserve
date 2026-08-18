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
  <ODrawer
    :open="open"
    @update:open="onDrawerOpenChange"
    :title="isEditMode ? t('alert_sources.editTitle') : t('alert_sources.addTitle')"
    size="lg"
    :form-id="created ? undefined : FORM_ID"
    :primary-button-label="created ? t('alert_sources.done') : t('alert_sources.save')"
    :secondary-button-label="created ? undefined : t('alert_sources.cancel')"
    data-test="add-alert-source-drawer"
    @click:primary="onPrimaryClick"
    @click:secondary="cancel"
  >
    <div class="flex flex-col gap-4">
      <!-- `formKey` remounts OForm on open so defaults re-read the edit target. -->
      <OForm
        :id="FORM_ID"
        :key="formKey"
        :schema="schema"
        :default-values="defaultValues"
        class="flex flex-col gap-5"
        @submit="onSubmit"
      >
        <OFormInput
          name="name"
          :disabled="created"
          :label="t('alert_sources.name')"
          :help-text="t('alert_sources.nameHint')"
          required
          data-test="add-alert-source-name-input"
        />
        <div class="flex flex-col gap-1">
          <div class="flex items-end gap-2">
            <!-- OSelect fills its container, so the width lives on the wrapper. -->
            <div class="w-72">
              <OFormSelect
                name="destinations"
                multiple
                searchable
                :disabled="created"
                :label="t('alert_sources.incidentDestination')"
                :options="destinationOptions"
                :placeholder="t('alert_sources.incidentDestinationPlaceholder')"
                data-test="add-alert-source-destinations-select"
              >
                <template #empty>{{ t("alerts.alertSettings.noDestinationsAvailable") }}</template>
              </OFormSelect>
            </div>
            <OButton
              variant="ghost"
              size="icon-circle-sm"
              :disabled="created"
              :title="t('alerts.alertSettings.refreshDestinations')"
              data-test="add-alert-source-refresh-destinations-btn"
              @click="fetchDestinationOptions"
            >
              <OIcon name="refresh" size="sm" />
            </OButton>
            <OButton
              variant="outline"
              size="sm"
              :disabled="created"
              data-test="add-alert-source-create-destination-btn"
              @click="routeToCreateDestination"
            >
              {{ t("alerts.alertSettings.addNewDestination") }}
            </OButton>
          </div>
          <p class="text-text-secondary text-xs">
            {{ t("alert_sources.incidentDestinationHint") }}
          </p>
        </div>
      </OForm>

      <!-- All 3 steps show from the start; 2 and 3 hold a "save first"
           placeholder until the source exists. -->
      <OStepper v-if="!isEditMode" :model-value="activeStep" expanded orientation="vertical">
        <OStep :name="1" :title="t('alert_sources.setupStep1Title')" :done="created">
          <p class="text-text-secondary text-sm">{{ t("alert_sources.setupStep1Body") }}</p>
        </OStep>
        <OStep :name="2" :title="t('alert_sources.setupStep2Title')" :done="created">
          <div v-if="created" class="flex flex-col gap-2">
            <p class="text-text-secondary text-sm">{{ t("alert_sources.setupStep2Body") }}</p>
            <CopyContent
              :content="createdUrlSnippet"
              :display-content="createdUrlSnippet"
              data-test="add-alert-source-created-snippet"
            />
            <p class="text-text-secondary text-xs font-medium">
              {{ t("alert_sources.curlLabel") }}
            </p>
            <CopyContent
              :content="createdCurlSnippet"
              :display-content="createdCurlSnippet"
              data-test="add-alert-source-created-curl"
            />
          </div>
          <p
            v-else
            class="text-text-secondary text-sm"
            data-test="add-alert-source-step2-placeholder"
          >
            {{ t("alert_sources.setupRemainingStepsHint") }}
          </p>
        </OStep>
        <OStep :name="3" :title="t('alert_sources.setupStep3Title')">
          <div v-if="created" class="flex items-center gap-2">
            <OTag
              v-if="waitingForEvent"
              variant="primary-soft"
              dot
              data-test="add-alert-source-waiting-pill"
            >
              {{ t("alert_sources.waitingForEvent") }}
            </OTag>
            <OTag v-else variant="success-soft" dot data-test="add-alert-source-connected-pill">
              {{ connectedLabel }}
            </OTag>
            <span class="text-text-secondary text-xs">{{ t("alert_sources.setupStep3Body") }}</span>
          </div>
          <p v-else class="text-text-secondary text-sm">
            {{ t("alert_sources.setupStep3Body") }}
          </p>
        </OStep>
      </OStepper>
    </div>
  </ODrawer>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useRouter } from "vue-router";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OStepper from "@/lib/navigation/Stepper/OStepper.vue";
import OStep from "@/lib/navigation/Stepper/OStep.vue";
import CopyContent from "@/components/CopyContent.vue";
import alertSources from "@/services/alert_sources";
import destinationService from "@/services/alert_destination";
import { toast } from "@/lib/feedback/Toast/useToast";
import { getEndPoint, getIngestionURL } from "@/utils/zincutils";
import {
  makeAlertSourceSchema,
  alertSourceDefaults,
  type AlertSourceForm,
} from "./AddExternalAlertSource.schema";
import type { AlertSourceIntegration } from "@/ts/interfaces/alertSources";

// Polls senders until the first event arrives, so wiring is confirmed live.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000;

// Links ODrawer's Save button to the nested OForm (submit + spinner).
const FORM_ID = "add-alert-source-form";

export default defineComponent({
  name: "AddExternalAlertSource",
  components: {
    ODrawer,
    OForm,
    OFormInput,
    OFormSelect,
    OButton,
    OIcon,
    OTag,
    OStepper,
    OStep,
    CopyContent,
  },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    // When set, the drawer pre-fills from this integration and Save patches
    // it in place instead of creating a new source.
    editingIntegration: {
      type: Object as () => AlertSourceIntegration | undefined,
      default: undefined,
    },
  },
  emits: ["update:open", "created", "updated"],
  setup() {
    const store = useStore();
    const { t } = useI18nTyped();
    const router = useRouter();
    const schema = makeAlertSourceSchema(t);
    return { store, t, router, schema, FORM_ID };
  },
  data() {
    return {
      destinationOptions: [] as Array<{ label: I18nText; value: string }>,
      defaultValues: alertSourceDefaults(),
      formKey: 0,
      created: false,
      createdIntegration: undefined as AlertSourceIntegration | undefined,
      waitingForEvent: true,
      detectedFormat: "",
      pollTimer: undefined as ReturnType<typeof setInterval> | undefined,
      pollDeadline: 0,
    };
  },
  computed: {
    orgIdentifier(): string {
      return this.store.state.selectedOrganization.identifier;
    },
    isEditMode(): boolean {
      return !!this.editingIntegration;
    },
    // OStepper's modelValue — which step reads as active (all stay visible).
    activeStep(): number {
      if (!this.created) return 1;
      return this.waitingForEvent ? 2 : 3;
    },
    // A URL and a bearer token the user copies verbatim — machine vocabulary,
    // identical in every locale.
    createdUrlSnippet(): I18nText {
      if (!this.createdIntegration) return raw("");
      const ingestionURL = getIngestionURL();
      const base = getEndPoint(ingestionURL).url;
      return raw(
        [
          "# URL",
          `${base}/api/v2/${this.orgIdentifier}/incidents/events`,
          "",
          "# Authorization header",
          `Bearer ${this.createdIntegration.token}`,
        ].join("\n"),
      );
    },
    createdCurlSnippet(): I18nText {
      if (!this.createdIntegration) return raw("");
      const ingestionURL = getIngestionURL();
      const base = getEndPoint(ingestionURL).url;
      const url = `${base}/api/v2/${this.orgIdentifier}/incidents/events`;
      // Pasted straight into a shell, so: no comment lines. The body is the
      // minimal payload detect.rs accepts — an empty `{}` is rejected.
      return raw(
        [
          `curl -X POST '${url}' \\`,
          `  -H 'Authorization: Bearer ${this.createdIntegration.token}' \\`,
          `  -H 'Content-Type: application/json' \\`,
          `  -d '{"status": "firing", "labels": {"source": "test"}}'`,
        ].join("\n"),
      );
    },
    connectedLabel(): I18nText {
      return this.t("alert_sources.connectedFormat", { format: this.detectedFormat });
    },
  },
  watch: {
    open(isOpen: boolean) {
      if (isOpen) {
        this.resetForm();
        this.fetchDestinationOptions();
      } else {
        this.stopPolling();
      }
    },
  },
  beforeUnmount() {
    this.stopPolling();
  },
  methods: {
    resetForm() {
      this.defaultValues = alertSourceDefaults(this.editingIntegration);
      this.formKey += 1;
      this.created = false;
      this.createdIntegration = undefined;
      this.waitingForEvent = true;
      this.detectedFormat = "";
    },
    async fetchDestinationOptions() {
      try {
        const res = await destinationService.list({
          org_identifier: this.orgIdentifier,
          module: "alert",
        });
        this.destinationOptions = (res.data ?? []).map((d: any) => ({
          label: raw(d.name),
          value: d.name,
        }));
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.destinationsLoadError") });
      }
    },
    // Destinations are a full resource, so they're created on their own page
    // (new tab) — matches AlertSettings.vue.
    routeToCreateDestination() {
      const url = this.router.resolve({
        name: "alertDestinations",
        query: {
          action: "add",
          org_identifier: this.store.state.selectedOrganization.identifier,
        },
      }).href;
      window.open(url, "_blank");
    },
    // ODrawer only emits click:primary without a form-id — i.e. the "Done"
    // button. Save/Update go through the form's own submit.
    onPrimaryClick() {
      if (this.created) this.onDrawerOpenChange(false);
    },
    onSubmit(values: AlertSourceForm) {
      return this.isEditMode ? this.submitEdit(values) : this.submit(values);
    },
    async submit(values: AlertSourceForm) {
      const name = values.name.trim();
      if (!name) return;
      try {
        const res = await alertSources.create(this.orgIdentifier, {
          name,
          source_type: "auto",
          destinations: values.destinations,
        });
        this.createdIntegration = res.data;
        this.created = true;
        toast({ variant: "success", message: this.t("alert_sources.createdSuccess") });
        this.$emit("created");
        this.startPolling();
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      }
    },
    async submitEdit(values: AlertSourceForm) {
      const name = values.name.trim();
      if (!this.editingIntegration || !name) return;
      try {
        const nameChanged = name !== this.editingIntegration.name;
        const destinationsChanged =
          JSON.stringify([...values.destinations].sort()) !==
          JSON.stringify([...this.editingIntegration.destinations].sort());
        if (nameChanged || destinationsChanged) {
          await alertSources.update(this.orgIdentifier, this.editingIntegration.id, {
            ...(nameChanged ? { name } : {}),
            ...(destinationsChanged ? { destinations: values.destinations } : {}),
          });
        }
        toast({ variant: "success", message: this.t("alert_sources.updatedSuccess") });
        this.$emit("updated");
        this.onDrawerOpenChange(false);
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      }
    },
    startPolling() {
      if (!this.createdIntegration) return;
      this.waitingForEvent = true;
      this.pollDeadline = Date.now() + POLL_TIMEOUT_MS;
      this.pollTimer = setInterval(() => this.pollForFirstEvent(), POLL_INTERVAL_MS);
      this.pollForFirstEvent();
    },
    stopPolling() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = undefined;
      }
    },
    async pollForFirstEvent() {
      if (!this.createdIntegration) return;
      if (Date.now() > this.pollDeadline) {
        this.stopPolling();
        return;
      }
      try {
        const res = await alertSources.listSenders(this.orgIdentifier, this.createdIntegration.id);
        const senders = res.data.senders ?? [];
        if (senders.length > 0) {
          this.waitingForEvent = false;
          this.detectedFormat = senders[0].detected_source;
          this.stopPolling();
        }
      } catch (e) {
        // Transient failures just leave the pill "waiting" for the next tick.
      }
    },
    onDrawerOpenChange(value: boolean) {
      this.$emit("update:open", value);
    },
    cancel() {
      this.stopPolling();
      this.onDrawerOpenChange(false);
    },
  },
});
</script>
