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
  <div class="semantic-field-groups-config">
    <div class="section-header q-mb-md">
      <div class="text-h6">Field Mappings</div>
      <div class="text-caption text-grey-7">
        Define field name mappings for correlation and deduplication (e.g.,
        host, hostname, node → "host" group)
      </div>
    </div>

    <!-- Preset Templates -->
    <div class="row q-col-gutter-md q-mb-md">
      <div class="col-12 col-md-6">
        <q-select
          v-model="selectedPreset"
          :options="presetOptions"
          label="Load Preset Template"
          hint="Quick start with common field groups"
          dense
          filled
          color="input-border"
          bg-color="input-bg"
          emit-value
          map-options
          clearable
          @update:model-value="loadPreset"
          style="max-width: 100%"
        >
          <template v-slot:selected>
            <div
              class="ellipsis"
              style="max-width: 100%; overflow: hidden; text-overflow: ellipsis"
            >
              {{
                presetOptions.find((p) => p.value === selectedPreset)?.label ||
                "Select preset"
              }}
            </div>
          </template>
        </q-select>
      </div>
      <div class="col-12 col-md-6 flex items-center">
        <q-btn
          color="primary"
          label="Add Custom Group"
          icon="add"
          size="sm"
          @click="addGroup"
        />
      </div>
    </div>

    <!-- Semantic Groups List -->
    <div v-if="localGroups.length > 0" class="groups-list q-mb-md">
      <SemanticGroupItem
        v-for="(group, index) in localGroups"
        :key="`${group.id}-${index}`"
        :group="group"
        @update="updateGroup(index, $event)"
        @delete="removeGroup(index)"
      />
    </div>
    <div v-else class="text-center q-pa-lg text-grey-7">
      <q-icon name="info" size="md"
class="q-mb-sm" />
      <div>
        No semantic groups defined. Add a group or load a preset template.
      </div>
    </div>

    <!-- Fingerprint Fields Selection -->
    <div v-if="localGroups.length > 0" class="fingerprint-section q-mt-lg">
      <div class="text-subtitle1 q-mb-sm">
        Deduplication Fields *
        <q-tooltip
          >Select which field mappings to use for deduplication
          fingerprinting</q-tooltip
        >
      </div>
      <div class="text-caption text-grey-7 q-mb-md">
        Alerts with the same values for these fields will be deduplicated (e.g.,
        same fingerprint = same field values)
      </div>
      <div class="fingerprint-checkboxes">
        <q-checkbox
          v-for="group in localGroups"
          :key="group.id"
          v-model="localFingerprintFields"
          :val="group.id"
          :label="group.display_name"
          class="fingerprint-checkbox"
          @update:model-value="emitUpdate"
        />
      </div>
      <div
        v-if="localFingerprintFields.length === 0"
        class="text-negative text-caption q-mt-sm"
      >
        At least one field mapping is required for deduplication
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from "vue";
import SemanticGroupItem from "./SemanticGroupItem.vue";

interface SemanticGroup {
  id: string;
  display_name: string;
  field_names: string[];
  normalize: boolean;
}

interface Props {
  semanticFieldGroups?: SemanticGroup[];
  fingerprintFields?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  semanticFieldGroups: () => [],
  fingerprintFields: () => [],
});

const emit = defineEmits<{
  (e: "update:semanticFieldGroups", groups: SemanticGroup[]): void;
  (e: "update:fingerprintFields", fields: string[]): void;
}>();

const localGroups = ref<SemanticGroup[]>([...props.semanticFieldGroups]);
const localFingerprintFields = ref<string[]>([...props.fingerprintFields]);
const selectedPreset = ref<string | null>(null);

// Watch for external changes
watch(
  () => props.semanticFieldGroups,
  (newGroups) => {
    localGroups.value = [...newGroups];
  },
  { deep: true },
);

watch(
  () => props.fingerprintFields,
  (newFields) => {
    localFingerprintFields.value = [...newFields];
  },
);

// Preset options
const presetOptions = [
  { label: "Common", value: "common" },
  { label: "Kubernetes", value: "kubernetes" },
  { label: "AWS", value: "aws" },
  { label: "GCP", value: "gcp" },
  { label: "Azure", value: "azure" },
];

// Group ID options for fingerprint selection
const groupIdOptions = computed(() => {
  return localGroups.value.map((group) => ({
    label: group.display_name,
    value: group.id,
  }));
});

// Preset templates
const presets: Record<
  string,
  { groups: SemanticGroup[]; fingerprint: string[] }
> = {
  common: {
    groups: [
      {
        id: "host",
        display_name: "Host",
        field_names: ["host", "hostname", "node", "server"],
        normalize: true,
      },
      {
        id: "service",
        display_name: "Service",
        field_names: ["service", "service_name", "application", "app"],
        normalize: true,
      },
      {
        id: "environment",
        display_name: "Environment",
        field_names: ["environment", "env", "stage"],
        normalize: true,
      },
      {
        id: "ip-address",
        display_name: "IP Address",
        field_names: ["ip", "ip_address", "ipaddr", "client_ip"],
        normalize: false,
      },
    ],
    fingerprint: ["service", "host"],
  },
  kubernetes: {
    groups: [
      {
        id: "k8s-cluster",
        display_name: "K8s Cluster",
        field_names: ["cluster", "k8s_cluster", "kubernetes_cluster"],
        normalize: true,
      },
      {
        id: "k8s-namespace",
        display_name: "K8s Namespace",
        field_names: ["namespace", "k8s_namespace", "kubernetes_namespace"],
        normalize: true,
      },
      {
        id: "k8s-pod",
        display_name: "K8s Pod",
        field_names: ["pod", "pod_name", "k8s_pod"],
        normalize: true,
      },
      {
        id: "k8s-container",
        display_name: "K8s Container",
        field_names: ["container", "container_name", "k8s_container"],
        normalize: true,
      },
    ],
    fingerprint: ["k8s-cluster", "k8s-namespace", "k8s-pod"],
  },
  aws: {
    groups: [
      {
        id: "aws-account",
        display_name: "AWS Account",
        field_names: ["account_id", "aws_account", "account"],
        normalize: false,
      },
      {
        id: "aws-region",
        display_name: "AWS Region",
        field_names: ["region", "aws_region"],
        normalize: true,
      },
      {
        id: "aws-service",
        display_name: "AWS Service",
        field_names: ["service", "aws_service", "service_name"],
        normalize: true,
      },
    ],
    fingerprint: ["aws-account", "aws-region", "aws-service"],
  },
  gcp: {
    groups: [
      {
        id: "gcp-project",
        display_name: "GCP Project",
        field_names: ["project_id", "gcp_project", "project"],
        normalize: false,
      },
      {
        id: "gcp-zone",
        display_name: "GCP Zone",
        field_names: ["zone", "gcp_zone", "availability_zone"],
        normalize: true,
      },
      {
        id: "gcp-service",
        display_name: "GCP Service",
        field_names: ["service", "gcp_service", "service_name"],
        normalize: true,
      },
    ],
    fingerprint: ["gcp-project", "gcp-zone", "gcp-service"],
  },
  azure: {
    groups: [
      {
        id: "azure-subscription",
        display_name: "Azure Subscription",
        field_names: ["subscription_id", "azure_subscription"],
        normalize: false,
      },
      {
        id: "azure-resource-group",
        display_name: "Azure Resource Group",
        field_names: ["resource_group", "azure_resource_group", "rg"],
        normalize: true,
      },
      {
        id: "azure-service",
        display_name: "Azure Service",
        field_names: ["service", "azure_service", "service_name"],
        normalize: true,
      },
    ],
    fingerprint: [
      "azure-subscription",
      "azure-resource-group",
      "azure-service",
    ],
  },
};

const loadPreset = (presetKey: string | null) => {
  if (!presetKey) return;

  const preset = presets[presetKey];
  if (preset) {
    localGroups.value = [...preset.groups];
    localFingerprintFields.value = [...preset.fingerprint];
    emitUpdate();
  }
};

const addGroup = () => {
  const newGroup: SemanticGroup = {
    id: "",
    display_name: "",
    field_names: [],
    normalize: true,
  };
  localGroups.value.push(newGroup);
  emitUpdate();
};

const updateGroup = (index: number, updatedGroup: SemanticGroup) => {
  localGroups.value[index] = updatedGroup;
  emitUpdate();
};

const removeGroup = (index: number) => {
  const removedId = localGroups.value[index].id;
  localGroups.value.splice(index, 1);

  // Remove from fingerprint fields if present
  localFingerprintFields.value = localFingerprintFields.value.filter(
    (id) => id !== removedId,
  );

  emitUpdate();
};

const emitUpdate = () => {
  emit("update:semanticFieldGroups", [...localGroups.value]);
  emit("update:fingerprintFields", [...localFingerprintFields.value]);
};
</script>

<style lang="scss" scoped>
.semantic-field-groups-config {
  width: 100%;
}

.section-header {
  border-bottom: 1px solid var(--q-separator-color);
  padding-bottom: 12px;
}

.groups-list {
  width: 100%;
  overflow-x: hidden;
}

.fingerprint-section {
  border-top: 1px solid var(--q-separator-color);
  padding-top: 16px;
}

.fingerprint-checkboxes {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.fingerprint-checkbox {
  min-width: 200px;
}
</style>
