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
  <div class="tw-w-full service-identity-config">
    <!-- Section Header -->
    <GroupHeader :title="t('settings.correlation.serviceIdentityTitle')" :showIcon="false" class="tw-mb-2" />
    <div class="text-body2 text-grey-7 tw-mb-4">
      {{ t("settings.correlation.serviceIdentityDescription") }}
    </div>

    <!-- How it works explanation -->
    <q-expansion-item
      dense
      dense-toggle
      icon="help_outline"
      :label="t('settings.correlation.howItWorksTitle')"
      class="tw-mb-4 tw-rounded-lg"
      :class="store.state.theme === 'dark' ? 'bg-grey-9' : 'bg-grey-2'"
    >
      <div class="tw-p-4 text-body2 tw-leading-relaxed">
        <div class="tw-mb-3">
          <span class="tw-font-semibold text-primary">Service FQN</span>
          <span class="text-grey-7"> {{ t("settings.correlation.howItWorksDescription") }}</span>
        </div>
        <div class="tw-mb-3">
          <span class="tw-font-semibold text-primary">{{ t("settings.correlation.priorityOrderLabel") }}</span>
          <span class="text-grey-7"> {{ t("settings.correlation.priorityOrderDescription") }}</span>
        </div>
        <div class="tw-mb-3 tw-p-3 tw-rounded" :class="store.state.theme === 'dark' ? 'bg-grey-10' : 'bg-white'">
          <span class="tw-font-semibold text-primary">{{ t("settings.correlation.exampleLabel") }} </span>
          <i18n-t keypath="settings.correlation.exampleText" tag="span" class="text-grey-7">
            <template #dim1>
              <q-chip dense size="sm" color="primary" text-color="white" class="tw-mx-1">k8s-deployment=my-app</q-chip>
            </template>
            <template #dim2>
              <q-chip dense size="sm" color="grey-7" text-color="white" class="tw-mx-1">service=myapp</q-chip>
            </template>
            <template #value>
              <q-chip dense size="sm" color="positive" text-color="white" class="tw-mx-1">my-app</q-chip>
            </template>
          </i18n-t>
        </div>
        <div>
          <span class="tw-font-semibold text-primary">{{ t("settings.correlation.correlationLabel") }} </span>
          <i18n-t keypath="settings.correlation.correlationDescription" tag="span" class="text-grey-7">
            <template #field>
              <span class="tw-font-mono tw-font-semibold">service</span>
            </template>
          </i18n-t>
        </div>
      </div>
    </q-expansion-item>

    <!-- FQN Priority Dimensions - Collapsible Section -->
    <q-expansion-item
      v-model="fqnSectionExpanded"
      icon="reorder"
      :label="t('settings.correlation.fqnPriorityTitle')"
      :caption="t('settings.correlation.fqnPriorityDescription')"
      header-class="section-header"
      class="tw-mb-4 tw-rounded-lg tw-border tw-border-solid"
      :class="store.state.theme === 'dark' ? 'tw-border-gray-700' : 'tw-border-gray-200'"
      default-opened
    >
      <div class="tw-p-4">
        <div class="tw-flex tw-gap-2 tw-mb-3">
          <q-btn
            flat
            dense
            size="sm"
            icon="restart_alt"
            :label="t('settings.correlation.resetToDefaults')"
            @click="resetFqnPriority"
          />
          <q-icon
            :name="outlinedInfo"
            size="1rem"
            class="cursor-pointer tw-self-center"
            :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
          >
            <q-tooltip
              anchor="center right"
              self="center left"
              max-width="21.875rem"
              class="tooltip-text"
            >
              {{ t("settings.correlation.fqnPriorityTooltip") }}
            </q-tooltip>
          </q-icon>
        </div>

        <q-list bordered class="tw-rounded-lg">
        <q-item
          v-for="(dim, index) in localFqnPriority"
          :key="dim"
          dense
          class="tw-py-2"
        >
          <q-item-section avatar class="tw-min-w-0">
            <q-badge
              :color="index < 4 ? 'primary' : 'grey'"
              text-color="white"
              class="tw-w-6 tw-h-6 tw-flex tw-items-center tw-justify-center tw-rounded-full"
            >
              {{ index + 1 }}
            </q-badge>
          </q-item-section>
          <q-item-section>
            <q-item-label class="tw-font-medium">{{ getDimensionDisplay(dim) }}</q-item-label>
            <q-item-label caption class="tw-font-mono tw-text-xs">{{ dim }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <div class="tw-flex tw-gap-1">
              <q-btn
                flat
                dense
                round
                size="sm"
                icon="arrow_upward"
                :disable="index === 0"
                @click="moveFqnDimensionUp(index)"
              >
                <q-tooltip>{{ t("settings.correlation.moveUp") }}</q-tooltip>
              </q-btn>
              <q-btn
                flat
                dense
                round
                size="sm"
                icon="arrow_downward"
                :disable="index === localFqnPriority.length - 1"
                @click="moveFqnDimensionDown(index)"
              >
                <q-tooltip>{{ t("settings.correlation.moveDown") }}</q-tooltip>
              </q-btn>
              <q-btn
                flat
                dense
                round
                size="sm"
                icon="delete"
                color="negative"
                @click="removeFqnDimension(index)"
              >
                <q-tooltip>{{ t("settings.correlation.removeFromList") }}</q-tooltip>
              </q-btn>
            </div>
          </q-item-section>
        </q-item>
        <q-item v-if="localFqnPriority.length === 0" class="tw-py-4 tw-text-center tw-text-gray-500">
          {{ t("settings.correlation.noDimensionsConfigured") }}
        </q-item>
      </q-list>

      <!-- Add new dimension from semantic groups - Two step: 1) Select group 2) Select field -->
      <div class="tw-mt-3">
        <div class="tw-text-sm tw-text-gray-600 dark:tw-text-gray-400 tw-mb-2">
          {{ t("settings.correlation.addDimensionHint") }}
        </div>
        <div class="tw-flex tw-gap-2 tw-items-end">
          <!-- Step 1: Select Semantic Group -->
          <q-select
            v-model="selectedSemanticGroup"
            :options="availableSemanticGroups"
            dense
            borderless
            stack-label
            :label="t('settings.correlation.selectSemanticGroup')"
            class="tw-flex-1 showLabelOnTop"
            emit-value
            map-options
            clearable
            :disable="availableSemanticGroups.length === 0"
          >
            <template v-slot:option="scope">
              <q-item v-bind="scope.itemProps">
                <q-item-section>
                  <q-item-label>{{ scope.opt.label }}</q-item-label>
                  <q-item-label caption class="tw-text-xs">
                    {{ scope.opt.fieldCount }} {{ t("settings.correlation.fieldsAvailable") }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </template>
            <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-grey">
                  {{ t("settings.correlation.noSemanticGroupsAvailable") }}
                </q-item-section>
              </q-item>
            </template>
          </q-select>

          <!-- Step 2: Select Field from Group -->
          <q-select
            v-model="newFqnDimension"
            :options="availableFieldsFromGroup"
            dense
            borderless
            stack-label
            :label="t('settings.correlation.selectField')"
            class="tw-flex-1 showLabelOnTop"
            emit-value
            map-options
            clearable
            :disable="!selectedSemanticGroup || availableFieldsFromGroup.length === 0"
          >
            <template v-slot:option="scope">
              <q-item v-bind="scope.itemProps">
                <q-item-section>
                  <q-item-label class="tw-font-mono">{{ scope.opt.label }}</q-item-label>
                </q-item-section>
              </q-item>
            </template>
            <template v-slot:no-option>
              <q-item>
                <q-item-section class="text-grey">
                  {{ selectedSemanticGroup ? t("settings.correlation.allFieldsAdded") : t("settings.correlation.selectGroupFirst") }}
                </q-item-section>
              </q-item>
            </template>
          </q-select>

          <q-btn
            flat
            dense
            icon="add"
            color="primary"
            :disable="!newFqnDimension"
            @click="addFqnDimension"
          >
            <q-tooltip>{{ t("settings.correlation.addDimensionLabel") }}</q-tooltip>
          </q-btn>
        </div>
      </div>
      <div v-if="availableSemanticGroups.length === 0 && localSemanticGroups.length === 0" class="tw-mt-2 tw-text-sm tw-text-amber-600 dark:tw-text-amber-400">
        {{ t("settings.correlation.noSemanticGroupsConfigured") }}
      </div>

        <!-- Save FQN Priority Button -->
        <div class="tw-flex tw-justify-end tw-mt-4">
          <q-btn
            :label="t('common.save')"
            color="primary"
            @click="saveFqnPriority"
            :loading="savingFqn"
            class="tw-px-4"
          />
        </div>
      </div>
    </q-expansion-item>

    <!-- Semantic Field Groups - Collapsible Section -->
    <q-expansion-item
      v-model="semanticSectionExpanded"
      icon="category"
      :label="t('settings.correlation.semanticFieldTitle')"
      :caption="t('settings.correlation.semanticFieldDescription')"
      header-class="section-header"
      class="tw-mb-4 tw-rounded-lg tw-border tw-border-solid"
      :class="store.state.theme === 'dark' ? 'tw-border-gray-700' : 'tw-border-gray-200'"
      default-opened
    >
      <div class="tw-p-4">
          <SemanticFieldGroupsConfig
          v-model:semantic-field-groups="localSemanticGroups"
          @update:semantic-field-groups="handleSemanticGroupsUpdate"
        />

        <!-- Save Semantic Mappings Button -->
        <div class="tw-flex tw-justify-end tw-mt-4">
          <q-btn
            :label="t('common.save')"
            color="primary"
            @click="saveSemanticMappings"
            :loading="savingSemanticMappings"
            class="tw-px-4"
          />
        </div>
      </div>
    </q-expansion-item>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import SemanticFieldGroupsConfig from "@/components/alerts/SemanticFieldGroupsConfig.vue";
import GroupHeader from "@/components/common/GroupHeader.vue";
import alertsService from "@/services/alerts";
import settingsService from "@/services/settings";

const store = useStore();
const $q = useQuasar();
const { t } = useI18n();

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
  fqn_priority_dimensions?: string[];
}

// Default FQN priority dimensions - empty by default, uses O2_FQN_PRIORITY_DIMENSIONS env var
const DEFAULT_FQN_PRIORITY: string[] = [];

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

const savingFqn = ref(false);
const savingSemanticMappings = ref(false);
const fqnSectionExpanded = ref(true);
const semanticSectionExpanded = ref(true);
const localFqnPriority = ref<string[]>([...DEFAULT_FQN_PRIORITY]);
const localSemanticGroups = ref<SemanticFieldGroup[]>([]);
const selectedSemanticGroup = ref<string | null>(null);
const newFqnDimension = ref<string | null>(null);

// Full config for saving
const localConfig = ref<OrganizationDeduplicationConfig>({
  enabled: true,
  alert_dedup_enabled: props.config?.alert_dedup_enabled ?? true,
  alert_fingerprint_groups: props.config?.alert_fingerprint_groups ?? [],
  time_window_minutes: props.config?.time_window_minutes ?? undefined,
  semantic_field_groups: props.config?.semantic_field_groups ?? [],
  fqn_priority_dimensions: props.config?.fqn_priority_dimensions ?? [...DEFAULT_FQN_PRIORITY],
});

// Reserved IDs that should not be used as semantic groups
// service-fqn is the OUTPUT of correlation, not an input dimension
const RESERVED_GROUP_IDS = ['service-fqn', 'servicefqn', 'fqn'];

// Computed: Get all semantic groups for the first dropdown
// Shows groups that have at least one field not yet in the priority list
const availableSemanticGroups = computed(() => {
  const semanticGroups = localSemanticGroups.value.length > 0
    ? localSemanticGroups.value
    : localConfig.value.semantic_field_groups || [];

  return semanticGroups
    .filter(group => {
      // Exclude reserved/computed fields like service-fqn (it's the output, not an input)
      if (RESERVED_GROUP_IDS.includes(group.id?.toLowerCase())) {
        return false;
      }
      // Check if this group has any fields not already in the priority list
      const availableFields = group.fields?.filter(field => !localFqnPriority.value.includes(field)) || [];
      return availableFields.length > 0;
    })
    .map(group => ({
      label: group.display || group.id,
      value: group.id,
      fieldCount: (group.fields?.filter(field => !localFqnPriority.value.includes(field)) || []).length
    }));
});

// Computed: Get fields from the selected semantic group that aren't already in priority list
const availableFieldsFromGroup = computed(() => {
  if (!selectedSemanticGroup.value) return [];

  const semanticGroups = localSemanticGroups.value.length > 0
    ? localSemanticGroups.value
    : localConfig.value.semantic_field_groups || [];

  const group = semanticGroups.find(g => g.id === selectedSemanticGroup.value);
  if (!group?.fields) return [];

  // Filter out reserved IDs and fields already in the priority list
  return group.fields
    .filter(field => {
      // Exclude reserved/computed field names
      if (RESERVED_GROUP_IDS.includes(field?.toLowerCase())) {
        return false;
      }
      return !localFqnPriority.value.includes(field);
    })
    .map(field => ({
      label: field,
      value: field
    }));
});

// Get display name for a dimension - check semantic groups first, then format the ID
const getDimensionDisplay = (dimId: string): string => {
  const semanticGroups = localSemanticGroups.value.length > 0
    ? localSemanticGroups.value
    : localConfig.value.semantic_field_groups;
  const group = semanticGroups.find(g => g.id === dimId);
  if (group?.display) {
    return group.display;
  }
  // Format the dimension ID as a display name (e.g., "k8s-deployment" -> "K8s Deployment")
  return dimId
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Get fields for a dimension from semantic groups (for description)
const getFieldsForDimension = (dimId: string): string => {
  const semanticGroups = localSemanticGroups.value.length > 0
    ? localSemanticGroups.value
    : localConfig.value.semantic_field_groups;
  const group = semanticGroups.find(g => g.id === dimId);
  if (group?.fields?.length) {
    return group.fields.slice(0, 3).join(", ") + (group.fields.length > 3 ? "..." : "");
  }
  return "";
};

const handleSemanticGroupsUpdate = (groups: SemanticFieldGroup[]) => {
  // Filter out reserved IDs like service-fqn (it's the output, not an input)
  const filteredGroups = groups.filter(g => !RESERVED_GROUP_IDS.includes(g.id?.toLowerCase()));
  localConfig.value.semantic_field_groups = filteredGroups;
  localSemanticGroups.value = filteredGroups;
};

// FQN Priority dimension management
const moveFqnDimensionUp = (index: number) => {
  if (index === 0) return;
  const dims = [...localFqnPriority.value];
  [dims[index - 1], dims[index]] = [dims[index], dims[index - 1]];
  localFqnPriority.value = dims;
};

const moveFqnDimensionDown = (index: number) => {
  if (index >= localFqnPriority.value.length - 1) return;
  const dims = [...localFqnPriority.value];
  [dims[index], dims[index + 1]] = [dims[index + 1], dims[index]];
  localFqnPriority.value = dims;
};

const removeFqnDimension = (index: number) => {
  localFqnPriority.value.splice(index, 1);
};

const addFqnDimension = () => {
  if (!newFqnDimension.value) return;
  localFqnPriority.value.push(newFqnDimension.value);
  newFqnDimension.value = null;
  // Clear group selection if no more fields available from this group
  if (availableFieldsFromGroup.value.length === 0) {
    selectedSemanticGroup.value = null;
  }
};

const resetFqnPriority = () => {
  // Reset to backend defaults from O2_FQN_PRIORITY_DIMENSIONS
  const backendDefaults = store.state.zoConfig?.fqn_priority_dimensions || [];
  localFqnPriority.value = [...backendDefaults];
};

const saveFqnPriority = async () => {
  savingFqn.value = true;
  try {
    // Update local config
    localConfig.value.fqn_priority_dimensions = localFqnPriority.value;

    // Save FQN priority dimensions using settings v2 API (org-level setting)
    await settingsService.setOrgSetting(
      props.orgId,
      "fqn_priority_dimensions",
      localFqnPriority.value,
      "correlation",
      "FQN priority dimensions for service correlation"
    );

    $q.notify({
      type: "positive",
      message: t("settings.correlation.fqnPrioritySaved"),
      timeout: 2000,
    });

    emit("saved");
  } catch (error: any) {
    console.error("Error saving FQN priority settings:", error);
    $q.notify({
      type: "negative",
      message: error?.message || t("settings.correlation.configSaveFailed"),
      timeout: 3000,
    });
  } finally {
    savingFqn.value = false;
  }
};

const saveSemanticMappings = async () => {
  savingSemanticMappings.value = true;
  try {
    // Update local config
    localConfig.value.semantic_field_groups = localSemanticGroups.value;

    // Save semantic field groups using settings v2 API (org-level setting)
    await settingsService.setOrgSetting(
      props.orgId,
      "semantic_field_groups",
      localSemanticGroups.value,
      "correlation",
      "Semantic field groups for dimension extraction and correlation"
    );

    // Also save semantic field groups to deduplication config API (for backward compatibility)
    await alertsService.setOrganizationDeduplicationConfig(
      props.orgId,
      localConfig.value,
    );

    $q.notify({
      type: "positive",
      message: t("settings.correlation.semanticMappingsSaved"),
      timeout: 2000,
    });

    emit("saved");
  } catch (error: any) {
    console.error("Error saving semantic mappings:", error);
    $q.notify({
      type: "negative",
      message: error?.message || t("settings.correlation.configSaveFailed"),
      timeout: 3000,
    });
  } finally {
    savingSemanticMappings.value = false;
  }
};

// Fetch config on mount if not provided
const loadConfig = async () => {
  // Get backend defaults for FQN priority dimensions
  const backendDefaults = store.state.zoConfig?.fqn_priority_dimensions || [];

  if (!props.config) {
    try {
      // First, try to load FQN priority from settings v2 API
      let fqnPriorityFromSettings: string[] | null = null;
      try {
        const settingResponse = await settingsService.getSetting(props.orgId, "fqn_priority_dimensions");
        const setting = settingResponse.data;
        console.log("ServiceIdentityConfig: Loaded FQN setting from v2 API:", setting);
        if (setting?.setting_value && Array.isArray(setting.setting_value) && setting.setting_value.length > 0) {
          fqnPriorityFromSettings = setting.setting_value;
        }
      } catch (settingError: any) {
        // 404 means setting not found, which is fine - use defaults
        if (settingError?.response?.status !== 404) {
          console.log("ServiceIdentityConfig: Error loading FQN settings v2, using defaults:", settingError);
        }
      }

      // Try to load semantic field groups from settings v2 API
      let semanticGroupsFromSettings: SemanticFieldGroup[] | null = null;
      try {
        const semanticSettingResponse = await settingsService.getSetting(props.orgId, "semantic_field_groups");
        const semanticSetting = semanticSettingResponse.data;
        console.log("ServiceIdentityConfig: Loaded semantic groups setting from v2 API:", semanticSetting);
        if (semanticSetting?.setting_value && Array.isArray(semanticSetting.setting_value) && semanticSetting.setting_value.length > 0) {
          semanticGroupsFromSettings = semanticSetting.setting_value;
        }
      } catch (settingError: any) {
        // 404 means setting not found, which is fine - fall back to dedup config
        if (settingError?.response?.status !== 404) {
          console.log("ServiceIdentityConfig: Error loading semantic groups settings v2:", settingError);
        }
      }

      // Load deduplication config for backward compatibility (if settings v2 not found)
      let dedupConfig: any = null;
      try {
        const response = await alertsService.getOrganizationDeduplicationConfig(props.orgId);
        dedupConfig = response.data;
        console.log("ServiceIdentityConfig: Loaded dedup config:", dedupConfig);
      } catch (dedupError) {
        console.log("ServiceIdentityConfig: No dedup config found:", dedupError);
      }

      // Use settings v2 FQN priority if available, otherwise use backend defaults
      const fqnPriority = fqnPriorityFromSettings ?? [...backendDefaults];

      // Use settings v2 semantic groups if available, otherwise fall back to dedup config
      // If neither exists, load default semantic groups from backend
      let semanticGroups: SemanticFieldGroup[] = [];
      if (semanticGroupsFromSettings) {
        semanticGroups = semanticGroupsFromSettings;
      } else if (dedupConfig?.semantic_field_groups && dedupConfig.semantic_field_groups.length > 0) {
        semanticGroups = dedupConfig.semantic_field_groups;
      } else {
        // Load default semantic groups from backend
        try {
          const semanticGroupsResponse = await alertsService.getSemanticGroups(props.orgId);
          semanticGroups = semanticGroupsResponse.data ?? [];
        } catch (semanticError) {
          console.error("Failed to load default semantic groups:", semanticError);
        }
      }

      // Filter out reserved IDs like service-fqn (it's the output, not an input)
      const filteredSemanticGroups = semanticGroups
        .filter((g: SemanticFieldGroup) => !RESERVED_GROUP_IDS.includes(g.id?.toLowerCase()));

      localConfig.value = {
        enabled: dedupConfig?.enabled ?? true,
        alert_dedup_enabled: dedupConfig?.alert_dedup_enabled ?? true,
        alert_fingerprint_groups: dedupConfig?.alert_fingerprint_groups ?? [],
        time_window_minutes: dedupConfig?.time_window_minutes ?? undefined,
        semantic_field_groups: filteredSemanticGroups,
        fqn_priority_dimensions: fqnPriority,
      };
      localFqnPriority.value = fqnPriority;
      localSemanticGroups.value = filteredSemanticGroups;
    } catch (error) {
      console.log("ServiceIdentityConfig: Error loading config, using defaults", error);
      localFqnPriority.value = [...backendDefaults];
      localSemanticGroups.value = [];
    }
  } else {
    console.log("ServiceIdentityConfig: Using config from props:", props.config);
    localFqnPriority.value = props.config.fqn_priority_dimensions ?? [...backendDefaults];
    // Filter out reserved IDs like service-fqn (it's the output, not an input)
    localSemanticGroups.value = (props.config.semantic_field_groups ?? [])
      .filter(g => !RESERVED_GROUP_IDS.includes(g.id?.toLowerCase()));
  }
};

// Load config on mount
loadConfig();

// Watch for external changes
watch(
  () => props.config,
  (newVal) => {
    if (newVal) {
      const backendDefaults = store.state.zoConfig?.fqn_priority_dimensions || [];
      console.log("ServiceIdentityConfig: Config changed from props:", newVal);
      // Filter out reserved IDs like service-fqn (it's the output, not an input)
      const filteredSemanticGroups = (newVal.semantic_field_groups ?? [])
        .filter(g => !RESERVED_GROUP_IDS.includes(g.id?.toLowerCase()));
      localConfig.value = {
        enabled: newVal.enabled ?? true,
        alert_dedup_enabled: newVal.alert_dedup_enabled ?? true,
        alert_fingerprint_groups: newVal.alert_fingerprint_groups ?? [],
        time_window_minutes: newVal.time_window_minutes ?? undefined,
        semantic_field_groups: filteredSemanticGroups,
        fqn_priority_dimensions: newVal.fqn_priority_dimensions ?? [...backendDefaults],
      };
      localFqnPriority.value = newVal.fqn_priority_dimensions ?? [...backendDefaults];
      localSemanticGroups.value = filteredSemanticGroups;
    }
  },
  { deep: true, immediate: true },
);
</script>

<style scoped lang="scss">
.service-identity-config {
  // Match parent card-container background
  background: var(--o2-card-bg);
}

:deep(.section-header) {
  font-weight: 600;
}

:deep(.q-expansion-item__content) {
  background: var(--o2-card-bg);
}

:deep(.tooltip-text) {
  font-size: 0.75rem;
}
</style>
