// Whitelist of config keys that require API calls when changed
const API_REQUIRING_CHANGES = new Set(["queries", "variables"]);

/**
 * Flattens an object's keys with dot notation
 */
const flattenObject = (obj: any, prefix = ""): Record<string, any> => {
  if (obj === null || obj === undefined) {
    return {};
  }
  return Object.keys(obj).reduce((acc: Record<string, any>, k: string) => {
    const pre = prefix.length ? prefix + "." : "";
    if (
      typeof obj[k] === "object" &&
      obj[k] !== null &&
      !Array.isArray(obj[k])
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
  const configNeedsApiCall = changedKeys.some((key) =>
    Array.from(API_REQUIRING_CHANGES).some((apiKey) => key.startsWith(apiKey)),
  );

  if (configNeedsApiCall) {
    return true;
  }

  return false;
};
