<template>
  <q-card
    class="tw:min-w-[900px] tw:max-w-[95vw] tw:max-h-[90vh] tw:flex tw:flex-col tw:rounded-xl tw:shadow-2xl tw:overflow-hidden dark:tw:bg-zinc-900">
    <!-- Header -->
    <div
      class="tw:flex tw:items-center tw:justify-between tw:px-6 tw:py-4 tw:bg-white dark:tw:bg-zinc-900 tw:border-b dark:tw:border-zinc-800">
      <div class="tw:flex tw:flex-col">
        <div
          class="tw:text-xl tw:font-bold tw:text-zinc-900 dark:tw:text-zinc-100 tw:m-0 tw:flex tw:items-center tw:gap-2">
          <q-icon name="search" size="24px" class="tw:text-primary" />
          Query Inspector
        </div>
        <div class="tw:text-sm tw:text-zinc-500 tw:mt-1 tw:flex tw:items-center tw:gap-3">
          <span class="tw:font-medium">Panel: {{ dataTitle }}</span>
          <span class="tw:w-1 tw:h-1 tw:bg-zinc-400 tw:rounded-full"></span>
          <span>Total Queries: {{ totalQueries }}</span>
        </div>
      </div>

      <div class="tw:flex tw:items-center tw:gap-4">
        <div class="tw:relative tw:w-64">
          <q-input v-model="searchQuery" placeholder="Search keywords..." dense outlined
            class="tw:bg-zinc-50 dark:tw:bg-zinc-800" color="primary">
            <template v-slot:prepend>
              <q-icon name="search" size="xs" />
            </template>
            <template v-slot:append v-if="searchQuery">
              <q-icon name="close" size="xs" class="tw:cursor-pointer" @click="searchQuery = ''" />
            </template>
          </q-input>
        </div>
        <q-btn icon="close" flat round dense v-close-popup="true"
          class="tw:text-zinc-400 hover:tw:text-zinc-600 dark:hover:tw:text-zinc-200"
          data-test="query-inspector-close-btn" />
      </div>
    </div>

    <!-- Body -->
    <q-card-section class="tw:flex-1 tw:overflow-y-auto tw:p-6 tw:bg-zinc-50 dark:tw:bg-zinc-950/50">
      <div v-if="queryData.length === 0"
        class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-64 tw:text-zinc-400">
        <q-icon name="info" size="48px" />
        <p class="tw:mt-2">No queries executed for this panel.</p>
      </div>

      <div v-else class="tw:space-y-10">
        <div v-for="(query, index) in queryData" :key="query?.originalQuery + index"
          class="tw:bg-white dark:tw:bg-zinc-900 tw:rounded-xl tw:border dark:tw:border-zinc-800 tw:shadow-sm tw:overflow-hidden">
          <!-- Query Header -->
          <div
            class="tw:px-5 tw:py-3 tw:bg-zinc-50 dark:tw:bg-zinc-800/50 tw:border-b dark:tw:border-zinc-800 tw:flex tw:items-center tw:justify-between">
            <div class="tw:flex tw:items-center tw:gap-3">
              <span
                class="tw:bg-primary/10 tw:text-primary tw:text-xs tw:font-bold tw:px-2.5 tw:py-1 tw:rounded-md tw:uppercase">
                Query {{ index + 1 }}
              </span>
              <span
                class="tw:bg-zinc-200 dark:tw:bg-zinc-700 tw:text-zinc-700 dark:tw:text-zinc-300 tw:text-[10px] tw:font-bold tw:px-2 tw:py-1 tw:rounded-md tw:uppercase">
                {{ query.queryType }}
              </span>
            </div>
            <div class="tw:flex tw:gap-4 tw:text-[11px] tw:text-zinc-500 tw:font-medium">
              <div class="tw:flex tw:items-center tw:gap-1.5">
                <q-icon name="schedule" size="14px" />
                <span>Elapsed: {{ getDuration(query.startTime, query.endTime) }}ms</span>
              </div>
            </div>
          </div>

          <!-- Query Content -->
          <div class="tw:p-6 tw:space-y-8">
            <!-- Executed Query -->
            <div class="tw:space-y-3">
              <div class="tw:flex tw:items-center tw:justify-between">
                <label class="tw:text-xs tw:font-bold tw:text-zinc-500 tw:uppercase tw:tracking-wider">Executed
                  Query</label>
                <q-btn flat dense no-caps color="primary" size="sm" class="tw:rounded-md tw:px-2"
                  @click="copyText(query.query)">
                  <q-icon name="content_copy" size="14px" class="tw:mr-2" />
                  Copy
                </q-btn>
              </div>
              <div class="tw:relative tw:group">
                <div
                  class="tw:p-4 tw:rounded-lg tw:bg-zinc-50 dark:tw:bg-zinc-950 tw:border dark:tw:border-zinc-800 tw:font-mono tw:text-sm tw:max-h-60 tw:overflow-y-auto tw:whitespace-pre-wrap tw:break-all inspector-query-editor"
                  v-html="highlightSearch(colorizedQueries[`${index}-Query`] || query.query)"></div>
              </div>
            </div>

            <!-- Original Query -->
            <div v-if="query.originalQuery" class="tw:space-y-3">
              <div class="tw:flex tw:items-center tw:justify-between">
                <label class="tw:text-xs tw:font-bold tw:text-zinc-500 tw:uppercase tw:tracking-wider">Original
                  Query</label>
                <q-btn flat dense no-caps color="primary" size="sm" class="tw:rounded-md tw:px-2"
                  @click="copyText(query.originalQuery)">
                  <q-icon name="content_copy" size="14px" class="tw:mr-2" />
                  Copy
                </q-btn>
              </div>
              <div class="tw:relative tw:group">
                <div
                  class="tw:p-4 tw:rounded-lg tw:bg-zinc-50 dark:tw:bg-zinc-950 tw:border dark:tw:border-zinc-800 tw:font-mono tw:text-sm tw:max-h-40 tw:overflow-y-auto tw:whitespace-pre-wrap tw:break-all inspector-query-editor"
                  v-html="highlightSearch(colorizedQueries[`${index}-Original Query`] || query.originalQuery)"></div>
              </div>
            </div>

            <!-- Variables Grid -->
            <div class="tw:grid tw:grid-cols-1 tw:md:grid-cols-3 tw:gap-8 tw:pt-6 tw:border-t dark:tw:border-zinc-800">
              <!-- Standard Variables -->
              <div class="tw:space-y-3">
                <label
                  class="tw:text-[10px] tw:font-bold tw:text-zinc-400 tw:uppercase tw:tracking-wider">Variable(s)</label>
                <div class="tw:flex tw:flex-wrap tw:gap-2">
                  <template v-if="getVariablesByType(query, 'variable').length">
                    <div v-for="v in getVariablesByType(query, 'variable')" :key="v.name"
                      class="tw:flex tw:items-center tw:gap-2 tw:px-2.5 tw:py-1.5 tw:rounded-lg tw:border dark:tw:border-zinc-800 tw:bg-white dark:tw:bg-zinc-900 tw:text-xs">
                      <span class="tw:font-bold tw:text-zinc-700 dark:tw:text-zinc-300">{{ v.name }}</span>
                      <span class="tw:text-zinc-400">:</span>
                      <span class="tw:text-zinc-500 tw:italic">{{ v.value }}</span>
                    </div>
                  </template>
                  <span v-else class="tw:text-xs tw:text-zinc-400">-</span>
                </div>
              </div>

              <!-- Fixed Variables -->
              <div class="tw:space-y-3">
                <label class="tw:text-[10px] tw:font-bold tw:text-zinc-400 tw:uppercase tw:tracking-wider">Fixed
                  Variable(s)</label>
                <div class="tw:flex tw:flex-wrap tw:gap-2">
                  <template v-if="getVariablesByType(query, 'fixed').length">
                    <div v-for="v in getVariablesByType(query, 'fixed')" :key="v.name"
                      class="tw:flex tw:items-center tw:gap-2 tw:px-2.5 tw:py-1.5 tw:rounded-lg tw:border dark:tw:border-zinc-800 tw:bg-white dark:tw:bg-zinc-900 tw:text-xs">
                      <span class="tw:font-bold tw:text-zinc-700 dark:tw:text-zinc-300">{{ v.name }}</span>
                      <span class="tw:text-zinc-400">:</span>
                      <span class="tw:text-zinc-500 tw:italic">{{ v.value }}</span>
                    </div>
                  </template>
                  <span v-else class="tw:text-xs tw:text-zinc-400">-</span>
                </div>
              </div>

              <!-- Dynamic Variables -->
              <div class="tw:space-y-3">
                <label class="tw:text-[10px] tw:font-bold tw:text-zinc-400 tw:uppercase tw:tracking-wider">Dynamic
                  Variable(s)</label>
                <div class="tw:flex tw:flex-wrap tw:gap-2">
                  <template v-if="getVariablesByType(query, 'dynamicVariable').length">
                    <div v-for="v in getVariablesByType(query, 'dynamicVariable')" :key="v.name"
                      class="tw:flex tw:items-center tw:gap-2 tw:px-2.5 tw:py-1.5 tw:rounded-lg tw:border dark:tw:border-zinc-800 tw:bg-white dark:tw:bg-zinc-900 tw:text-xs">
                      <span class="tw:font-bold tw:text-zinc-700 dark:tw:text-zinc-300">{{ v.name }}</span>
                      <span class="tw:text-zinc-400">{{ v.operator }}</span>
                      <span class="tw:text-zinc-500 tw:italic">{{ v.value }}</span>
                    </div>
                  </template>
                  <span v-else class="tw:text-xs tw:text-zinc-400">-</span>
                </div>
              </div>
            </div>

            <!-- Time Metadata -->
            <div class="tw:grid tw:grid-cols-1 tw:sm:grid-cols-2 tw:gap-8 tw:pt-6 tw:border-t dark:tw:border-zinc-800">
              <div class="tw:space-y-2">
                <span class="tw:text-[10px] tw:font-bold tw:text-zinc-400 tw:uppercase tw:tracking-wider">Start
                  Time</span>
                <div
                  class="tw:text-xs tw:text-zinc-700 dark:tw:text-zinc-300 tw:font-medium tw:flex tw:items-center tw:gap-2">
                  <q-icon name="login" size="14px" class="tw:text-zinc-400" />
                  {{ formatTimestamp(query.startTime) }}
                </div>
              </div>
              <div class="tw:space-y-2">
                <span class="tw:text-[10px] tw:font-bold tw:text-zinc-400 tw:uppercase tw:tracking-wider">End
                  Time</span>
                <div
                  class="tw:text-xs tw:text-zinc-700 dark:tw:text-zinc-300 tw:font-medium tw:flex tw:items-center tw:gap-2">
                  <q-icon name="logout" size="14px" class="tw:text-zinc-400" />
                  {{ formatTimestamp(query.endTime) }}
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
import { useQuasar } from "quasar";

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
    const $q = useQuasar();
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
        "yyyy-MM-dd HH:mm:ss.SSS"
      );
      return `${ts} (${formatted} ${store.state.timezone})`;
    };

    const getDuration = (start: number, end: number) => {
      if (!start || !end) return 0;
      return (end / 1000 - start / 1000).toFixed(2);
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
            lang
          );
        }

        // Executed Query
        if (query.query) {
          newColorized[`${index}-Query`] = await colorizeQuery(
            query.query,
            lang
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
          "\\$&"
        );
        const regex = new RegExp(`(?![^<]*>)(${escapedSearch})`, "gi");

        return html.replace(
          regex,
          (match) =>
            `<mark class="tw:bg-yellow-400 tw:text-black tw:rounded-sm tw:px-0.5 tw:shadow-sm">${match}</mark>`
        );
      } catch (e) {
        return html;
      }
    };

    const copyText = (text: string) => {
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        $q.notify({
          type: "positive",
          message: "Copied to clipboard",
          timeout: 2000,
          position: "bottom",
        });
      });
    };

    onMounted(() => {
      updateColorizedQueries();
    });

    watch(() => props.metaData, updateColorizedQueries, { deep: true });

    return {
      queryData,
      totalQueries,
      dataTitle,
      searchQuery,
      colorizedQueries,
      formatTimestamp,
      getDuration,
      getVariablesByType,
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
    background: rgba(128, 128, 128, 0.3);
    border-radius: 10px;

    &:hover {
      background: rgba(128, 128, 128, 0.5);
    }
  }

  /* Firefox scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.3) transparent;
}

:deep(mark) {
  all: unset;
  background-color: #facc15;
  color: black;
  border-radius: 2px;
  padding: 0 2px;
}

// Ensure Monaco colorized content looks good
:deep(.mtk1) {
  color: inherit;
}
</style>
