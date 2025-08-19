/**
 * useLogsGridManagement.ts
 * 
 * Manages grid layout, column configuration, and data presentation for the logs module.
 * Handles column ordering, field visibility, data formatting, and grid state management.
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useStore } from 'vuex';
import {
  useLocalWrapContent,
  useLocalLogFilterField,
} from '@/utils/zincutils';
import type { 
  UseLogsGridManagement,
  SearchObject
} from './INTERFACES_AND_TYPES';

/**
 * Grid Management Composable
 * 
 * Provides comprehensive grid management functionality including:
 * - Column configuration and ordering
 * - Field visibility management
 * - Data formatting and presentation
 * - Sort state management
 * - Grid layout preferences
 * - Export and selection handling
 */
export default function useLogsGridManagement(
  searchObj: Ref<SearchObject>
): UseLogsGridManagement {
  const store = useStore();

  // ========================================
  // REACTIVE STATE
  // ========================================

  // Column configuration
  const columns = ref<any[]>([]);
  const visibleColumns = ref<string[]>([]);
  const columnWidths = ref<{ [key: string]: number }>({});
  const columnOrder = ref<string[]>([]);

  // Grid selection state
  const selectedRows = ref<any[]>([]);
  const selectedRowKeys = ref<string[]>([]);

  // Sort state
  const sortField = ref<string>('');
  const sortOrder = ref<'asc' | 'desc'>('desc');

  // Grid preferences
  const wrapContent = ref<boolean>(useLocalWrapContent() === 'true');
  const showTimestamp = ref<boolean>(true);

  // Loading states
  const columnsLoading = ref<boolean>(false);
  const gridDataLoading = ref<boolean>(false);

  // ========================================
  // COMPUTED PROPERTIES
  // ========================================

  const currentStreamName: ComputedRef<string> = computed(() => 
    searchObj.value.data.stream.selectedStream.join(',')
  );

  const selectedFields: ComputedRef<string[]> = computed(() => 
    searchObj.value.data.stream.selectedFields || []
  );

  const streamFields: ComputedRef<any[]> = computed(() => 
    searchObj.value.data.stream.selectedStreamFields || []
  );

  const gridData: ComputedRef<any[]> = computed(() => 
    searchObj.value.data.sortedQueryResults || []
  );

  const totalRecords: ComputedRef<number> = computed(() => 
    searchObj.value.data.queryResults.total || 0
  );

  const timestampColumn: ComputedRef<string> = computed(() => 
    store.state.zoConfig.timestamp_column || '_timestamp'
  );

  const isMultiStreamMode: ComputedRef<boolean> = computed(() => 
    searchObj.value.data.stream.selectedStream.length > 1
  );

  const hasData: ComputedRef<boolean> = computed(() => 
    gridData.value.length > 0
  );

  // ========================================
  // COLUMN MANAGEMENT
  // ========================================

  /**
   * Initializes grid columns based on selected fields and stream configuration
   */
  const initializeColumns = (): void => {
    columnsLoading.value = true;
    
    try {
      const newColumns: any[] = [];
      const localFieldPrefs: any = useLocalLogFilterField();
      
      // Always add timestamp column first if enabled
      if (showTimestamp.value && timestampColumn.value) {
        newColumns.push({
          name: timestampColumn.value,
          field: timestampColumn.value,
          prop: timestampColumn.value,
          label: 'Timestamp',
          align: 'left',
          sortable: true,
          type: 'datetime',
          width: 180,
          show: true,
          closable: false, // Timestamp column cannot be hidden
        });
      }

      // Add source stream column for multi-stream mode
      if (isMultiStreamMode.value) {
        newColumns.push({
          name: '_stream',
          field: '_stream', 
          prop: '_stream',
          label: 'Stream',
          align: 'left',
          sortable: true,
          type: 'text',
          width: 120,
          show: true,
          closable: true,
        });
      }

      // Add selected field columns
      streamFields.value.forEach(field => {
        if (selectedFields.value.includes(field.name) && field.name !== timestampColumn.value) {
          const isInterestingField = searchObj.value.data.stream.interestingFieldList.includes(field.name);
          
          newColumns.push({
            name: field.name,
            field: field.name,
            prop: field.name,
            label: field.name,
            align: 'left',
            sortable: true,
            type: field.type || 'text',
            width: getColumnWidth(field.name, field.type),
            show: isInterestingField || selectedFields.value.includes(field.name),
            closable: field.name !== timestampColumn.value,
            isInterestingField,
          });
        }
      });

      // Apply saved column order if available
      const savedOrder = searchObj.value.data.resultGrid.colOrder?.[currentStreamName.value];
      if (savedOrder && savedOrder.length > 0) {
        newColumns.sort((a, b) => {
          const aIndex = savedOrder.indexOf(a.name);
          const bIndex = savedOrder.indexOf(b.name);
          
          // Keep columns not in saved order at the end
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          
          return aIndex - bIndex;
        });
      }

      columns.value = newColumns;
      visibleColumns.value = newColumns.filter(col => col.show).map(col => col.name);
      
    } catch (error) {
      console.error('Error initializing columns:', error);
    } finally {
      columnsLoading.value = false;
    }
  };

  /**
   * Gets the appropriate width for a column based on field type and name
   */
  const getColumnWidth = (fieldName: string, fieldType: string = 'text'): number => {
    // Check for saved width first
    if (columnWidths.value[fieldName]) {
      return columnWidths.value[fieldName];
    }

    // Default widths based on field type
    switch (fieldType) {
      case 'datetime':
      case 'timestamp':
        return 180;
      case 'number':
      case 'integer':
      case 'float':
        return 100;
      case 'boolean':
        return 80;
      case 'text':
      default:
        // Adjust width based on field name length
        const baseWidth = 120;
        const nameLength = fieldName.length;
        return Math.max(baseWidth, Math.min(nameLength * 8, 300));
    }
  };

  /**
   * Updates column visibility
   */
  const updateColumnVisibility = (columnName: string, visible: boolean): void => {
    const column = columns.value.find(col => col.name === columnName);
    if (column) {
      column.show = visible;
      
      if (visible) {
        if (!visibleColumns.value.includes(columnName)) {
          visibleColumns.value.push(columnName);
        }
      } else {
        visibleColumns.value = visibleColumns.value.filter(col => col !== columnName);
      }
      
      // Update selected fields in search object
      if (visible && !selectedFields.value.includes(columnName)) {
        searchObj.value.data.stream.selectedFields.push(columnName);
      } else if (!visible) {
        searchObj.value.data.stream.selectedFields = selectedFields.value.filter(
          field => field !== columnName
        );
      }
    }
  };

  /**
   * Reorders columns based on new column order
   */
  const reorderColumns = (newOrder: string[]): void => {
    const reorderedColumns: any[] = [];
    
    // Add columns in the new order
    newOrder.forEach(columnName => {
      const column = columns.value.find(col => col.name === columnName);
      if (column) {
        reorderedColumns.push(column);
      }
    });
    
    // Add any columns not in the new order at the end
    columns.value.forEach(column => {
      if (!newOrder.includes(column.name)) {
        reorderedColumns.push(column);
      }
    });
    
    columns.value = reorderedColumns;
    columnOrder.value = newOrder;
    
    // Save column order to search object
    if (!searchObj.value.data.resultGrid.colOrder) {
      searchObj.value.data.resultGrid.colOrder = {};
    }
    searchObj.value.data.resultGrid.colOrder[currentStreamName.value] = newOrder;
  };

  /**
   * Resizes a column to a new width
   */
  const resizeColumn = (columnName: string, width: number): void => {
    const column = columns.value.find(col => col.name === columnName);
    if (column) {
      column.width = Math.max(50, width); // Minimum width of 50px
      columnWidths.value[columnName] = column.width;
    }
  };

  // ========================================
  // DATA FORMATTING
  // ========================================

  /**
   * Formats cell value based on field type
   */
  const formatCellValue = (value: any, fieldType: string = 'text'): string => {
    if (value === null || value === undefined) {
      return '-';
    }

    switch (fieldType) {
      case 'datetime':
      case 'timestamp':
        return formatTimestamp(value);
      case 'number':
      case 'integer':
      case 'float':
        return formatNumber(value);
      case 'boolean':
        return value ? 'true' : 'false';
      case 'object':
      case 'json':
        return formatObject(value);
      default:
        return String(value);
    }
  };

  /**
   * Formats timestamp values
   */
  const formatTimestamp = (timestamp: any): string => {
    try {
      const date = new Date(typeof timestamp === 'number' ? timestamp / 1000 : timestamp);
      return date.toLocaleString();
    } catch (error) {
      return String(timestamp);
    }
  };

  /**
   * Formats numeric values
   */
  const formatNumber = (value: any): string => {
    const num = Number(value);
    if (isNaN(num)) return String(value);
    
    // Format large numbers with commas
    if (Math.abs(num) >= 1000) {
      return num.toLocaleString();
    }
    
    return String(num);
  };

  /**
   * Formats object/JSON values
   */
  const formatObject = (value: any): string => {
    try {
      if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
      }
      return String(value);
    } catch (error) {
      return String(value);
    }
  };

  // ========================================
  // SORT MANAGEMENT
  // ========================================

  /**
   * Sets sort configuration
   */
  const setSortConfiguration = (field: string, order: 'asc' | 'desc'): void => {
    sortField.value = field;
    sortOrder.value = order;
    
    // Update search object sort configuration
    searchObj.value.data.resultGrid.sortBy = field;
    searchObj.value.data.resultGrid.sortOrder = order;
  };

  /**
   * Toggles sort order for a field
   */
  const toggleSort = (field: string): void => {
    if (sortField.value === field) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
    } else {
      sortField.value = field;
      sortOrder.value = 'desc'; // Default to descending
    }
    
    setSortConfiguration(sortField.value, sortOrder.value);
  };

  /**
   * Clears current sort configuration
   */
  const clearSort = (): void => {
    sortField.value = '';
    sortOrder.value = 'desc';
    searchObj.value.data.resultGrid.sortBy = '';
    searchObj.value.data.resultGrid.sortOrder = 'desc';
  };

  // ========================================
  // ROW SELECTION
  // ========================================

  /**
   * Selects a row
   */
  const selectRow = (row: any): void => {
    const key = getRowKey(row);
    if (!selectedRowKeys.value.includes(key)) {
      selectedRows.value.push(row);
      selectedRowKeys.value.push(key);
    }
  };

  /**
   * Deselects a row
   */
  const deselectRow = (row: any): void => {
    const key = getRowKey(row);
    selectedRows.value = selectedRows.value.filter(r => getRowKey(r) !== key);
    selectedRowKeys.value = selectedRowKeys.value.filter(k => k !== key);
  };

  /**
   * Toggles row selection
   */
  const toggleRowSelection = (row: any): void => {
    const key = getRowKey(row);
    if (selectedRowKeys.value.includes(key)) {
      deselectRow(row);
    } else {
      selectRow(row);
    }
  };

  /**
   * Selects all visible rows
   */
  const selectAllRows = (): void => {
    gridData.value.forEach(row => {
      const key = getRowKey(row);
      if (!selectedRowKeys.value.includes(key)) {
        selectedRows.value.push(row);
        selectedRowKeys.value.push(key);
      }
    });
  };

  /**
   * Clears all row selections
   */
  const clearSelection = (): void => {
    selectedRows.value = [];
    selectedRowKeys.value = [];
  };

  /**
   * Gets a unique key for a row
   */
  const getRowKey = (row: any): string => {
    // Use timestamp + a hash of the row content for uniqueness
    const timestamp = row[timestampColumn.value] || Date.now();
    const content = JSON.stringify(row);
    return `${timestamp}_${btoa(content).slice(0, 10)}`;
  };

  // ========================================
  // GRID PREFERENCES
  // ========================================

  /**
   * Updates wrap content setting
   */
  const updateWrapContent = (wrap: boolean): void => {
    wrapContent.value = wrap;
    localStorage.setItem('logs_wrap_content', String(wrap));
  };

  /**
   * Updates timestamp visibility
   */
  const updateTimestampVisibility = (visible: boolean): void => {
    showTimestamp.value = visible;
    
    if (visible && !visibleColumns.value.includes(timestampColumn.value)) {
      visibleColumns.value.unshift(timestampColumn.value);
    } else if (!visible) {
      visibleColumns.value = visibleColumns.value.filter(col => col !== timestampColumn.value);
    }
    
    initializeColumns();
  };

  // ========================================
  // EXPORT FUNCTIONALITY
  // ========================================

  /**
   * Exports selected rows as CSV
   */
  const exportSelectedRows = (): string => {
    const rows = selectedRows.value.length > 0 ? selectedRows.value : gridData.value;
    const cols = visibleColumns.value;
    
    const csvContent = [
      // Header
      cols.join(','),
      // Data rows
      ...rows.map(row => 
        cols.map(col => {
          const value = row[col];
          const formatted = formatCellValue(value, getFieldType(col));
          // Escape commas and quotes for CSV
          return `"${String(formatted).replace(/"/g, '""')}"`;
        }).join(',')
      )
    ].join('\n');
    
    return csvContent;
  };

  /**
   * Gets the field type for a given column name
   */
  const getFieldType = (columnName: string): string => {
    const field = streamFields.value.find(f => f.name === columnName);
    return field?.type || 'text';
  };

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Resets grid configuration to defaults
   */
  const resetGridConfiguration = (): void => {
    columns.value = [];
    visibleColumns.value = [];
    columnWidths.value = {};
    columnOrder.value = [];
    clearSelection();
    clearSort();
    initializeColumns();
  };

  /**
   * Gets the current grid configuration for persistence
   */
  const getGridConfiguration = (): any => {
    return {
      columns: columns.value.map(col => ({
        name: col.name,
        width: col.width,
        show: col.show,
      })),
      columnOrder: columnOrder.value,
      sortField: sortField.value,
      sortOrder: sortOrder.value,
      wrapContent: wrapContent.value,
      showTimestamp: showTimestamp.value,
    };
  };

  /**
   * Applies a saved grid configuration
   */
  const applyGridConfiguration = (config: any): void => {
    if (config.columns) {
      config.columns.forEach((savedCol: any) => {
        const column = columns.value.find(col => col.name === savedCol.name);
        if (column) {
          column.width = savedCol.width || column.width;
          column.show = savedCol.show !== undefined ? savedCol.show : column.show;
        }
      });
    }
    
    if (config.columnOrder) {
      reorderColumns(config.columnOrder);
    }
    
    if (config.sortField && config.sortOrder) {
      setSortConfiguration(config.sortField, config.sortOrder);
    }
    
    if (config.wrapContent !== undefined) {
      updateWrapContent(config.wrapContent);
    }
    
    if (config.showTimestamp !== undefined) {
      updateTimestampVisibility(config.showTimestamp);
    }
  };

  // ========================================
  // RETURN INTERFACE
  // ========================================

  return {
    // Computed State
    columns,
    visibleColumns,
    currentStreamName,
    selectedFields,
    streamFields,
    gridData,
    totalRecords,
    hasData,
    isMultiStreamMode,

    // Column Management
    initializeColumns,
    updateColumnVisibility,
    reorderColumns,
    resizeColumn,

    // Data Formatting
    formatCellValue,
    formatTimestamp,
    formatNumber,
    formatObject,

    // Sort Management
    sortField,
    sortOrder,
    setSortConfiguration,
    toggleSort,
    clearSort,

    // Selection Management
    selectedRows,
    selectedRowKeys,
    selectRow,
    deselectRow,
    toggleRowSelection,
    selectAllRows,
    clearSelection,

    // Grid Preferences
    wrapContent,
    showTimestamp,
    updateWrapContent,
    updateTimestampVisibility,

    // Export
    exportSelectedRows,

    // Configuration Management
    resetGridConfiguration,
    getGridConfiguration,
    applyGridConfiguration,

    // Utility
    getFieldType,
    getRowKey,

    // Loading States
    columnsLoading,
    gridDataLoading,
  };
}