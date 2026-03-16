import { ref, computed, watch } from "vue";
import {
  SectionId,
  DEFAULT_EXPANDED_SECTIONS,
} from "../../utils/dashboard/searchLabelsConfig";

export interface ConfigOption {
  label: string | string[];
  visible?: boolean;
}

export interface ConfigOptions {
  [key: string]: {
    [optionId: string]: ConfigOption;
  };
}

export interface SearchState {
  searchQuery: string;
  expandedSections: Record<string, boolean>;
  beforeSearchExpandedSections: Record<string, boolean> | null;
}

export function useConfigPanelSearch() {
  // State
  const searchQuery = ref("");
  const expandedSections = ref<Record<string, boolean>>({
    ...DEFAULT_EXPANDED_SECTIONS,
  });
  const beforeSearchExpandedSections = ref<Record<string, boolean> | null>(
    null,
  );

  // Computed
  const normalizedSearchQuery = computed(() =>
    (searchQuery.value ?? "").trim().toLowerCase(),
  );

  // Methods
  const matchesSearch = (label: string, query: string): boolean => {
    return label.toLowerCase().includes(query.toLowerCase());
  };

  const isConfigOptionVisible = (
    configOptions: ConfigOptions,
    sectionId: SectionId,
    optionId: string,
  ): boolean => {
    const option = configOptions[sectionId]?.[optionId];

    // 1. Check visibility
    if (!option || (option.visible !== undefined && option.visible === false)) {
      return false;
    }

    // 2. Check search query
    const q = normalizedSearchQuery.value;
    if (!q) return true;

    const labels = Array.isArray(option.label) ? option.label : [option.label];
    return labels.some((l: string) => matchesSearch(l, q));
  };

  const isSectionVisible = (
    configOptions: ConfigOptions,
    sectionId: SectionId,
  ): boolean => {
    const sectionOptions = configOptions[sectionId];
    if (!sectionOptions) return false;

    // Check if any option in this section is visible
    return Object.keys(sectionOptions).some((optionId) =>
      isConfigOptionVisible(configOptions, sectionId, optionId),
    );
  };

  const isExpanded = (key: string): boolean => {
    return expandedSections.value[key] ?? true;
  };

  const toggleSection = (sectionId: SectionId): void => {
    expandedSections.value[sectionId] = !isExpanded(sectionId);
  };

  const saveExpansionState = (): void => {
    beforeSearchExpandedSections.value = { ...expandedSections.value };
    // Expand all sections when searching
    Object.keys(expandedSections.value).forEach((key) => {
      expandedSections.value[key] = true;
    });
  };

  const restoreExpansionState = (): void => {
    if (beforeSearchExpandedSections.value) {
      expandedSections.value = { ...beforeSearchExpandedSections.value };
      beforeSearchExpandedSections.value = null;
    }
  };

  const resetSearch = (): void => {
    searchQuery.value = "";
    restoreExpansionState();
  };

  // Watch for search query changes to automatically save/restore state
  watch(searchQuery, (newQ, oldQ) => {
    if (newQ && !oldQ) {
      saveExpansionState();
    } else if (!newQ && oldQ) {
      restoreExpansionState();
    }
  });

  return {
    searchQuery,
    expandedSections,
    normalizedSearchQuery,
    matchesSearch,
    isConfigOptionVisible,
    isSectionVisible,
    isExpanded,
    toggleSection,
    saveExpansionState,
    restoreExpansionState,
    resetSearch,
  };
}
