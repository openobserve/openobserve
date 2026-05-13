// Whitelist of config keys that require API calls when changed
const API_REQUIRING_CHANGES = new Set(["queries", "variables"]);

// Keys under "queries" that are runtime metadata — changes to these
// should NOT trigger the "chart not up to date" banner or require an API call.
const IGNORED_QUERY_KEYS = new Set([
  "vrlFunctionFieldList",
  "tabName",
]);

/**
 * Flattens an object's keys with dot notation
 */
const flattenObject = (obj: any, prefix = ""): Record<string, any> => {
  if (obj === null || obj === undefined) {
    return {};
  }
  return Object.keys(obj).reduce((acc: Record<string, any>, k: string) => {
    const pre = prefix.length ? prefix + "." : "";
    if (Array.isArray(obj[k])) {
      // Recurse into arrays so individual elements and their fields are
      // flattened (e.g., queries.0.vrlFunctionFieldList). This allows
      // IGNORED_QUERY_KEYS filtering to work on per-field granularity.
      obj[k].forEach((item: any, idx: number) => {
        if (typeof item === "object" && item !== null) {
          Object.assign(acc, flattenObject(item, `${pre}${k}.${idx}`));
        } else {
          acc[`${pre}${k}.${idx}`] = item;
        }
      });
    } else if (
      typeof obj[k] === "object" &&
      obj[k] !== null
    ) {
      Object.assign(acc, flattenObject(obj[k], pre + k));
    } else {
      acc[pre + k] = obj[k];
    }
    return acc;
  }, {});
};

/**
 * Gets changed keys between two objects
 */
const getChangedKeys = (oldObj: any, newObj: any): string[] => {
  const flatOld = flattenObject(oldObj);
  const flatNew = flattenObject(newObj);
  const changedKeys: string[] = [];

  // Check all keys in both objects
  const allKeys = Array.from(
    new Set([...Object.keys(flatOld), ...Object.keys(flatNew)]),
  );

  for (const key of allKeys) {
    if (JSON.stringify(flatOld[key]) !== JSON.stringify(flatNew[key])) {
      changedKeys.push(key);
    }
  }

  return changedKeys;
};

/**
 * Checks if the changes between old and new config require an API call
 */
export const checkIfConfigChangeRequiredApiCallOrNot = (
  oldConfig: any,
  newConfig: any,
): boolean => {
  const changedKeys = getChangedKeys(oldConfig, newConfig);

  // Filter out runtime-only metadata keys that don't affect query execution
  const meaningfulChanges = changedKeys.filter((key) => {
    // Check if the leaf key (last segment) is in the ignored set
    const segments = key.split(".");
    const leafKey = segments[segments.length - 1];
    return !IGNORED_QUERY_KEYS.has(leafKey);
  });

  const configNeedsApiCall = meaningfulChanges.some((key) =>
    Array.from(API_REQUIRING_CHANGES).some((apiKey) => key.startsWith(apiKey)),
  );

  return configNeedsApiCall;
};
