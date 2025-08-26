// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { ref, computed, reactive } from "vue";
import { useLogsState } from "@/composables/useLogsState";
import { useLocalLogFilterField } from "@/utils/zincutils";
import {
  validateMultiStreamFilter,
  type MultiStreamFilterParams
} from "@/utils/logs/validators";
import {
  createFilterExpression,
  formatFilterValue,
  parseFilterCondition,
  type FilterExpressionParams
} from "@/utils/logs/formatters";

interface FilterCondition {
  field: string;
  operator: string;
  value: any;
  type: 'include' | 'exclude';
}

interface FilterGroup {
  conditions: FilterCondition[];
  operator: 'AND' | 'OR';
}

interface FieldFilter {
  field: string;
  values: Set<any>;
  type: 'include' | 'exclude';
}

/**
 * Filtering logic composable for logs functionality
 * Contains all filtering operations including field filters, query filters, and validation
 */
export const useLogsFilters = () => {
  const { searchObj } = useLogsState();

  // Active filters state
  const activeFilters = reactive<{ [field: string]: FieldFilter }>({});
  const filterGroups = ref<FilterGroup[]>([]);
  const quickFilters = ref<{ [key: string]: any }>({});

  // Computed properties
  const hasActiveFilters = computed(() => 
    Object.keys(activeFilters).length > 0 || 
    searchObj.data.stream.filterField?.length > 0
  );

  const activeFilterCount = computed(() => {
    const fieldFilters = Object.keys(activeFilters).length;
    const queryFilters = searchObj.data.stream.filterField ? 1 : 0;
    return fieldFilters + queryFilters;
  });

  const isMultiStreamFilterValid = computed(() => {
    if (searchObj.data.stream.selectedStream.length <= 1) {
      return true;
    }
    return validateFilterForMultiStream();
  });

  /**
   * Update local log filter field from stored preferences
   */
  const updateLocalLogFilterField = (): void => {
    try {
      const identifier: string = searchObj.organizationIdentifier || "default";
      const selectedFields: any = useLocalLogFilterField()?.value != null
        ? useLocalLogFilterField()?.value
        : {};

      const streamName = searchObj.data.stream.selectedStream.length > 0
        ? searchObj.data.stream.selectedStream[0].name ||
          searchObj.data.stream.selectedStream[0].value
        : "";

      const key = `${identifier}_${streamName}_${searchObj.data.stream.streamType}`;
      
      if (selectedFields[key]) {
        searchObj.data.stream.selectedFields = selectedFields[key];
      }
    } catch (error: any) {
      console.error("Error updating local log filter field:", error);
    }
  };

  /**
   * Validate filter conditions for multi-stream queries
   */
  const validateFilterForMultiStream = () => {
    try {
      const params: MultiStreamFilterParams = {
        filterCondition: searchObj.data.query,
        selectedStreamFields: searchObj.data.stream.selectedStreamFields,
        selectedStream: searchObj.data.stream.selectedStream,
        sqlMode: searchObj.meta.sqlMode
      };

      return validateMultiStreamFilter(params);
    } catch (error: any) {
      console.error("Error validating multi-stream filter:", error);
      return false;
    }
  };

  /**
   * Create filter expression for field and value
   */
  const getFilterExpressionByFieldType = (
    field: string | number,
    fieldValue: string | number | boolean,
    action: string,
  ) => {
    try {
      const params: FilterExpressionParams = {
        field: String(field),
        value: fieldValue,
        operator: action,
        dataType: typeof fieldValue
      };

      return createFilterExpression(params);
    } catch (error: any) {
      console.error("Error creating filter expression:", error);
      return "";
    }
  };

  /**
   * Add field filter
   */
  const addFieldFilter = (field: string, value: any, type: 'include' | 'exclude' = 'include') => {
    try {
      if (!activeFilters[field]) {
        activeFilters[field] = {
          field,
          values: new Set(),
          type
        };
      }

      activeFilters[field].values.add(value);
      updateQueryWithFilters();
    } catch (error: any) {
      console.error("Error adding field filter:", error);
    }
  };

  /**
   * Remove field filter
   */
  const removeFieldFilter = (field: string, value?: any) => {
    try {
      if (!activeFilters[field]) return;

      if (value !== undefined) {
        activeFilters[field].values.delete(value);
        
        // Remove the filter if no values left
        if (activeFilters[field].values.size === 0) {
          delete activeFilters[field];
        }
      } else {
        // Remove entire field filter
        delete activeFilters[field];
      }

      updateQueryWithFilters();
    } catch (error: any) {
      console.error("Error removing field filter:", error);
    }
  };

  /**
   * Clear all field filters
   */
  const clearAllFilters = () => {
    try {
      Object.keys(activeFilters).forEach(key => {
        delete activeFilters[key];
      });
      
      searchObj.data.stream.filterField = "";
      filterGroups.value = [];
      quickFilters.value = {};
      
      updateQueryWithFilters();
    } catch (error: any) {
      console.error("Error clearing all filters:", error);
    }
  };

  /**
   * Toggle field filter (add if not exists, remove if exists)
   */
  const toggleFieldFilter = (field: string, value: any, type: 'include' | 'exclude' = 'include') => {
    try {
      if (activeFilters[field]?.values.has(value)) {
        removeFieldFilter(field, value);
      } else {
        addFieldFilter(field, value, type);
      }
    } catch (error: any) {
      console.error("Error toggling field filter:", error);
    }
  };

  /**
   * Check if field value is filtered
   */
  const isFieldValueFiltered = (field: string, value: any) => {
    return activeFilters[field]?.values.has(value) || false;
  };

  /**
   * Get filter summary for display
   */
  const getFilterSummary = () => {
    try {
      const summary: { [field: string]: { included: any[], excluded: any[] } } = {};
      
      Object.entries(activeFilters).forEach(([field, filter]) => {
        summary[field] = {
          included: filter.type === 'include' ? Array.from(filter.values) : [],
          excluded: filter.type === 'exclude' ? Array.from(filter.values) : []
        };
      });

      return summary;
    } catch (error: any) {
      console.error("Error getting filter summary:", error);
      return {};
    }
  };

  /**
   * Create filter condition object
   */
  const createFilterCondition = (
    field: string, 
    operator: string, 
    value: any, 
    type: 'include' | 'exclude' = 'include'
  ): FilterCondition => {
    return {
      field,
      operator,
      value,
      type
    };
  };

  /**
   * Add filter group with multiple conditions
   */
  const addFilterGroup = (conditions: FilterCondition[], operator: 'AND' | 'OR' = 'AND') => {
    try {
      const group: FilterGroup = {
        conditions,
        operator
      };
      
      filterGroups.value.push(group);
      updateQueryWithFilters();
    } catch (error: any) {
      console.error("Error adding filter group:", error);
    }
  };

  /**
   * Remove filter group by index
   */
  const removeFilterGroup = (index: number) => {
    try {
      if (index >= 0 && index < filterGroups.value.length) {
        filterGroups.value.splice(index, 1);
        updateQueryWithFilters();
      }
    } catch (error: any) {
      console.error("Error removing filter group:", error);
    }
  };

  /**
   * Parse existing query to extract filters
   */
  const parseExistingFilters = (query: string) => {
    try {
      const conditions = parseFilterCondition(query);
      
      // Clear existing filters
      clearAllFilters();
      
      // Add parsed conditions
      conditions.forEach(condition => {
        addFieldFilter(condition.field, condition.value, condition.type);
      });
    } catch (error: any) {
      console.error("Error parsing existing filters:", error);
    }
  };

  /**
   * Apply quick filter (predefined common filters)
   */
  const applyQuickFilter = (filterName: string, config: any) => {
    try {
      quickFilters.value[filterName] = config;
      
      // Apply the quick filter logic based on config
      if (config.field && config.value) {
        addFieldFilter(config.field, config.value, config.type || 'include');
      } else if (config.conditions) {
        addFilterGroup(config.conditions, config.operator || 'AND');
      }
    } catch (error: any) {
      console.error("Error applying quick filter:", error);
    }
  };

  /**
   * Remove quick filter
   */
  const removeQuickFilter = (filterName: string) => {
    try {
      const config = quickFilters.value[filterName];
      if (!config) return;

      // Remove the corresponding field filters or groups
      if (config.field) {
        removeFieldFilter(config.field);
      }
      
      delete quickFilters.value[filterName];
    } catch (error: any) {
      console.error("Error removing quick filter:", error);
    }
  };

  /**
   * Update query string based on active filters
   */
  const updateQueryWithFilters = () => {
    try {
      if (Object.keys(activeFilters).length === 0 && filterGroups.value.length === 0) {
        return;
      }

      // Build filter expressions
      const expressions: string[] = [];
      
      // Add field filters
      Object.entries(activeFilters).forEach(([field, filter]) => {
        const values = Array.from(filter.values);
        if (values.length > 0) {
          const expr = buildFieldFilterExpression(field, values, filter.type);
          if (expr) expressions.push(expr);
        }
      });

      // Add filter groups
      filterGroups.value.forEach(group => {
        const expr = buildGroupFilterExpression(group);
        if (expr) expressions.push(`(${expr})`);
      });

      // Combine expressions
      if (expressions.length > 0) {
        const filterExpression = expressions.join(' AND ');
        
        // Add to existing filter field
        const currentFilter = searchObj.data.stream.filterField;
        if (currentFilter && currentFilter.trim()) {
          searchObj.data.stream.filterField = `(${currentFilter}) AND (${filterExpression})`;
        } else {
          searchObj.data.stream.filterField = filterExpression;
        }
      }
    } catch (error: any) {
      console.error("Error updating query with filters:", error);
    }
  };

  /**
   * Build filter expression for a field
   */
  const buildFieldFilterExpression = (field: string, values: any[], type: 'include' | 'exclude') => {
    try {
      if (values.length === 0) return "";

      const operator = type === 'include' ? 'IN' : 'NOT IN';
      const formattedValues = values.map(v => formatFilterValue(v)).join(', ');
      
      return `${field} ${operator} (${formattedValues})`;
    } catch (error: any) {
      console.error("Error building field filter expression:", error);
      return "";
    }
  };

  /**
   * Build filter expression for a group
   */
  const buildGroupFilterExpression = (group: FilterGroup) => {
    try {
      const expressions = group.conditions.map(condition => {
        const formattedValue = formatFilterValue(condition.value);
        const operator = condition.type === 'exclude' ? '!=' : condition.operator;
        
        return `${condition.field} ${operator} ${formattedValue}`;
      });

      return expressions.join(` ${group.operator} `);
    } catch (error: any) {
      console.error("Error building group filter expression:", error);
      return "";
    }
  };

  /**
   * Export filters to configuration object
   */
  const exportFilters = () => {
    try {
      return {
        fieldFilters: Object.fromEntries(
          Object.entries(activeFilters).map(([field, filter]) => [
            field,
            {
              values: Array.from(filter.values),
              type: filter.type
            }
          ])
        ),
        filterGroups: filterGroups.value,
        quickFilters: quickFilters.value,
        filterField: searchObj.data.stream.filterField
      };
    } catch (error: any) {
      console.error("Error exporting filters:", error);
      return {};
    }
  };

  /**
   * Import filters from configuration object
   */
  const importFilters = (config: any) => {
    try {
      // Clear existing filters
      clearAllFilters();

      // Import field filters
      if (config.fieldFilters) {
        Object.entries(config.fieldFilters).forEach(([field, filterConfig]: [string, any]) => {
          filterConfig.values.forEach((value: any) => {
            addFieldFilter(field, value, filterConfig.type);
          });
        });
      }

      // Import filter groups
      if (config.filterGroups) {
        filterGroups.value = config.filterGroups;
      }

      // Import quick filters
      if (config.quickFilters) {
        quickFilters.value = config.quickFilters;
      }

      // Import filter field
      if (config.filterField) {
        searchObj.data.stream.filterField = config.filterField;
      }

      updateQueryWithFilters();
    } catch (error: any) {
      console.error("Error importing filters:", error);
    }
  };

  return {
    // State
    activeFilters,
    filterGroups,
    quickFilters,
    
    // Computed properties
    hasActiveFilters,
    activeFilterCount,
    isMultiStreamFilterValid,
    
    // Filter management
    updateLocalLogFilterField,
    validateFilterForMultiStream,
    getFilterExpressionByFieldType,
    
    // Field filters
    addFieldFilter,
    removeFieldFilter,
    toggleFieldFilter,
    isFieldValueFiltered,
    clearAllFilters,
    
    // Filter groups
    createFilterCondition,
    addFilterGroup,
    removeFilterGroup,
    
    // Quick filters
    applyQuickFilter,
    removeQuickFilter,
    
    // Query integration
    parseExistingFilters,
    updateQueryWithFilters,
    
    // Utility functions
    getFilterSummary,
    exportFilters,
    importFilters,
    buildFieldFilterExpression,
    buildGroupFilterExpression,
  };
};

export default useLogsFilters;