<template>
  <section class="sc-list">
    <div class="sc-list__toolbar">
      <div class="sc-list__heading">
        <h2>{{ t("onlineEvals.scoreConfig.listTitle") }}</h2>
        <p>{{ t("onlineEvals.scoreConfig.listSubtitle") }}</p>
      </div>

      <div class="sc-list__toolbar-actions">
        <div class="sc-list__search">
          <OIcon name="search" size="xs" />
          <input
            :value="search"
            :placeholder="t('onlineEvals.scoreConfig.searchPlaceholder')"
            @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
          />
        </div>

        <select v-model="typeFilter" class="sc-list__select">
          <option value="">{{ t("onlineEvals.scoreConfig.allTypes") }}</option>
          <option value="numeric">{{ t("onlineEvals.scoreConfig.dataTypes.numeric").toLowerCase() }}</option>
          <option value="categorical">{{ t("onlineEvals.scoreConfig.dataTypes.categorical").toLowerCase() }}</option>
          <option value="boolean">{{ t("onlineEvals.scoreConfig.dataTypes.boolean").toLowerCase() }}</option>
        </select>

        <button class="sc-list__new-btn" type="button" @click="$emit('create')">
          <OIcon name="add" size="xs" />
          {{ t("onlineEvals.scoreConfig.newButton") }}
        </button>
      </div>
    </div>

    <div class="sc-list__table-wrap">
      <table class="sc-table">
        <thead>
          <tr>
            <th class="sc-table__col-check">
              <input type="checkbox" class="sc-checkbox" />
            </th>
            <th class="sc-table__col-index">{{ t("onlineEvals.scoreConfig.columns.index") }}</th>
            <th>{{ t("onlineEvals.scoreConfig.columns.name") }}</th>
            <th class="sc-table__col-type">{{ t("onlineEvals.scoreConfig.columns.type") }}</th>
            <th>{{ t("onlineEvals.scoreConfig.columns.rangeValues") }}</th>
            <th class="sc-table__col-healthy">{{ t("onlineEvals.scoreConfig.columns.healthy") }}</th>
            <th class="sc-table__col-version">{{ t("onlineEvals.scoreConfig.columns.activeVersion") }}</th>
            <th class="sc-table__col-usedby">{{ t("onlineEvals.scoreConfig.columns.usedBy") }}</th>
            <th class="sc-table__col-created">{{ t("onlineEvals.scoreConfig.columns.created") }}</th>
            <th class="sc-table__col-actions">{{ t("onlineEvals.scoreConfig.columns.actions") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in filteredRows"
            :key="entityId(row)"
            class="sc-table__row"
            @click="$emit('edit', row)"
          >
            <td @click.stop>
              <input type="checkbox" class="sc-checkbox" />
            </td>
            <td class="sc-table__index">{{ String(index + 1).padStart(2, "0") }}</td>
            <td class="sc-table__name">{{ row.name }}</td>
            <td>
              <span class="sc-dtype-chip" :class="`sc-dtype-chip--${dataTypeOf(row)}`">
                {{ dataTypeOf(row) }}
              </span>
            </td>
            <td class="sc-table__range">{{ rangeOrValues(row) }}</td>
            <td class="sc-table__healthy">{{ healthyDisplay(row) }}</td>
            <td class="sc-table__version">
              <span class="sc-version">
                <span class="sc-version__dot" />v{{ row.version }}
                <span class="sc-version__muted">({{ t("onlineEvals.scoreConfig.active") }})</span>
              </span>
            </td>
            <td class="sc-table__usedby">{{ usedByText(row) }}</td>
            <td class="sc-table__created">{{ formatDateShort(rowCreated(row)) }}</td>
            <td class="sc-table__actions" @click.stop>
              <button
                class="sc-icon-btn"
                type="button"
                :title="t('onlineEvals.actions.edit')"
                @click="$emit('edit', row)"
              >
                <OIcon name="edit" size="xs" />
              </button>
              <button
                class="sc-icon-btn sc-icon-btn--danger"
                type="button"
                :title="t('onlineEvals.actions.delete')"
                @click="$emit('delete', row)"
              >
                <OIcon name="delete" size="xs" />
              </button>
            </td>
          </tr>
          <tr v-if="filteredRows.length === 0">
            <td colspan="10" class="sc-table__empty">
              <OIcon name="rule" size="md" />
              <strong>{{ t("onlineEvals.noRowsFound", { label: t("onlineEvals.tabs.scoreConfigs").toLowerCase() }) }}</strong>
              <span>{{ t("onlineEvals.getStartedHint") }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { ScoreConfig, Scorer } from "@/services/online-evals.service";
import { dataTypeOf, entityId, valueOf } from "./utils/evalEntity";

const props = defineProps<{
  rows: ScoreConfig[];
  scorers: Scorer[];
  search: string;
}>();

defineEmits<{
  (e: "update:search", value: string): void;
  (e: "create"): void;
  (e: "edit", row: ScoreConfig): void;
  (e: "delete", row: ScoreConfig): void;
}>();

const { t } = useI18n();
const typeFilter = ref<"" | "numeric" | "categorical" | "boolean">("");

const filteredRows = computed(() => {
  const query = props.search.trim().toLowerCase();
  return props.rows.filter((row) => {
    if (typeFilter.value && dataTypeOf(row) !== typeFilter.value) return false;
    if (!query) return true;
    return [row.name, row.description, dataTypeOf(row)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
});

function rowCreated(row: ScoreConfig) {
  return Number(valueOf(row, "createdAt", "created_at") || valueOf(row, "updatedAt", "updated_at") || 0);
}

function rangeOrValues(row: ScoreConfig) {
  const type = dataTypeOf(row);
  if (type === "numeric") {
    const range = valueOf(row, "numericRange", "numeric_range");
    if (!range || range.min === undefined || range.max === undefined) return "—";
    return `${range.min} – ${range.max}`;
  }
  if (type === "categorical") {
    const cats = row.categories;
    if (!Array.isArray(cats) || cats.length === 0) return "—";
    return cats.join(" · ");
  }
  return "true / false";
}

function healthyDisplay(row: ScoreConfig) {
  const ht = valueOf(row, "healthyThreshold", "healthy_threshold");
  if (!ht) return "—";
  const type = dataTypeOf(row);
  if (type === "numeric") {
    if (ht.value === undefined || !ht.direction) return "—";
    const symbol = ht.direction === "gte" ? "≥" : "≤";
    return `${symbol} ${ht.value}`;
  }
  if (type === "categorical") {
    const list = ht.healthy_categories || ht.healthyCategories;
    if (!Array.isArray(list) || list.length === 0) return "—";
    return list.join(", ");
  }
  const val = ht.healthy_value ?? ht.healthyValue;
  if (val === undefined || val === null) return "—";
  return String(val);
}

function usedByText(row: ScoreConfig) {
  const id = entityId(row);
  const count = props.scorers.filter(
    (scorer) => String(valueOf(scorer, "producesScoreConfigId", "produces_score_config_id") || "") === id,
  ).length;
  if (count === 1) return t("onlineEvals.scoreConfig.usedByScorer", { count });
  return t("onlineEvals.scoreConfig.usedByScorers", { count });
}

function formatDateShort(value: number) {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}
</script>

<style lang="scss">
.sc-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.sc-list__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 20px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
}

.sc-list__heading h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--o2-text, var(--color-text-primary, #19191E));
  display: inline;
}

.sc-list__heading p {
  display: inline;
  margin: 0 0 0 10px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
  font-style: italic;
}

.sc-list__toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.sc-list__search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--color-input-border, var(--o2-border-input));
  border-radius: 4px;
  background: var(--color-card-bg);
  min-width: 240px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sc-list__search input {
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--o2-text, var(--color-text-primary, #19191E));
  font-size: 12px;
}

.sc-list__select {
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--color-input-border, var(--o2-border-input));
  border-radius: 4px;
  background: var(--color-card-bg);
  color: var(--o2-text, var(--color-text-primary, #19191E));
  font: 400 12px var(--o2-font);
}

.sc-list__new-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: var(--o2-primary-btn-bg, #3F7994);
  color: var(--o2-primary-btn-text, #FFFFFF);
  font: 600 12px/1 var(--o2-font);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s;
}

.sc-list__new-btn:hover {
  background: color-mix(in srgb, var(--color-primary-600, #3F7994) 88%, black);
}

.sc-list__table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--color-card-bg);
  border-top: 1px solid var(--color-dialog-header-border, var(--o2-border));
}

.sc-table {
  width: 100%;
  border-collapse: collapse;
}

.sc-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--o2-table-header-bg);
  padding: 8px 12px;
  font: 600 11px var(--o2-font);
  color: var(--o2-text, var(--color-text-primary, #19191E));
  text-align: left;
  letter-spacing: 0.02em;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  white-space: nowrap;
}

.sc-table th.sc-table__col-check { width: 32px; }
.sc-table th.sc-table__col-index { width: 32px; }
.sc-table th.sc-table__col-type { width: 120px; }
.sc-table th.sc-table__col-healthy { width: 150px; }
.sc-table th.sc-table__col-version { width: 140px; }
.sc-table th.sc-table__col-usedby { width: 160px; }
.sc-table th.sc-table__col-created { width: 110px; }
.sc-table th.sc-table__col-actions { width: 84px; text-align: right; }

.sc-table td {
  padding: 8px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  vertical-align: middle;
  white-space: nowrap;
}

.sc-table__row { cursor: pointer; }
.sc-table__row:hover td { background: color-mix(in srgb, var(--color-text-primary) 6%, transparent); }

.sc-table__index { color: var(--color-text-secondary, var(--o2-text-secondary)); font-family: var(--o2-font-mono); }

.sc-table__name {
  font-weight: 600;
  color: var(--o2-text, var(--color-text-primary, #19191E));
  font-family: var(--o2-font-mono);
}

.sc-table__range,
.sc-table__healthy {
  font-family: var(--o2-font-mono);
  font-size: 11.5px;
}

.sc-table__healthy { font-weight: 600; }

.sc-table__version { font-family: var(--o2-font-mono); }

.sc-table__usedby { font-family: var(--o2-font-mono); }

.sc-table__created { color: var(--color-text-secondary, var(--o2-text-secondary)); }

.sc-table__actions {
  text-align: right;
  padding: 4px 8px;
}

.sc-table__empty {
  text-align: center;
  padding: 32px 16px !important;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.sc-table__empty strong {
  display: block;
  margin: 6px 0 2px;
  color: var(--o2-text, var(--color-text-primary, #19191E));
  font-size: 14px;
}

.sc-table__empty span {
  display: block;
  font-size: 12px;
}

.sc-checkbox {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--color-input-border, var(--o2-border-input));
  border-radius: 3px;
  background: var(--color-card-bg);
  cursor: pointer;
  display: inline-grid;
  place-items: center;
  vertical-align: middle;
  flex-shrink: 0;
}

.sc-checkbox:checked {
  background: var(--color-primary-600, #3F7994);
  border-color: var(--color-primary-600, #3F7994);
}

.sc-checkbox:checked::after {
  content: "";
  width: 7px;
  height: 4px;
  border-left: 1.5px solid white;
  border-bottom: 1.5px solid white;
  transform: rotate(-45deg) translate(0, -1px);
}

.sc-dtype-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 3px;
  font: 600 11px/1.5 var(--o2-font);
}

.sc-dtype-chip--numeric { background: #EDF3FF; color: #3369D6; }
.sc-dtype-chip--categorical { background: #EFE5FF; color: #7444D4; }
.sc-dtype-chip--boolean { background: #E6F7E9; color: #208A3C; }

.sc-version {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sc-version__dot {
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: var(--o2-status-success-text);
  display: inline-block;
}

.sc-version__muted {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-weight: 400;
}

.sc-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.sc-icon-btn:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  color: var(--color-primary-600, #3F7994);
}

.sc-icon-btn--danger:hover {
  background: color-mix(in srgb, var(--o2-status-error-text) 14%, transparent);
  color: var(--o2-status-error-text);
}
</style>
