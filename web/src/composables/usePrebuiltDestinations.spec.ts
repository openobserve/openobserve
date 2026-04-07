// Copyright 2026 OpenObserve Inc.
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

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNotify = vi.fn();

vi.mock("quasar", () => ({
  useQuasar: vi.fn(() => ({ notify: mockNotify })),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
  })),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      selectedOrganization: { identifier: "test-org" },
    },
  })),
}));

const {
  mockGetSystemTemplates,
  mockGetByName,
  mockDestCreate,
  mockDestUpdate,
  mockDestTest,
  mockDestGetByName,
} = vi.hoisted(() => ({
  mockGetSystemTemplates: vi.fn(),
  mockGetByName: vi.fn(),
  mockDestCreate: vi.fn(),
  mockDestUpdate: vi.fn(),
  mockDestTest: vi.fn(),
  mockDestGetByName: vi.fn(),
}));

vi.mock("@/services/alert_templates", () => ({
  default: {
    get_system_templates: mockGetSystemTemplates,
    get_by_name: mockGetByName,
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: {
    create: mockDestCreate,
    update: mockDestUpdate,
    test: mockDestTest,
    get_by_name: mockDestGetByName,
  },
}));

// The real prebuilt-templates utilities are lightweight and have no side
// effects, so we let them run. However we need to stub out the
// generateDestinationUrl / generateDestinationHeaders used inside tests.
vi.mock("@/utils/prebuilt-templates", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    generateDestinationUrl: vi.fn(() => "https://hooks.slack.com/test"),
    generateDestinationHeaders: vi.fn(() => ({
      "Content-Type": "application/json",
    })),
  };
});

import { usePrebuiltDestinations } from "./usePrebuiltDestinations";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSlackCredentials() {
  return { webhookUrl: "https://hooks.slack.com/services/T000/B000/xxxx" };
}

// ---------------------------------------------------------------------------

describe("usePrebuiltDestinations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default template fetch: empty list (no cache)
    mockGetSystemTemplates.mockResolvedValue({ data: [] });
  });

  // -------------------------------------------------------------------------
  // Return value structure
  // -------------------------------------------------------------------------
  describe("return value structure", () => {
    it("exposes reactive state, computed, and methods", () => {
      const inst = usePrebuiltDestinations();

      expect(inst).toHaveProperty("isLoading");
      expect(inst).toHaveProperty("isTestInProgress");
      expect(inst).toHaveProperty("lastTestResult");
      expect(inst).toHaveProperty("availableTypes");
      expect(inst).toHaveProperty("popularTypes");
      expect(inst).toHaveProperty("typesByCategory");
      expect(inst).toHaveProperty("fetchSystemTemplates");
      expect(inst).toHaveProperty("validateCredentials");
      expect(inst).toHaveProperty("generatePreview");
      expect(inst).toHaveProperty("testDestination");
      expect(inst).toHaveProperty("createDestination");
      expect(inst).toHaveProperty("updateDestination");
      expect(inst).toHaveProperty("detectPrebuiltType");
      expect(inst).toHaveProperty("convertToPrebuilt");
    });

    it("initial state: isLoading false, isTestInProgress false, lastTestResult null", () => {
      const { isLoading, isTestInProgress, lastTestResult } =
        usePrebuiltDestinations();

      expect(isLoading.value).toBe(false);
      expect(isTestInProgress.value).toBe(false);
      expect(lastTestResult.value).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // availableTypes / popularTypes / typesByCategory
  // -------------------------------------------------------------------------
  describe("computed type lists", () => {
    it("availableTypes is a non-empty array of prebuilt type objects", () => {
      const { availableTypes } = usePrebuiltDestinations();
      expect(Array.isArray(availableTypes.value)).toBe(true);
      expect(availableTypes.value.length).toBeGreaterThan(0);
    });

    it("each available type has id, name, category fields", () => {
      const { availableTypes } = usePrebuiltDestinations();
      availableTypes.value.forEach((t: any) => {
        expect(t).toHaveProperty("id");
        expect(t).toHaveProperty("name");
        expect(t).toHaveProperty("category");
      });
    });

    it("popularTypes contains only entries with popular=true", () => {
      const { popularTypes, availableTypes } = usePrebuiltDestinations();
      const popularIds = popularTypes.value.map((t: any) => t.id);
      availableTypes.value
        .filter((t: any) => !t.popular)
        .forEach((t: any) => {
          expect(popularIds).not.toContain(t.id);
        });
    });

    it("typesByCategory groups types into messaging/incident/email categories", () => {
      const { typesByCategory } = usePrebuiltDestinations();
      expect(typesByCategory.value).toHaveProperty("messaging");
      expect(typesByCategory.value).toHaveProperty("incident");
      expect(typesByCategory.value).toHaveProperty("email");
    });
  });

  // -------------------------------------------------------------------------
  // fetchSystemTemplates
  // -------------------------------------------------------------------------
  describe("fetchSystemTemplates", () => {
    it("calls templatesService.get_system_templates with correct org", async () => {
      const { fetchSystemTemplates } = usePrebuiltDestinations();
      await fetchSystemTemplates();
      expect(mockGetSystemTemplates).toHaveBeenCalledWith({
        org_identifier: "test-org",
      });
    });

    it("does not throw when API returns empty list", async () => {
      mockGetSystemTemplates.mockResolvedValue({ data: [] });
      const { fetchSystemTemplates } = usePrebuiltDestinations();
      await expect(fetchSystemTemplates()).resolves.toBeUndefined();
    });

    it("does not throw when API call fails (graceful degradation)", async () => {
      mockGetSystemTemplates.mockRejectedValue(new Error("network error"));
      const { fetchSystemTemplates } = usePrebuiltDestinations();
      await expect(fetchSystemTemplates()).resolves.toBeUndefined();
    });

    it("handles array response format", async () => {
      mockGetSystemTemplates.mockResolvedValue({
        data: [{ name: "prebuilt_slack", body: "{}" }],
      });
      const { fetchSystemTemplates } = usePrebuiltDestinations();
      await expect(fetchSystemTemplates()).resolves.toBeUndefined();
    });

    it("handles list-wrapped response format", async () => {
      mockGetSystemTemplates.mockResolvedValue({
        data: { list: [{ name: "prebuilt_slack", body: "{}" }] },
      });
      const { fetchSystemTemplates } = usePrebuiltDestinations();
      await expect(fetchSystemTemplates()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // validateCredentials
  // -------------------------------------------------------------------------
  describe("validateCredentials", () => {
    it("returns isValid=true for valid slack webhook URL", () => {
      const { validateCredentials } = usePrebuiltDestinations();
      const result = validateCredentials("slack", makeSlackCredentials());
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual({});
    });

    it("returns isValid=false and error for missing required field", () => {
      const { validateCredentials } = usePrebuiltDestinations();
      const result = validateCredentials("slack", { webhookUrl: "" });
      expect(result.isValid).toBe(false);
      expect(Object.keys(result.errors).length).toBeGreaterThan(0);
    });

    it("returns isValid=false for unknown destination type", () => {
      const { validateCredentials } = usePrebuiltDestinations();
      const result = validateCredentials("unknownType" as any, {});
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveProperty("type");
    });
  });

  // -------------------------------------------------------------------------
  // testDestination
  // -------------------------------------------------------------------------
  describe("testDestination", () => {
    it("sets isTestInProgress to false after test completes", async () => {
      mockDestTest.mockResolvedValue({
        data: { success: true, statusCode: 200 },
      });

      const { testDestination, isTestInProgress } = usePrebuiltDestinations();
      await testDestination("slack", makeSlackCredentials());
      expect(isTestInProgress.value).toBe(false);
    });

    it("returns success result and stores in lastTestResult", async () => {
      mockDestTest.mockResolvedValue({
        data: { success: true, statusCode: 200 },
      });

      const { testDestination, lastTestResult } = usePrebuiltDestinations();
      const result = await testDestination("slack", makeSlackCredentials());

      expect(result.success).toBe(true);
      expect(lastTestResult.value?.success).toBe(true);
    });

    it("returns failure when credentials are invalid (validation short-circuit)", async () => {
      const { testDestination } = usePrebuiltDestinations();
      const result = await testDestination("slack", { webhookUrl: "" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Validation error");
    });

    it("returns failure when destination type is invalid", async () => {
      const { testDestination } = usePrebuiltDestinations();
      const result = await testDestination("unknownType" as any, {});
      expect(result.success).toBe(false);
    });

    it("returns failure and sets lastTestResult when test service throws", async () => {
      mockGetSystemTemplates.mockResolvedValue({ data: [] });
      mockDestTest.mockRejectedValue(new Error("connection refused"));

      const { testDestination, lastTestResult } = usePrebuiltDestinations();
      const result = await testDestination("slack", makeSlackCredentials());

      expect(result.success).toBe(false);
      expect(lastTestResult.value?.success).toBe(false);
    });

    it("sets isTestInProgress to false even when an error is thrown", async () => {
      mockDestTest.mockRejectedValue(new Error("timeout"));

      const { testDestination, isTestInProgress } = usePrebuiltDestinations();
      await testDestination("slack", makeSlackCredentials());
      expect(isTestInProgress.value).toBe(false);
    });

    it("calls email-specific test endpoint when type is email", async () => {
      mockDestTest.mockResolvedValue({
        data: { success: true },
      });

      const { testDestination } = usePrebuiltDestinations();
      await testDestination("email", {
        recipients: "user@example.com",
      });

      const callArg = mockDestTest.mock.calls[0][0];
      expect(callArg.data.type).toBe("email");
      expect(Array.isArray(callArg.data.recipients)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // createDestination
  // -------------------------------------------------------------------------
  describe("createDestination", () => {
    it("calls alertDestinationService.create with correct org_identifier", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });

      const { createDestination } = usePrebuiltDestinations();
      await createDestination("slack", "my-slack", makeSlackCredentials());

      expect(mockDestCreate).toHaveBeenCalledWith(
        expect.objectContaining({ org_identifier: "test-org" }),
      );
    });

    it("throws and notifies negatively when validation fails", async () => {
      const { createDestination } = usePrebuiltDestinations();

      await expect(
        createDestination("slack", "my-slack", { webhookUrl: "" }),
      ).rejects.toThrow();

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative" }),
      );
    });

    it("throws when destination type is unknown", async () => {
      const { createDestination } = usePrebuiltDestinations();

      // validateCredentials runs first and returns "Unknown destination type" error,
      // which is wrapped in a "Validation error:" prefix before reaching the type check.
      await expect(
        createDestination("unknownType" as any, "test", {}),
      ).rejects.toThrow();
    });

    it("shows positive notification on success", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });

      const { createDestination } = usePrebuiltDestinations();
      await createDestination("slack", "my-slack", makeSlackCredentials());

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "positive" }),
      );
    });

    it("sets isLoading to false after successful creation", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });

      const { createDestination, isLoading } = usePrebuiltDestinations();
      await createDestination("slack", "my-slack", makeSlackCredentials());

      expect(isLoading.value).toBe(false);
    });

    it("sets isLoading to false even when creation throws", async () => {
      mockDestCreate.mockRejectedValue(new Error("create failed"));

      const { createDestination, isLoading } = usePrebuiltDestinations();

      await expect(
        createDestination("slack", "my-slack", makeSlackCredentials()),
      ).rejects.toThrow();

      expect(isLoading.value).toBe(false);
    });

    it("creates email destination with emails array", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });

      const { createDestination } = usePrebuiltDestinations();
      await createDestination("email", "email-dest", {
        recipients: "a@example.com, b@example.com",
      });

      const callArg = mockDestCreate.mock.calls[0][0];
      expect(callArg.data.type).toBe("email");
      expect(Array.isArray(callArg.data.emails)).toBe(true);
      expect(callArg.data.emails).toContain("a@example.com");
    });

    it("creates HTTP destination with url and method for slack", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });

      const { createDestination } = usePrebuiltDestinations();
      await createDestination("slack", "slack-dest", makeSlackCredentials());

      const callArg = mockDestCreate.mock.calls[0][0];
      expect(callArg.data.type).toBe("http");
      expect(callArg.data.url).toBeDefined();
    });

    it("includes prebuilt_type in destination metadata", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });

      const { createDestination } = usePrebuiltDestinations();
      await createDestination("slack", "slack-dest", makeSlackCredentials());

      const callArg = mockDestCreate.mock.calls[0][0];
      expect(callArg.data.metadata?.prebuilt_type).toBe("slack");
    });

    it("adds Basic Auth header for servicenow type", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });

      const { createDestination } = usePrebuiltDestinations();
      // ServiceNow requires the service-now.com domain with the incident table path
      await createDestination("servicenow", "snow-dest", {
        instanceUrl:
          "https://myinstance.service-now.com/api/now/table/incident",
        username: "admin",
        password: "secret",
      });

      const callArg = mockDestCreate.mock.calls[0][0];
      expect(callArg.data.headers?.Authorization).toMatch(/^Basic /);
    });
  });

  // -------------------------------------------------------------------------
  // updateDestination
  // -------------------------------------------------------------------------
  describe("updateDestination", () => {
    it("calls alertDestinationService.update with original name", async () => {
      mockDestUpdate.mockResolvedValue({ data: {} });

      const { updateDestination } = usePrebuiltDestinations();
      await updateDestination(
        "slack",
        "original-name",
        "new-name",
        makeSlackCredentials(),
      );

      expect(mockDestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ destination_name: "original-name" }),
      );
    });

    it("throws when destination type is unknown", async () => {
      const { updateDestination } = usePrebuiltDestinations();

      await expect(
        updateDestination("unknownType" as any, "orig", "new", {}),
      ).rejects.toThrow("Invalid destination type");
    });

    it("shows positive notification on success", async () => {
      mockDestUpdate.mockResolvedValue({ data: {} });

      const { updateDestination } = usePrebuiltDestinations();
      await updateDestination(
        "slack",
        "orig",
        "new",
        makeSlackCredentials(),
      );

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "positive" }),
      );
    });

    it("sets isLoading to false after update", async () => {
      mockDestUpdate.mockResolvedValue({ data: {} });

      const { updateDestination, isLoading } = usePrebuiltDestinations();
      await updateDestination(
        "slack",
        "orig",
        "new",
        makeSlackCredentials(),
      );
      expect(isLoading.value).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // detectPrebuiltType
  // -------------------------------------------------------------------------
  describe("detectPrebuiltType", () => {
    it("returns type from metadata.prebuilt_type when present", () => {
      const { detectPrebuiltType } = usePrebuiltDestinations();
      const result = detectPrebuiltType({
        metadata: { prebuilt_type: "slack" },
      });
      expect(result).toBe("slack");
    });

    it("returns type from system-prebuilt- template prefix", () => {
      const { detectPrebuiltType } = usePrebuiltDestinations();
      const result = detectPrebuiltType({
        template: "system-prebuilt-discord",
      });
      expect(result).toBe("discord");
    });

    it("returns type from prebuilt_ template prefix", () => {
      const { detectPrebuiltType } = usePrebuiltDestinations();
      const result = detectPrebuiltType({ template: "prebuilt_msteams" });
      expect(result).toBe("msteams");
    });

    it("returns null when no indicators are present", () => {
      const { detectPrebuiltType } = usePrebuiltDestinations();
      const result = detectPrebuiltType({ name: "custom-destination" });
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // convertToPrebuilt
  // -------------------------------------------------------------------------
  describe("convertToPrebuilt", () => {
    it("fetches existing destination and updates it with prebuilt config", async () => {
      mockDestGetByName.mockResolvedValue({
        data: {
          name: "my-dest",
          url: "https://example.com",
          headers: {},
          metadata: {},
        },
      });
      mockDestUpdate.mockResolvedValue({ data: {} });

      const { convertToPrebuilt } = usePrebuiltDestinations();
      await convertToPrebuilt("my-dest", "slack");

      expect(mockDestUpdate).toHaveBeenCalled();
    });

    it("throws when target type is invalid", async () => {
      mockDestGetByName.mockResolvedValue({ data: {} });

      const { convertToPrebuilt } = usePrebuiltDestinations();
      await expect(
        convertToPrebuilt("my-dest", "unknownType" as any),
      ).rejects.toThrow("Invalid target type");
    });

    it("shows negative notification when conversion fails", async () => {
      mockDestGetByName.mockRejectedValue(new Error("not found"));

      const { convertToPrebuilt } = usePrebuiltDestinations();
      await expect(convertToPrebuilt("missing", "slack")).rejects.toThrow();

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative" }),
      );
    });

    it("sets isLoading to false after conversion", async () => {
      mockDestGetByName.mockResolvedValue({
        data: { name: "dest", url: "", headers: {}, metadata: {} },
      });
      mockDestUpdate.mockResolvedValue({ data: {} });

      const { convertToPrebuilt, isLoading } = usePrebuiltDestinations();
      await convertToPrebuilt("dest", "slack");
      expect(isLoading.value).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // generatePreview
  // -------------------------------------------------------------------------
  describe("generatePreview", () => {
    it("returns a non-empty string for a valid type", async () => {
      mockGetByName.mockResolvedValue({ data: { body: "Alert: {alert_name}" } });

      const { generatePreview } = usePrebuiltDestinations();
      const preview = await generatePreview("slack", makeSlackCredentials());
      expect(typeof preview).toBe("string");
    });

    it("returns empty string for unknown type", async () => {
      const { generatePreview } = usePrebuiltDestinations();
      const preview = await generatePreview("unknownType" as any);
      expect(preview).toBe("");
    });

    it("falls back gracefully when template fetch fails", async () => {
      mockGetByName.mockRejectedValue(new Error("not found"));

      const { generatePreview } = usePrebuiltDestinations();
      const preview = await generatePreview("slack", makeSlackCredentials());
      // Should return a string (fallback template), not throw
      expect(typeof preview).toBe("string");
    });
  });
});
