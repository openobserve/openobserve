import {
  convertV0ToV2,
  convertV1BEToV2,
  convertV1ToV2,
  detectConditionsVersion,
  ensureIds,
  type V2Group,
} from "@/utils/alerts/alertDataTransforms";

export function createEmptyJobFilterGroup(): V2Group {
  return ensureIds(convertV0ToV2([])) as V2Group;
}

export function normalizeJobFilterCondition(value: any): V2Group {
  const parsedValue = parseMaybeJson(value);
  if (
    !parsedValue ||
    parsedValue.type === "all" ||
    (typeof parsedValue === "object" &&
      !Array.isArray(parsedValue) &&
      Object.keys(parsedValue).length === 0)
  ) {
    return createEmptyJobFilterGroup();
  }

  const conditionValue =
    parsedValue.version !== undefined && parsedValue.conditions !== undefined
      ? parsedValue.conditions
      : parsedValue;

  if (conditionValue?.op && Array.isArray(conditionValue.conditions)) {
    return ensureIds({
      filterType: "group",
      logicalOperator:
        String(conditionValue.op).toUpperCase() === "OR" ? "OR" : "AND",
      conditions: conditionValue.conditions.map((condition: any) => ({
        filterType: "condition",
        column: condition.column || "",
        operator: condition.operator || "=",
        value: condition.value || "",
        values: condition.values || [],
        logicalOperator:
          String(conditionValue.op).toUpperCase() === "OR" ? "OR" : "AND",
      })),
    }) as V2Group;
  }

  const version = detectConditionsVersion(conditionValue);
  if (version === 2) return ensureIds(cloneJson(conditionValue)) as V2Group;
  if (Array.isArray(conditionValue)) return ensureIds(convertV0ToV2(conditionValue)) as V2Group;
  if (conditionValue?.label && conditionValue?.items) {
    return ensureIds(convertV1ToV2(conditionValue)) as V2Group;
  }

  return ensureIds(convertV1BEToV2(conditionValue)) as V2Group;
}

export function cleanFilterGroup(group: any): V2Group {
  const logicalOperator = group?.logicalOperator === "OR" ? "OR" : "AND";
  const conditions = (group?.conditions || [])
    .map((item: any) => {
      if (item?.filterType === "group") {
        const cleanGroup = cleanFilterGroup(item);
        return cleanGroup.conditions.length
          ? {
              ...cleanGroup,
              logicalOperator: item.logicalOperator === "OR" ? "OR" : "AND",
            }
          : null;
      }

      const hasValue =
        item?.value !== undefined && item?.value !== null && item?.value !== "";
      if (item?.filterType !== "condition" || !item.column || !item.operator || !hasValue)
        return null;

      return {
        filterType: "condition",
        column: item.column,
        operator: item.operator,
        value: item.value,
        values: item.values || [],
        logicalOperator: item.logicalOperator === "OR" ? "OR" : "AND",
      };
    })
    .filter(Boolean);

  return {
    filterType: "group",
    logicalOperator,
    conditions,
  } as V2Group;
}

export function buildJobFilterConditionPayload(group: V2Group) {
  const conditions = cleanFilterGroup(group);
  if (!conditions.conditions.length) return { type: "all" };

  return {
    version: 2,
    conditions,
  };
}

function parseMaybeJson(value: any) {
  if (typeof value !== "string") return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
