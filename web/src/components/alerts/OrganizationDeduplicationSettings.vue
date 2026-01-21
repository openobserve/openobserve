<!-- Copyright 2025 OpenObserve Inc.

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
  <div class="tw:w-full tw:h-[calc(100vh-172px)] tw:px-2 org-dedup-settings tw:flex tw:flex-col">
    <!-- Scrollable content area -->
    <div class="tw:flex-1 tw:overflow-y-auto tw:pr-2">
      <div class="tw:mb-6">
        <GroupHeader :title="t('alerts.correlation.title')" :showIcon="false" class="tw:mb-2" />
        <div class="text-body2 text-grey-7">
          {{ t('alerts.correlation.description') }}
        </div>
        <div class="text-body2 text-grey-6 tw:mt-2 tw:italic">
          {{ t('alerts.correlation.semanticFieldNote') }}
        </div>
        <q-btn
          data-test="dedup-settings-refresh-btn"
          class="text-bold o2-secondary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
          :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
          flat
          dense
          color="primary"
          :label="t('common.refresh')"
          @click="loadConfig"
        />
      </div>

      <q-separator class="tw:mb-6" />

      <!-- Enable Deduplication -->
      <div class="tw:mb-6">
        <q-checkbox
          data-test="organization-deduplication-enable-checkbox"
          v-model="localConfig.enabled"
          :label="t('alerts.correlation.enableOrgLevel')"
          dense
          @update:model-value="emitUpdate"
        >
          <q-tooltip>
            {{ t('alerts.correlation.enableOrgLevelTooltip') }}
          </q-tooltip>
        </q-checkbox>
      </div>

      <!-- Cross-Alert Deduplication -->
      <div class="tw:mb-6" v-if="localConfig.enabled">
        <q-checkbox
          data-test="organizationdeduplication-enable-cross-alert-checkbox"
          v-model="localConfig.alert_dedup_enabled"
          :label="t('alerts.correlation.enableCrossAlert')"
          dense
          @update:model-value="emitUpdate"
        >
          <q-tooltip>
            {{ t('alerts.correlation.enableCrossAlertTooltip') }}
          </q-tooltip>
        </q-checkbox>
      </div>

      <!-- Cross-Alert Fingerprint Groups -->
      <div class="tw:mb-6" v-if="localConfig.alert_dedup_enabled">
        <div class="tw:font-semibold tw:pb-2 tw:flex tw:items-center">
          {{ t('alerts.correlation.fingerprintGroups') }} <span class="tw:text-red-500 tw:ml-1">*</span>
          <q-icon
            :name="outlinedInfo"
            size="17px"
            class="q-ml-xs cursor-pointer"
            :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
          >
            <q-tooltip
              anchor="center right"
              self="center left"
              max-width="300px"
              style="font-size: 12px"
            >
              {{ t('alerts.correlation.fingerprintGroupsTooltip') }}
            </q-tooltip>
          </q-icon>
        </div>
        <div class="tw:text-sm tw:text-gray-600 dark:tw:text-gray-400 tw:mb-2">
          {{ t('alerts.correlation.fingerprintGroupsHint') }}
        </div>
        <div class="tw:flex tw:flex-col tw:gap-2">
          <q-checkbox
            v-for="group in localSemanticGroups"
            :data-test="'organizationdeduplication-fingerprint-' + group.id + '-checkbox'"
            :key="group.id"
            :model-value="localConfig.alert_fingerprint_groups?.includes(group.id)"
            @update:model-value="(val) => toggleFingerprintGroup(group.id, val)"
            :label="`${group.display} (${group.id})`"
            dense
          />
          <div
            v-if="!localConfig.alert_fingerprint_groups || localConfig.alert_fingerprint_groups.length === 0"
            class="tw:text-red-500 tw:text-sm tw:mt-1"
          >
            {{ t('alerts.correlation.fingerprintGroupsRequired') }}
          </div>
        </div>
      </div>

      <!-- Time Window -->
      <div class="tw:mb-6">
        <div class="tw:font-semibold tw:pb-2 tw:flex tw:items-center">
          {{ t('alerts.correlation.defaultWindow') }}
          <q-icon
            :name="outlinedInfo"
            size="17px"
            class="q-ml-xs cursor-pointer"
            :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
          >
            <q-tooltip
              anchor="center right"
              self="center left"
              max-width="300px"
              style="font-size: 12px"
            >
              {{ t('alerts.correlation.defaultWindowTooltip') }}
            </q-tooltip>
          </q-icon>
        </div>
        <div class="tw:text-sm tw:text-gray-600 dark:tw:text-gray-400 tw:mb-2">
          {{ t('alerts.correlation.defaultWindowDescription') }}
        </div>
        <q-input
          data-test="organizationdeduplication-default-window-input"
          v-model.number="localConfig.time_window_minutes"
          type="number"
          dense
          borderless
          min="1"
          :placeholder="t('alerts.correlation.defaultWindowPlaceholder')"
          :class="
            store.state.theme === 'dark'
              ? 'input-box-bg-dark input-border-dark'
              : 'input-box-bg-light input-border-light'
          "
          @update:model-value="emitUpdate"
        />
      </div>
    </div>

    <!-- Sticky footer with buttons -->
    <div class="tw:flex tw:justify-end tw:gap-3 tw:pt-4 tw:pb-2 tw:border-t tw:border-gray-200 dark:tw:border-gray-700 tw:bg-inherit tw:sticky tw:bottom-0">
      <q-btn :label="t('alerts.correlation.cancelButton')" @click="$emit('cancel')" class="o2-secondary-button" />
      <q-btn
        :label="t('alerts.correlation.saveButton')"
        @click="saveSettings"
        :loading="saving"
        class="o2-primary-button"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import alertsService from "@/services/alerts";
import GroupHeader from "@/components/common/GroupHeader.vue";

const store = useStore();
const $q = useQuasar();
const { t } = useI18n();

interface SemanticFieldGroup {
  id: string;
  display: string;
  group?: string;
  fields: string[];
  normalize: boolean;
  is_stable?: boolean;
}

interface OrganizationDeduplicationConfig {
  enabled: boolean;
  semantic_field_groups?: SemanticFieldGroup[];
  alert_dedup_enabled?: boolean;
  alert_fingerprint_groups?: string[];
  time_window_minutes?: number;
  fqn_priority_dimensions?: string[];
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

const saving = ref(false);

const localConfig = ref<OrganizationDeduplicationConfig>({
  enabled: true,
  alert_dedup_enabled: props.config?.alert_dedup_enabled ?? true,
  alert_fingerprint_groups: props.config?.alert_fingerprint_groups ?? [],
  time_window_minutes: props.config?.time_window_minutes ?? undefined,
  semantic_field_groups: props.config?.semantic_field_groups ?? [],
  fqn_priority_dimensions: props.config?.fqn_priority_dimensions,
});

const localSemanticGroups = ref<SemanticFieldGroup[]>(
  props.config?.semantic_field_groups ?? [],
);

const toggleFingerprintGroup = (groupId: string, checked: boolean) => {
  if (!localConfig.value.alert_fingerprint_groups) {
    localConfig.value.alert_fingerprint_groups = [];
  }

  if (checked) {
    if (!localConfig.value.alert_fingerprint_groups.includes(groupId)) {
      localConfig.value.alert_fingerprint_groups.push(groupId);
    }
  } else {
    localConfig.value.alert_fingerprint_groups =
      localConfig.value.alert_fingerprint_groups.filter((id) => id !== groupId);
  }
};

const emitUpdate = () => {
  // Just update local state, don't auto-save
};

const saveSettings = async () => {
  // Validate cross-alert dedup requires fingerprint groups
  if (localConfig.value.alert_dedup_enabled) {
    if (!localConfig.value.alert_fingerprint_groups ||
        localConfig.value.alert_fingerprint_groups.length === 0) {
      $q.notify({
        type: "negative",
        message: "Please select at least one semantic group for cross-alert deduplication",
        timeout: 3000,
      });
      return;
    }
  }

  saving.value = true;
  try {
    await alertsService.setOrganizationDeduplicationConfig(
      props.orgId,
      localConfig.value,
    );

    $q.notify({
      type: "positive",
      message:
        "Organization deduplication settings saved successfully",
      timeout: 2000,
    });

    emit("saved");
  } catch (error: any) {
    console.error("Error saving deduplication settings:", error);
    $q.notify({
      type: "negative",
      message: error?.message || "Failed to save settings",
      timeout: 3000,
    });
  } finally {
    saving.value = false;
  }
};

// Fetch config on mount if not provided
const loadConfig = async () => {
  if (!props.config) {
    try {
      // Try to get existing config
      const response = await alertsService.getOrganizationDeduplicationConfig(props.orgId);
      const config = response.data;
      localConfig.value = {
        enabled: config.enabled ?? true,
        alert_dedup_enabled: config.alert_dedup_enabled ?? true,
        alert_fingerprint_groups: config.alert_fingerprint_groups ?? [],
        time_window_minutes: config.time_window_minutes ?? undefined,
        semantic_field_groups: config.semantic_field_groups ?? [],
        fqn_priority_dimensions: config.fqn_priority_dimensions,
      };
      localSemanticGroups.value = config.semantic_field_groups ?? [];
    } catch (error) {
      // Load default semantic groups from backend
      try {
        const semanticGroupsResponse = await alertsService.getSemanticGroups(props.orgId);
        const defaultGroups = semanticGroupsResponse.data;

        localConfig.value = {
          enabled: true,
          alert_dedup_enabled: true,
          alert_fingerprint_groups: [],
          time_window_minutes: undefined,
          semantic_field_groups: defaultGroups,
          fqn_priority_dimensions: undefined,
        };
        localSemanticGroups.value = defaultGroups;
      } catch (semanticError) {
        console.error("Failed to load default semantic groups:", semanticError);
        // Fallback to empty
        localSemanticGroups.value = [];
      }
    }
  }
};

// Load config on mount
loadConfig();

// Watch for external changes
watch(
  () => props.config,
  (newVal) => {
    if (newVal) {
      localConfig.value = {
        enabled: newVal.enabled ?? true,
        alert_dedup_enabled: newVal.alert_dedup_enabled ?? true,
        alert_fingerprint_groups: newVal.alert_fingerprint_groups ?? [],
        time_window_minutes: newVal.time_window_minutes ?? undefined,
        semantic_field_groups: newVal.semantic_field_groups ?? [],
        fqn_priority_dimensions: newVal.fqn_priority_dimensions,
      };
      localSemanticGroups.value = newVal.semantic_field_groups ?? [];
    }
  },
  { deep: true, immediate: true },
);
</script>

<style scoped lang="scss">
.org-dedup-settings {
  // Match parent card-container background
  background: var(--o2-card-bg);
}
</style>
