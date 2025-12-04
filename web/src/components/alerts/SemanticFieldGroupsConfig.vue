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
      <div class="col-12 col-md-4">
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
      <div class="col-12 col-md-8 flex items-center justify-end q-gutter-sm">
        <q-btn
          outline
          color="primary"
          label="Import from JSON"
          icon="upload_file"
          size="sm"
          @click="navigateToImport"
        />
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

    <!-- Fingerprint Fields Selection (only for per-alert, not org-level) -->
    <div v-if="localGroups.length > 0 && showFingerprintFields" class="fingerprint-section q-mt-lg">
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
          :label="group.display"
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
import { ref, computed, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import alertsService from "@/services/alerts";
import SemanticGroupItem from "./SemanticGroupItem.vue";

const router = useRouter();
const store = useStore();

interface SemanticGroup {
  id: string;
  display: string;
  group?: string;
  fields: string[];
  normalize: boolean;
}

interface Props {
  semanticFieldGroups?: SemanticGroup[];
  fingerprintFields?: string[];
  showFingerprintFields?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  semanticFieldGroups: () => [],
  fingerprintFields: () => [],
  showFingerprintFields: false,
});

const emit = defineEmits<{
  (e: "update:semanticFieldGroups", groups: SemanticGroup[]): void;
  (e: "update:fingerprintFields", fields: string[]): void;
}>();

const localGroups = ref<SemanticGroup[]>([...props.semanticFieldGroups]);
const localFingerprintFields = ref<string[]>([...props.fingerprintFields]);
const selectedPreset = ref<string | null>(null);
const availableSemanticGroups = ref<SemanticGroup[]>([]);
const loadingPresets = ref(false);

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

// Dynamically build preset options from backend semantic groups
const presetOptions = computed(() => {
  if (availableSemanticGroups.value.length === 0) {
    return [];
  }

  // Group semantic groups by their 'group' field
  const groupsMap = new Map<string, SemanticGroup[]>();

  for (const group of availableSemanticGroups.value) {
    const category = group.group || "Other";
    if (!groupsMap.has(category)) {
      groupsMap.set(category, []);
    }
    groupsMap.get(category)!.push(group);
  }

  // Convert to preset options, sorted by category name
  return Array.from(groupsMap.keys())
    .sort()
    .map(category => ({
      label: category,
      value: category.toLowerCase().replace(/\s+/g, '-'),
    }));
});

// Group ID options for fingerprint selection
const groupIdOptions = computed(() => {
  return localGroups.value.map((group) => ({
    label: group.display,
    value: group.id,
  }));
});

// Load semantic groups from backend on mount
const loadSemanticGroups = async () => {
  loadingPresets.value = true;
  try {
    const orgId = store.state.selectedOrganization.identifier;
    const response = await alertsService.getSemanticGroups(orgId);
    availableSemanticGroups.value = response.data;
    console.log(`Loaded ${availableSemanticGroups.value.length} semantic groups from backend`);
  } catch (error) {
    console.error("Failed to load semantic groups:", error);
    availableSemanticGroups.value = [];
  } finally {
    loadingPresets.value = false;
  }
};

// Load preset by category name
const loadPreset = (presetKey: string | null) => {
  if (!presetKey || availableSemanticGroups.value.length === 0) return;

  // Find the category name from the preset key
  const categoryOption = presetOptions.value.find(opt => opt.value === presetKey);
  if (!categoryOption) return;

  const categoryName = categoryOption.label;

  // Filter groups by category
  const categoryGroups = availableSemanticGroups.value.filter(
    group => group.group === categoryName
  );

  if (categoryGroups.length > 0) {
    localGroups.value = [...categoryGroups];
    // Auto-select all groups for fingerprinting
    localFingerprintFields.value = categoryGroups.map(g => g.id);
    emitUpdate();
  }
};

const addGroup = () => {
  const newGroup: SemanticGroup = {
    id: "",
    display: "",
    fields: [],
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

const navigateToImport = () => {
  router.push({
    name: "importSemanticGroups",
  });
};

const emitUpdate = () => {
  emit("update:semanticFieldGroups", [...localGroups.value]);
  emit("update:fingerprintFields", [...localFingerprintFields.value]);
};

// Load semantic groups from backend on component mount
onMounted(() => {
  loadSemanticGroups();
});
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
