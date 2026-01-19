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
      <div class="text-h6">{{ t("settings.correlation.semanticFieldGroupsTitle") }}</div>
      <div class="text-caption text-grey-7">
        {{ t("correlation.semanticFieldGroupsCaption") }}
      </div>
    </div>

    <!-- Category Filter -->
    <div class="row q-col-gutter-md q-mb-md">
      <div class="col-12 col-md-4">
        <q-select
          data-test="semantic-group-category-select"
          v-model="selectedCategory"
          :options="categoryOptions"
          :label="t('correlation.category')"
          :hint="t('correlation.categoryHint')"
          dense
          borderless
          stack-label
          class="showLabelOnTop"
          emit-value
          map-options
          style="max-width: 100%"
        >
          <template v-slot:option="scope">
            <q-item v-bind="scope.itemProps">
              <q-item-section>
                <q-item-label>
                  <span class="tw:font-medium">{{ scope.opt.label }}</span>
                  <span class="tw:text-xs tw:text-gray-500 tw:ml-2">({{ scope.opt.count }} {{ t("settings.correlation.groupsLabel") }})</span>
                </q-item-label>
              </q-item-section>
            </q-item>
          </template>
        </q-select>
      </div>
      <div class="col-12 col-md-8 flex items-center justify-end q-gutter-sm">
        <q-btn
          data-test="correlation-semanticfieldgroup-import-json-btn"
          class="text-bold o2-secondary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
          :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
          no-caps
          flat
          :label="t('correlation.importFromJson')"
          @click="navigateToImport"
        />
        <q-btn
          data-test="correlation-semanticfieldgroup-add-custom-group-btn"
          class="text-bold o2-secondary-button tw:h-[28px] tw:w-[32px] tw:min-w-[32px]!"
          :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
          no-caps
          flat
          color="primary"
          :label="t('correlation.addCustomGroup')"
          @click="addGroup"
        />
      </div>
    </div>

    <!-- Filtered Semantic Groups List -->
    <div v-if="filteredGroups.length > 0" class="groups-list q-mb-md">
      <SemanticGroupItem
        v-for="(group, index) in filteredGroups"
        :key="`${group.id}-${index}`"
        :group="group"
        @update="updateGroupByFilter(index, $event)"
        @delete="removeGroupByFilter(index)"
      />
    </div>
    <div v-else class="text-center q-pa-lg text-grey-7">
      <q-icon name="info" size="md" class="q-mb-sm" />
      <div>
        {{ t("correlation.noSemanticGroupsInCategory", { category: selectedCategory || t("correlation.other") }) }}
      </div>
    </div>

    <!-- Total groups indicator -->
    <div v-if="localGroups.length > 0" class="text-caption text-grey-6 q-mt-sm">
      {{ t("correlation.showingGroups", { filterGroupLength: filteredGroups.length, localGroupLength: localGroups.length }) }}
    </div>

    <!-- Fingerprint Fields Selection (only for per-alert, not org-level) -->
    <div v-if="localGroups.length > 0 && showFingerprintFields" class="fingerprint-section q-mt-lg">
      <div class="text-subtitle1 q-mb-sm">
        {{ t("correlation.deduplicateFields") }} *
        <q-tooltip
          >{{ t("correlation.deduplicateFieldTooltip") }}</q-tooltip
        >
      </div>
      <div class="text-caption text-grey-7 q-mb-md">
        {{ t("correlation.alertDeduplicationMessage") }}
      </div>
      <div class="fingerprint-checkboxes">
        <q-checkbox
          :data-test="`fingerprint-field-checkbox-${group.id}`"
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
        {{ t("correlation.atLeastOneDeduplicationField") }}
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import SemanticGroupItem from "./SemanticGroupItem.vue";

const router = useRouter();

const store = useStore();
const { t } = useI18n();

interface SemanticGroup {
  id: string;
  display: string;
  group?: string;
  fields: string[];
  normalize: boolean;
  is_stable?: boolean;
  is_scope?: boolean;
}

// Reserved IDs that should not be used as semantic groups
// service-fqn is the OUTPUT of correlation, not an input dimension
const RESERVED_GROUP_IDS = ['service-fqn', 'servicefqn', 'fqn'];

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

// Filter out reserved IDs like service-fqn (it's the output, not an input)
const localGroups = ref<SemanticGroup[]>(
  props.semanticFieldGroups.filter(g => !RESERVED_GROUP_IDS.includes(g.id?.toLowerCase()))
);
const localFingerprintFields = ref<string[]>([...props.fingerprintFields]);
const selectedCategory = ref<string | null>(null);

// Watch for external changes and auto-select first category
watch(
  () => props.semanticFieldGroups,
  (newGroups) => {
    // Filter out reserved IDs like service-fqn (it's the output, not an input)
    localGroups.value = newGroups.filter(g => !RESERVED_GROUP_IDS.includes(g.id?.toLowerCase()));
    // Auto-select first category if none selected
    if (!selectedCategory.value && localGroups.value.length > 0) {
      nextTick(() => {
        if (categoryOptions.value.length > 0) {
          selectedCategory.value = categoryOptions.value[0].value;
        }
      });
    }
  },
  { deep: true },
);

watch(
  () => props.fingerprintFields,
  (newFields) => {
    localFingerprintFields.value = [...newFields];
  },
);

// Build category options from localGroups (the actual data)
const categoryOptions = computed(() => {
  if (localGroups.value.length === 0) {
    return [];
  }

  // Group semantic groups by their 'group' field
  const groupsMap = new Map<string, number>();

  for (const group of localGroups.value) {
    const category = group.group || "Other";
    groupsMap.set(category, (groupsMap.get(category) || 0) + 1);
  }

  // Convert to options, sorted by category name
  return Array.from(groupsMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => ({
      label: category,
      value: category,
      count: count,
    }));
});

// Filter groups by selected category
const filteredGroups = computed(() => {
  if (!selectedCategory.value) {
    return localGroups.value;
  }
  return localGroups.value.filter(
    group => (group.group || "Other") === selectedCategory.value
  );
});

// Group ID options for fingerprint selection
const groupIdOptions = computed(() => {
  return localGroups.value.map((group) => ({
    label: group.display,
    value: group.id,
  }));
});

// Add a new custom group (assign to current category if selected)
const addGroup = () => {
  const newGroup: SemanticGroup = {
    id: "",
    display: "",
    group: selectedCategory.value || "Other",
    fields: [],
    normalize: true,
  };
  localGroups.value.push(newGroup);
  emitUpdate();
};

// Update group by filtered index - find actual index in localGroups
const updateGroupByFilter = (filteredIndex: number, updatedGroup: SemanticGroup) => {
  const group = filteredGroups.value[filteredIndex];
  const actualIndex = localGroups.value.findIndex(g => g.id === group.id && g.display === group.display);
  if (actualIndex !== -1) {
    localGroups.value[actualIndex] = updatedGroup;
    emitUpdate();
  }
};

// Remove group by filtered index - find actual index in localGroups
const removeGroupByFilter = (filteredIndex: number) => {
  const group = filteredGroups.value[filteredIndex];
  const actualIndex = localGroups.value.findIndex(g => g.id === group.id && g.display === group.display);
  if (actualIndex !== -1) {
    const removedId = localGroups.value[actualIndex].id;
    localGroups.value.splice(actualIndex, 1);

    // Remove from fingerprint fields if present
    localFingerprintFields.value = localFingerprintFields.value.filter(
      (id) => id !== removedId,
    );

    emitUpdate();
  }
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

// Auto-select first category on mount
onMounted(() => {
  nextTick(() => {
    if (categoryOptions.value.length > 0 && !selectedCategory.value) {
      selectedCategory.value = categoryOptions.value[0].value;
    }
  });
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
