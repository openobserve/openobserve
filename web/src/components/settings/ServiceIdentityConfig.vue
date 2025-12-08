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
    <div class="tw-mb-4">
      <div class="text-h6 tw-mb-2">{{ t("settings.correlation.serviceIdentityTitle") }}</div>
      <div class="text-body2 text-grey-7">
        {{ t("settings.correlation.serviceIdentityDescription") }}
      </div>
    </div>

    <q-separator class="tw-mb-4" />

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
          <span class="tw-font-semibold text-primary">{{ t("settings.correlation.exampleLabel") }}</span>
          <span class="text-grey-7"> {{ t("settings.correlation.exampleText1") }} </span>
          <q-chip dense size="sm" color="primary" text-color="white" class="tw-mx-1">k8s-deployment=my-app</q-chip>
          <span class="text-grey-7"> {{ t("settings.correlation.exampleText2") }} </span>
          <q-chip dense size="sm" color="grey-7" text-color="white" class="tw-mx-1">service=myapp</q-chip>
          <span class="text-grey-7">, {{ t("settings.correlation.exampleText3") }} </span>
          <q-chip dense size="sm" color="positive" text-color="white" class="tw-mx-1">my-app</q-chip>
          <span class="text-grey-7"> {{ t("settings.correlation.exampleText4") }} </span>
          <span class="tw-font-semibold">k8s-deployment</span>
          <span class="text-grey-7"> {{ t("settings.correlation.exampleText5") }}</span>
        </div>
        <div>
          <span class="tw-font-semibold text-primary">{{ t("settings.correlation.correlationDescription").split(' ')[0] }}:</span>
          <span class="text-grey-7"> {{ t("settings.correlation.correlationDescription") }} </span>
          <span class="tw-font-mono tw-font-semibold">{{ t("settings.correlation.correlationDescriptionField") }}</span>
          <span class="text-grey-7"> {{ t("settings.correlation.correlationDescriptionEnd") }}</span>
        </div>
      </div>
    </q-expansion-item>

    <!-- FQN Priority Dimensions -->
    <div class="tw-mb-6">
      <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center tw-text-lg">
        {{ t("settings.correlation.fqnPriorityTitle") }}
        <q-icon
          :name="outlinedInfo"
          size="1.125rem"
          class="q-ml-xs cursor-pointer"
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
      <div class="tw-text-sm tw-text-gray-600 dark:tw-text-gray-400 tw-mb-3">
        {{ t("settings.correlation.fqnPriorityDescription") }}
      </div>

      <div class="tw-flex tw-gap-2 tw-mb-3">
        <q-btn
          flat
          dense
          size="sm"
          icon="restart_alt"
          :label="t('settings.correlation.resetToDefaults')"
          @click="resetFqnPriority"
        />
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
            <q-item-label class="tw-font-mono">{{ dim }}</q-item-label>
            <q-item-label caption>{{ getDimensionDescription(dim) }}</q-item-label>
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

      <!-- Add new dimension -->
      <div class="tw-mt-3 tw-flex tw-gap-2">
        <q-select
          v-model="newFqnDimension"
          :options="availableFqnDimensions"
          dense
          filled
          :label="t('settings.correlation.addDimensionLabel')"
          class="tw-flex-1"
          emit-value
          map-options
          :option-label="opt => typeof opt === 'string' ? opt : opt.label"
        />
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

    <q-separator class="tw-my-4" />

    <!-- Semantic Field Groups (for dimension extraction) -->
    <div class="tw-mb-6">
      <div class="tw-font-semibold tw-pb-2 tw-flex tw-items-center tw-text-lg">
        {{ t("settings.correlation.semanticFieldTitle") }}
        <q-icon
          :name="outlinedInfo"
          size="1.125rem"
          class="q-ml-xs cursor-pointer"
          :class="store.state.theme === 'dark' ? 'text-grey-5' : 'text-grey-7'"
        >
          <q-tooltip
            anchor="center right"
            self="center left"
            max-width="21.875rem"
            class="tooltip-text"
          >
            {{ t("settings.correlation.semanticFieldTooltip") }}
          </q-tooltip>
        </q-icon>
      </div>
      <div class="tw-text-sm tw-text-gray-600 dark:tw-text-gray-400 tw-mb-3">
        {{ t("settings.correlation.semanticFieldDescription") }}
      </div>

      <SemanticFieldGroupsConfig
        v-model:semantic-field-groups="localSemanticGroups"
        @update:semantic-field-groups="handleSemanticGroupsUpdate"
      />
    </div>

    <div class="tw-flex tw-justify-end tw-gap-3 tw-mt-6">
      <q-btn outline :label="t('common.cancel')" @click="$emit('cancel')" class="tw-px-4" />
      <q-btn
        :label="t('settings.correlation.saveConfiguration')"
        color="primary"
        @click="saveSettings"
        :loading="saving"
        class="tw-px-4"
      />
    </div>
  </q-card>
</template>

<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import { outlinedInfo } from "@quasar/extras/material-icons-outlined";
import SemanticFieldGroupsConfig from "@/components/alerts/SemanticFieldGroupsConfig.vue";
import alertsService from "@/services/alerts";
import organizationsService from "@/services/organizations";

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

// Default FQN priority dimensions - matches backend defaults
const DEFAULT_FQN_PRIORITY = [
  "k8s-deployment",
  "k8s-statefulset",
  "k8s-daemonset",
  "k8s-job",
  "aws-ecs-task",
  "faas-name",
  "gcp-cloud-run",
  "azure-cloud-role",
  "process-name",
  "service",
];

// All available dimensions that can be used for FQN priority
const ALL_FQN_DIMENSIONS = [
  { label: "K8s Deployment", value: "k8s-deployment", description: "Kubernetes Deployment name" },
  { label: "K8s StatefulSet", value: "k8s-statefulset", description: "Kubernetes StatefulSet name" },
  { label: "K8s DaemonSet", value: "k8s-daemonset", description: "Kubernetes DaemonSet name" },
  { label: "K8s Job", value: "k8s-job", description: "Kubernetes Job name" },
  { label: "K8s ReplicaSet", value: "k8s-replicaset", description: "Kubernetes ReplicaSet name" },
  { label: "K8s Namespace", value: "k8s-namespace", description: "Kubernetes Namespace" },
  { label: "AWS ECS Task", value: "aws-ecs-task", description: "AWS ECS Task family" },
  { label: "FaaS Name", value: "faas-name", description: "Lambda, Cloud Functions, etc." },
  { label: "GCP Cloud Run", value: "gcp-cloud-run", description: "Google Cloud Run service" },
  { label: "Azure Cloud Role", value: "azure-cloud-role", description: "Azure Cloud role name" },
  { label: "Process Name", value: "process-name", description: "Bare metal process name" },
  { label: "Service", value: "service", description: "OpenTelemetry service.name" },
  { label: "Host", value: "host", description: "Host/Node name" },
  { label: "Environment", value: "environment", description: "Deployment environment" },
];

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
const localFqnPriority = ref<string[]>([...DEFAULT_FQN_PRIORITY]);
const localSemanticGroups = ref<SemanticFieldGroup[]>([]);
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

// Computed: available dimensions not already in the priority list
const availableFqnDimensions = computed(() => {
  return ALL_FQN_DIMENSIONS.filter(d => !localFqnPriority.value.includes(d.value));
});

// Get description for a dimension using i18n
const getDimensionDescription = (dim: string): string => {
  const descriptionMap: Record<string, string> = {
    "k8s-deployment": t("settings.correlation.k8sDeployment"),
    "k8s-statefulset": t("settings.correlation.k8sStatefulSet"),
    "k8s-daemonset": t("settings.correlation.k8sDaemonSet"),
    "k8s-job": t("settings.correlation.k8sJob"),
    "k8s-replicaset": t("settings.correlation.k8sReplicaSet"),
    "k8s-namespace": t("settings.correlation.k8sNamespace"),
    "aws-ecs-task": t("settings.correlation.awsEcsTask"),
    "faas-name": t("settings.correlation.faasName"),
    "gcp-cloud-run": t("settings.correlation.gcpCloudRun"),
    "azure-cloud-role": t("settings.correlation.azureCloudRole"),
    "process-name": t("settings.correlation.processName"),
    "service": t("settings.correlation.serviceDim"),
    "host": t("settings.correlation.host"),
    "environment": t("settings.correlation.environment"),
  };
  return descriptionMap[dim] || "";
};

const handleSemanticGroupsUpdate = (groups: SemanticFieldGroup[]) => {
  localConfig.value.semantic_field_groups = groups;
  localSemanticGroups.value = groups;
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
};

const resetFqnPriority = () => {
  localFqnPriority.value = [...DEFAULT_FQN_PRIORITY];
};

const saveSettings = async () => {
  saving.value = true;
  try {
    // Merge FQN priority into config
    localConfig.value.fqn_priority_dimensions = localFqnPriority.value;
    localConfig.value.semantic_field_groups = localSemanticGroups.value;

    // Save FQN priority dimensions to organization settings API
    await organizationsService.post_organization_settings(
      props.orgId,
      { fqn_priority_dimensions: localFqnPriority.value }
    );

    // Also save semantic field groups to deduplication config API
    await alertsService.setOrganizationDeduplicationConfig(
      props.orgId,
      localConfig.value,
    );

    $q.notify({
      type: "positive",
      message: t("settings.correlation.configSavedSuccess"),
      timeout: 2000,
    });

    emit("saved");
  } catch (error: any) {
    console.error("Error saving service identity settings:", error);
    $q.notify({
      type: "negative",
      message: error?.message || t("settings.correlation.configSaveFailed"),
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
      // First, try to load FQN priority from organization settings API
      let fqnPriorityFromOrgSettings: string[] | null = null;
      try {
        const orgSettingsResponse = await organizationsService.get_organization_settings(props.orgId);
        const orgSettings = orgSettingsResponse.data?.data;
        console.log("ServiceIdentityConfig: Loaded org settings:", orgSettings);
        if (orgSettings?.fqn_priority_dimensions?.length > 0) {
          fqnPriorityFromOrgSettings = orgSettings.fqn_priority_dimensions;
        }
      } catch (orgError) {
        console.log("ServiceIdentityConfig: No org settings, using defaults");
      }

      // Load deduplication config for semantic field groups
      const response = await alertsService.getOrganizationDeduplicationConfig(props.orgId);
      const config = response.data;
      console.log("ServiceIdentityConfig: Loaded dedup config:", config);

      // Use org settings FQN priority if available, otherwise use dedup config or defaults
      const fqnPriority = fqnPriorityFromOrgSettings ??
                          config.fqn_priority_dimensions ??
                          [...DEFAULT_FQN_PRIORITY];

      localConfig.value = {
        enabled: config.enabled ?? true,
        alert_dedup_enabled: config.alert_dedup_enabled ?? true,
        alert_fingerprint_groups: config.alert_fingerprint_groups ?? [],
        time_window_minutes: config.time_window_minutes ?? undefined,
        semantic_field_groups: config.semantic_field_groups ?? [],
        fqn_priority_dimensions: fqnPriority,
      };
      localFqnPriority.value = fqnPriority;
      localSemanticGroups.value = config.semantic_field_groups ?? [];
    } catch (error) {
      console.log("ServiceIdentityConfig: No existing config, loading defaults", error);

      // Load default semantic groups from backend
      try {
        const semanticGroupsResponse = await alertsService.getSemanticGroups(props.orgId);
        const defaultGroups = semanticGroupsResponse.data;
        console.log(`Loaded ${defaultGroups.length} default semantic groups`);

        localConfig.value = {
          enabled: true,
          alert_dedup_enabled: true,
          alert_fingerprint_groups: [],
          time_window_minutes: undefined,
          semantic_field_groups: defaultGroups,
          fqn_priority_dimensions: [...DEFAULT_FQN_PRIORITY],
        };
        localFqnPriority.value = [...DEFAULT_FQN_PRIORITY];
        localSemanticGroups.value = defaultGroups;
      } catch (semanticError) {
        console.error("Failed to load default semantic groups:", semanticError);
        localSemanticGroups.value = [];
      }
    }
  } else {
    console.log("ServiceIdentityConfig: Using config from props:", props.config);
    localFqnPriority.value = props.config.fqn_priority_dimensions ?? [...DEFAULT_FQN_PRIORITY];
    localSemanticGroups.value = props.config.semantic_field_groups ?? [];
  }
};

// Load config on mount
loadConfig();

// Watch for external changes
watch(
  () => props.config,
  (newVal) => {
    if (newVal) {
      console.log("ServiceIdentityConfig: Config changed from props:", newVal);
      localConfig.value = {
        enabled: newVal.enabled ?? true,
        alert_dedup_enabled: newVal.alert_dedup_enabled ?? true,
        alert_fingerprint_groups: newVal.alert_fingerprint_groups ?? [],
        time_window_minutes: newVal.time_window_minutes ?? undefined,
        semantic_field_groups: newVal.semantic_field_groups ?? [],
        fqn_priority_dimensions: newVal.fqn_priority_dimensions ?? [...DEFAULT_FQN_PRIORITY],
      };
      localFqnPriority.value = newVal.fqn_priority_dimensions ?? [...DEFAULT_FQN_PRIORITY];
      localSemanticGroups.value = newVal.semantic_field_groups ?? [];
    }
  },
  { deep: true, immediate: true },
);
</script>

<style scoped lang="scss">
.q-card {
  max-width: 75rem;
}

:deep(.tooltip-text) {
  font-size: 0.75rem;
}
</style>
