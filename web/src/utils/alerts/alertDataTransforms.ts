/**
 * Alert Data Transformation Utilities
 * Extracted from AddAlert.vue to reduce file complexity
 */

import { getUUID } from "@/utils/zincutils";

export interface TransformContext {
  formData: any;
}

export const updateGroup = (updatedGroup: any, context: TransformContext): void => {
  const { formData } = context;
  formData.query_condition.conditions.items.forEach((element: any) => {
    if (element.groupId === updatedGroup.groupId) {
      element.items = updatedGroup.items;
    }
  });
};

export const removeConditionGroup = (
  targetGroupId: string,
  currentGroup: any,
  context: TransformContext,
): void => {
  const { formData } = context;
  const groupToProcess = currentGroup || formData.query_condition.conditions;
  
  if (!groupToProcess?.items || !Array.isArray(groupToProcess.items)) return;

  const filterEmptyGroups = (items: any[]): any[] => {
    return items.filter((item: any) => {
      if (item.groupId === targetGroupId) {
        return false;
      }

      if (item.items && Array.isArray(item.items)) {
        item.items = filterEmptyGroups(item.items);
        return item.items.length > 0;
      }

      return true;
    });
  };

  groupToProcess.items = filterEmptyGroups(groupToProcess.items);
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