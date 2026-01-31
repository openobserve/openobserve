# Logs Query Builder - Implementation Plan

## Overview

This document provides a detailed implementation plan with specific file locations and code changes for the Logs Query Builder feature.

---

## Phase 1: SQL Query Parser

### 1.1 Create SQLQueryParser.ts

**File**: `web/src/utils/query/sqlQueryParser.ts`

**Status**: NEW FILE (~800 lines)

```typescript
// ============================================================================
// Types and Interfaces
// ============================================================================

export interface ParsedQuery {
  stream: string;
  streamType: string;
  xFields: ParsedField[];
  yFields: ParsedField[];
  zFields: ParsedField[];
  breakdownFields: ParsedField[];
  filters: ParsedFilter[];
  groupBy: string[];
  orderBy: OrderByClause[];
  limit: number | null;
  customQuery: boolean;
  rawQuery: string;
  parseError?: string;
}

export interface ParsedField {
  name: string;
  alias: string;
  aggregationFunction?: string;
  isDerived?: boolean;
  expression?: string;
}

export interface ParsedFilter {
  column: string;
  operator: string;
  value: string | number | boolean | null;
  logicalOperator?: 'AND' | 'OR';
  type: 'condition' | 'group';
  conditions?: ParsedFilter[];
}

export interface OrderByClause {
  column: string;
  direction: 'ASC' | 'DESC';
}

// ============================================================================
// Constants - Unparseable Patterns
// ============================================================================

const UNPARSEABLE_PATTERNS: RegExp[] = [
  // Subqueries
  /\bSELECT\s+.*\(\s*SELECT\b/is,        // Subquery in SELECT
  /\bFROM\s+\(\s*SELECT\b/is,            // Subquery in FROM
  /\bWHERE\s+.*\(\s*SELECT\b/is,         // Subquery in WHERE
  /\bIN\s*\(\s*SELECT\b/is,              // IN subquery

  // CASE/SWITCH statements
  /\bCASE\s+.*\bWHEN\b/is,
  /\bSWITCH\s*\(/i,

  // Set operations
  /\bUNION\s+(ALL\s+)?SELECT\b/is,
  /\bINTERSECT\s+SELECT\b/is,
  /\bEXCEPT\s+SELECT\b/is,

  // Window functions
  /\bOVER\s*\(/i,
  /\bPARTITION\s+BY\b/i,
  /\b(ROW_NUMBER|RANK|DENSE_RANK|NTILE|LAG|LEAD|FIRST_VALUE|LAST_VALUE)\s*\(/i,

  // Complex JOINs (more than 2)
  /\bJOIN\b.*\bJOIN\b.*\bJOIN\b/is,

  // CTEs
  /\bWITH\s+\w+\s+AS\s*\(/i,

  // HAVING clause (complex)
  /\bHAVING\s+.*\bAND\b.*\bOR\b/is,
];

// ============================================================================
// Main Parser Function
// ============================================================================

/**
 * Parse a SQL query into a structured format for the visual query builder.
 * Returns customQuery=true if the query is too complex to parse.
 */
export function parseSQL(query: string): ParsedQuery {
  const emptyResult: ParsedQuery = {
    stream: '',
    streamType: 'logs',
    xFields: [],
    yFields: [],
    zFields: [],
    breakdownFields: [],
    filters: [],
    groupBy: [],
    orderBy: [],
    limit: null,
    customQuery: true,
    rawQuery: query,
  };

  if (!query || query.trim() === '') {
    return { ...emptyResult, customQuery: false };
  }

  // Normalize the query
  const normalizedQuery = normalizeQuery(query);

  // Check if query is parseable
  if (!isQueryParseable(normalizedQuery)) {
    return {
      ...emptyResult,
      parseError: 'Query contains complex patterns that cannot be parsed',
    };
  }

  try {
    // Extract components
    const selectFields = extractSelectFields(normalizedQuery);
    const fromClause = extractFromClause(normalizedQuery);
    const whereFilters = extractWhereClause(normalizedQuery);
    const groupByFields = extractGroupByClause(normalizedQuery);
    const orderByClause = extractOrderByClause(normalizedQuery);
    const limitValue = extractLimitClause(normalizedQuery);

    // Validate minimum requirements
    if (!fromClause.tableName) {
      return {
        ...emptyResult,
        parseError: 'Could not extract table name from FROM clause',
      };
    }

    // Map fields to axes based on context
    const mappedFields = mapFieldsToAxes(selectFields, groupByFields);

    return {
      stream: fromClause.tableName,
      streamType: fromClause.streamType || 'logs',
      xFields: mappedFields.x,
      yFields: mappedFields.y,
      zFields: mappedFields.z,
      breakdownFields: mappedFields.breakdown,
      filters: whereFilters,
      groupBy: groupByFields,
      orderBy: orderByClause,
      limit: limitValue,
      customQuery: false,
      rawQuery: query,
    };
  } catch (error) {
    return {
      ...emptyResult,
      parseError: error instanceof Error ? error.message : 'Unknown parsing error',
    };
  }
}

/**
 * Check if a query can be parsed by the visual builder
 */
export function isQueryParseable(query: string): boolean {
  const normalized = normalizeQuery(query);

  // Check against all unparseable patterns
  for (const pattern of UNPARSEABLE_PATTERNS) {
    if (pattern.test(normalized)) {
      return false;
    }
  }

  // Must have SELECT and FROM
  if (!/\bSELECT\b/i.test(normalized) || !/\bFROM\b/i.test(normalized)) {
    return false;
  }

  return true;
}

// ============================================================================
// Helper Functions
// ============================================================================

function normalizeQuery(query: string): string {
  return query
    .replace(/\s+/g, ' ')           // Collapse whitespace
    .replace(/\r?\n/g, ' ')         // Remove newlines
    .trim();
}

function extractSelectFields(query: string): ParsedField[] {
  // Match SELECT ... FROM (non-greedy)
  const selectMatch = query.match(/\bSELECT\s+(DISTINCT\s+)?(.*?)\s+FROM\b/is);
  if (!selectMatch) return [];

  const selectClause = selectMatch[2];
  const fields: ParsedField[] = [];

  // Handle SELECT *
  if (selectClause.trim() === '*') {
    return [{ name: '*', alias: '*' }];
  }

  // Split by comma (respecting parentheses)
  const tokens = splitByComma(selectClause);

  for (const token of tokens) {
    const field = parseSelectField(token.trim());
    if (field) fields.push(field);
  }

  return fields;
}

function parseSelectField(token: string): ParsedField | null {
  if (!token) return null;

  // Pattern: expression [AS] alias
  // Handle both quoted and unquoted aliases
  const aliasMatch = token.match(/^(.+?)\s+(?:AS\s+)?["'`]?(\w+)["'`]?\s*$/i);

  let expression = aliasMatch ? aliasMatch[1].trim() : token;
  let alias = aliasMatch ? aliasMatch[2] : undefined;

  // Check for aggregation function
  const aggMatch = expression.match(
    /^(COUNT|SUM|AVG|MIN|MAX|STDDEV|VARIANCE)\s*\(\s*(DISTINCT\s+)?(.+?)\s*\)$/i
  );

  if (aggMatch) {
    const columnName = aggMatch[3].trim();
    return {
      name: columnName,
      alias: alias || `${aggMatch[1].toLowerCase()}_${columnName}`,
      aggregationFunction: aggMatch[1].toLowerCase(),
      expression: expression,
    };
  }

  // Simple field or expression
  return {
    name: expression,
    alias: alias || expression,
    expression: expression,
  };
}

function extractFromClause(query: string): { tableName: string; streamType?: string } {
  // Match FROM table_name [AS alias]
  const fromMatch = query.match(/\bFROM\s+["'`]?(\w+)["'`]?(?:\s+(?:AS\s+)?["'`]?\w+["'`]?)?\s*/i);

  if (!fromMatch) {
    return { tableName: '' };
  }

  return {
    tableName: fromMatch[1],
    streamType: 'logs', // Default; could be enhanced to detect stream type
  };
}

function extractWhereClause(query: string): ParsedFilter[] {
  // Match WHERE ... (up to GROUP BY, ORDER BY, LIMIT, or end)
  const whereMatch = query.match(
    /\bWHERE\s+(.*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|$)/is
  );

  if (!whereMatch) return [];

  const whereClause = whereMatch[1].trim();
  return parseWhereConditions(whereClause);
}

function parseWhereConditions(clause: string): ParsedFilter[] {
  const filters: ParsedFilter[] = [];

  // Simple pattern: column operator value [AND|OR ...]
  // This is a simplified parser; complex conditions may need custom mode
  const conditionPattern = /(\w+)\s*(=|!=|<>|>=|<=|>|<|LIKE|NOT\s+LIKE|IN|NOT\s+IN|IS\s+NULL|IS\s+NOT\s+NULL)\s*('[^']*'|\d+|NULL|\([^)]+\))/gi;

  let match;
  let lastIndex = 0;
  let currentLogicalOp: 'AND' | 'OR' | undefined;

  while ((match = conditionPattern.exec(clause)) !== null) {
    // Check for logical operator before this condition
    const beforeCondition = clause.substring(lastIndex, match.index).trim().toUpperCase();
    if (beforeCondition.endsWith('AND')) {
      currentLogicalOp = 'AND';
    } else if (beforeCondition.endsWith('OR')) {
      currentLogicalOp = 'OR';
    }

    const column = match[1];
    const operator = match[2].toUpperCase().replace(/\s+/g, ' ');
    let value: string | number | boolean | null = match[3];

    // Parse value
    if (value === 'NULL') {
      value = null;
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1); // Remove quotes
    } else if (!isNaN(Number(value))) {
      value = Number(value);
    }

    filters.push({
      column,
      operator,
      value,
      logicalOperator: filters.length > 0 ? (currentLogicalOp || 'AND') : undefined,
      type: 'condition',
    });

    lastIndex = match.index + match[0].length;
  }

  return filters;
}

function extractGroupByClause(query: string): string[] {
  const groupByMatch = query.match(
    /\bGROUP\s+BY\s+(.*?)(?:\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|$)/is
  );

  if (!groupByMatch) return [];

  const groupByClause = groupByMatch[1].trim();
  return splitByComma(groupByClause).map(f => f.trim());
}

function extractOrderByClause(query: string): OrderByClause[] {
  const orderByMatch = query.match(/\bORDER\s+BY\s+(.*?)(?:\bLIMIT\b|$)/is);

  if (!orderByMatch) return [];

  const orderByClause = orderByMatch[1].trim();
  const clauses: OrderByClause[] = [];

  const parts = splitByComma(orderByClause);
  for (const part of parts) {
    const match = part.trim().match(/^(\w+)(?:\s+(ASC|DESC))?$/i);
    if (match) {
      clauses.push({
        column: match[1],
        direction: (match[2]?.toUpperCase() as 'ASC' | 'DESC') || 'ASC',
      });
    }
  }

  return clauses;
}

function extractLimitClause(query: string): number | null {
  const limitMatch = query.match(/\bLIMIT\s+(\d+)/i);
  return limitMatch ? parseInt(limitMatch[1], 10) : null;
}

function splitByComma(str: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of str) {
    if (char === '(' || char === '[') {
      depth++;
      current += char;
    } else if (char === ')' || char === ']') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current) {
    result.push(current);
  }

  return result;
}

// ============================================================================
// Field Mapping Logic
// ============================================================================

const TIME_FIELD_PATTERNS = [
  /^_timestamp$/i,
  /timestamp/i,
  /^time$/i,
  /datetime/i,
  /^created_at$/i,
  /^updated_at$/i,
  /^date$/i,
];

function isTimeField(fieldName: string): boolean {
  return TIME_FIELD_PATTERNS.some(pattern => pattern.test(fieldName));
}

interface MappedFields {
  x: ParsedField[];
  y: ParsedField[];
  z: ParsedField[];
  breakdown: ParsedField[];
}

function mapFieldsToAxes(
  fields: ParsedField[],
  groupBy: string[]
): MappedFields {
  const result: MappedFields = {
    x: [],
    y: [],
    z: [],
    breakdown: [],
  };

  // Handle SELECT *
  if (fields.length === 1 && fields[0].name === '*') {
    return result;
  }

  for (const field of fields) {
    if (field.aggregationFunction) {
      // Aggregated fields -> Y-axis
      result.y.push(field);
    } else if (isTimeField(field.name)) {
      // Time fields -> X-axis (first position)
      if (result.x.length === 0 || !isTimeField(result.x[0].name)) {
        result.x.unshift(field);
      } else {
        result.x.push(field);
      }
    } else if (groupBy.includes(field.name) || groupBy.includes(field.alias)) {
      // GROUP BY fields -> Breakdown
      result.breakdown.push(field);
    } else {
      // Other fields -> X-axis
      result.x.push(field);
    }
  }

  return result;
}

// ============================================================================
// Export for Testing
// ============================================================================

export const __testing__ = {
  normalizeQuery,
  extractSelectFields,
  extractFromClause,
  extractWhereClause,
  extractGroupByClause,
  parseSelectField,
  splitByComma,
  isTimeField,
  mapFieldsToAxes,
};
```

### 1.2 Create Parser Tests

**File**: `web/src/utils/query/sqlQueryParser.test.ts`

**Status**: NEW FILE (~500 lines)

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseSQL,
  isQueryParseable,
  ParsedQuery,
  __testing__,
} from './sqlQueryParser';

const {
  normalizeQuery,
  extractSelectFields,
  extractFromClause,
  extractWhereClause,
  extractGroupByClause,
  parseSelectField,
  splitByComma,
  isTimeField,
  mapFieldsToAxes,
} = __testing__;

describe('SQLQueryParser', () => {
  describe('isQueryParseable', () => {
    it('should return true for simple SELECT * FROM', () => {
      expect(isQueryParseable('SELECT * FROM logs')).toBe(true);
    });

    it('should return true for SELECT with specific fields', () => {
      expect(isQueryParseable('SELECT field1, field2 FROM logs')).toBe(true);
    });

    it('should return true for SELECT with aggregations', () => {
      expect(isQueryParseable('SELECT COUNT(*), AVG(value) FROM logs')).toBe(true);
    });

    it('should return true for SELECT with WHERE', () => {
      expect(isQueryParseable("SELECT * FROM logs WHERE status = 'error'")).toBe(true);
    });

    it('should return true for SELECT with GROUP BY', () => {
      expect(isQueryParseable('SELECT level, COUNT(*) FROM logs GROUP BY level')).toBe(true);
    });

    it('should return true for SELECT with simple JOIN', () => {
      expect(isQueryParseable('SELECT * FROM logs JOIN users ON logs.user_id = users.id')).toBe(true);
    });

    // Complex queries that should fail
    it('should return false for subqueries in SELECT', () => {
      expect(isQueryParseable('SELECT (SELECT MAX(id) FROM logs) FROM users')).toBe(false);
    });

    it('should return false for subqueries in FROM', () => {
      expect(isQueryParseable('SELECT * FROM (SELECT * FROM logs) AS subquery')).toBe(false);
    });

    it('should return false for subqueries in WHERE', () => {
      expect(isQueryParseable('SELECT * FROM logs WHERE id IN (SELECT id FROM errors)')).toBe(false);
    });

    it('should return false for CASE statements', () => {
      expect(isQueryParseable("SELECT CASE WHEN status = 1 THEN 'active' ELSE 'inactive' END FROM logs")).toBe(false);
    });

    it('should return false for UNION', () => {
      expect(isQueryParseable('SELECT * FROM logs UNION SELECT * FROM errors')).toBe(false);
    });

    it('should return false for window functions', () => {
      expect(isQueryParseable('SELECT ROW_NUMBER() OVER (ORDER BY id) FROM logs')).toBe(false);
    });

    it('should return false for PARTITION BY', () => {
      expect(isQueryParseable('SELECT *, SUM(value) OVER (PARTITION BY category) FROM logs')).toBe(false);
    });

    it('should return false for more than 2 JOINs', () => {
      expect(isQueryParseable('SELECT * FROM a JOIN b ON a.id = b.id JOIN c ON b.id = c.id JOIN d ON c.id = d.id')).toBe(false);
    });

    it('should return false for CTEs', () => {
      expect(isQueryParseable('WITH cte AS (SELECT * FROM logs) SELECT * FROM cte')).toBe(false);
    });
  });

  describe('parseSQL', () => {
    it('should parse simple SELECT * query', () => {
      const result = parseSQL('SELECT * FROM logs');

      expect(result.customQuery).toBe(false);
      expect(result.stream).toBe('logs');
      expect(result.xFields).toHaveLength(1);
      expect(result.xFields[0].name).toBe('*');
    });

    it('should parse SELECT with specific fields', () => {
      const result = parseSQL('SELECT timestamp, level, message FROM logs');

      expect(result.customQuery).toBe(false);
      expect(result.stream).toBe('logs');
      expect(result.xFields.length).toBeGreaterThan(0);
    });

    it('should parse SELECT with aggregations', () => {
      const result = parseSQL('SELECT level, COUNT(*) as count FROM logs GROUP BY level');

      expect(result.customQuery).toBe(false);
      expect(result.yFields.length).toBeGreaterThan(0);
      expect(result.yFields[0].aggregationFunction).toBe('count');
    });

    it('should parse SELECT with WHERE clause', () => {
      const result = parseSQL("SELECT * FROM logs WHERE level = 'error'");

      expect(result.customQuery).toBe(false);
      expect(result.filters.length).toBeGreaterThan(0);
      expect(result.filters[0].column).toBe('level');
      expect(result.filters[0].value).toBe('error');
    });

    it('should parse SELECT with aliases', () => {
      const result = parseSQL('SELECT timestamp AS ts, COUNT(*) AS total FROM logs');

      expect(result.customQuery).toBe(false);
    });

    it('should return customQuery=true for complex queries', () => {
      const result = parseSQL('SELECT * FROM (SELECT * FROM logs) AS subquery');

      expect(result.customQuery).toBe(true);
    });

    it('should handle empty query', () => {
      const result = parseSQL('');

      expect(result.customQuery).toBe(false);
      expect(result.stream).toBe('');
    });
  });

  describe('extractSelectFields', () => {
    it('should extract * field', () => {
      const fields = extractSelectFields('SELECT * FROM logs');
      expect(fields).toHaveLength(1);
      expect(fields[0].name).toBe('*');
    });

    it('should extract multiple fields', () => {
      const fields = extractSelectFields('SELECT a, b, c FROM logs');
      expect(fields).toHaveLength(3);
    });

    it('should extract aggregation functions', () => {
      const fields = extractSelectFields('SELECT COUNT(*), SUM(value) FROM logs');
      expect(fields).toHaveLength(2);
      expect(fields[0].aggregationFunction).toBe('count');
      expect(fields[1].aggregationFunction).toBe('sum');
    });

    it('should handle aliases', () => {
      const fields = extractSelectFields('SELECT field1 AS alias1, field2 alias2 FROM logs');
      expect(fields[0].alias).toBe('alias1');
      expect(fields[1].alias).toBe('alias2');
    });
  });

  describe('extractWhereClause', () => {
    it('should extract simple equality', () => {
      const filters = extractWhereClause("SELECT * FROM logs WHERE status = 'active'");
      expect(filters).toHaveLength(1);
      expect(filters[0].column).toBe('status');
      expect(filters[0].operator).toBe('=');
      expect(filters[0].value).toBe('active');
    });

    it('should extract multiple conditions', () => {
      const filters = extractWhereClause("SELECT * FROM logs WHERE a = 1 AND b = 2");
      expect(filters).toHaveLength(2);
      expect(filters[1].logicalOperator).toBe('AND');
    });

    it('should handle numeric values', () => {
      const filters = extractWhereClause('SELECT * FROM logs WHERE count > 100');
      expect(filters[0].value).toBe(100);
    });
  });

  describe('helper functions', () => {
    it('splitByComma should handle nested parentheses', () => {
      const result = splitByComma('a, func(b, c), d');
      expect(result).toEqual(['a', ' func(b, c)', ' d']);
    });

    it('isTimeField should detect time fields', () => {
      expect(isTimeField('_timestamp')).toBe(true);
      expect(isTimeField('timestamp')).toBe(true);
      expect(isTimeField('created_at')).toBe(true);
      expect(isTimeField('username')).toBe(false);
    });
  });
});
```

---

## Phase 2: Build Tab Components

### 2.1 Create BuildQueryTab.vue

**File**: `web/src/plugins/logs/BuildQueryTab.vue`

**Status**: NEW FILE (~500 lines)

```vue
<!-- Copyright 2023 OpenObserve Inc. -->

<template>
  <div class="build-query-tab">
    <!-- Header with mode toggle and actions -->
    <div class="build-query-header">
      <div class="row items-center">
        <!-- Query Mode Toggle (Auto/Custom) -->
        <div class="row button-group q-mr-md">
          <button
            data-test="logs-build-auto-mode"
            :class="['button button-left', !isCustomMode ? 'selected' : '']"
            @click="onSwitchToAutoMode"
            :disabled="!canSwitchToAuto"
          >
            {{ t("panel.builder") }}
          </button>
          <button
            data-test="logs-build-custom-mode"
            :class="['button button-right', isCustomMode ? 'selected' : '']"
            @click="onSwitchToCustomMode"
          >
            {{ t("panel.custom") }}
          </button>
        </div>

        <q-tooltip v-if="!canSwitchToAuto && isCustomMode">
          {{ t("search.complexQueryDetected") }}
        </q-tooltip>
      </div>

      <div class="row items-center q-gutter-sm">
        <q-btn
          data-test="logs-build-run-query"
          color="primary"
          :label="t('search.runQuery')"
          @click="onRunQuery"
          :loading="isRunning"
          no-caps
        />
      </div>
    </div>

    <!-- Main content area -->
    <q-splitter
      v-model="splitterModel"
      :limits="[0, 30]"
      class="build-query-splitter"
    >
      <!-- Field List Panel -->
      <template #before>
        <div class="build-field-list-container">
          <FieldList
            v-if="showFieldList"
            :isLoading="isFieldsLoading"
          />
          <div
            v-else
            class="field-list-collapsed"
            @click="toggleFieldList"
          >
            <q-icon name="expand_all" class="rotate-90" />
            <span class="vertical-text">{{ t("panel.fields") }}</span>
          </div>
        </div>
      </template>

      <!-- Separator -->
      <template #separator>
        <q-btn
          :icon="showFieldList ? 'chevron_left' : 'chevron_right'"
          color="primary"
          size="sm"
          dense
          round
          class="splitter-btn"
          @click="toggleFieldList"
        />
      </template>

      <!-- Query Builder / Editor -->
      <template #after>
        <div class="build-query-content">
          <!-- Query Builder (Auto Mode) -->
          <div v-if="!isCustomMode" class="query-builder-section">
            <DashboardQueryBuilder />
          </div>

          <!-- Generated/Custom Query Display -->
          <GeneratedQueryDisplay
            :query="currentQuery"
            :isCustomMode="isCustomMode"
            :isExpanded="queryDisplayExpanded"
            @update:query="onQueryUpdate"
            @toggle-expand="queryDisplayExpanded = !queryDisplayExpanded"
          />

          <!-- Optional: Chart Preview -->
          <div v-if="showChartPreview" class="chart-preview-section">
            <div class="preview-header">
              <span>{{ t("search.preview") }}</span>
              <q-btn flat icon="close" size="sm" @click="showChartPreview = false" />
            </div>
            <PanelSchemaRenderer
              :data="dashboardPanelData.data"
              :selectedTimeDate="selectedTimeDate"
              searchType="ui"
            />
          </div>
        </div>
      </template>
    </q-splitter>

    <!-- Confirm Dialog for mode switch -->
    <ConfirmDialog
      v-model="showConfirmDialog"
      :title="t('search.switchMode')"
      :message="confirmMessage"
      @update:ok="confirmModeSwitch"
      @update:cancel="showConfirmDialog = false"
    />
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  watch,
  inject,
  onMounted,
  PropType,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

// Composables
import useDashboardPanelData from "@/composables/useDashboardPanel";

// Components
import FieldList from "@/components/dashboards/addPanel/FieldList.vue";
import DashboardQueryBuilder from "@/components/dashboards/addPanel/DashboardQueryBuilder.vue";
import PanelSchemaRenderer from "@/components/dashboards/PanelSchemaRenderer.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import GeneratedQueryDisplay from "./GeneratedQueryDisplay.vue";

// Utils
import { parseSQL, isQueryParseable } from "@/utils/query/sqlQueryParser";

export default defineComponent({
  name: "BuildQueryTab",

  components: {
    FieldList,
    DashboardQueryBuilder,
    PanelSchemaRenderer,
    ConfirmDialog,
    GeneratedQueryDisplay,
  },

  props: {
    searchQuery: {
      type: String,
      default: "",
    },
    selectedStream: {
      type: Array as PropType<string[]>,
      default: () => [],
    },
    streamType: {
      type: String,
      default: "logs",
    },
    selectedTimeDate: {
      type: Object,
      default: () => ({}),
    },
  },

  emits: ["update:query", "run-query"],

  setup(props, { emit, expose }) {
    const { t } = useI18n();
    const store = useStore();

    // Dashboard panel data composable
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "logs"
    );
    const {
      dashboardPanelData,
      makeAutoSQLQuery,
      resetDashboardPanelData,
    } = useDashboardPanelData(dashboardPanelDataPageKey);

    // Local state
    const splitterModel = ref(20);
    const showFieldList = ref(true);
    const queryDisplayExpanded = ref(true);
    const showChartPreview = ref(false);
    const isRunning = ref(false);
    const isFieldsLoading = ref(false);

    // Mode switching
    const showConfirmDialog = ref(false);
    const confirmMessage = ref("");
    const pendingModeSwitch = ref<"auto" | "custom" | null>(null);
    const canSwitchToAuto = ref(true);

    // Computed
    const isCustomMode = computed(() =>
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ]?.customQuery ?? false
    );

    const currentQuery = computed(() =>
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ]?.query ?? ""
    );

    // Initialize from external query
    async function initializeFromQuery(query: string) {
      if (!query || query.trim() === "") {
        // No query - start in auto mode
        dashboardPanelData.data.queries[0].customQuery = false;
        dashboardPanelData.data.queries[0].query = "";
        canSwitchToAuto.value = true;
        return;
      }

      // Try to parse the query
      const parsed = parseSQL(query);

      if (parsed && !parsed.customQuery) {
        // Successfully parsed - use auto mode
        applyParsedQuery(parsed);
        dashboardPanelData.data.queries[0].customQuery = false;
        canSwitchToAuto.value = true;
      } else {
        // Complex query - use custom mode
        dashboardPanelData.data.queries[0].query = query;
        dashboardPanelData.data.queries[0].customQuery = true;
        canSwitchToAuto.value = false;
      }
    }

    function applyParsedQuery(parsed: any) {
      const queryIndex = dashboardPanelData.layout.currentQueryIndex;

      // Set stream
      if (parsed.stream) {
        dashboardPanelData.data.queries[queryIndex].fields.stream = parsed.stream;
        dashboardPanelData.data.queries[queryIndex].fields.stream_type = parsed.streamType || "logs";
      }

      // Set fields
      dashboardPanelData.data.queries[queryIndex].fields.x = parsed.xFields.map((f: any) => ({
        label: f.alias || f.name,
        alias: f.alias || f.name,
        column: f.name,
        isDerived: false,
      }));

      dashboardPanelData.data.queries[queryIndex].fields.y = parsed.yFields.map((f: any) => ({
        label: f.alias || f.name,
        alias: f.alias || f.name,
        column: f.name,
        aggregationFunction: f.aggregationFunction || "count",
        isDerived: false,
      }));

      dashboardPanelData.data.queries[queryIndex].fields.breakdown = parsed.breakdownFields.map((f: any) => ({
        label: f.alias || f.name,
        alias: f.alias || f.name,
        column: f.name,
        isDerived: false,
      }));

      // Set filters
      if (parsed.filters && parsed.filters.length > 0) {
        dashboardPanelData.data.queries[queryIndex].fields.filter = {
          filterType: "group",
          logicalOperator: "AND",
          conditions: parsed.filters.map((f: any) => ({
            filterType: "condition",
            column: f.column,
            operator: f.operator,
            value: f.value,
          })),
        };
      }
    }

    // Mode switching
    function onSwitchToAutoMode() {
      if (isCustomMode.value) {
        const currentQueryStr = currentQuery.value;

        // Check if current query can be parsed
        if (currentQueryStr && !isQueryParseable(currentQueryStr)) {
          canSwitchToAuto.value = false;
          // Show notification
          store.dispatch("showNotification", {
            type: "warning",
            message: t("search.complexQueryDetected"),
          });
          return;
        }

        pendingModeSwitch.value = "auto";
        confirmMessage.value = t("search.switchToAutoConfirm");
        showConfirmDialog.value = true;
      }
    }

    function onSwitchToCustomMode() {
      if (!isCustomMode.value) {
        pendingModeSwitch.value = "custom";
        confirmMessage.value = t("search.switchToCustomConfirm");
        showConfirmDialog.value = true;
      }
    }

    async function confirmModeSwitch() {
      showConfirmDialog.value = false;

      if (pendingModeSwitch.value === "auto") {
        // Try to parse current query
        const parsed = parseSQL(currentQuery.value);

        if (parsed && !parsed.customQuery) {
          applyParsedQuery(parsed);
          dashboardPanelData.data.queries[0].customQuery = false;
          canSwitchToAuto.value = true;
        } else {
          canSwitchToAuto.value = false;
          store.dispatch("showNotification", {
            type: "warning",
            message: t("search.complexQueryDetected"),
          });
        }
      } else if (pendingModeSwitch.value === "custom") {
        // Generate query first if needed
        if (!currentQuery.value) {
          await makeAutoSQLQuery();
        }
        dashboardPanelData.data.queries[0].customQuery = true;
      }

      pendingModeSwitch.value = null;
    }

    // Query updates
    function onQueryUpdate(newQuery: string) {
      dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ].query = newQuery;

      // Emit to parent
      emit("update:query", newQuery);
    }

    // Run query
    function onRunQuery() {
      emit("run-query");
    }

    // Field list toggle
    function toggleFieldList() {
      showFieldList.value = !showFieldList.value;
      splitterModel.value = showFieldList.value ? 20 : 0;
    }

    // Watch for auto query generation in builder mode
    watch(
      () => [
        dashboardPanelData.data.queries[0].fields,
        isCustomMode.value,
      ],
      async () => {
        if (!isCustomMode.value) {
          await makeAutoSQLQuery();
          emit("update:query", currentQuery.value);
        }
      },
      { deep: true }
    );

    // Expose methods for parent
    expose({
      initializeFromQuery,
    });

    return {
      t,
      dashboardPanelData,
      splitterModel,
      showFieldList,
      queryDisplayExpanded,
      showChartPreview,
      isRunning,
      isFieldsLoading,
      isCustomMode,
      currentQuery,
      showConfirmDialog,
      confirmMessage,
      canSwitchToAuto,

      initializeFromQuery,
      onSwitchToAutoMode,
      onSwitchToCustomMode,
      confirmModeSwitch,
      onQueryUpdate,
      onRunQuery,
      toggleFieldList,
    };
  },
});
</script>

<style lang="scss" scoped>
.build-query-tab {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.build-query-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--q-separator);
  flex-shrink: 0;
}

.button-group {
  border: 1px solid gray;
  border-radius: 9px;
}

.button {
  cursor: pointer;
  background-color: transparent;
  border: none;
  font-size: 14px;
  padding: 4px 12px;

  &.selected {
    background-color: var(--q-primary);
    color: white;
    font-weight: bold;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.button-left {
  border-top-left-radius: 8px;
  border-bottom-left-radius: 8px;
}

.button-right {
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
}

.build-query-splitter {
  flex: 1;
  min-height: 0;
}

.build-field-list-container {
  height: 100%;
  padding: 0.5rem;
}

.field-list-collapsed {
  width: 50px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 1rem;
  cursor: pointer;

  .vertical-text {
    writing-mode: vertical-rl;
    text-orientation: mixed;
    font-weight: bold;
  }
}

.build-query-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  gap: 1rem;
  overflow-y: auto;
}

.query-builder-section {
  flex-shrink: 0;
}

.chart-preview-section {
  flex: 1;
  min-height: 200px;
  border: 1px solid var(--q-separator);
  border-radius: 4px;

  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem;
    border-bottom: 1px solid var(--q-separator);
  }
}

.splitter-btn {
  position: absolute;
  left: -12px;
  top: 14px;
  z-index: 100;
}
</style>
```

### 2.2 Create GeneratedQueryDisplay.vue

**File**: `web/src/plugins/logs/GeneratedQueryDisplay.vue`

**Status**: NEW FILE (~250 lines)

```vue
<!-- Copyright 2023 OpenObserve Inc. -->

<template>
  <div class="generated-query-display" :class="{ expanded: isExpanded }">
    <div class="query-header" @click="$emit('toggle-expand')">
      <span class="query-title">
        <q-icon :name="isExpanded ? 'expand_less' : 'expand_more'" />
        {{ isCustomMode ? t("search.customSql") : t("search.generatedSql") }}
      </span>
      <div class="query-actions" @click.stop>
        <q-btn
          flat
          dense
          icon="content_copy"
          size="sm"
          @click="copyQuery"
        >
          <q-tooltip>{{ t("common.copy") }}</q-tooltip>
        </q-btn>
        <q-btn
          v-if="isCustomMode"
          flat
          dense
          icon="format_align_left"
          size="sm"
          @click="formatQuery"
        >
          <q-tooltip>{{ t("search.formatQuery") }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <div v-show="isExpanded" class="query-content">
      <!-- Read-only mode (auto) -->
      <div v-if="!isCustomMode" class="sql-readonly">
        <pre class="sql-highlight" v-html="highlightedQuery"></pre>
      </div>

      <!-- Editable mode (custom) -->
      <div v-else class="sql-editor">
        <textarea
          ref="textareaRef"
          :value="query"
          @input="onInput"
          class="sql-textarea"
          placeholder="Enter your SQL query..."
          spellcheck="false"
        ></textarea>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { copyToClipboard, useQuasar } from "quasar";

export default defineComponent({
  name: "GeneratedQueryDisplay",

  props: {
    query: {
      type: String,
      default: "",
    },
    isCustomMode: {
      type: Boolean,
      default: false,
    },
    isExpanded: {
      type: Boolean,
      default: true,
    },
  },

  emits: ["update:query", "toggle-expand"],

  setup(props, { emit }) {
    const { t } = useI18n();
    const $q = useQuasar();
    const textareaRef = ref<HTMLTextAreaElement | null>(null);

    // SQL syntax highlighting (simple version)
    const highlightedQuery = computed(() => {
      if (!props.query) return "";

      // Escape HTML first
      let html = escapeHtml(props.query);

      // Highlight keywords
      const keywords = [
        "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE",
        "IS", "NULL", "AS", "ON", "JOIN", "LEFT", "RIGHT", "INNER",
        "OUTER", "GROUP", "BY", "ORDER", "ASC", "DESC", "LIMIT",
        "OFFSET", "HAVING", "DISTINCT", "COUNT", "SUM", "AVG",
        "MIN", "MAX", "BETWEEN", "CASE", "WHEN", "THEN", "ELSE", "END",
      ];

      const keywordPattern = new RegExp(
        `\\b(${keywords.join("|")})\\b`,
        "gi"
      );
      html = html.replace(
        keywordPattern,
        '<span class="sql-keyword">$1</span>'
      );

      // Highlight strings
      html = html.replace(
        /'([^']*)'/g,
        '<span class="sql-string">\'$1\'</span>'
      );

      // Highlight numbers
      html = html.replace(
        /\b(\d+)\b/g,
        '<span class="sql-number">$1</span>'
      );

      // Highlight comments
      html = html.replace(
        /--(.*?)(?:\n|$)/g,
        '<span class="sql-comment">--$1</span>'
      );

      return html;
    });

    function escapeHtml(str: string): string {
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function onInput(event: Event) {
      const target = event.target as HTMLTextAreaElement;
      emit("update:query", target.value);
    }

    function copyQuery() {
      copyToClipboard(props.query);
      $q.notify({
        type: "positive",
        message: t("common.copied"),
        position: "top",
        timeout: 1500,
      });
    }

    function formatQuery() {
      // Simple formatting: add newlines after keywords
      let formatted = props.query
        .replace(/\s+/g, " ")
        .replace(/\bSELECT\b/gi, "\nSELECT")
        .replace(/\bFROM\b/gi, "\nFROM")
        .replace(/\bWHERE\b/gi, "\nWHERE")
        .replace(/\bAND\b/gi, "\n  AND")
        .replace(/\bOR\b/gi, "\n  OR")
        .replace(/\bGROUP BY\b/gi, "\nGROUP BY")
        .replace(/\bORDER BY\b/gi, "\nORDER BY")
        .replace(/\bLIMIT\b/gi, "\nLIMIT")
        .replace(/\bJOIN\b/gi, "\nJOIN")
        .trim();

      emit("update:query", formatted);
    }

    // Auto-resize textarea
    watch(
      () => props.query,
      () => {
        if (textareaRef.value) {
          textareaRef.value.style.height = "auto";
          textareaRef.value.style.height = `${textareaRef.value.scrollHeight}px`;
        }
      }
    );

    return {
      t,
      textareaRef,
      highlightedQuery,
      onInput,
      copyQuery,
      formatQuery,
    };
  },
});
</script>

<style lang="scss" scoped>
.generated-query-display {
  border: 1px solid var(--q-separator);
  border-radius: 4px;
  background: var(--q-bg-secondary);
  flex-shrink: 0;

  &.expanded {
    min-height: 100px;
  }
}

.query-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 1rem;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  .query-title {
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
}

.query-content {
  border-top: 1px solid var(--q-separator);
}

.sql-readonly {
  padding: 1rem;
  overflow-x: auto;
}

.sql-highlight {
  margin: 0;
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;

  :deep(.sql-keyword) {
    color: #0077aa;
    font-weight: bold;
  }

  :deep(.sql-string) {
    color: #669900;
  }

  :deep(.sql-number) {
    color: #aa5500;
  }

  :deep(.sql-comment) {
    color: #999999;
    font-style: italic;
  }
}

.sql-editor {
  padding: 0;
}

.sql-textarea {
  width: 100%;
  min-height: 100px;
  padding: 1rem;
  border: none;
  resize: vertical;
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 13px;
  line-height: 1.5;
  background: transparent;
  color: inherit;

  &:focus {
    outline: none;
  }
}
</style>
```

---

## Phase 3: Integration

### 3.1 Modify SearchBar.vue

**File**: `web/src/plugins/logs/SearchBar.vue`

**Changes**: Add "Build" toggle button

**Location**: After line 68 (after visualize button)

```vue
<!-- ADD after existing visualize button (around line 67) -->
<div>
  <q-btn
    data-test="logs-build-toggle"
    :class="[
      searchObj.meta.logsVisualizeToggle === 'build' ? 'selected' : '',
      'button tw:flex tw:justify-center tw:items-center no-border no-outline q-px-sm btn-height-32'
    ]"
    @click="onLogsVisualizeToggleUpdate('build')"
    :disable="isBuildDisabled"
    no-caps
    size="sm"
    icon="construction"
  >
    <q-tooltip v-if="isBuildDisabled">
      {{ t("search.enableSqlModeForBuild") }}
    </q-tooltip>
    <q-tooltip v-else>
      {{ t("search.buildQuery") }}
    </q-tooltip>
  </q-btn>
</div>
```

**Script changes** (add computed property around line 900):

```typescript
// Add this computed property
const isBuildDisabled = computed(() => {
  return !searchObj.meta.sqlMode ||
         searchObj.data.stream.selectedStream.length > 1;
});

// Add to return statement
return {
  // ... existing
  isBuildDisabled,
};
```

**Lines changed**: ~25 lines

### 3.2 Modify Index.vue

**File**: `web/src/plugins/logs/Index.vue`

**Changes**:
1. Import BuildQueryTab component
2. Add build container in template
3. Handle build tab state

**Template changes** (after visualize-container, around line 320):

```vue
<!-- ADD after visualize-container -->
<div
  v-show="searchObj.meta.logsVisualizeToggle == 'build'"
  class="build-container"
  :style="{ '--splitter-height': `${splitterModel}vh` }"
>
  <BuildQueryTab
    ref="buildQueryTabRef"
    :searchQuery="searchObj.data.query"
    :selectedStream="searchObj.data.stream.selectedStream"
    :streamType="searchObj.data.stream.streamType"
    :selectedTimeDate="searchObj.data.datetime"
    @update:query="onBuildQueryUpdate"
    @run-query="handleRunQueryFromBuild"
  />
</div>
```

**Script changes**:

```typescript
// Add import (around line 650)
import BuildQueryTab from "./BuildQueryTab.vue";

// Add ref (around line 700)
const buildQueryTabRef = ref<InstanceType<typeof BuildQueryTab> | null>(null);

// Add methods (around line 1900)
const onBuildQueryUpdate = (query: string) => {
  searchObj.data.query = query;
};

const handleRunQueryFromBuild = () => {
  searchObj.meta.logsVisualizeToggle = 'logs';
  nextTick(() => {
    handleRunQueryFn();
  });
};

// Add watch for build tab initialization (around line 1950)
watch(
  () => searchObj.meta.logsVisualizeToggle,
  async (newVal, oldVal) => {
    if (newVal === 'build' && oldVal !== 'build') {
      await nextTick();
      buildQueryTabRef.value?.initializeFromQuery(searchObj.data.query);
    }
  }
);

// Add to return statement
return {
  // ... existing
  buildQueryTabRef,
  onBuildQueryUpdate,
  handleRunQueryFromBuild,
};
```

**Lines changed**: ~70 lines

### 3.3 Add Translations

**File**: `web/src/locales/en.json`

**Changes**: Add new translation keys

```json
{
  "search": {
    "buildQuery": "Build",
    "enableSqlModeForBuild": "Enable SQL mode to use query builder",
    "generatedSql": "Generated SQL",
    "customSql": "Custom SQL",
    "parseError": "Could not parse query. Switched to custom mode.",
    "queryParsed": "Query parsed successfully. Using builder mode.",
    "switchToAuto": "Switch to Builder",
    "switchToCustom": "Switch to Custom",
    "switchToAutoConfirm": "Switch to builder mode? The current query will be parsed into visual fields.",
    "switchToCustomConfirm": "Switch to custom mode? You can edit the SQL directly.",
    "complexQueryDetected": "Complex query detected. Cannot switch to builder mode.",
    "switchMode": "Switch Query Mode",
    "formatQuery": "Format Query",
    "preview": "Preview"
  }
}
```

**Lines changed**: ~15 lines (repeat for other language files)

### 3.4 Add Styles

**File**: `web/src/styles/logs/logs-page.scss`

**Changes**: Add build container styles

```scss
// Add at end of file

.build-container {
  height: calc(100vh - var(--splitter-height));
  width: 100%;
  padding: 0.625rem;

  .build-query-tab {
    height: 100%;
    background: var(--q-bg-secondary);
    border-radius: 4px;
  }
}
```

**Lines changed**: ~15 lines

---

## Summary of All File Changes

| File | Status | Lines Changed | Description |
|------|--------|---------------|-------------|
| `web/src/utils/query/sqlQueryParser.ts` | NEW | ~800 | SQL query parser |
| `web/src/utils/query/sqlQueryParser.test.ts` | NEW | ~500 | Parser unit tests |
| `web/src/plugins/logs/BuildQueryTab.vue` | NEW | ~500 | Main build tab component |
| `web/src/plugins/logs/GeneratedQueryDisplay.vue` | NEW | ~250 | SQL display component |
| `web/src/plugins/logs/SearchBar.vue` | MODIFIED | ~25 | Add build toggle button |
| `web/src/plugins/logs/Index.vue` | MODIFIED | ~70 | Integrate build tab |
| `web/src/locales/en.json` | MODIFIED | ~15 | Add translations |
| `web/src/locales/[other].json` | MODIFIED | ~15 each | Add translations (10 files) |
| `web/src/styles/logs/logs-page.scss` | MODIFIED | ~15 | Add build container styles |

**Total New Lines**: ~2,050
**Total Modified Lines**: ~260
**Total Files**: 14

---

## Testing Checklist

### Unit Tests
- [ ] SQLQueryParser.isQueryParseable - all patterns
- [ ] SQLQueryParser.parseSQL - various query types
- [ ] SQLQueryParser.extractSelectFields
- [ ] SQLQueryParser.extractWhereClause
- [ ] SQLQueryParser.mapFieldsToAxes

### Component Tests
- [ ] BuildQueryTab - initial render
- [ ] BuildQueryTab - mode switching
- [ ] BuildQueryTab - query sync
- [ ] GeneratedQueryDisplay - syntax highlighting
- [ ] GeneratedQueryDisplay - copy functionality

### E2E Tests
- [ ] Navigate to logs, click Build toggle
- [ ] Enter simple query, verify builder populated
- [ ] Modify builder, verify query updates
- [ ] Switch to custom mode, edit query
- [ ] Try switch back to auto for complex query (should fail)
- [ ] Run query from build tab
