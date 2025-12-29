<!-- Copyright 2023 OpenObserve Inc.

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
    <div class="filters-bar q-pa-md">
      <div class="row q-col-gutter-md">
        <div class="col-12 col-md-6">
          <q-input
            v-model="searchQuery"
            :placeholder="t('regex_patterns.search')"
            borderless
            dense
            flat
            clearable
            class="no-border tw:w-full"
            data-test="built-in-pattern-search"
          >
            <template v-slot:prepend>
             <q-icon class="o2-search-input-icon" name="search" />
            </template>
          </q-input>
        </div>
        <div class="col-12 col-md-4">
          <q-select
            v-model="selectedTags"
            :options="availableTags"
            :label="t('regex_patterns.filter_by_tag')"
            dense
            multiple
            use-chips
            clearable
            borderless
            data-test="built-in-pattern-tag-filter"
          />
        </div>
        <div class="col-12 col-md-2">
          <q-btn
            :label="t('regex_patterns.refresh')"
            icon="refresh"
            flat
            class="o2-secondary-button tw:w-[120px]"
            @click="refreshPatterns"
            :loading="loading"
            data-test="built-in-pattern-refresh-btn"
          />
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading && patterns.length === 0" class="text-center q-pa-xl">
      <q-spinner-hourglass color="primary" size="50px" />
      <div class="q-mt-md">{{ t('regex_patterns.loading_patterns') }}</div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center q-pa-xl">
      <q-icon name="error" size="50px" color="negative" />
      <div class="q-mt-md text-negative">{{ error }}</div>
      <q-btn
        flat
        color="primary"
        :label="t('regex_patterns.try_again')"
        @click="fetchPatterns"
        class="q-mt-md"
      />
    </div>

    <!-- Patterns List -->
    <div v-else class="patterns-list">
      <div class="q-pa-md">
        <div class="text-subtitle2 q-mb-md">
          {{ t('regex_patterns.showing_patterns', { count: filteredPatterns.length }) }}
        </div>

        <!-- Pattern Cards -->
        <q-list bordered separator>
          <q-item
            v-for="(pattern, index) in filteredPatterns"
            :key="`${pattern.name}-${pattern.pattern.substring(0, 20)}`"
            class="pattern-item"
            :data-test="`pattern-item-${index}`"
          >
            <q-item-section side>
              <q-checkbox
                v-model="pattern.selected"
                @update:model-value="updateSelection"
                :data-test="`pattern-checkbox-${index}`"
              />
            </q-item-section>

            <q-item-section>
              <q-item-label class="text-weight-bold">
                {{ pattern.name }}
              </q-item-label>
              <q-item-label caption lines="2">
                <div class="q-mb-xs">
                  <q-chip
                    v-for="tag in pattern.tags.slice(0, 3)"
                    :key="tag"
                    size="sm"
                    color="primary"
                    text-color="white"
                    dense
                  >
                    {{ tag }}
                  </q-chip>
                  <q-chip
                    v-if="pattern.tags.length > 3"
                    size="sm"
                    dense
                  >
                    +{{ pattern.tags.length - 3 }}
                  </q-chip>
                </div>
                <div class="pattern-preview">
                  {{ pattern.pattern.substring(0, 100) }}{{ pattern.pattern.length > 100 ? '...' : '' }}
                </div>
              </q-item-label>
            </q-item-section>

            <q-item-section side>
              <q-btn
                flat
                round
                dense
                icon="more_vert"
                @click="previewPattern(pattern)"
                :data-test="`pattern-preview-${index}`"
              >
                <q-tooltip>{{ t('regex_patterns.preview') }}</q-tooltip>
              </q-btn>
            </q-item-section>
          </q-item>

          <q-item v-if="filteredPatterns.length === 0">
            <q-item-section class="text-center text-grey-6">
              <div class="q-pa-xl">
                <q-icon name="search_off" size="50px" />
                <div class="q-mt-md">{{ t('regex_patterns.no_patterns_found') }}</div>
              </div>
            </q-item-section>
          </q-item>
        </q-list>
      </div>
    </div>

    <!-- Preview Dialog -->
    <q-dialog v-model="showPreview" data-test="pattern-preview-dialog">
      <q-card style="min-width: 600px">
        <q-card-section>
          <div class="text-h6">{{ previewedPattern?.name }}</div>
        </q-card-section>

        <q-separator />

        <q-card-section class="q-pt-none" style="max-height: 60vh; overflow-y: auto">
          <div class="q-mb-md">
            <div class="text-weight-bold q-mb-xs">{{ t('regex_patterns.description') }}</div>
            <div>{{ previewedPattern?.description || t('regex_patterns.no_description') }}</div>
          </div>

          <div class="q-mb-md">
            <div class="text-weight-bold q-mb-xs">{{ t('regex_patterns.pattern') }}</div>
            <q-input
              :model-value="previewedPattern?.pattern"
              type="textarea"
              readonly
              outlined
              dense
              rows="3"
            />
          </div>

          <div class="q-mb-md">
            <div class="text-weight-bold q-mb-xs">{{ t('regex_patterns.tags') }}</div>
            <q-chip
              v-for="tag in previewedPattern?.tags"
              :key="tag"
              color="primary"
              text-color="white"
              dense
            >
              {{ tag }}
            </q-chip>
          </div>

          <div class="q-mb-md">
            <div class="text-weight-bold q-mb-xs">{{ t('regex_patterns.rarity') }}</div>
            <div>{{ previewedPattern?.rarity }}</div>
          </div>

          <div v-if="previewedPattern?.examples?.Valid?.length > 0" class="q-mb-md">
            <div class="text-weight-bold q-mb-xs">{{ t('regex_patterns.valid_examples') }}</div>
            <q-list dense bordered>
              <q-item v-for="(example, idx) in previewedPattern.examples.Valid.slice(0, 3)" :key="idx">
                <q-item-section>
                  <q-item-label caption class="text-wrap" style="word-break: break-all">
                    {{ example.substring(0, 200) }}{{ example.length > 200 ? '...' : '' }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-card-section>

        <q-separator />

        <q-card-actions align="right">
          <q-btn flat :label="t('regex_patterns.close')" color="primary" v-close-popup />
          <q-btn
            :label="t('regex_patterns.import_this_pattern')"
            color="primary"
            @click="importSinglePattern"
            data-test="import-single-pattern-btn"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import regexPatternsService from "@/services/regex_pattern";
import { RegexPatternCache } from "@/utils/regexPatternCache";

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
  emits: ["import-patterns"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const q = useQuasar();

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
      patterns.value.forEach(p => {
        p.tags.forEach(tag => tags.add(tag));
      });
      return Array.from(tags).sort();
    });

    const filteredPatterns = computed(() => {
      let filtered = patterns.value;

      // Apply search filter
      if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        filtered = filtered.filter(p =>
          p.name.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.tags.some(tag => tag.toLowerCase().includes(query))
        );
      }

      // Apply tag filter
      if (selectedTags.value.length > 0) {
        filtered = filtered.filter(p =>
          selectedTags.value.some(tag => p.tags.includes(tag))
        );
      }

      return filtered;
    });

    const selectedPatterns = computed(() => {
      return patterns.value.filter(p => p.selected);
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

            q.notify({
              message: t('regex_patterns.patterns_loaded', { count: patterns.value.length }),
              color: "positive",
              position: "bottom",
              timeout: 2000,
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

        q.notify({
          message: t('regex_patterns.patterns_loaded', { count: patterns.value.length }),
          color: "positive",
          position: "bottom",
          timeout: 2000,
        });
      } catch (e: any) {
        error.value = e.response?.data?.message || e.message || t('regex_patterns.failed_to_load');
        q.notify({
          message: error.value,
          color: "negative",
          position: "bottom",
          timeout: 4000,
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
        q.notify({
          message: t('regex_patterns.no_patterns_selected'),
          color: "warning",
          position: "bottom",
          timeout: 2000,
        });
        return;
      }

      // Transform to the format expected by existing import flow
      const patternsToImport = selected.map(p => ({
        name: p.name,
        pattern: p.pattern,
        description: p.description || '',
      }));

      emit('import-patterns', patternsToImport);
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
  background: var(--q-color-background);
  border-bottom: 1px solid var(--q-color-separator);
}

.patterns-list {
  flex: 1;
  overflow-y: auto;
  min-height: 0; // Important for flex scrolling
}

.pattern-item {
  &:hover {
    background-color: rgba(0, 0, 0, 0.02);
  }
}

.pattern-preview {
  font-family: monospace;
  font-size: 0.85em;
  color: var(--q-color-text-caption);
  word-break: break-all;
}
</style>
