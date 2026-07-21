// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";

const organizationDataLocal: any = ref({});

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

    window.addEventListener("load", () => {
      window.addEventListener("storage", read);
    });

    const write = () => {
      const val: unknown = isJSONValue
        ? JSON.stringify(defaultValue)
        : defaultValue;
      window.localStorage.setItem(key, String(val));
    };

    if (
      window.localStorage.getItem(key) == null &&
      !isDelete &&
      defaultValue !== ""
    )
      write();
    else if (value.value !== defaultValue && defaultValue !== "") write();

    const remove = () => {
      window.localStorage.removeItem(key);
    };

    if (isDelete) {
      remove();
    }

    return value;
  } catch (e) {
    console.log(
      `Error: Error in UseLocalStorage for key: ${key}, error-message : ${e}`,
    );
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

export const useLocalSavedView = (val = "", isDelete = false) => {
  return useLocalStorage("savedViews", val, isDelete, true);
};

export const useLocalUserInfo = (val = "", isDelete = false) => {
  const userInfo: any = useLocalStorage("userInfo", val, isDelete);
  return userInfo.value;
};

export const useLocalTimezone = (val = "", isDelete = false) => {
  const timezone: any = useLocalStorage("timezone", val, isDelete);
  return timezone.value;
};

export const useLocalWrapContent = (val = "", isDelete = false) => {
  const wrapcontent: any = useLocalStorage("wrapContent", val, isDelete);
  return wrapcontent.value;
};
