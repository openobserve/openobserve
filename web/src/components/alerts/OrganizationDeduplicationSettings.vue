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
  <!-- Inline form: OForm renders the <form>, so the footer Save uses
       type="submit" (Enter submits natively — no form-id needed). The component
       OWNS the form (it reads `enabled`/`alert_dedup_enabled` to drive the
       conditional sections) → Rule ③ owner pattern: useOForm + form.useStore +
       <OForm :form>. -->
  <OForm
    id="organization-deduplication-settings-form"
    :form="form"
    v-slot="{ isSubmitting }"
    class="w-full h-full bg-card-glass-bg flex flex-col"
  >
    <!-- Scrollable content area -->
    <div class="flex-1 overflow-y-auto pr-2 pt-4">
      <div class="mb-4">
        <div class="text-sm font-semibold leading-tight text-text-heading">
          {{ t("alerts.correlation.title") }}
        </div>
        <div class="text-xs text-text-secondary mt-1">
          {{ t("alerts.correlation.description") }}
        </div>
        <div class="text-xs text-text-secondary mt-1 italic">
          {{ t("alerts.correlation.semanticFieldNote") }}
        </div>
      </div>

      <OButton
        data-test="dedup-settings-refresh-btn"
        variant="outline"
        size="sm"
        class="mb-6"
        @click="loadConfig"
        >{{ t("common.refresh") }}</OButton
      >

      <!-- Enable Deduplication -->
      <div class="mb-6">
        <OFormCheckbox
          name="enabled"
          data-test="organization-deduplication-enable-checkbox"
          :label="t('alerts.correlation.enableOrgLevel')"
        >
          <OTooltip :content="t('alerts.correlation.enableOrgLevelTooltip')" />
        </OFormCheckbox>
      </div>

      <!-- Cross-Alert Deduplication -->
      <div class="mb-6" v-if="enabled">
        <OFormCheckbox
          name="alert_dedup_enabled"
          data-test="organizationdeduplication-enable-cross-alert-checkbox"
          :label="t('alerts.correlation.enableCrossAlert')"
        >
          <OTooltip :content="t('alerts.correlation.enableCrossAlertTooltip')" />
        </OFormCheckbox>
      </div>

      <!-- Cross-Alert Fingerprint Groups -->
      <div class="mb-6" v-if="enabled && alertDedupEnabled">
        <div class="font-semibold pb-2 flex items-center">
          {{ t("alerts.correlation.fingerprintGroups") }}
          <span class="text-status-error-text ml-1">*</span>
          <OIcon name="info" size="sm" class="ml-1 cursor-pointer" :class="'text-text-secondary'">
            <OTooltip
              side="right"
              align="center"
              :content="t('alerts.correlation.fingerprintGroupsTooltip')"
            />
          </OIcon>
        </div>
        <div class="text-sm text-text-secondary mb-2">
          {{ t("alerts.correlation.fingerprintGroupsHint") }}
        </div>
        <!-- The selected group ids ARE the form's alert_fingerprint_groups
             array. Each per-group OCheckbox is a group member (value = id); the
             group's superRefine "at least one required" error renders below. -->
        <OFormCheckboxGroup name="alert_fingerprint_groups">
          <OCheckbox
            v-for="group in localSemanticGroups"
            :data-test="'organizationdeduplication-fingerprint-' + group.id + '-checkbox'"
            :key="group.id"
            :value="group.id"
            :label="`${group.display} (${group.id})`"
          />
        </OFormCheckboxGroup>
      </div>

      <!-- Time Window -->
      <div class="mb-6">
        <div class="font-semibold pb-2 flex items-center">
          {{ t("alerts.correlation.defaultWindow") }}
          <OIcon name="info" size="sm" class="ml-1 cursor-pointer" :class="'text-text-secondary'" />
          <OTooltip
            side="right"
            align="center"
            :content="t('alerts.correlation.defaultWindowTooltip')"
          />
        </div>
        <div class="text-sm text-text-secondary mb-2">
          {{ t("alerts.correlation.defaultWindowDescription") }}
        </div>
        <OFormInput
          name="time_window_minutes"
          data-test="organizationdeduplication-default-window-input"
          type="number"
          min="1"
          width="md"
          :placeholder="t('alerts.correlation.defaultWindowPlaceholder')"
        />
      </div>
    </div>

    <!-- Sticky footer with buttons -->
    <div
      class="flex justify-end gap-3 pt-4 pb-2 border-t border-border-default bg-inherit sticky bottom-0"
    >
      <OButton
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="$emit('cancel')"
        >{{ t("alerts.correlation.cancelButton") }}</OButton
      >
      <OButton variant="primary" size="sm-action" type="submit" :loading="isSubmitting">{{
        t("alerts.correlation.saveButton")
      }}</OButton>
    </div>
  </OForm>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import alertsService from "@/services/alerts";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import OFormCheckboxGroup from "@/lib/forms/Checkbox/OFormCheckboxGroup.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import {
  makeOrgDedupSettingsSchema,
  orgDedupSettingsDefaults,
  type OrgDedupSettingsForm,
} from "./OrganizationDeduplicationSettings.schema";

const store = useStore();
const { t } = useI18n();

interface FieldAlias {
  id: string;
  display: string;
  group?: string;
  fields: string[];
  normalize: boolean;
  is_stable?: boolean;
}

interface OrganizationDeduplicationConfig {
  enabled: boolean;
  alert_dedup_enabled?: boolean;
  alert_fingerprint_groups?: string[];
  time_window_minutes?: number | null;
}

interface Props {
  orgId: string;
  config?: OrganizationDeduplicationConfig | null;
}

const props = withDefaults(defineProps<Props>(), {
  config: null,
});

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

// Owner pattern (Rule ③): create the ONE form here so the template can read it
// reactively (form.useStore) to drive the conditional sections. Loading is
// form-driven (isSubmitting) — no manual `saving` ref.
const orgDedupSettingsSchema = makeOrgDedupSettingsSchema(t);
const form = useOForm<OrgDedupSettingsForm>({
  defaultValues: orgDedupSettingsDefaults(props.config),
  schema: orgDedupSettingsSchema,
  // Forward to saveSettings (defined below) — arrow avoids a setup-time TDZ ref.
  onSubmit: (value) => saveSettings(value),
});

// Reactive reads for the parent-side v-if sections (single source of truth).
const enabled = form.useStore((s: any) => s.values.enabled);
const alertDedupEnabled = form.useStore((s: any) => s.values.alert_dedup_enabled);

// Available semantic groups (the option list rendered as checkboxes) — NOT form
// data, so it stays a plain local ref.
const localSemanticGroups = ref<FieldAlias[]>([]);

const saveSettings = async (value: OrgDedupSettingsForm) => {
  // @submit fires only when the schema passes, so the cross-alert fingerprint
  // guard is already enforced (superRefine) — no imperative toast-guard here.
  try {
    // Payload parity: build with explicit keys (no {...value} leak) and coerce
    // time_window_minutes exactly like the pre-migration form (empty/NaN → null,
    // else a number).
    const rawWindow = value.time_window_minutes as unknown;
    const payload = {
      enabled: value.enabled,
      alert_dedup_enabled: value.alert_dedup_enabled,
      alert_fingerprint_groups: value.alert_fingerprint_groups,
      time_window_minutes:
        rawWindow == null || rawWindow === "" || isNaN(Number(rawWindow))
          ? null
          : Number(rawWindow),
    };
    await alertsService.setOrganizationDeduplicationConfig(props.orgId, payload);

    toast({
      variant: "success",
      message: t("alerts.correlation.settingsSaved"),
    });

    emit("saved");
  } catch (error: any) {
    console.error("Error saving deduplication settings:", error);
    toast({
      variant: "error",
      message: error?.message || t("alerts.correlation.settingsSaveError"),
    });
  }
};

// Fetch config on mount if not provided. Async data arrives → form.reset() (not
// a setFieldValue loop / local mirror). Also wired to the refresh button (its
// exact behavior is preserved; being type="button" it never submits/validates).
const loadConfig = async () => {
  if (!props.config) {
    try {
      // Load dedup config (does NOT contain semantic groups)
      const response = await alertsService.getOrganizationDeduplicationConfig(props.orgId);
      form.reset(orgDedupSettingsDefaults(response.data));
    } catch (error) {
      // No dedup config exists yet — use defaults
      form.reset(orgDedupSettingsDefaults(null));
    }

    // Always load semantic groups from system_settings (single source of truth)
    try {
      const semanticGroupsResponse = await alertsService.getSemanticGroups(props.orgId);
      localSemanticGroups.value = semanticGroupsResponse.data;
    } catch (semanticError) {
      console.error("Failed to load semantic groups:", semanticError);
      localSemanticGroups.value = [];
    }
  }
};

// Load config on mount
loadConfig();

// Watch for external changes — reset the form from the EXTERNAL source (props),
// not a local mirror. Initial values are already seeded via useOForm's
// defaultValues, so this only handles subsequent prop changes.
watch(
  () => props.config,
  (newVal) => {
    if (newVal) {
      form.reset(orgDedupSettingsDefaults(newVal));
    }
  },
  { deep: true },
);
</script>
