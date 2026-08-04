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
    :primary-button-label="created ? t('alert_sources.done') : t('alert_sources.save')"
    :secondary-button-label="created ? undefined : t('alert_sources.cancel')"
    :primary-button-disabled="!created && !form.name.trim()"
    :primary-button-loading="saving"
    data-test="add-alert-source-drawer"
    @click:primary="onPrimaryClick"
    @click:secondary="cancel"
  >
    <div class="flex flex-col gap-4">
      <OInput
        v-model="form.name"
        :disabled="created"
        :label="t('alert_sources.name')"
        :help-text="t('alert_sources.nameHint')"
        data-test="add-alert-source-name-input"
      />
      <div class="flex flex-col gap-1">
        <p class="text-text-secondary text-xs">{{ t("alert_sources.incidentDestination") }}</p>
        <div class="flex items-center">
          <OSelect
            v-model="form.destinations"
            multiple
            searchable
            :disabled="created"
            class="max-w-[18.75rem] min-w-[11.25rem]"
            :options="destinationOptions"
            :placeholder="t('alert_sources.incidentDestinationPlaceholder')"
            data-test="add-alert-source-destinations-select"
          >
            <template #empty>{{ t("alerts.alertSettings.noDestinationsAvailable") }}</template>
          </OSelect>
          <OButton
            variant="ghost"
            size="icon-circle-sm"
            class="ml-1"
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
            class="ml-2"
            :disabled="created"
            data-test="add-alert-source-create-destination-btn"
            @click="routeToCreateDestination"
          >
            {{ t("alerts.alertSettings.addNewDestination") }}
          </OButton>
        </div>
        <p class="text-text-secondary text-xs">{{ t("alert_sources.incidentDestinationHint") }}</p>
      </div>

      <!-- All 3 setup steps render together from the start (matches the
           ingestion setup cards' OStepper `expanded` checklist pattern) —
           steps 2/3 just show a "save first" placeholder until the source
           exists, instead of being hidden entirely. -->
      <OStepper v-if="!isEditMode" expanded orientation="vertical">
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
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
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
import type { AlertSourceIntegration } from "@/ts/interfaces/alertSources";

// Polls the senders endpoint until the first event arrives, so the admin sees
// wiring confirmed live instead of having to manually refresh the source
// list — closes the "no feedback loop" gap flagged in the design review.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000;

export default defineComponent({
  name: "AddExternalAlertSource",
  components: { ODrawer, OInput, OSelect, OButton, OIcon, OTag, OStepper, OStep, CopyContent },
  props: {
    open: {
      type: Boolean,
      default: false,
    },
    // When set, the drawer opens pre-filled with this integration's current
    // name/destinations and Save patches them in place instead of creating a
    // new source — one row-level "Edit" action covering all editable fields,
    // matching the list ⇄ editor convention used by Destinations/Templates
    // rather than separate per-field popovers.
    editingIntegration: {
      type: Object as () => AlertSourceIntegration | undefined,
      default: undefined,
    },
  },
  emits: ["update:open", "created", "updated"],
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();
    return { store, t, router };
  },
  data() {
    return {
      form: { name: "", destinations: [] as string[] },
      destinationOptions: [] as Array<{ label: string; value: string }>,
      created: false,
      createdIntegration: undefined as AlertSourceIntegration | undefined,
      waitingForEvent: true,
      detectedFormat: "",
      pollTimer: undefined as ReturnType<typeof setInterval> | undefined,
      pollDeadline: 0,
      saving: false,
    };
  },
  computed: {
    orgIdentifier(): string {
      return this.store.state.selectedOrganization.identifier;
    },
    isEditMode(): boolean {
      return !!this.editingIntegration;
    },
    createdUrlSnippet(): string {
      if (!this.createdIntegration) return "";
      const ingestionURL = getIngestionURL();
      const base = getEndPoint(ingestionURL).url;
      return [
        "# URL",
        `${base}/api/v2/${this.orgIdentifier}/incidents/events`,
        "",
        "# Authorization header",
        `Bearer ${this.createdIntegration.token}`,
      ].join("\n");
    },
    createdCurlSnippet(): string {
      if (!this.createdIntegration) return "";
      const ingestionURL = getIngestionURL();
      const base = getEndPoint(ingestionURL).url;
      const url = `${base}/api/v2/${this.orgIdentifier}/incidents/events`;
      // No leading "# curl" comment line here — unlike createdUrlSnippet,
      // this whole block is meant to be pasted straight into a shell and
      // run as-is, so it must contain nothing but valid shell syntax.
      // Body is the minimal payload the generic-format detector accepts
      // (status: firing/resolved + a labels object) — see
      // core/src/alerts/external_alerts/detect.rs — an empty `{}` body
      // fails with "unrecognized payload format".
      return [
        `curl -X POST '${url}' \\`,
        `  -H 'Authorization: Bearer ${this.createdIntegration.token}' \\`,
        `  -H 'Content-Type: application/json' \\`,
        `  -d '{"status": "firing", "labels": {"source": "test"}}'`,
      ].join("\n");
    },
    connectedLabel(): string {
      // Built from a plain (non-interpolated) t() call + string concatenation
      // rather than t(key, { format }) — vue-i18n's named-interpolation path
      // throws on a missing/renamed key instead of warning-and-falling-back
      // the way a plain t() call does, which previously could take down this
      // whole branch's render.
      return `${this.t("alert_sources.connectedPrefix")} ${this.detectedFormat}`;
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
      this.form = this.editingIntegration
        ? {
            name: this.editingIntegration.name,
            destinations: [...this.editingIntegration.destinations],
          }
        : { name: "", destinations: [] };
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
          label: d.name,
          value: d.name,
        }));
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.destinationsLoadError") });
      }
    },
    // Matches AlertSettings.vue's routeToCreateDestination — destinations are
    // a full resource (webhook/email/etc config), so creation always happens
    // on the real Destinations page, not inline. Opens in a new tab; the
    // admin returns and clicks refresh to pick up the new destination.
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
    onPrimaryClick() {
      if (this.created) {
        this.onDrawerOpenChange(false);
      } else if (this.isEditMode) {
        this.submitEdit();
      } else {
        this.submit();
      }
    },
    async submit() {
      if (!this.form.name.trim()) return;
      try {
        const res = await alertSources.create(this.orgIdentifier, {
          name: this.form.name,
          source_type: "auto",
          destinations: this.form.destinations,
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
    async submitEdit() {
      if (!this.editingIntegration || !this.form.name.trim()) return;
      this.saving = true;
      try {
        const name = this.form.name.trim();
        const nameChanged = name !== this.editingIntegration.name;
        const destinationsChanged =
          JSON.stringify([...this.form.destinations].sort()) !==
          JSON.stringify([...this.editingIntegration.destinations].sort());
        if (nameChanged) {
          await alertSources.setName(this.orgIdentifier, this.editingIntegration.id, name);
        }
        if (destinationsChanged) {
          await alertSources.setDestinations(
            this.orgIdentifier,
            this.editingIntegration.id,
            this.form.destinations,
          );
        }
        toast({ variant: "success", message: this.t("alert_sources.updatedSuccess") });
        this.$emit("updated");
        this.onDrawerOpenChange(false);
      } catch (e) {
        toast({ variant: "error", message: this.t("alert_sources.error") });
      } finally {
        this.saving = false;
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
        // Transient poll failures don't need a toast — the pill just stays
        // "waiting" and the next tick tries again.
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
