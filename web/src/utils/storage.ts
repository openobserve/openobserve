// Copyright 2026 OpenObserve Inc.

import { ref, type Ref } from "vue";

const organizationDataLocal: any = ref({});

// Keyed by storage key, so ~107 useLocalStorage() call sites share one listener
// instead of each leaking its own for the lifetime of the page.
const storageReaders = new Map<string, () => void>();

let storageListenerAttached = false;

const attachStorageListener = () => {
  if (storageListenerAttached) return;
  storageListenerAttached = true;
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key == null) return;
    storageReaders.get(event.key)?.();
  });
};

const useLocalStorage = (
  key: string,
  defaultValue: unknown,
  isDelete: boolean = false,
  isJSONValue: boolean = false,
) => {
  try {
    const value = ref(defaultValue);
    const read = () => {
      const v = window.localStorage.getItem(key);

      if (v != null && isJSONValue === true) value.value = JSON.parse(v);
      else if (v != null) value.value = v;
      else value.value = null;
    };

    read();

    // Most recent ref per key wins, which is what keeps the map bounded.
    storageReaders.set(key, read);
    attachStorageListener();

    const write = () => {
      const val: unknown = isJSONValue ? JSON.stringify(defaultValue) : defaultValue;
      window.localStorage.setItem(key, String(val));
    };

    if (window.localStorage.getItem(key) == null && !isDelete && defaultValue !== "") write();
    else if (value.value !== defaultValue && defaultValue !== "") write();

    const remove = () => {
      window.localStorage.removeItem(key);
    };

    if (isDelete) {
      remove();
    }

    return value;
  } catch (e) {
    console.log(`Error: Error in UseLocalStorage for key: ${key}, error-message : ${e}`);
    return undefined;
  }
};

export const getSessionStorageVal = (key: string) => {
  try {
    return window.sessionStorage.getItem(key);
  } catch (e) {
    console.log(`Error: Error while pull sessionstorage value ${key}`);
    return undefined;
  }
};

export const deleteSessionStorageVal = (key: string) => {
  try {
    return sessionStorage.removeItem(key);
  } catch (e) {
    console.log(`Error: Error while pull sessionstorage value ${key}`);
  }
};

export const useLocalOrganization = (val: any = {}, isDelete = false) => {
  try {
    if (typeof val === "object") {
      if (Object.keys(val).length > 0) {
        organizationDataLocal.value = val;
      } else if (isDelete) {
        organizationDataLocal.value = {};
      }
      return organizationDataLocal;
    } else {
      return organizationDataLocal;
    }
  } catch (e) {
    console.log(`Error: Error in useLocalOrganization: ${e}`);
    return ref({});
  }
};

export const useLocalCurrentUser = (val = "", isDelete = false) => {
  return useLocalStorage("currentuser", val, isDelete, true);
};

export const useLocalLogsObj = (val = "", isDelete = false) => {
  return useLocalStorage("logsobj", val, isDelete, true);
};

export const useLocalLogFilterField = (val = "", isDelete = false) => {
  return useLocalStorage("logFilterField", val, isDelete, true);
};

export const useLocalTraceFilterField = (val = "", isDelete = false) => {
  return useLocalStorage("traceFilterField", val, isDelete, true);
};

export const useLocalInterestingFields = (val = "", isDelete = false) => {
  return useLocalStorage("interestingFields", val, isDelete, true);
};

export const useLocalUserInfo = (val = "", isDelete = false) => {
  const userInfo: any = useLocalStorage("userInfo", val, isDelete);
  return userInfo.value;
};

export const useLocalTimezone = (val = "", isDelete = false) => {
  const timezone: any = useLocalStorage("timezone", val, isDelete);
  return timezone.value;
};

/** Applies a linked timezone to the store and its stored key, so the picker and every query use it from now on. */
export const applyTimezone = (
  store: { dispatch: (type: string, payload?: unknown) => unknown },
  zone: string | null | undefined,
): void => {
  if (!zone) return;
  useLocalTimezone(zone);
  store.dispatch("setTimezone", zone);
};

/** Applies a shared timezone (a saved view) for this session only; the user's own stored zone is left as it was. */
export const applySessionTimezone = (
  store: { dispatch: (type: string, payload?: unknown) => unknown },
  zone: string | null | undefined,
): void => {
  if (zone) store.dispatch("setTimezone", zone);
};

export const useLocalWrapContent = (val = "", isDelete = false) => {
  const wrapcontent: any = useLocalStorage("wrapContent", val, isDelete);
  return wrapcontent.value;
};

/** Wrap preference for the traces/spans table.
 *
 *  Its own key rather than sharing `wrapContent` with the logs table: they are
 *  different views, and a user who wraps one has not asked to wrap the other. */
export const useLocalWrapTracesContent = (val = "", isDelete = false) => {
  const wrapcontent: any = useLocalStorage("wrapTracesContent", val, isDelete);
  return wrapcontent.value;
};

/** Reads (no `val`) or writes the hide-internal-streams flag under `key`; the ref follows other tabs' writes, `undefined` when storage is unavailable. */
export const useLocalHideInternalStreams = (key: string, val: "" | "true" | "false" = "") =>
  useLocalStorage(key, val) as Ref<string | null> | undefined;
