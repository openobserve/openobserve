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
  <div class="w-full">
    <!-- Toolbar: caption left, actions right — the module tab already titles the page -->
    <div class="mb-2 flex items-center justify-between gap-4">
      <div class="text-text-secondary min-w-0 truncate text-xs">
        {{ t("correlation.semanticFieldGroupsCaption") }}
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <OButton
          data-test="correlation-semanticfieldgroup-export-json-btn"
          variant="outline"
          size="sm"
          :disabled="localGroups.length === 0"
          @click="exportGroups"
          >{{ t("correlation.exportToJson") }}</OButton
        >
        <OButton
          data-test="correlation-semanticfieldgroup-import-json-btn"
          variant="outline"
          size="sm"
          @click="navigateToImport"
          >{{ t("correlation.importFromJson") }}</OButton
        >
        <OButton
          data-test="correlation-semanticfieldgroup-add-custom-group-btn"
          variant="primary"
          size="sm"
          @click="addGroup"
          >{{ t("correlation.addCustomGroup") }}</OButton
        >
        <slot name="header-actions" />
      </div>
    </div>

    <!-- Category strip + global search -->
    <div v-if="categoryOptions.length > 0" class="mb-3 flex items-center gap-3">
      <OTabs
        :model-value="searchActive ? '' : (selectedCategory ?? '')"
        dense
        class="min-w-0 flex-1"
        @update:model-value="onCategoryTabChange"
      >
        <OTab
          v-for="opt in categoryTabs"
          :key="opt.value"
          :name="opt.value"
          :data-test="`semantic-group-category-tab-${opt.value}`"
          :class="searchActive && opt.count === 0 ? 'opacity-50' : ''"
        >
          <span>{{ opt.label }}</span>
          <OBadge size="xs" variant="default-soft">{{ opt.count }}</OBadge>
        </OTab>
      </OTabs>
      <OInput
        data-test="semantic-group-search-input"
        v-model="searchQuery"
        type="search"
        size="sm"
        width="md"
        clearable
        :placeholder="t('correlation.searchGroupsPlaceholder')"
        class="shrink-0"
      >
        <template #icon-left><OIcon name="search" size="sm" /></template>
      </OInput>
    </div>

    <!-- Groups list: active category, or cross-category search results -->
    <div v-if="visibleGroups.length > 0" class="mb-3 w-full overflow-x-hidden">
      <SemanticGroupItem
        v-for="(group, index) in visibleGroups"
        :key="`${group.id}-${index}`"
        :data-group-id="group.id"
        :group="group"
        :category-tag="searchActive ? raw(normalizeCategoryName(group.group || '')) : undefined"
        :highlight-query="searchActive ? normalizedQuery : undefined"
        @update="updateGroupByFilter(index, $event)"
        @delete="removeGroupByFilter(index)"
      />
    </div>
    <div v-else class="text-text-muted p-4 text-center">
      <OIcon name="info" size="md" class="mb-2" />
      <div v-if="searchActive" data-test="semantic-group-search-no-results">
        {{ t("correlation.noSearchResults", { query: searchQuery.trim() }) }}
      </div>
      <div v-else>
        {{
          t("correlation.noSemanticGroupsInCategory", {
            category: selectedCategory || t("correlation.other"),
          })
        }}
      </div>
    </div>

    <!-- Total groups indicator -->
    <div v-if="localGroups.length > 0" class="text-text-secondary mt-2 text-xs">
      {{
        t("correlation.showingGroups", {
          filterGroupLength: visibleGroups.length,
          localGroupLength: localGroups.length,
        })
      }}
    </div>

    <!-- Fingerprint Fields Selection (only for per-alert, not org-level) -->
    <div
      v-if="localGroups.length > 0 && showFingerprintFields"
      class="border-separator mt-4 border-t pt-4"
    >
      <div class="mb-2 text-base font-medium">
        {{ t("correlation.deduplicateFields") }} *
        <OTooltip :content="t('correlation.deduplicateFieldTooltip')" />
      </div>
      <div class="text-text-secondary mb-3 text-xs">
        {{ t("correlation.alertDeduplicationMessage") }}
      </div>
      <div class="flex flex-wrap gap-3">
        <OCheckbox
          :data-test="`fingerprint-field-checkbox-${group.id}`"
          v-for="group in localGroups"
          :key="group.id"
          v-model="localFingerprintFields"
          :value="group.id"
          :label="raw(group.display)"
          class="min-w-50"
          @update:model-value="emitUpdate"
        />
      </div>
      <div v-if="localFingerprintFields.length === 0" class="text-status-error-text mt-2 text-xs">
        {{ t("correlation.atLeastOneDeduplicationField") }}
      </div>
    </div>

    <!-- Import Drawer -->
    <ImportSemanticGroupsDrawer
      data-test="semantic-field-groups-config-import-drawer"
      v-model:open="showImportDrawer"
      :current-groups="localGroups"
      :org-id="store.state.selectedOrganization.identifier"
      @apply="handleImportApply"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import { v4 as uuidv4 } from "uuid";
import SemanticGroupItem from "./SemanticGroupItem.vue";
import ImportSemanticGroupsDrawer from "./ImportSemanticGroupsDrawer.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const store = useStore();
const { t } = useI18nTyped();

export interface SemanticGroup {
  id: string;
  display: string;
  group?: string;
  fields: string[];
}

interface Props {
  semanticFieldGroups?: SemanticGroup[];
  fingerprintFields?: string[];
  showFingerprintFields?: boolean;
  scrollToGroupId?: string;
}

const props = withDefaults(defineProps<Props>(), {
  semanticFieldGroups: () => [],
  fingerprintFields: () => [],
  showFingerprintFields: false,
  scrollToGroupId: undefined,
});

const emit = defineEmits<{
  (e: "update:semanticFieldGroups", groups: SemanticGroup[]): void;
  (e: "update:fingerprintFields", fields: string[]): void;
}>();

const localGroups = ref<SemanticGroup[]>([...props.semanticFieldGroups]);
const localFingerprintFields = ref<string[]>([...props.fingerprintFields]);
const selectedCategory = ref<string | null>(null);
const searchQuery = ref("");
const showImportDrawer = ref(false);

// Watch for external changes and auto-select first category
watch(
  () => props.semanticFieldGroups,
  (newGroups) => {
    localGroups.value = [...newGroups];
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

// Helper function to normalize category names
const normalizeCategoryName = (category: string): string => {
  if (!category) return "Other";

  const normalized = category.toLowerCase();

  // Map common variations to consistent names
  const categoryMap: Record<string, string> = {
    kubernetes: "Kubernetes",
    k8s: "Kubernetes",
    aws: "AWS",
    amazon: "AWS",
    azure: "Azure",
    gcp: "GCP",
    google: "GCP",
    common: "Common",
    generic: "Common",
    other: "Other",
  };

  return categoryMap[normalized] || category;
};

// Build category options from localGroups (the actual data)
const categoryOptions = computed(() => {
  if (localGroups.value.length === 0) {
    return [];
  }

  // Group semantic groups by their 'group' field
  const groupsMap = new Map<string, number>();

  for (const group of localGroups.value) {
    const category = normalizeCategoryName(group.group || "Other");
    groupsMap.set(category, (groupsMap.get(category) || 0) + 1);
  }

  // Convert to options, sorted by category name
  return Array.from(groupsMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => ({
      label: raw(category),
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
    (group) => normalizeCategoryName(group.group || "Other") === selectedCategory.value,
  );
});

// ── Global search (name / id / field alias, across ALL categories) ─────────
const normalizedQuery = computed(() => searchQuery.value.trim().toLowerCase());
const searchActive = computed(() => normalizedQuery.value.length > 0);

const matchesQuery = (group: SemanticGroup): boolean => {
  const q = normalizedQuery.value;
  return (
    group.display.toLowerCase().includes(q) ||
    group.id.toLowerCase().includes(q) ||
    group.fields.some((f) => f.toLowerCase().includes(q))
  );
};

// Search results ordered by category (stable sort keeps original order within one)
const searchResults = computed(() => {
  if (!searchActive.value) return [];
  return [...localGroups.value]
    .filter(matchesQuery)
    .sort((a, b) =>
      normalizeCategoryName(a.group || "Other").localeCompare(
        normalizeCategoryName(b.group || "Other"),
      ),
    );
});

// What the list renders: search results (all categories) or the active category
const visibleGroups = computed(() =>
  searchActive.value ? searchResults.value : filteredGroups.value,
);

// Strip tabs: counts flip to per-category MATCH counts while searching
const categoryTabs = computed(() => {
  if (!searchActive.value) return categoryOptions.value;
  return categoryOptions.value.map((opt) => ({
    ...opt,
    count: localGroups.value.filter(
      (g) => normalizeCategoryName(g.group || "Other") === opt.value && matchesQuery(g),
    ).length,
  }));
});

// Tab click exits search mode and resumes category browsing
const onCategoryTabChange = (name: string | number) => {
  searchQuery.value = "";
  selectedCategory.value = String(name);
};

// Generate a short unique ID for new groups using first 8 chars of UUID
const generateShortId = (): string => {
  return uuidv4().substring(0, 8);
};

// Add a new custom group (assign to current category if selected).
// Clears any active search first — a fresh empty group would rarely match the
// query and would silently vanish from a search-results view.
const addGroup = () => {
  searchQuery.value = "";
  const newGroup: SemanticGroup = {
    id: generateShortId(),
    display: "",
    group: selectedCategory.value || "Other",
    fields: [],
  };
  localGroups.value.unshift(newGroup);
  emitUpdate();
};

// Update group by visible index - find actual index in localGroups
const updateGroupByFilter = (filteredIndex: number, updatedGroup: SemanticGroup) => {
  const group = visibleGroups.value[filteredIndex];
  const actualIndex = localGroups.value.findIndex(
    (g) => g.id === group.id && g.display === group.display,
  );
  if (actualIndex !== -1) {
    localGroups.value[actualIndex] = updatedGroup;
    emitUpdate();
  }
};

// Remove group by visible index - find actual index in localGroups
const removeGroupByFilter = (filteredIndex: number) => {
  const group = visibleGroups.value[filteredIndex];
  const actualIndex = localGroups.value.findIndex(
    (g) => g.id === group.id && g.display === group.display,
  );
  if (actualIndex !== -1) {
    const removedId = localGroups.value[actualIndex].id;
    localGroups.value.splice(actualIndex, 1);

    // Remove from fingerprint fields if present
    localFingerprintFields.value = localFingerprintFields.value.filter((id) => id !== removedId);

    emitUpdate();
  }
};

const exportGroups = () => {
  const json = JSON.stringify(localGroups.value, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `semantic-groups-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

const navigateToImport = () => {
  showImportDrawer.value = true;
};

const handleImportApply = (importedGroups: SemanticGroup[]) => {
  // Merge imported groups with existing groups
  const groupsMap = new Map<string, SemanticGroup>();

  // Add existing groups to map
  localGroups.value.forEach((g) => groupsMap.set(g.id, g));

  // Update or add imported groups
  importedGroups.forEach((g) => groupsMap.set(g.id, g));

  // Convert back to array
  localGroups.value = Array.from(groupsMap.values());

  emitUpdate();
};

const emitUpdate = () => {
  emit("update:semanticFieldGroups", [...localGroups.value]);
  emit("update:fingerprintFields", [...localFingerprintFields.value]);
};

// Auto-select first category on mount, or navigate to a specific group
onMounted(async () => {
  await nextTick();

  if (props.scrollToGroupId) {
    // Find and switch to the category that contains the requested group
    const targetGroup = localGroups.value.find((g) => g.id === props.scrollToGroupId);
    if (targetGroup) {
      // Normalized to match filteredGroups' comparison — a raw alias like "k8s"
      // would select a tab that doesn't exist and render an empty list.
      selectedCategory.value = normalizeCategoryName(targetGroup.group || "Other");
      await nextTick(); // wait for filteredGroups to re-render
    }
  } else if (categoryOptions.value.length > 0 && !selectedCategory.value) {
    selectedCategory.value = categoryOptions.value[0].value;
  }

  if (props.scrollToGroupId) {
    await nextTick();
    const el = document.querySelector(
      `[data-group-id="${props.scrollToGroupId}"]`,
    ) as HTMLElement | null;
    if (el) {
      // Scroll within the nearest scrollable parent to avoid pushing
      // ancestor containers (main page layout) out of view
      const scrollParent = el.closest(".overflow-y-auto") as HTMLElement | null;
      if (scrollParent) {
        const parentRect = scrollParent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offset = elRect.top - parentRect.top - parentRect.height / 2 + elRect.height / 2;
        scrollParent.scrollBy({ top: offset, behavior: "smooth" });
      } else {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      // Blink the border to draw attention
      el.classList.add("group-highlight");
      setTimeout(() => el.classList.remove("group-highlight"), 2000);
    }
  }
});
</script>

<style scoped>
/* keep(keyframes): @keyframes can't be expressed as a utility; applied via JS classList */
.group-highlight {
  animation: group-border-blink 0.4s ease-in-out 3;
}

@keyframes group-border-blink {
  0%,
  100% {
    outline: 0.125rem solid transparent;
  }
  50% {
    outline: 0.125rem solid var(--color-theme-accent);
    border-radius: 0.25rem;
  }
}
</style>
