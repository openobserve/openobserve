<template>
  <q-card
    class="tw:min-w-[850px] tw:max-w-[80vw] tw:max-h-[90vh] tw:flex tw:flex-col tw:rounded-xl tw:shadow-2xl tw:overflow-hidden tw:bg-[var(--o2-card-bg)] tw:text-[var(--o2-text-primary)]">
    <!-- Header -->
    <div
      class="tw:flex tw:items-center tw:justify-between tw:px-6 tw:py-4 tw:bg-[var(--o2-card-bg)] tw:border-b tw:border-[var(--o2-border-color)]">
      <div class="tw:flex tw:flex-col">
        <div class="tw:text-xl tw:font-bold tw:m-0 tw:flex tw:items-center tw:gap-2">
          Query Inspector
        </div>
        <div class="tw:text-[var(--o2-text-secondary)] tw:text-sm tw:font-bold tw:mt-1 tw:flex tw:items-center tw:gap-3">
          <span>Panel : {{ dataTitle }}</span>
          <span class="tw:w-1 tw:h-1 tw:bg-[var(--o2-text-secondary)] tw:rounded-full"></span>
          <span>Total Queries: {{ totalQueries }}</span>
        </div>
      </div>

      <div class="tw:flex tw:items-center tw:gap-4">
        <div class="tw:relative tw:w-50">
          <q-input v-model="searchQuery" placeholder="Search keywords..." dense color="primary"
            :dark="store.state.theme === 'dark'">
            <template v-slot:prepend>
              <q-icon name="search" size="xs" />
            </template>
          </q-input>
        </div>
        <q-btn icon="close" flat round dense v-close-popup="true"
          class="tw:text-[var(--o2-text-muted)] hover:tw:text-[var(--o2-text-primary)]"
          data-test="query-inspector-close-btn" />
      </div>
    </div>

    <!-- Body -->
    <q-card-section class="tw:flex-1 tw:max-h-[60vh] tw:overflow-y-auto tw:p-6">
      <div v-if="queryData.length === 0"
        class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-64 tw:text-[var(--o2-text-muted)]">
        <q-icon name="info" size="48px" />
        <p class="tw:mt-2">No queries executed for this panel.</p>
      </div>

      <div v-else class="tw:space-y-4">
        <div v-for="(query, index) in queryData" :key="query?.originalQuery + index"
          class="tw:bg-[var(--o2-card-bg)] tw:rounded-xl tw:border tw:border-[var(--o2-border-color)] tw:shadow-sm tw:overflow-hidden">
          <!-- Query Header -->
          <div
            class="tw:p-2 tw:gap-3 tw:bg-[var(--o2-body-primary-bg)] tw:border-b tw:border-[var(--o2-border-color)] tw:flex tw:items-start tw:justify-start">
           
              <span
                class="tw:text-sm tw:font-bold tw:rounded-md">
                Query {{ index + 1 }}
              </span>
              <span
                class="tw:bg-[var(--o2-body-primary-bg)] tw:border tw:border-[var(--o2-border-color)] tw:text-[var(--o2-text-secondary)] tw:text-[10px] tw:font-bold tw:px-2 tw:py-0.5 tw:rounded-md">
                 {{ getQueryTypeDisplay(query.queryType) }}
              </span>
          </div>

          <!-- Query Content -->
          <div class="tw:p-3 tw:space-y-4">
            <!-- Original Query -->
            <div v-if="query.originalQuery">
              <div class="tw:flex tw:items-center tw:justify-between">
                <label
                  class="tw:text-xs tw:font-bold tw:tracking-wider">Original
                  Query</label>
                <q-btn flat dense no-caps color="primary" size="sm" class="tw:rounded-md tw:px-2"
                  @click="copyText(query.originalQuery)">
                  <q-icon name="content_copy" size="14px" class="tw:mr-2" />
                  Copy
                </q-btn>
              </div>
              <div class="tw:relative tw:group">
                <div
                  class="tw:p-2 tw:rounded-lg tw:bg-[var(--o2-body-primary-bg)] tw:border tw:border-[var(--o2-border-color)] tw:font-mono tw:text-sm tw:max-h-40 tw:overflow-y-auto tw:whitespace-pre-wrap tw:break-all inspector-query-editor"
                  v-html="highlightSearch(
                    colorizedQueries[`${index}-Original Query`] ||
                    query.originalQuery,
                  )
                    "></div>
              </div>
            </div>

            <!-- Executed Query -->
            <div>
              <div class="tw:flex tw:items-center tw:justify-between">
                <label
                  class="tw:text-xs tw:font-bold tw:tracking-wider">Executed
                  Query</label>
                <q-btn flat dense no-caps color="primary" size="sm" class="tw:rounded-md tw:px-2"
                  @click="copyText(query.query)">
                  <q-icon name="content_copy" size="14px" class="tw:mr-2" />
                  Copy
                </q-btn>
              </div>
              <div class="tw:relative tw:group">
                <div
                  class="tw:p-2 tw:rounded-lg tw:bg-[var(--o2-body-primary-bg)] tw:border tw:border-[var(--o2-border-color)] tw:font-mono tw:text-sm tw:max-h-40 tw:overflow-y-auto tw:whitespace-pre-wrap tw:break-all inspector-query-editor"
                  v-html="highlightSearch(
                    colorizedQueries[`${index}-Query`] || query.query,
                  )
                    "></div>
              </div>
            </div>

            <!-- Time Metadata -->
            <div class="tw:grid tw:grid-cols-2 tw:gap-4 tw:border-t tw:border-[var(--o2-border-color)] tw:pt-2">
              <div class="tw:space-y-1">
                <label
                  class="tw:text-xs tw:font-bold tw:tracking-wider">Start
                  Time</label>
                <div
                  class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:font-medium tw:flex tw:items-center tw:gap-2">
                  <q-icon name="login" size="14px" class="tw:text-[var(--o2-text-muted)]" />
                  {{ formatTimestamp(query.startTime) }}
                </div>
              </div>
              <div class="tw:space-y-1">
                <label class="tw:text-xs tw:font-bold tw:tracking-wider">End
                  Time</label>
                <div
                  class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:font-medium tw:flex tw:items-center tw:gap-2">
                  <q-icon name="logout" size="14px" class="tw:text-[var(--o2-text-muted)]" />
                  {{ formatTimestamp(query.endTime) }}
                </div>
              </div>
            </div>

            <!-- Variables List (Row by Row) -->
            <div class="tw:space-y-3 tw:border-t tw:border-[var(--o2-border-color)]">
              <!-- Standard Variables -->
              <div class="tw:pt-2">
                <label
                  class="tw:text-xs tw:font-bold tw:tracking-wider">Variable(s)</label>
                <div class="tw:flex tw:flex-wrap tw:gap-2">
                  <template v-if="getVariablesByType(query, 'variable').length">
                    <div v-for="v in getVariablesByType(query, 'variable')" :key="v.name"
                      class="tw:flex tw:items-center tw:gap-2 tw:p-1 tw:rounded-md tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:text-xs">
                      <span class="tw:font-bold tw:text-[var(--o2-text-primary)]">{{ v.name }}</span>
                      <span class="tw:text-[var(--o2-text-muted)]">:</span>
                      <span class="tw:text-[var(--o2-text-secondary)] tw:italic">{{
                        v.value
                      }}</span>
                    </div>
                  </template>
                  <span v-else class="tw:text-xs tw:text-[var(--o2-text-muted)]">-</span>
                </div>
              </div>

              <!-- Fixed Variables -->
              <div>
                <label
                  class="tw:text-xs tw:font-bold tw:tracking-wider">Fixed
                  Variable(s)</label>
                <div class="tw:flex tw:flex-wrap tw:gap-2">
                  <template v-if="getVariablesByType(query, 'fixed').length">
                    <div v-for="v in getVariablesByType(query, 'fixed')" :key="v.name"
                      class="tw:flex tw:items-center tw:gap-2 tw:p-1 tw:rounded-md tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:text-xs">
                      <span class="tw:font-bold tw:text-[var(--o2-text-primary)]">{{ v.name }}</span>
                      <span class="tw:text-[var(--o2-text-muted)]">:</span>
                      <span class="tw:text-[var(--o2-text-secondary)] tw:italic">{{
                        v.value
                      }}</span>
                    </div>
                  </template>
                  <span v-else class="tw:text-xs tw:text-[var(--o2-text-muted)]">-</span>
                </div>
              </div>

              <!-- Dynamic Variables -->
              <div>
                <label
                  class="tw:text-xs tw:font-bold tw:tracking-wider">Dynamic
                  Variable(s)</label>
                <div class="tw:flex tw:flex-wrap tw:gap-2">
                  <template v-if="getVariablesByType(query, 'dynamicVariable').length">
                    <div v-for="v in getVariablesByType(query, 'dynamicVariable')" :key="v.name"
                      class="tw:flex tw:items-center tw:gap-2 tw:p-1 tw:rounded-md tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:text-xs">
                      <span class="tw:font-bold tw:text-[var(--o2-text-primary)]">{{ v.name }}</span>
                      <span class="tw:text-[var(--o2-text-muted)]">{{ v.operator }}</span>
                      <span class="tw:text-[var(--o2-text-secondary)] tw:italic">{{
                        v.value
                      }}</span>
                    </div>
                  </template>
                  <span v-else class="tw:text-xs tw:text-[var(--o2-text-muted)]">-</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </q-card-section>
  </q-card>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, onMounted } from "vue";
import { timestampToTimezoneDate } from "@/utils/zincutils";
import { useStore } from "vuex";
import { colorizeQuery } from "@/utils/query/colorizeQuery";

export default defineComponent({
  name: "QueryInspector",
  props: {
    metaData: {
      type: Object,
      required: true,
    },
    data: {
      type: Object,
      required: true,
    },
  },
  setup(props: any) {
    const store = useStore();
    const queryData = computed(() => props.metaData?.queries || []);
    const searchQuery = ref("");
    const colorizedQueries = ref<Record<string, string>>({});

    const totalQueries = computed(() => queryData.value.length);
    const dataTitle = computed(() => props.data.title);

    const formatTimestamp = (ts: number) => {
      if (!ts) return "-";
      const formatted = timestampToTimezoneDate(
        ts / 1000,
        store.state.timezone,
        "yyyy-MM-dd HH:mm:ss.SSS",
      );
      return `${ts} (${formatted} ${store.state.timezone})`;
    };


    const getVariablesByType = (query: any, type: string) => {
      return (query.variables || []).filter((v: any) => v.type === type);
    };

    const updateColorizedQueries = async () => {
      const newColorized: Record<string, string> = {};
      for (const [index, query] of queryData.value.entries()) {
        const lang = query.queryType?.toLowerCase() || "sql";

        // Original Query
        if (query.originalQuery) {
          newColorized[`${index}-Original Query`] = await colorizeQuery(
            query.originalQuery,
            lang,
          );
        }

        // Executed Query
        if (query.query) {
          newColorized[`${index}-Query`] = await colorizeQuery(
            query.query,
            lang,
          );
        }
      }
      colorizedQueries.value = newColorized;
    };

    const highlightSearch = (html: string) => {
      if (!searchQuery.value || !html) return html;

      try {
        const escapedSearch = searchQuery.value.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );
        const regex = new RegExp(`(?![^<]*>)(${escapedSearch})`, "gi");

        return html.replace(
          regex,
          (match) =>
            `<mark class="tw:bg-yellow-400 tw:text-black tw:rounded-sm tw:shadow-sm">${match}</mark>`,
        );
      } catch (e) {
        return html;
      }
    };

    const getQueryTypeDisplay = (queryType: string) => {
      if (!queryType) return "SQL";
      const type = queryType.toLowerCase();
      if (type === "sql") return "SQL";
      if (type === "promql" || type === "metrics") return "PromQL";
      return queryType.toUpperCase();
    };

    const copyText = (text: string) => {
      if (!text) return;
      navigator.clipboard.writeText(text);
    };

    watch(
      () => props.metaData,
      updateColorizedQueries,
      { deep: true, immediate: true }
    );

    return {
      store,
      queryData,
      totalQueries,
      dataTitle,
      searchQuery,
      colorizedQueries,
      formatTimestamp,
      getVariablesByType,
      getQueryTypeDisplay,
      highlightSearch,
      copyText,
    };
  },
});
</script>

<style lang="scss" scoped>
.inspector-query-editor {

  /* Custom scrollbar styling */
  &::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(128, 128, 128, 0.2);
    border-radius: 10px;

    &:hover {
      background: rgba(128, 128, 128, 0.4);
    }
  }

  /* Firefox scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.2) transparent;
}

:deep(mark) {
  all: unset;
  background-color: #facc15;
  color: black;
  border-radius: 2px;
  padding: 0;
}

// Ensure Monaco colorized content looks good
:deep(.mtk1) {
  color: inherit;
}
</style>
