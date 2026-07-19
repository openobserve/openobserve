<template>
  <ODialog data-test="query-inspector"
    :open="open"
    @update:open="$emit('update:open', $event)"
    :title="t('dashboard.queryInspector.title')"
    :sub-title="t('dashboard.queryInspector.subTitle', { dataTitle, totalQueries })"
    :width="50"
  >
    <!-- search input: sits left of the close button via #header-right -->
    <template #header-right>
      <div class="flex">
        <OSearchInput
          v-model="searchQuery"
          :placeholder="t('dashboard.queryInspector.searchKeywords')"
          data-test="query-inspector-search"
          size="xs"
        />
      </div>
    </template>

    <!-- Body -->
      <div
        v-if="queryData.length === 0"
        class="flex flex-col items-center justify-center h-64 text-text-muted"
      >
        <OIcon class="w-12 h-12" name="info" />
        <p class="mt-2">{{ t('dashboard.queryInspector.noQueries') }}</p>
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="(query, index) in queryData"
          :key="query?.originalQuery + index"
          class="bg-card-glass-bg rounded-default border border-card-glass-border overflow-hidden"
        >
          <!-- Query Header -->
          <div
            class="p-2 gap-3 bg-theme-body-bg-primary border-b border-card-glass-border flex items-start justify-start"
          >
            <span class="text-sm font-bold rounded-default"
                :data-test="`query-inspector-query-name-${index}`"
            >
              {{ query.tabName || t('dashboard.queryInspector.queryN', { n: index + 1 }) }}
            </span>
            <span
              class="bg-theme-body-bg-primary border border-card-glass-border text-text-secondary text-3xs font-bold px-2 py-0.5 rounded-default"
            >
              {{ getQueryTypeDisplay(query.queryType) }}
            </span>
          </div>

          <!-- Query Content -->
          <div class="p-3 space-y-4">
            <!-- Original Query -->
            <div v-if="query.originalQuery">
              <div class="flex items-center justify-between">
                <label class="text-xs font-bold tracking-wider"
                  >{{ t('dashboard.queryInspector.originalQuery') }}</label
                >
                <OButton
                  variant="ghost-primary"
                  size="sm"
                  @click="copyText(query.originalQuery)"
                  icon-left="content-copy"
                >
                  {{ t('dashboard.queryInspector.copy') }}
                </OButton>
              </div>
              <div class="relative group mt-1">
                <div
                  class="p-2 rounded-default bg-theme-body-bg-primary border border-card-glass-border font-mono text-sm max-h-40 overflow-y-auto whitespace-pre-wrap break-all [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--color-grey-500)_20%,transparent)_transparent] inspector-query-editor"
                  :data-test="`query-inspector-original-query-${index}`"
                  v-html="
                    highlightSearch(
                      colorizedQueries[`${index}-Original Query`] ||
                        query.originalQuery,
                      !!colorizedQueries[`${index}-Original Query`],
                    )
                  "
                ></div>
              </div>
            </div>

            <!-- Executed Query -->
            <div>
              <div class="flex items-center justify-between">
                <label class="text-xs font-bold tracking-wider"
                  >{{ t('dashboard.queryInspector.executedQuery') }}</label
                >
                <OButton
                  variant="ghost-primary"
                  size="sm"
                  @click="copyText(query.query)"
                  icon-left="content-copy"
                >
                  {{ t('dashboard.queryInspector.copy') }}
                </OButton>
              </div>
              <div class="relative group mt-1">
                <div
                  class="p-2 rounded-default bg-theme-body-bg-primary border border-card-glass-border font-mono text-sm max-h-40 overflow-y-auto whitespace-pre-wrap break-all [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--color-grey-500)_20%,transparent)_transparent] inspector-query-editor"
                  :data-test="`query-inspector-executed-query-${index}`"
                  v-html="
                    highlightSearch(
                      colorizedQueries[`${index}-Query`] || query.query,
                      !!colorizedQueries[`${index}-Query`],
                    )
                  "
                ></div>
              </div>
            </div>

            <!-- Time Metadata -->
            <div
              class="grid grid-cols-2 gap-4 border-t border-card-glass-border pt-2"
            >
              <div class="space-y-1"
                :data-test="`dashboard-query-inspector-start-time-${index}`"
              >
                <label class="text-xs font-bold tracking-wider"
                  >{{ t('dashboard.queryInspector.startTime') }}</label
                >
                <div
                  class="text-xs text-text-secondary font-medium flex items-center gap-2"
                >
                  <OIcon
                    name="login"
                    size="xs"
                    class="text-text-muted"
                  />
                  {{ formatTimestamp(query.startTime) }}
                </div>
              </div>
              <div class="space-y-1"
                :data-test="`dashboard-query-inspector-end-time-${index}`"
              >
                <label class="text-xs font-bold tracking-wider"
                  >{{ t('dashboard.queryInspector.endTime') }}</label
                >
                <div
                  class="text-xs text-text-secondary font-medium flex items-center gap-2"
                >
                  <OIcon
                    name="logout"
                    size="xs"
                    class="text-text-muted"
                  />
                  {{ formatTimestamp(query.endTime) }}
                </div>
              </div>
            </div>

            <!-- Variables List (Row by Row) -->
            <div
              class="space-y-3 border-t border-card-glass-border"
            >
              <!-- Standard Variables -->
              <div class="pt-2">
                <label class="text-xs font-bold tracking-wider"
                  >{{ t('dashboard.queryInspector.variables') }}</label
                >
                <div class="flex flex-wrap gap-2 mt-1">
                  <template v-if="getVariablesByType(query, 'variable').length">
                    <div
                      v-for="v in getVariablesByType(query, 'variable')"
                      :key="v.name"
                      class="flex items-center gap-2 p-1 rounded-default border border-card-glass-border bg-card-glass-bg text-xs"
                    >
                      <span
                        class="font-bold text-text-label"
                      >{{ v.name }}</span
                      >
                      <span class="text-text-muted">:</span>
                      <span
                        class="text-text-secondary italic"
                      >{{ v.value }}</span
                      >
                    </div>
                  </template>
                  <span v-else class="text-xs text-text-muted">-</span
                  >
                </div>
              </div>

              <!-- Fixed Variables -->
              <div>
                <label class="text-xs font-bold tracking-wider"
                  >{{ t('dashboard.queryInspector.fixedVariables') }}</label
                >
                <div class="flex flex-wrap gap-2 mt-1">
                  <template v-if="getVariablesByType(query, 'fixed').length">
                    <div
                      v-for="v in getVariablesByType(query, 'fixed')"
                      :key="v.name"
                      class="flex items-center gap-2 p-1 rounded-default border border-card-glass-border bg-card-glass-bg text-xs"
                    >
                      <span
                        class="font-bold text-text-label"
                      >{{ v.name }}</span
                      >
                      <span class="text-text-muted">:</span>
                      <span
                        class="text-text-secondary italic"
                      >{{ v.value }}</span
                      >
                    </div>
                  </template>
                  <span v-else class="text-xs text-text-muted">-</span
                  >
                </div>
              </div>

              <!-- Dynamic Variables -->
              <div>
                <label class="text-xs font-bold tracking-wider"
                  >{{ t('dashboard.queryInspector.dynamicVariables') }}</label
                >
                <div class="flex flex-wrap gap-2 mt-1">
                  <template
                    v-if="getVariablesByType(query, 'dynamicVariable').length"
                  >
                    <div
                      v-for="v in getVariablesByType(query, 'dynamicVariable')"
                      :key="v.name"
                      class="flex items-center gap-2 p-1 rounded-default border border-card-glass-border bg-card-glass-bg text-xs"
                    >
                      <span
                        class="font-bold text-text-label"
                      >{{ v.name }}</span
                      >
                      <span class="text-text-muted">{{
                        v.operator
                      }}</span>
                      <span
                        class="text-text-secondary italic"
                      >{{ v.value }}</span
                      >
                    </div>
                  </template>
                  <span v-else class="text-xs text-text-muted">-</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
  </ODialog>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { timestampToTimezoneDate } from "@/utils/zincutils";
import { useStore } from "vuex";
import { colorizeQuery } from "@/utils/query/colorizeQuery";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import DOMPurify from "dompurify";
import { copyToClipboard } from "@/utils/clipboard";

export default defineComponent({
  name: "QueryInspector",
  emits: ["update:open"],
  components: { OButton, ODialog, OSearchInput,
    OIcon,
},
  props: {
    open: {
      type: Boolean,
      default: false,
    },
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
    const { t } = useI18n();
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

    const escapeHtml = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const highlightSearch = (html: string, isColorized: boolean) => {
      if (!html) return "";
      const safeHtml = isColorized
        ? DOMPurify.sanitize(html)
        : escapeHtml(html);
      if (!searchQuery.value) return safeHtml;

      try {
        const escapedSearch = searchQuery.value.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );
        const regex = new RegExp(`(?![^<]*>)(${escapedSearch})`, "gi");

        return safeHtml.replace(
          regex,
          (match) =>
            `<mark class="rounded-default">${match}</mark>`,
        );
      } catch (e) {
        return safeHtml;
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
      copyToClipboard(text, { silent: true });
    };

    watch(() => props.metaData, updateColorizedQueries, {
      deep: true,
      immediate: true,
    });

    return {
      t,
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

<style scoped>
/* keep(scrollbar): custom webkit scrollbar for the query preview, plus :deep
   overrides for the highlight <mark> and Monaco token spans injected via v-html. */
.inspector-query-editor::-webkit-scrollbar {
  width: 0.375rem;
  height: 0.375rem;
}

.inspector-query-editor::-webkit-scrollbar-track {
  background: transparent;
}

.inspector-query-editor::-webkit-scrollbar-thumb {
  background: var(--color-border-default);
  border-radius: 0.625rem;
}

.inspector-query-editor::-webkit-scrollbar-thumb:hover {
  background: var(--color-border-strong);
}

.inspector-query-editor :deep(mark) {
  all: unset;
  background-color: var(--color-table-highlight-bg);
  color: var(--color-table-highlight-text);
  border-radius: 0.125rem;
  padding: 0;
}

/* Ensure Monaco colorized content looks good */
.inspector-query-editor :deep(.mtk1) {
  color: inherit;
}
</style>
