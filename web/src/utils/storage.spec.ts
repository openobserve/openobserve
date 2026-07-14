// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// localStorage / sessionStorage mocks — defined before importing module
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});
Object.defineProperty(global, "sessionStorage", {
  value: sessionStorageMock,
  writable: true,
});

import {
  getSessionStorageVal,
  deleteSessionStorageVal,
  useLocalOrganization,
  useLocalCurrentUser,
  useLocalLogsObj,
  useLocalLogFilterField,
  useLocalTraceFilterField,
  useLocalInterestingFields,
  useLocalSavedView,
  useLocalUserInfo,
  useLocalTimezone,
  useLocalWrapContent,
} from "./storage";

beforeEach(() => {
  localStorageMock.getItem.mockReset();
  localStorageMock.setItem.mockReset();
  localStorageMock.removeItem.mockReset();
  sessionStorageMock.getItem.mockReset();
  sessionStorageMock.setItem.mockReset();
  sessionStorageMock.removeItem.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// getSessionStorageVal
// ---------------------------------------------------------------------------

describe("getSessionStorageVal", () => {
  it("returns the stored value when key exists", () => {
    sessionStorageMock.getItem.mockReturnValue("stored-value");

    const result = getSessionStorageVal("myKey");

    expect(result).toBe("stored-value");
    expect(sessionStorageMock.getItem).toHaveBeenCalledWith("myKey");
  });

  it("returns null when the key does not exist", () => {
    sessionStorageMock.getItem.mockReturnValue(null);

    const result = getSessionStorageVal("missing");

    expect(result).toBeNull();
  });

  it("returns undefined and logs error when sessionStorage throws", () => {
    sessionStorageMock.getItem.mockImplementation(() => {
      throw new Error("storage error");
    });

    const result = getSessionStorageVal("badKey");

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deleteSessionStorageVal
// ---------------------------------------------------------------------------

describe("deleteSessionStorageVal", () => {
  it("calls removeItem with the correct key", () => {
    deleteSessionStorageVal("myKey");

    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith("myKey");
  });

  it("logs error and returns undefined when sessionStorage throws", () => {
    sessionStorageMock.removeItem.mockImplementation(() => {
      throw new Error("remove error");
    });

    const result = deleteSessionStorageVal("badKey");

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useLocalOrganization
// ---------------------------------------------------------------------------

describe("useLocalOrganization", () => {
  it("stores a non-empty object and returns the module-level ref", () => {
    const org = { identifier: "test-org" };

    const result = useLocalOrganization(org);

    expect(result.value).toEqual(org);
  });

  it("returns the existing ref when called with an empty object", () => {
    // First set a value
    useLocalOrganization({ identifier: "org1" });
    // Then call with empty
    const result = useLocalOrganization({});

    expect(result.value).toEqual({ identifier: "org1" });
  });

  it("resets the ref to {} when isDelete=true", () => {
    useLocalOrganization({ identifier: "something" });

    const result = useLocalOrganization({}, true);

    expect(result.value).toEqual({});
  });

  it("returns the organizationDataLocal ref when val is not an object", () => {
    const result = useLocalOrganization("some-string" as any);

    // Should return the ref without changing its value
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("logs and returns a fresh ref when an exception is thrown", () => {
    // Temporarily break Object.keys to force the catch branch
    const originalKeys = Object.keys;
    Object.keys = () => {
      throw new Error("forced error");
    };

    const result = useLocalOrganization({ a: 1 });

    // restore immediately
    Object.keys = originalKeys;

    // result should still be a ref-like object
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// useLocalCurrentUser — verifies correct localStorage key is used
// ---------------------------------------------------------------------------

describe("useLocalCurrentUser", () => {
  it("reads from localStorage with key 'currentuser'", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalCurrentUser("test-user");

    expect(localStorageMock.getItem).toHaveBeenCalledWith("currentuser");
  });

  it("removes localStorage entry when isDelete=true", () => {
    // getItem returns a valid JSON string so JSON.parse succeeds
    localStorageMock.getItem.mockReturnValue(JSON.stringify("existing-value"));

    useLocalCurrentUser("", true);

    expect(localStorageMock.removeItem).toHaveBeenCalledWith("currentuser");
  });
});

// ---------------------------------------------------------------------------
// useLocalLogsObj
// ---------------------------------------------------------------------------

describe("useLocalLogsObj", () => {
  it("reads from localStorage with key 'logsobj'", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalLogsObj("val");

    expect(localStorageMock.getItem).toHaveBeenCalledWith("logsobj");
  });
});

// ---------------------------------------------------------------------------
// useLocalLogFilterField
// ---------------------------------------------------------------------------

describe("useLocalLogFilterField", () => {
  it("reads from localStorage with key 'logFilterField'", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalLogFilterField("val");

    expect(localStorageMock.getItem).toHaveBeenCalledWith("logFilterField");
  });
});

// ---------------------------------------------------------------------------
// useLocalTraceFilterField
// ---------------------------------------------------------------------------

describe("useLocalTraceFilterField", () => {
  it("reads from localStorage with key 'traceFilterField'", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalTraceFilterField("val");

    expect(localStorageMock.getItem).toHaveBeenCalledWith("traceFilterField");
  });
});

// ---------------------------------------------------------------------------
// useLocalInterestingFields
// ---------------------------------------------------------------------------

describe("useLocalInterestingFields", () => {
  it("reads from localStorage with key 'interestingFields'", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalInterestingFields("val");

    expect(localStorageMock.getItem).toHaveBeenCalledWith("interestingFields");
  });
});

// ---------------------------------------------------------------------------
// useLocalSavedView
// ---------------------------------------------------------------------------

describe("useLocalSavedView", () => {
  it("reads from localStorage with key 'savedViews'", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalSavedView("val");

    expect(localStorageMock.getItem).toHaveBeenCalledWith("savedViews");
  });
});

// ---------------------------------------------------------------------------
// useLocalUserInfo — returns .value (primitive), not the ref
// ---------------------------------------------------------------------------

describe("useLocalUserInfo", () => {
  it("returns the string value stored in localStorage (not a ref)", () => {
    localStorageMock.getItem.mockReturnValue("encoded-user-data");

    const result = useLocalUserInfo();

    expect(typeof result).toBe("string");
    expect(result).toBe("encoded-user-data");
  });

  it("returns null when key is not in localStorage", () => {
    localStorageMock.getItem.mockReturnValue(null);

    const result = useLocalUserInfo();

    expect(result).toBeNull();
  });

  it("uses the key 'userInfo'", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalUserInfo();

    expect(localStorageMock.getItem).toHaveBeenCalledWith("userInfo");
  });
});

// ---------------------------------------------------------------------------
// useLocalTimezone — returns .value (primitive), not the ref
// ---------------------------------------------------------------------------

describe("useLocalTimezone", () => {
  it("returns the timezone string value from localStorage", () => {
    localStorageMock.getItem.mockReturnValue("UTC");

    const result = useLocalTimezone();

    expect(result).toBe("UTC");
  });

  it("returns null when key is not in localStorage", () => {
    localStorageMock.getItem.mockReturnValue(null);

    const result = useLocalTimezone();

    expect(result).toBeNull();
  });

  it("uses the key 'timezone'", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalTimezone();

    expect(localStorageMock.getItem).toHaveBeenCalledWith("timezone");
  });
});

// ---------------------------------------------------------------------------
// useLocalWrapContent — returns .value (primitive), not the ref
// ---------------------------------------------------------------------------

describe("useLocalWrapContent", () => {
  it("returns the wrapContent value from localStorage", () => {
    localStorageMock.getItem.mockReturnValue("true");

    const result = useLocalWrapContent();

    expect(result).toBe("true");
  });

  it("returns null when key is not in localStorage", () => {
    localStorageMock.getItem.mockReturnValue(null);

    const result = useLocalWrapContent();

    expect(result).toBeNull();
  });

  it("uses the key 'wrapContent'", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalWrapContent();

    expect(localStorageMock.getItem).toHaveBeenCalledWith("wrapContent");
  });
});

// ---------------------------------------------------------------------------
// useLocalStorage internal behaviour (tested through wrapper functions)
// ---------------------------------------------------------------------------

describe("useLocalStorage internals (via useLocalCurrentUser)", () => {
  it("parses JSON value when isJSONValue=true and value exists", () => {
    const payload = { name: "Alice", role: "admin" };
    localStorageMock.getItem.mockReturnValue(JSON.stringify(payload));

    const ref = useLocalCurrentUser();

    expect(ref!.value).toEqual(payload);
  });

  it("stores null in ref when localStorage returns null", () => {
    localStorageMock.getItem.mockReturnValue(null);

    const ref = useLocalCurrentUser("non-empty-default");

    expect(ref!.value).toBeNull();
  });

  it("writes to localStorage when key is absent and defaultValue is not empty", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalCurrentUser("initial-value");

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "currentuser",
      expect.any(String),
    );
  });

  it("does NOT write to localStorage when defaultValue is empty string", () => {
    localStorageMock.getItem.mockReturnValue(null);

    useLocalCurrentUser("");

    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("calls removeItem when isDelete=true", () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify("existing-value"));

    useLocalCurrentUser("", true);

    expect(localStorageMock.removeItem).toHaveBeenCalledWith("currentuser");
  });

  it("logs error and returns undefined when localStorage throws", () => {
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const ref = useLocalCurrentUser("value");

    expect(ref).toBeUndefined();
  });

  it("writes when stored value differs from default", () => {
    localStorageMock.getItem.mockReturnValue(JSON.stringify("old-value"));

    useLocalCurrentUser("new-value");

    expect(localStorageMock.setItem).toHaveBeenCalled();
  });
});
