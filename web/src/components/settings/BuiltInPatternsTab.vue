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
  <div class="built-in-patterns-container card-container">
    <!-- Search and Filter Bar -->
    <div class="filters-bar tw:p-3">
      <div class="tw:flex tw:gap-3">
        <div class="tw:w-full col-md-6">
          <OSearchInput
            v-model="searchQuery"
            :placeholder="t('regex_patterns.search')"
            clearable
            class="tw:w-full"
            data-test="built-in-pattern-search"
          />
        </div>
        <div class="tw:w-full col-md-4">
          <OSelect
            v-model="selectedTags"
            :options="tagOptions"
            :placeholder="t('regex_patterns.filter_by_tag')"
            multiple
            clearable
            data-test="built-in-pattern-tag-filter"
          />
        </div>
        <div class="tw:w-full col-md-2">
          <OButton
            variant="outline"
            size="sm"
            @click="refreshPatterns"
            :loading="loading"
            data-test="built-in-pattern-refresh-btn"
          >
            <template #icon-left
              ><OIcon name="refresh" size="sm"
            /></template>
            {{ t("regex_patterns.refresh") }}
          </OButton>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && patterns.length === 0" class="tw:text-center tw:p-6">
      <OSpinner size="lg" />
      <div class="tw:mt-3">{{ t("regex_patterns.loading_patterns") }}</div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="tw:text-center tw:p-6">
      <OIcon name="error" style="width: 50px; height: 50px;" />
      <div class="tw:mt-3 tw:text-red-500">{{ error }}</div>
      <span class="tw:mt-2">
        <OButton variant="ghost-primary" size="sm" @click="fetchPatterns">
          {{ t("regex_patterns.try_again") }}
        </OButton>
      </span>
    </div>

    <!-- Patterns List -->
    <div v-else class="patterns-list">
      <div class="tw:p-3">
        <div class="tw:text-sm tw:font-medium tw:mb-3">
          {{
            t("regex_patterns.showing_patterns", {
              count: filteredPatterns.length,
            })
          }}
        </div>

        <!-- Pattern Cards -->
        <ul class="tw:flex tw:flex-col tw:divide-y tw:divide-border tw:border tw:rounded-md">
          <li
            v-for="(pattern, index) in filteredPatterns"
            :key="`${pattern.name}-${pattern.pattern.substring(0, 20)}`"
            class="pattern-item tw:flex tw:items-center tw:gap-3 tw:px-4 tw:py-3"
            :data-test="`pattern-item-${index}`"
          >
            <div class="tw:flex tw:items-center tw:shrink-0">
              <OCheckbox
                v-model="pattern.selected"
                @update:model-value="updateSelection"
                :data-test="`pattern-checkbox-${index}`"
              />
            </div>

            <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:gap-1.5">
              <span class="tw:text-sm tw:font-semibold tw:leading-snug">
                {{ pattern.name }}
              </span>
              <div class="tw:flex tw:flex-wrap tw:gap-1">
                <OBadge
                  v-for="tag in pattern.tags.slice(0, 3)"
                  :key="tag"
                  size="md"
                  variant="primary-soft"
                  class="tw:text-[11px]! tw:ring-1 tw:ring-inset tw:ring-current"
                >
                  {{ tag }}
                </OBadge>
                <OBadge v-if="pattern.tags.length > 3" size="md" variant="default-soft" class="tw:text-[11px]! tw:ring-1 tw:ring-inset tw:ring-current">
                  +{{ pattern.tags.length - 3 }}
                </OBadge>
              </div>
              <div class="pattern-preview tw:line-clamp-1">
                {{ pattern.pattern.substring(0, 100)
                }}{{ pattern.pattern.length > 100 ? "..." : "" }}
              </div>
            </div>

            <div class="tw:flex tw:items-center tw:shrink-0 tw:ms-auto">
              <OButton
                variant="ghost"
                size="icon"
                @click="previewPattern(pattern)"
                :data-test="`pattern-preview-${index}`"
              >
                <OIcon name="visibility" size="sm" />
                <OTooltip :content="t('regex_patterns.preview')" side="top" />
              </OButton>
            </div>
          </li>

          <li v-if="filteredPatterns.length === 0" class="tw:flex tw:items-center tw:px-3 tw:py-2">
            <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0 tw:text-center tw:text-gray-400">
              <div class="tw:p-6">
                <OIcon name="search-off" style="width: 50px; height: 50px;" />
                <div class="tw:mt-3">
                  {{ t("regex_patterns.no_patterns_found") }}
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Preview Dialog -->
    <ODialog
      v-model:open="showPreview"
      size="md"
      :title="previewedPattern?.name"
      data-test="pattern-preview-dialog"
      :secondary-button-label="t('regex_patterns.close')"
      :primary-button-label="t('regex_patterns.import_this_pattern')"
      @click:secondary="showPreview = false"
      @click:primary="importSinglePattern"
    >
      <div style="max-height: 60vh; overflow-y: auto">
        <div class="tw:mb-3">
          <div class="text-weight-bold tw:mb-1">
            {{ t('regex_patterns.description') }}
          </div>
          <div>
            {{ previewedPattern?.description || t('regex_patterns.no_description') }}
          </div>
        </div>

        <div class="tw:mb-3">
          <div class="text-weight-bold tw:mb-1">{{ t('regex_patterns.pattern') }}</div>
          <OTextarea
            :model-value="previewedPattern?.pattern"
            readonly
            rows="3"
          />
        </div>

        <div class="tw:mb-3">
          <div class="text-weight-bold tw:mb-1">{{ t('regex_patterns.tags') }}</div>
          <div class="tw:flex tw:flex-wrap tw:gap-2">
            <OBadge
              v-for="tag in previewedPattern?.tags"
              :key="tag"
              size="md"
              variant="primary-soft"
              class="tw:text-[11px]! tw:ring-1 tw:ring-inset tw:ring-current"
            >
              {{ tag }}
            </OBadge>
          </div>
        </div>

        <div class="tw:mb-3">
          <div class="text-weight-bold tw:mb-1">{{ t('regex_patterns.rarity') }}</div>
          <div>{{ previewedPattern?.rarity }}</div>
        </div>

        <div
          v-if="previewedPattern?.examples?.Valid?.length > 0"
          class="tw:mb-3"
        >
          <div class="text-weight-bold tw:mb-1">
            {{ t('regex_patterns.valid_examples') }}
          </div>
          <ul class="tw:flex tw:flex-col tw:divide-y tw:divide-border tw:border tw:rounded-md">
            <li
              v-for="(example, idx) in previewedPattern.examples.Valid.slice(0, 3)"
              :key="idx"
              class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-1"
            >
              <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
                <span
                  class="tw:block tw:text-xs tw:text-muted-foreground tw:text-wrap"
                  style="word-break: break-all"
                >
                  {{ example.substring(0, 200) }}{{ example.length > 200 ? '...' : '' }}
                </span>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </ODialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import regexPatternsService from "@/services/regex_pattern";
import { RegexPatternCache } from "@/utils/regexPatternCache";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { toast } from "@/lib/feedback/Toast/useToast";

interface PatternExample {
  Valid: string[];
  Invalid: string[];
}

interface BuiltInPattern {
  name: string;
  pattern: string;
  description: string;
  tags: string[];
  rarity: number;
  url: string | null;
  examples: PatternExample;
  selected?: boolean;
}

export default defineComponent({
  name: "BuiltInPatternsTab",
  components: { OButton, ODialog, OSpinner, OIcon, OBadge, OSelect, OSearchInput, OCheckbox, OTooltip, OTextarea },
  emits: ["import-patterns"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();

    const patterns = ref<BuiltInPattern[]>([]);
    const loading = ref(false);
    const error = ref("");
    const searchQuery = ref("");
    const selectedTags = ref<string[]>([]);
    const showPreview = ref(false);
    const previewedPattern = ref<BuiltInPattern | null>(null);

    // Computed
    const availableTags = computed(() => {
      const tags = new Set<string>();
      patterns.value.forEach((p) => {
        p.tags.forEach((tag) => tags.add(tag));
      });
      return Array.from(tags).sort();
    });

    const tagOptions = computed(() =>
      availableTags.value.map((tag) => ({ label: tag, value: tag }))
    );

    const filteredPatterns = computed(() => {
      let filtered = patterns.value;

      // Apply search filter
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        filtered = filtered.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.description.toLowerCase().includes(query) ||
            p.tags.some((tag) => tag.toLowerCase().includes(query)),
        );
      }

      // Apply tag filter
      if (selectedTags.value.length > 0) {
        filtered = filtered.filter((p) =>
          selectedTags.value.some((tag) => p.tags.includes(tag)),
        );
      }

      return filtered;
    });

    const selectedPatterns = computed(() => {
      return patterns.value.filter((p) => p.selected);
    });

    const selectedCount = computed(() => selectedPatterns.value.length);

    // Methods
    const fetchPatterns = async (clearCache = false) => {
      loading.value = true;
      error.value = "";

      try {
        const orgId = store.state.selectedOrganization.identifier;

        // Clear cache if requested (manual refresh)
        if (clearCache) {
          RegexPatternCache.clear(orgId);
          // console.log('[BuiltInPatternsTab] Cleared frontend cache, fetching fresh data');
        }

        // Check frontend cache first unless cleared
        if (!clearCache) {
          const cachedPatterns = RegexPatternCache.get<BuiltInPattern[]>(orgId);
          if (cachedPatterns) {
            patterns.value = cachedPatterns.map((p: BuiltInPattern) => ({
              ...p,
              selected: false,
            }));

            // console.log(`[BuiltInPatternsTab] Loaded ${patterns.value.length} patterns from frontend cache`);

            toast({
              message: t("regex_patterns.patterns_loaded", {
                count: patterns.value.length,
              }),
              variant: "success",
            });
            loading.value = false;
            return;
          }
        }

        // Fetch from backend (no backend caching)
        const response = await regexPatternsService.getBuiltInPatterns(orgId);

        const fetchedPatterns = response.data.patterns;

        // Cache the fetched patterns in frontend
        RegexPatternCache.set(orgId, fetchedPatterns);
        // console.log(`[BuiltInPatternsTab] Cached ${fetchedPatterns.length} patterns in frontend`);

        patterns.value = fetchedPatterns.map((p: BuiltInPattern) => ({
          ...p,
          selected: false,
        }));

        toast({
          message: t("regex_patterns.patterns_loaded", {
            count: patterns.value.length,
          }),
          variant: "success",
        });
      } catch (e: any) {
        error.value =
          e.response?.data?.message ||
          e.message ||
          t("regex_patterns.failed_to_load");
        toast({
          message: error.value,
          variant: "error",
        });
      } finally {
        loading.value = false;
      }
    };

    const refreshPatterns = () => {
      fetchPatterns(true);
    };

    const updateSelection = () => {
      // Trigger reactivity
    };

    const previewPattern = (pattern: BuiltInPattern) => {
      previewedPattern.value = pattern;
      showPreview.value = true;
    };

    const importSinglePattern = () => {
      if (previewedPattern.value) {
        previewedPattern.value.selected = true;
        showPreview.value = false;
        importSelectedPatterns();
      }
    };

    const importSelectedPatterns = () => {
      const selected = selectedPatterns.value;

      if (selected.length === 0) {
        toast({
          message: t("regex_patterns.no_patterns_selected"),
          variant: "warning",
        });
        return;
      }

      // Transform to the format expected by existing import flow
      const patternsToImport = selected.map((p) => ({
        name: p.name,
        pattern: p.pattern,
        description: p.description || "",
      }));

      emit("import-patterns", patternsToImport);
    };

    // Lifecycle
    onMounted(() => {
      fetchPatterns();
    });

    return {
      t,
      patterns,
      loading,
      error,
      searchQuery,
      selectedTags,
      availableTags,
      tagOptions,
      filteredPatterns,
      selectedCount,
      showPreview,
      previewedPattern,
      fetchPatterns,
      refreshPatterns,
      updateSelection,
      previewPattern,
      importSinglePattern,
      importSelectedPatterns,
    };
  },
});
</script>

<style scoped lang="scss">
.built-in-patterns-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.filters-bar {
  flex-shrink: 0;
  border-bottom: 1px solid var(--o2-border-color);
}

.patterns-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0; // Important for flex scrolling
}

.pattern-item {
  transition: background-color 0.15s ease;

  &:hover {
    background-color: var(--o2-hover-accent);
  }
}

.pattern-preview {
  font-family: monospace;
  font-size: 0.8125rem;
  line-height: 1.4;
  color: var(--o2-text-secondary);
  word-break: break-all;
}
</style>
