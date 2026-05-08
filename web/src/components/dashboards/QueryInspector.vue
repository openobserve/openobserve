<template>
  <ODialog
    :open="open"
    @update:open="$emit('update:open', $event)"
    title="Query Inspector"
    :sub-title="`Panel : ${dataTitle}  ·  Total Queries: ${totalQueries}`"
    :width="50"
  >
    <!-- search input: sits left of the close button via #header-right -->
    <template #header-right>
      <div class="tw:flex ">
        <q-input
          v-model="searchQuery"
          placeholder="Search keywords..."
          dense
          color="primary"
          :dark="store.state.theme === 'dark'"
        >
          <template v-slot:prepend>
            <q-icon name="search" size="xs" />
          </template>
        </q-input>
      </div>
    </template>

    <!-- Body -->
      <div
        v-if="queryData.length === 0"
        class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-64 tw:text-[var(--o2-text-muted)]"
      >
        <q-icon name="info" size="48px" />
        <p class="tw:mt-2">No queries executed for this panel.</p>
      </div>

      <div v-else class="tw:space-y-4">
        <div
          v-for="(query, index) in queryData"
          :key="query?.originalQuery + index"
          class="tw:bg-[var(--o2-card-bg)] tw:rounded-xl tw:border tw:border-[var(--o2-border-color)] tw:shadow-sm tw:overflow-hidden"
        >
          <!-- Query Header -->
          <div
            class="tw:p-2 tw:gap-3 tw:bg-[var(--o2-body-primary-bg)] tw:border-b tw:border-[var(--o2-border-color)] tw:flex tw:items-start tw:justify-start"
          >
            <span class="tw:text-sm tw:font-bold tw:rounded-md">
              Query {{ index + 1 }}
            </span>
            <span
              class="tw:bg-[var(--o2-body-primary-bg)] tw:border tw:border-[var(--o2-border-color)] tw:text-[var(--o2-text-secondary)] tw:text-[10px] tw:font-bold tw:px-2 tw:py-0.5 tw:rounded-md"
            >
              {{ getQueryTypeDisplay(query.queryType) }}
            </span>
          </div>

          <!-- Query Content -->
          <div class="tw:p-3 tw:space-y-4">
            <!-- Original Query -->
            <div v-if="query.originalQuery">
              <div class="tw:flex tw:items-center tw:justify-between">
                <label class="tw:text-xs tw:font-bold tw:tracking-wider"
                  >Original Query</label
                >
                <OButton
                  variant="ghost-primary"
                  size="sm"
                  @click="copyText(query.originalQuery)"
                >
                  <template #icon-left><q-icon name="content_copy" /></template>
                  Copy
                </OButton>
              </div>
              <div class="tw:relative tw:group">
                <div
                  class="tw:p-2 tw:rounded-lg tw:bg-[var(--o2-body-primary-bg)] tw:border tw:border-[var(--o2-border-color)] tw:font-mono tw:text-sm tw:max-h-40 tw:overflow-y-auto tw:whitespace-pre-wrap tw:break-all inspector-query-editor"
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
              <div class="tw:flex tw:items-center tw:justify-between">
                <label class="tw:text-xs tw:font-bold tw:tracking-wider"
                  >Executed Query</label
                >
                <OButton
                  variant="ghost-primary"
                  size="sm"
                  @click="copyText(query.query)"
                >
                  <template #icon-left><q-icon name="content_copy" /></template>
                  Copy
                </OButton>
              </div>
              <div class="tw:relative tw:group">
                <div
                  class="tw:p-2 tw:rounded-lg tw:bg-[var(--o2-body-primary-bg)] tw:border tw:border-[var(--o2-border-color)] tw:font-mono tw:text-sm tw:max-h-40 tw:overflow-y-auto tw:whitespace-pre-wrap tw:break-all inspector-query-editor"
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
              class="tw:grid tw:grid-cols-2 tw:gap-4 tw:border-t tw:border-[var(--o2-border-color)] tw:pt-2"
            >
              <div class="tw:space-y-1">
                <label class="tw:text-xs tw:font-bold tw:tracking-wider"
                  >Start Time</label
                >
                <div
                  class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:font-medium tw:flex tw:items-center tw:gap-2"
                >
                  <q-icon
                    name="login"
                    size="14px"
                    class="tw:text-[var(--o2-text-muted)]"
                  />
                  {{ formatTimestamp(query.startTime) }}
                </div>
              </div>
              <div class="tw:space-y-1">
                <label class="tw:text-xs tw:font-bold tw:tracking-wider"
                  >End Time</label
                >
                <div
                  class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:font-medium tw:flex tw:items-center tw:gap-2"
                >
                  <q-icon
                    name="logout"
                    size="14px"
                    class="tw:text-[var(--o2-text-muted)]"
                  />
                  {{ formatTimestamp(query.endTime) }}
                </div>
              </div>
            </div>

            <!-- Variables List (Row by Row) -->
            <div
              class="tw:space-y-3 tw:border-t tw:border-[var(--o2-border-color)]"
            >
              <!-- Standard Variables -->
              <div class="tw:pt-2">
                <label class="tw:text-xs tw:font-bold tw:tracking-wider"
                  >Variable(s)</label
                >
                <div class="tw:flex tw:flex-wrap tw:gap-2">
                  <template v-if="getVariablesByType(query, 'variable').length">
                    <div
                      v-for="v in getVariablesByType(query, 'variable')"
                      :key="v.name"
                      class="tw:flex tw:items-center tw:gap-2 tw:p-1 tw:rounded-md tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:text-xs"
                    >
                      <span
                        class="tw:font-bold tw:text-[var(--o2-text-primary)]"
                        >{{ v.name }}</span
                      >
                      <span class="tw:text-[var(--o2-text-muted)]">:</span>
                      <span
                        class="tw:text-[var(--o2-text-secondary)] tw:italic"
                        >{{ v.value }}</span
                      >
                    </div>
                  </template>
                  <span v-else class="tw:text-xs tw:text-[var(--o2-text-muted)]"
                    >-</span
                  >
                </div>
              </div>

              <!-- Fixed Variables -->
              <div>
                <label class="tw:text-xs tw:font-bold tw:tracking-wider"
                  >Fixed Variable(s)</label
                >
                <div class="tw:flex tw:flex-wrap tw:gap-2">
                  <template v-if="getVariablesByType(query, 'fixed').length">
                    <div
                      v-for="v in getVariablesByType(query, 'fixed')"
                      :key="v.name"
                      class="tw:flex tw:items-center tw:gap-2 tw:p-1 tw:rounded-md tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:text-xs"
                    >
                      <span
                        class="tw:font-bold tw:text-[var(--o2-text-primary)]"
                        >{{ v.name }}</span
                      >
                      <span class="tw:text-[var(--o2-text-muted)]">:</span>
                      <span
                        class="tw:text-[var(--o2-text-secondary)] tw:italic"
                        >{{ v.value }}</span
                      >
                    </div>
                  </template>
                  <span v-else class="tw:text-xs tw:text-[var(--o2-text-muted)]"
                    >-</span
                  >
                </div>
              </div>

              <!-- Dynamic Variables -->
              <div>
                <label class="tw:text-xs tw:font-bold tw:tracking-wider"
                  >Dynamic Variable(s)</label
                >
                <div class="tw:flex tw:flex-wrap tw:gap-2">
                  <template
                    v-if="getVariablesByType(query, 'dynamicVariable').length"
                  >
                    <div
                      v-for="v in getVariablesByType(query, 'dynamicVariable')"
                      :key="v.name"
                      class="tw:flex tw:items-center tw:gap-2 tw:p-1 tw:rounded-md tw:border tw:border-[var(--o2-border-color)] tw:bg-[var(--o2-card-bg)] tw:text-xs"
                    >
                      <span
                        class="tw:font-bold tw:text-[var(--o2-text-primary)]"
                        >{{ v.name }}</span
                      >
                      <span class="tw:text-[var(--o2-text-muted)]">{{
                        v.operator
                      }}</span>
                      <span
                        class="tw:text-[var(--o2-text-secondary)] tw:italic"
                        >{{ v.value }}</span
                      >
                    </div>
                  </template>
                  <span v-else class="tw:text-xs tw:text-[var(--o2-text-muted)]"
                    >-</span
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
import { timestampToTimezoneDate } from "@/utils/zincutils";
import { useStore } from "vuex";
import { colorizeQuery } from "@/utils/query/colorizeQuery";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import DOMPurify from "dompurify";

export default defineComponent({
  name: "QueryInspector",
  emits: ["update:open"],
  components: { OButton, ODialog },
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
            `<mark class="tw:bg-yellow-400 tw:text-black tw:rounded-sm tw:shadow-sm">${match}</mark>`,
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
      navigator.clipboard.writeText(text);
    };

    watch(() => props.metaData, updateColorizedQueries, {
      deep: true,
      immediate: true,
    });

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
