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
    <div class="query-header" @click="toggleExpand">
      <div class="header-left">
        <q-icon
          :name="isExpanded ? 'expand_less' : 'expand_more'"
          size="20px"
          class="expand-icon"
        />
        <span class="query-label">
          {{ isCustomMode ? t("panel.customSql") : t("panel.generatedSql") }}
        </span>
      </div>
      <div class="header-actions">
        <q-btn
          flat
          round
          dense
          size="sm"
          icon="content_copy"
          @click.stop="copyQuery"
          data-test="generated-query-copy-btn"
        >
          <q-tooltip>{{ t("common.copy") }}</q-tooltip>
        </q-btn>
      </div>
    </div>
    <div v-show="isExpanded" class="query-content">
      <pre v-if="!isCustomMode" class="query-text" data-test="generated-query-text">{{ query }}</pre>
      <textarea
        v-else
        v-model="editableQuery"
        class="query-textarea"
        @input="onQueryChange"
        data-test="custom-query-textarea"
        :placeholder="t('panel.enterCustomSql')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useQuasar, copyToClipboard } from "quasar";

// ============================================================================
// Props and Emits
// ============================================================================

interface Props {
  /** The SQL query to display */
  query: string;
  /** Whether in custom edit mode */
  isCustomMode: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  query: "",
  isCustomMode: false,
});

const emit = defineEmits<{
  (e: "update:query", query: string): void;
}>();

// ============================================================================
// Setup
// ============================================================================

const { t } = useI18n();
const $q = useQuasar();

// ============================================================================
// State
// ============================================================================

const isExpanded = ref(true);
const editableQuery = ref(props.query);

// ============================================================================
// Watchers
// ============================================================================

watch(
  () => props.query,
  (newQuery) => {
    editableQuery.value = newQuery;
  },
);

// ============================================================================
// Methods
// ============================================================================

const toggleExpand = () => {
  isExpanded.value = !isExpanded.value;
};

const copyQuery = () => {
  const queryToCopy = props.isCustomMode ? editableQuery.value : props.query;
  copyToClipboard(queryToCopy)
    .then(() => {
      $q.notify({
        type: "positive",
        message: t("common.copySuccess"),
        timeout: 2000,
      });
    })
    .catch(() => {
      $q.notify({
        type: "negative",
        message: t("common.copyError"),
        timeout: 2000,
      });
    });
};

const onQueryChange = () => {
  emit("update:query", editableQuery.value);
};
</script>

<style lang="scss" scoped>
.generated-query-display {
  border: 1px solid var(--q-separator);
  border-radius: 4px;
  margin: 8px;
  background-color: var(--q-bg);
}

.query-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  background-color: var(--q-page-container-bg);
  border-bottom: 1px solid var(--q-separator);

  &:hover {
    background-color: var(--q-hover);
  }
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.expand-icon {
  transition: transform 0.2s ease;
}

.query-label {
  font-weight: 600;
  font-size: 13px;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.query-content {
  padding: 12px;
  max-height: 200px;
  overflow-y: auto;
}

.query-text {
  margin: 0;
  padding: 0;
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--q-text);
  background: transparent;
}

.query-textarea {
  width: 100%;
  min-height: 100px;
  padding: 8px;
  font-family: monospace;
  font-size: 12px;
  border: 1px solid var(--q-separator);
  border-radius: 4px;
  background-color: var(--q-bg);
  color: var(--q-text);
  resize: vertical;

  &:focus {
    outline: none;
    border-color: var(--q-primary);
  }
}
</style>
