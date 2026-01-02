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
  <div class="generated-query-display">
    <div class="query-header" @click="toggleCollapse">
      <div class="header-left">
        <q-icon
          :name="collapsed ? 'chevron_right' : 'expand_more'"
          size="sm"
          class="collapse-icon"
        />
        <span class="header-title">Generated SQL Query</span>
        <q-chip
          size="sm"
          color="primary"
          text-color="white"
          class="auto-chip"
        >
          Auto-generated
        </q-chip>
      </div>

      <div class="header-actions" @click.stop>
        <q-btn
          flat
          dense
          size="sm"
          icon="content_copy"
          @click="copyQuery"
          class="action-btn"
          data-test="copy-sql-btn"
        >
          <q-tooltip>Copy SQL</q-tooltip>
        </q-btn>

        <q-btn
          flat
          dense
          size="sm"
          icon="open_in_new"
          @click="openInSQLMode"
          class="action-btn"
          data-test="edit-sql-btn"
        >
          <q-tooltip>Edit in SQL mode</q-tooltip>
        </q-btn>
      </div>
    </div>

    <q-slide-transition>
      <div v-show="!collapsed" class="query-content">
        <pre class="sql-code" data-test="sql-query-content"><code v-html="highlightedQuery"></code></pre>
      </div>
    </q-slide-transition>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from "vue";
import { useQuasar } from "quasar";

export default defineComponent({
  name: "GeneratedQueryDisplay",

  props: {
    query: {
      type: String,
      required: true,
    },
    collapsed: {
      type: Boolean,
      default: true,
    },
  },

  emits: ["toggle", "copy", "edit"],

  setup(props, { emit }) {
    const $q = useQuasar();

    // SQL syntax highlighting (simple regex-based)
    const highlightedQuery = computed(() => {
      if (!props.query) return '<span class="sql-empty">No query generated yet</span>';

      let highlighted = escapeHtml(props.query);

      // Keywords
      const keywords = [
        "SELECT",
        "FROM",
        "WHERE",
        "GROUP BY",
        "ORDER BY",
        "LIMIT",
        "AND",
        "OR",
        "NOT",
        "IN",
        "AS",
        "ON",
        "JOIN",
        "LEFT",
        "RIGHT",
        "INNER",
        "OUTER",
        "HAVING",
        "DISTINCT",
        "COUNT",
        "SUM",
        "AVG",
        "MIN",
        "MAX",
        "CASE",
        "WHEN",
        "THEN",
        "ELSE",
        "END",
        "IS",
        "NULL",
        "LIKE",
        "BETWEEN",
        "ASC",
        "DESC",
      ];

      keywords.forEach((keyword) => {
        const regex = new RegExp(`\\b${keyword}\\b`, "gi");
        highlighted = highlighted.replace(
          regex,
          `<span class="sql-keyword">${keyword}</span>`
        );
      });

      // Functions (word followed by opening parenthesis)
      highlighted = highlighted.replace(
        /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
        '<span class="sql-function">$1</span>('
      );

      // Strings (single quotes)
      highlighted = highlighted.replace(
        /'([^']*)'/g,
        '<span class="sql-string">\'$1\'</span>'
      );

      // Numbers
      highlighted = highlighted.replace(
        /\b(\d+\.?\d*)\b/g,
        '<span class="sql-number">$1</span>'
      );

      // Comments (-- style)
      highlighted = highlighted.replace(
        /--([^\n]*)/g,
        '<span class="sql-comment">--$1</span>'
      );

      return highlighted;
    });

    const escapeHtml = (text: string): string => {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    };

    const toggleCollapse = () => {
      emit("toggle");
    };

    const copyQuery = async () => {
      try {
        await navigator.clipboard.writeText(props.query);
        $q.notify({
          type: "positive",
          message: "SQL query copied to clipboard",
          timeout: 2000,
        });
        emit("copy");
      } catch (error) {
        $q.notify({
          type: "negative",
          message: "Failed to copy query",
          timeout: 2000,
        });
      }
    };

    const openInSQLMode = () => {
      emit("edit");
    };

    return {
      highlightedQuery,
      toggleCollapse,
      copyQuery,
      openInSQLMode,
    };
  },
});
</script>

<style lang="scss" scoped>
.generated-query-display {
  border: 1px solid var(--q-border-color, #e0e0e0);
  border-radius: 4px;
  margin: 12px;
  overflow: hidden;
}

.query-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: #f5f5f5;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s;

  &:hover {
    background-color: #ececec;
  }
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.collapse-icon {
  transition: transform 0.3s;
}

.header-title {
  font-weight: 600;
  font-size: 14px;
}

.auto-chip {
  font-size: 11px;
  height: 20px;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  min-width: auto;
  padding: 4px 8px;
}

.query-content {
  padding: 12px;
  background-color: #ffffff;
  max-height: 400px;
  overflow-y: auto;
}

.sql-code {
  margin: 0;
  font-family: "Courier New", Courier, monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-wrap: break-word;

  :deep(.sql-keyword) {
    color: #569cd6;
    font-weight: bold;
  }

  :deep(.sql-function) {
    color: #dcdcaa;
  }

  :deep(.sql-string) {
    color: #ce9178;
  }

  :deep(.sql-number) {
    color: #b5cea8;
  }

  :deep(.sql-comment) {
    color: #6a9955;
    font-style: italic;
  }

  :deep(.sql-empty) {
    color: #888;
    font-style: italic;
  }
}

// Dark mode adjustments
body.body--dark {
  .query-header {
    background-color: #2c2c2c;

    &:hover {
      background-color: #3a3a3a;
    }
  }

  .query-content {
    background-color: #1e1e1e;
  }
}

// Light mode adjustments
body.body--light {
  .query-header {
    background-color: #f5f5f5;

    &:hover {
      background-color: #ececec;
    }
  }

  .query-content {
    background-color: #ffffff;
  }
}
</style>
