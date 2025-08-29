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

/**
 * Utilities for managing interesting fields functionality
 */

/**
 * Interface for field object
 */
export interface LogField {
  name: string;
  type?: string;
  label?: boolean;
  group?: string;
  streams?: string[];
  isInterestingField?: boolean;
  isSchemaField?: boolean;
  ftsKey?: boolean;
  showValues?: boolean;
}

/**
 * Interface for store configuration
 */
export interface StoreConfig {
  timestamp_column?: string;
  default_quick_mode_fields?: string[];
}

/**
 * Checks if a field should be marked as interesting by default
 */
export const isDefaultInterestingField = (
  fieldName: string,
  config: StoreConfig
): boolean => {
  const defaultInterestingFields = new Set(
    config?.default_quick_mode_fields || []
  );
  const timestampField = config?.timestamp_column;
  
  return defaultInterestingFields.has(fieldName) || fieldName === timestampField;
};

/**
 * Filters fields to get only interesting ones
 */
export const filterInterestingFields = (
  fields: LogField[],
  config: StoreConfig
): LogField[] => {
  return fields.filter((field) => {
    // Include group headers (label: true)
    if (field.label) return true;
    
    // Include fields that are marked as interesting
    if (field.isInterestingField) return true;
    
    // Include default interesting fields
    if (isDefaultInterestingField(field.name, config)) return true;
    
    return false;
  });
};

/**
 * Updates field's interesting status in a fields array
 */
export const updateFieldInterestingStatus = (
  fields: LogField[],
  fieldName: string,
  isInteresting: boolean
): LogField[] => {
  return fields.map((field) => {
    if (field.name === fieldName && !field.label) {
      return { ...field, isInterestingField: isInteresting };
    }
    return field;
  });
};

/**
 * Rebuilds interesting fields list from all fields
 */
export const rebuildInterestingFieldsList = (
  allFields: LogField[],
  config: StoreConfig
): {
  interestingFields: LogField[];
  fieldCounts: { [group: string]: number };
} => {
  const interestingFields = filterInterestingFields(allFields, config);
  
  // Build field counts per group
  const fieldCounts: { [group: string]: number } = {};
  
  interestingFields.forEach((field) => {
    if (!field.label && field.group) {
      // Skip group headers, count only actual fields
      fieldCounts[field.group] = (fieldCounts[field.group] || 0) + 1;
    }
  });
  
  return {
    interestingFields,
    fieldCounts,
  };
};

/**
 * Builds interesting field names array (excluding group headers)
 */
export const buildInterestingFieldNamesList = (
  interestingFields: LogField[],
  config: StoreConfig
): string[] => {
  const fieldNamesSet = new Set<string>();
  
  // Add default interesting fields
  const defaultFields = config?.default_quick_mode_fields || [];
  const timestampField = config?.timestamp_column;
  
  defaultFields.forEach(field => fieldNamesSet.add(field));
  if (timestampField) fieldNamesSet.add(timestampField);
  
  // Add fields marked as interesting (excluding group headers)
  interestingFields
    .filter(field => !field.label && field.isInterestingField)
    .forEach(field => fieldNamesSet.add(field.name));
  
  return Array.from(fieldNamesSet);
};