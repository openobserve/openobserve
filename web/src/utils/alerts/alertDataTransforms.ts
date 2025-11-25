/**
 * Alert Data Transformation Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 *
 * VERSION SUPPORT:
 * - Version 1: Old structure with {and: [...]} or {or: [...]} format
 * - Version 2: New structure with filterType, logicalOperator, and conditions array
 */

import { getUUID } from "@/utils/zincutils";

export interface TransformContext {
  formData: any;
}

// ============================================================================
// VERSION 2 INTERFACES
// ============================================================================

export interface V2Condition {
  type: "condition";
  filterType: "condition";
  column: string;
  operator: string;
  value: string | number;
  values?: any[];
  logicalOperator: "AND" | "OR";
  ignore_case?: boolean;
  id?: string;
}

export interface V2Group {
  filterType: "group";
  logicalOperator: "AND" | "OR";
  conditions: (V2Condition | V2Group)[];
  groupId?: string;
}

export interface V1Condition {
  column: string;
  operator: string;
  value: string | number;
  ignore_case?: boolean;
  id?: string;
}

export interface V1Group {
  groupId: string;
  label: "and" | "or";
  items: (V1Condition | V1Group)[];
}

/**
 * Ensures all groups have groupId and all conditions have id
 * This is needed because data from backend might not have these fields
 */
export const ensureIds = (group: any): any => {
  if (!group) return group;

  // Ensure this group has a groupId
  if (group.filterType === "group" && !group.groupId) {
    group.groupId = getUUID();
  }

  // Process conditions array
  if (group.conditions && Array.isArray(group.conditions)) {
    group.conditions = group.conditions.map((item: any) => {
      if (item.filterType === "group") {
        // Recursively ensure IDs for nested groups
        return ensureIds(item);
      } else {
        // Ensure condition has an id
        if (!item.id) {
          item.id = getUUID();
        }
        return item;
      }
    });
  }

  return group;
};

/**
 * Updates a condition group (root or nested) with new data
 * This is called when FilterGroup emits add-condition or add-group events
 *
 * @param updatedGroup - The updated group emitted by FilterGroup
 * @param context - Context object containing formData
 */
export const updateGroup = (updatedGroup: any, context: TransformContext): void => {
  const { formData } = context;
  const rootGroup = formData.query_condition.conditions;

  // If the updated group is the root group, replace it entirely
  if (rootGroup.groupId === updatedGroup.groupId) {
    formData.query_condition.conditions = updatedGroup;
    return;
  }

  // Otherwise, find and update the nested group recursively
  const updateNestedGroup = (group: any, updated: any): boolean => {
    // V2: Use conditions array, V1: use items array
    const itemsArray = group.conditions || group.items;
    if (!itemsArray || !Array.isArray(itemsArray)) return false;

    for (let i = 0; i < itemsArray.length; i++) {
      const item = itemsArray[i];

      // Check if this is the group to update
      if (item.groupId && item.groupId === updated.groupId) {
        // Replace the entire group object
        if (group.conditions) {
          group.conditions[i] = updated;
        } else {
          group.items[i] = updated;
        }
        return true;
      }

      // Recursively check nested groups
      const nestedItems = item.conditions || item.items;
      if (nestedItems && Array.isArray(nestedItems)) {
        if (updateNestedGroup(item, updated)) {
          return true;
        }
      }
    }
    return false;
  };

  updateNestedGroup(rootGroup, updatedGroup);
};

export const removeConditionGroup = (
  targetGroupId: string,
  currentGroup: any,
  context: TransformContext,
): void => {
  const { formData } = context;
  const groupToProcess = currentGroup || formData.query_condition.conditions;

  // V2: Use conditions array, V1: use items array
  const itemsArray = groupToProcess?.conditions || groupToProcess?.items;
  if (!itemsArray || !Array.isArray(itemsArray)) return;

  const filterEmptyGroups = (items: any[]): any[] => {
    return items.filter((item: any) => {
      if (item.groupId === targetGroupId) {
        return false;
      }

      // V2: check conditions, V1: check items
      const nestedItems = item.conditions || item.items;
      if (nestedItems && Array.isArray(nestedItems)) {
        const filtered = filterEmptyGroups(nestedItems);
        if (item.conditions) {
          item.conditions = filtered;
          return item.conditions.length > 0;
        } else {
          item.items = filtered;
          return item.items.length > 0;
        }
      }

      return true;
    });
  };

  const filtered = filterEmptyGroups(itemsArray);
  if (groupToProcess.conditions) {
    groupToProcess.conditions = filtered;
  } else {
    groupToProcess.items = filtered;
  }
};

export const transformFEToBE = (node: any): any => {
  if (!node || !node.items || !Array.isArray(node.items)) return {};

  const groupLabel = node.label?.toLowerCase();
  if (!groupLabel || (groupLabel !== "or" && groupLabel !== "and")) return {};

  const transformedItems = node.items.map((item: any) => {
    // If the item has its own groupId and items, it's a nested group
    //that means the item is a group and we need to iterate over that group to get further conditions
    if (item.groupId && item.items) {
      return transformFEToBE(item);
    }

    return {
      column: item.column,
      operator: item.operator,
      value: item.value,
      ignore_case: !!item.ignore_case,
    };
  });
  //return the transformed items in the format of the backend
  return {
    [groupLabel]: transformedItems,
  };
};
// Method to transform the backend data to the frontend format
//when we get response from the BE we need to transform it to the frontend format
//eg:
// {
//   and: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
// }
// to
// {
//   groupId: '123',
//   label: 'and',
//   items: [{column: 'name', operator: '=', value: 'John', ignore_case: false}]
// }
export const retransformBEToFE = (data: any): any => {
  if (!data) return null;
  const keys = Object.keys(data);
  if (keys.length !== 1) return null;

  const label = keys[0];
  const items = data[label];

  const transformedItems = items.map((item: any) => {
    if (item.and || item.or) {
      // Nested group
      //so we need to iterate over the item and get the conditions and map that to one group
      return retransformBEToFE(item);
    } else {
      //if not its a condition so we can simply return the condition
      return {
        column: item.column,
        operator: item.operator,
        value: item.value,
        ignore_case: !!item.ignore_case,
        id: getUUID(),
      };
    }
  });

  return {
    groupId: getUUID(),
    label,
    items: transformedItems,
  };
};

// ============================================================================
// VERSION 2 UTILITIES
// ============================================================================

/**
 * Detects which version of conditions structure we have:
 *
 * V0 (Original): Flat array of conditions, no groups, implicit AND between all
 *    Example: [{column: "x", operator: "=", value: "1"}, ...]
 *
 * V1 (Tree-based): Nested structure with {and: [...]} or {or: [...]} or {label, items, groupId}
 *    Example: {and: [{column: "x", operator: "=", value: "1"}]} or
 *             {label: "and", items: [...], groupId: "..."}
 *
 * V2 (Linear): New structure with filterType, logicalOperator per condition
 *    Example: {filterType: "group", logicalOperator: "AND", conditions: [...]}
 *
 * Note: version field should be at parent level (query_condition.version), not inside conditions
 */
export const detectConditionsVersion = (conditions: any): 0 | 1 | 2 => {
  if (!conditions) return 0;

  // Check for V2 structure (newest)
  if (conditions.filterType === "group" && conditions.conditions && Array.isArray(conditions.conditions)) {
    return 2;
  }

  // Check for V1 structure (tree-based with nesting)
  if (conditions.and || conditions.or || (conditions.label && conditions.items)) {
    return 1;
  }

  // Check for V0 structure (flat array of conditions)
  if (Array.isArray(conditions) && conditions.length > 0) {
    // It's a flat array - V0
    return 0;
  }

  // Empty or unknown - default to V0
  return 0;
};

/**
 * Converts V0 flat array to V2 format
 * V0: [{column: "x", operator: "=", value: "1"}, ...]
 * V2: {filterType: "group", logicalOperator: "AND", conditions: [...]}
 * Note: V0 had implicit AND between all conditions (no groups)
 */
export const convertV0ToV2 = (v0Data: any[]): V2Group => {
  if (!Array.isArray(v0Data) || v0Data.length === 0) {
    return {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
      groupId: getUUID(),
    };
  }

  // Convert each flat condition to V2 format
  const conditions: V2Condition[] = v0Data.map((item: any, index: number) => {
    const condition: V2Condition = {
      type: "condition",
      filterType: "condition",
      column: item.column || "",
      operator: item.operator || "=",
      value: item.value || "",
      values: item.values || [],
      logicalOperator: "AND", // V0 had implicit AND between all
      ignore_case: item.ignore_case !== undefined ? item.ignore_case : true,
      id: item.id || getUUID(),
    };

    return condition;
  });

  return {
    filterType: "group",
    logicalOperator: "AND",
    conditions: conditions,
    groupId: getUUID(),
  };
};

/**
 * Converts V1 frontend format (with groupId, label, items) to V2 format
 * V1: {groupId, label: "and", items: [...]}
 * V2: {filterType: "group", logicalOperator: "AND", conditions: [...]}
 */
export const convertV1ToV2 = (v1Data: any, isFirstGroup: boolean = true): V2Group => {
  if (!v1Data) {
    return {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    };
  }

  // If it's already V2 format, return as is
  if (v1Data.filterType === "group") {
    return v1Data;
  }

  const items = v1Data.items || [];
  const label = v1Data.label || "and";
  const logicalOperator = label.toUpperCase() as "AND" | "OR";

  const conditions: (V2Condition | V2Group)[] = items.map((item: any, index: number) => {
    // Check if it's a nested group
    if (item.groupId && item.items) {
      // It's a V1 group, convert recursively
      return convertV1ToV2(item, false);
    }

    // It's a condition
    const condition: V2Condition = {
      type: "condition",
      filterType: "condition",
      column: item.column || "",
      operator: item.operator || "=",
      value: item.value || "",
      values: item.values || [],
      logicalOperator: logicalOperator,
      ignore_case: item.ignore_case !== undefined ? item.ignore_case : true,
    };

    // Keep the id if it exists
    if (item.id) {
      condition.id = item.id;
    }

    return condition;
  });

  const result: V2Group = {
    filterType: "group",
    logicalOperator: logicalOperator,
    conditions: conditions,
  };

  // Keep groupId if it exists (useful for frontend tracking)
  if (v1Data.groupId) {
    result.groupId = v1Data.groupId;
  }

  return result;
};

/**
 * Converts V1 backend format to V2 format
 * V1 BE: {and: [{column, operator, value}]} or {or: [...]}
 * V2: {filterType: "group", logicalOperator: "AND", conditions: [...]}
 *
 * In V1: Group has operator that applies between all items in that group
 * In V2: Each condition has operator that determines how it connects to the NEXT item
 */
export const convertV1BEToV2 = (v1BEData: any): V2Group => {
  if (!v1BEData) {
    return {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    };
  }

  // If it's already V2 format, return as is
  if (v1BEData.filterType === "group") {
    return v1BEData;
  }

  // Get the operator key (and/or)
  const keys = Object.keys(v1BEData);
  if (keys.length === 0) {
    return {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [],
    };
  }

  const operatorKey = keys[0]; // "and" or "or"
  const items = v1BEData[operatorKey];
  const logicalOperator = operatorKey.toUpperCase() as "AND" | "OR";

  const conditions: (V2Condition | V2Group)[] = items.map((item: any) => {
    // Check if it's a nested group
    if (item.and || item.or) {
      // For nested groups, recursively convert
      const nestedGroup = convertV1BEToV2(item);
      // The nested group itself doesn't need a logicalOperator at its root level
      // but we need to track it for UI purposes
      nestedGroup.logicalOperator = logicalOperator;
      return nestedGroup;
    }

    // It's a condition
    // In V2, each condition's logicalOperator determines how it connects to the NEXT item
    // So all conditions in this group should have the same operator (from the group level in V1)
    const condition: V2Condition = {
      type: "condition",
      filterType: "condition",
      column: item.column || "",
      operator: item.operator || "=",
      value: item.value || "",
      values: item.values || [],
      logicalOperator: logicalOperator,
      ignore_case: item.ignore_case !== undefined ? item.ignore_case : true,
      id: item.id || getUUID(),
    };

    return condition;
  });

  return {
    filterType: "group",
    logicalOperator: logicalOperator,
    conditions: conditions,
    groupId: getUUID(),
  };
};