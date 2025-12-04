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
  <q-card flat class="tw-p-6">
    <div class="tw-mb-6">
      <div class="text-h6 tw-mb-2">Alert Deduplication</div>
      <div class="text-body2 text-grey-7">
        Configure organization-wide semantic field groups and default time windows.
        Semantic groups define which field name variations represent the same dimension
        (e.g., "host", "hostname", "node" all map to "host"). Each alert specifies which
        fields to use for fingerprinting in its own configuration.
      </div>
    </div>

    <q-separator class="tw-mb-6" />

    <!-- Enable Deduplication -->
    <div class="tw-mb-6">
      <q-checkbox
        v-model="localConfig.enabled"
        label="Enable Organization-Level Deduplication"
        dense
        @update:model-value="emitUpdate"
      >
        <q-tooltip>
          Enable deduplication and correlation features for all alerts in this organization
        </q-tooltip>
      </q-checkbox>
    </div>

    <!-- Cross-Alert Deduplication -->
    <div class="tw-mb-6" v-if="localConfig.enabled">
      <q-checkbox
        v-model="localConfig.alert_dedup_enabled"
        label="Enable Cross-Alert Deduplication"
        dense
        @update:model-value="emitUpdate"
      >
        <q-tooltip>
          Allow different alerts to deduplicate each other when they share the same fingerprint
        </q-tooltip>
      </q-checkbox>
    </div>

    <!-- Semantic Field Groups Configuration -->
    <div class="tw-mb-6" v-if="localConfig.enabled">
      <SemanticFieldGroupsConfig
        v-model:semantic-field-groups="localSemanticGroups"
        @update:semantic-field-groups="handleSemanticGroupsUpdate"
      />
    </div>

    <!-- Cross-Alert Fingerprint Groups -->
    <div class="tw-mb-6" v-if="localConfig.alert_dedup_enabled">
      <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center">
        Cross-Alert Fingerprint Groups <span class="tw-text-red-500 tw-ml-1">*</span>
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
            Select which semantic groups to use for cross-alert fingerprinting.
            Alerts will be deduplicated if they share the same values for these dimensions.
          </q-tooltip>
        </q-icon>
      </div>
      <div class="tw-text-sm tw-text-gray-600 dark:tw-text-gray-400 tw-mb-2">
        Select at least one semantic group for cross-alert deduplication
      </div>
      <div class="tw-flex tw-flex-col tw-gap-2">
        <q-checkbox
          v-for="group in localSemanticGroups"
          :key="group.id"
          :model-value="localConfig.alert_fingerprint_groups?.includes(group.id)"
          @update:model-value="(val) => toggleFingerprintGroup(group.id, val)"
          :label="`${group.display} (${group.id})`"
          dense
        />
        <div
          v-if="!localConfig.alert_fingerprint_groups || localConfig.alert_fingerprint_groups.length === 0"
          class="tw-text-red-500 tw-text-sm tw-mt-1"
        >
          At least one semantic group must be selected
        </div>
      </div>
    </div>

    <!-- Time Window -->
    <div class="tw-mb-6">
      <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center">
        Default Correlation Window (minutes)
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
            In absence of semantic field match, alerts and data from given
            duration is considered related
          </q-tooltip>
        </q-icon>
      </div>
      <div class="tw-text-sm tw-text-gray-600 dark:tw-text-gray-400 tw-mb-2">
        In absence of semantic field match, alerts and data from given duration
        is considered related
      </div>
      <q-input
        v-model.number="localConfig.time_window_minutes"
        type="number"
        dense
        filled
        min="1"
        placeholder="Use alert period by default"
        :class="
          store.state.theme === 'dark'
            ? 'input-box-bg-dark input-border-dark'
            : 'input-box-bg-light input-border-light'
        "
        @update:model-value="emitUpdate"
      />
    </div>

    <div class="tw-flex tw-justify-end tw-gap-3">
      <q-btn outline label="Cancel" @click="$emit('cancel')" class="tw-px-4" />
      <q-btn
        label="Save Settings"
        color="primary"
        @click="saveSettings"
        :loading="saving"
        class="tw-px-4"
      />
    </div>
  </q-card>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import SemanticFieldGroupsConfig from "./SemanticFieldGroupsConfig.vue";
import alertsService from "@/services/alerts";

const store = useStore();
const $q = useQuasar();

interface SemanticFieldGroup {
  id: string;
  display: string;
  group?: string;
  fields: string[];
  normalize: boolean;
}

interface OrganizationDeduplicationConfig {
  enabled: boolean;
  semantic_field_groups?: SemanticFieldGroup[];
  alert_dedup_enabled?: boolean;
  alert_fingerprint_groups?: string[];
  time_window_minutes?: number;
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
});

const localSemanticGroups = ref<SemanticFieldGroup[]>(
  props.config?.semantic_field_groups ?? [],
);

const handleSemanticGroupsUpdate = (groups: SemanticFieldGroup[]) => {
  localConfig.value.semantic_field_groups = groups;
  localSemanticGroups.value = groups;
};

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
      console.log("Loaded dedup config:", config);
      localConfig.value = {
        enabled: config.enabled ?? true,
        alert_dedup_enabled: config.alert_dedup_enabled ?? true,
        alert_fingerprint_groups: config.alert_fingerprint_groups ?? [],
        time_window_minutes: config.time_window_minutes ?? undefined,
        semantic_field_groups: config.semantic_field_groups ?? [],
      };
      localSemanticGroups.value = config.semantic_field_groups ?? [];
    } catch (error) {
      console.log("No existing config, loading default semantic groups from backend", error);

      // Load default semantic groups from backend
      try {
        const semanticGroupsResponse = await alertsService.getSemanticGroups(props.orgId);
        const defaultGroups = semanticGroupsResponse.data;
        console.log(`Loaded ${defaultGroups.length} default semantic groups from backend`);

        localConfig.value = {
          enabled: true,
          alert_dedup_enabled: true,
          alert_fingerprint_groups: [],
          time_window_minutes: undefined,
          semantic_field_groups: defaultGroups,
        };
        localSemanticGroups.value = defaultGroups;
      } catch (semanticError) {
        console.error("Failed to load default semantic groups:", semanticError);
        // Fallback to empty
        localSemanticGroups.value = [];
      }
    }
  } else {
    console.log("Using config from props:", props.config);
  }
};

// Load config on mount
loadConfig();

// Watch for external changes
watch(
  () => props.config,
  (newVal) => {
    if (newVal) {
      console.log("Config changed from props:", newVal);
      localConfig.value = {
        enabled: newVal.enabled ?? true,
        alert_dedup_enabled: newVal.alert_dedup_enabled ?? true,
        alert_fingerprint_groups: newVal.alert_fingerprint_groups ?? [],
        time_window_minutes: newVal.time_window_minutes ?? undefined,
        semantic_field_groups: newVal.semantic_field_groups ?? [],
      };
      localSemanticGroups.value = newVal.semantic_field_groups ?? [];
      console.log("Updated localConfig:", localConfig.value);
      console.log("Updated localSemanticGroups:", localSemanticGroups.value);
    }
  },
  { deep: true, immediate: true },
);
</script>

<style scoped lang="scss">
.q-card {
  max-width: 1200px;
}
</style>
