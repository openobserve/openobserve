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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(),
}));

// Resolve against the real en.json rather than echoing the key, so these tests
// also prove the keys exist and interpolate.
vi.mock("vue-i18n", async () => {
  const en: any = (await import("@/locales/languages/en-US.json")).default;
  return {
    useI18n: vi.fn(() => ({
      t: (key: string, named?: Record<string, unknown>) => {
        const msg = key.split(".").reduce((a: any, k) => (a == null ? a : a[k]), en);
        if (typeof msg !== "string") return key;
        return named
          ? msg.replace(/\{(\w+)\}/g, (_: string, p: string) =>
              named[p] === undefined ? `{${p}}` : String(named[p]),
            )
          : msg;
      },
    })),
  };
});

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

vi.mock("@/services/alert_templates", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_system_templates: mockGetSystemTemplates,
      get_by_name: mockGetByName,
    },
  });
});

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create: mockDestCreate,
      update: mockDestUpdate,
      test: mockDestTest,
      get_by_name: mockDestGetByName,
    },
  });
});

// The real prebuilt-templates utilities are lightweight and have no side
// effects, so we let them run. However we need to stub out the
// generateDestinationUrl / generateDestinationHeaders used inside tests.
vi.mock("@/utils/prebuilt-templates", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    generateDestinationUrl: vi.fn((type: string, credentials: Record<string, unknown>) =>
      type === "servicenow"
        ? String(credentials.instanceUrl ?? "")
        : String(credentials.webhookUrl ?? "https://generated.example.com"),
    ),
    generateDestinationHeaders: vi.fn(() => ({
      "Content-Type": "application/json",
    })),
  };
});

import { toast } from "@/lib/feedback/Toast/useToast";
import { usePrebuiltDestinations, type SlackSetupMetadata } from "./usePrebuiltDestinations";

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
    vi.mocked(toast).mockReturnValue(vi.fn());
    // Default template fetch: empty list (no cache)
    mockGetSystemTemplates.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      expect(inst).toHaveProperty("clearTestResult");
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
      const { isLoading, isTestInProgress, lastTestResult } = usePrebuiltDestinations();

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

    it("clears a stale test result on demand", async () => {
      mockDestTest.mockResolvedValue({ data: { success: true, statusCode: 200 } });
      const { testDestination, clearTestResult, lastTestResult } = usePrebuiltDestinations();

      await testDestination("slack", makeSlackCredentials());
      expect(lastTestResult.value).not.toBeNull();

      clearTestResult();
      expect(lastTestResult.value).toBeNull();
    });

    it("does not republish an in-flight result after it is cleared", async () => {
      let resolveRequest:
        ((value: { data: { success: boolean; statusCode: number } }) => void) | null = null;
      mockDestTest.mockReturnValue(
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
      );
      const { testDestination, clearTestResult, lastTestResult, isTestInProgress } =
        usePrebuiltDestinations();

      const pending = testDestination("slack", makeSlackCredentials());
      await vi.waitFor(() => expect(mockDestTest).toHaveBeenCalledTimes(1));
      clearTestResult();
      resolveRequest?.({ data: { success: true, statusCode: 200 } });
      await pending;

      expect(lastTestResult.value).toBeNull();
      expect(isTestInProgress.value).toBe(false);
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

      await expect(createDestination("slack", "my-slack", { webhookUrl: "" })).rejects.toThrow();

      expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });

    it("throws when destination type is unknown", async () => {
      const { createDestination } = usePrebuiltDestinations();

      // validateCredentials runs first and returns "Unknown destination type" error,
      // which is wrapped in a "Validation error:" prefix before reaching the type check.
      await expect(createDestination("unknownType" as any, "test", {})).rejects.toThrow();
    });

    it("shows positive notification on success", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });

      const { createDestination } = usePrebuiltDestinations();
      await createDestination("slack", "my-slack", makeSlackCredentials());

      expect(vi.mocked(toast)).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success" }),
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
        instanceUrl: "https://myinstance.service-now.com/api/now/table/incident",
        username: "admin",
        password: "secret",
      });

      const callArg = mockDestCreate.mock.calls[0][0];
      expect(callArg.data.headers?.Authorization).toMatch(/^Basic /);
    });

    it("stores typed OAuth setup metadata without duplicating the webhook", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });
      const secret = "https://hooks.slack.com/services/T000/B000/secret";

      const { createDestination } = usePrebuiltDestinations();
      const untrustedSetupMetadata = {
        setup_method: "oauth" as const,
        slack_team_id: "T000",
        slack_team_name: "Acme",
        slack_channel_id: "B000",
        prebuilt_type: "attacker-controlled",
        credential_webhookUrl: secret,
        arbitrary: "must-not-persist",
      };
      await createDestination(
        "slack",
        "slack-dest",
        { webhookUrl: secret, channel: "" },
        {},
        false,
        undefined,
        untrustedSetupMetadata,
      );

      const data = mockDestCreate.mock.calls[0][0].data;
      expect(data.url).toBe(secret);
      expect(data.metadata).toEqual({
        prebuilt_type: "slack",
        setup_method: "oauth",
        slack_team_id: "T000",
        slack_team_name: "Acme",
        slack_channel_id: "B000",
      });
      expect(JSON.stringify(data.metadata)).not.toContain(secret);
      expect(data.metadata).not.toHaveProperty("credential_webhookUrl");
      expect(data.metadata).not.toHaveProperty("credential_channel");
      expect(data.metadata).not.toHaveProperty("arbitrary");
      expect(JSON.stringify(data).split(secret)).toHaveLength(2);
    });

    it("stores allowlisted manifest metadata without duplicating the webhook", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });
      const secret = "https://hooks.slack.com/services/T000/B000/secret";

      const { createDestination } = usePrebuiltDestinations();
      await createDestination(
        "slack",
        "slack-dest",
        { webhookUrl: secret, channel: "#operations" },
        {},
        false,
        undefined,
        {
          setup_method: "manifest",
          slack_app_name: "  Operations Alerts  ",
          arbitrary: "must-not-persist",
        } as SlackSetupMetadata & { arbitrary: string },
      );

      const data = mockDestCreate.mock.calls[0][0].data;
      expect(data.metadata).toEqual({
        prebuilt_type: "slack",
        credential_channel: "#operations",
        setup_method: "manifest",
        slack_app_name: "Operations Alerts",
      });
      expect(JSON.stringify(data.metadata)).not.toContain(secret);
      expect(data.metadata).not.toHaveProperty("arbitrary");
      expect(JSON.stringify(data).split(secret)).toHaveLength(2);
    });

    it("persists an explicitly entered Slack channel", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });

      const { createDestination } = usePrebuiltDestinations();
      await createDestination(
        "slack",
        "slack-dest",
        { ...makeSlackCredentials(), channel: "#operations" },
        {},
        false,
        undefined,
        { setup_method: "webhook" },
      );

      const metadata = mockDestCreate.mock.calls[0][0].data.metadata;
      expect(metadata.credential_channel).toBe("#operations");
      expect(metadata).not.toHaveProperty("credential_webhookUrl");
      expect(metadata).not.toHaveProperty("slack_team_id");
    });

    it("does not flatten Discord or Teams webhook credentials", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });
      const { createDestination } = usePrebuiltDestinations();

      await createDestination("discord", "discord-dest", {
        webhookUrl: "https://discord.com/api/webhooks/123/secret",
        username: "OpenObserve",
      });
      await createDestination("msteams", "teams-dest", {
        webhookUrl: "https://outlook.office.com/webhook/test",
      });

      const discordMetadata = mockDestCreate.mock.calls[0][0].data.metadata;
      const teamsMetadata = mockDestCreate.mock.calls[1][0].data.metadata;
      expect(discordMetadata.credential_username).toBe("OpenObserve");
      expect(discordMetadata).not.toHaveProperty("credential_webhookUrl");
      expect(teamsMetadata).not.toHaveProperty("credential_webhookUrl");
    });

    it("persists meaningful false toggles and omits empty allowlisted text", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });
      const { createDestination } = usePrebuiltDestinations();

      await createDestination("opsgenie", "opsgenie-dest", {
        apiKey: "x".repeat(40),
        euRegion: false,
        priority: "",
      });

      const metadata = mockDestCreate.mock.calls[0][0].data.metadata;
      expect(metadata.credential_euRegion).toBe("false");
      expect(metadata).not.toHaveProperty("credential_priority");
      expect(metadata).not.toHaveProperty("credential_apiKey");
    });

    it("does not duplicate ServiceNow username outside the Authorization header", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });
      const { createDestination } = usePrebuiltDestinations();

      await createDestination("servicenow", "snow-dest", {
        instanceUrl: "https://myinstance.service-now.com/api/now/table/incident",
        username: "admin",
        password: "secret",
        assignmentGroup: "Platform",
      });

      const metadata = mockDestCreate.mock.calls[0][0].data.metadata;
      expect(metadata.credential_assignmentGroup).toBe("Platform");
      expect(metadata).not.toHaveProperty("credential_username");
      expect(metadata).not.toHaveProperty("credential_password");
      expect(metadata).not.toHaveProperty("credential_instanceUrl");
    });

    it("keeps PagerDuty substitutions separate from generic credential metadata", async () => {
      mockDestCreate.mockResolvedValue({ data: {} });
      const { createDestination } = usePrebuiltDestinations();

      await createDestination("pagerduty", "pagerduty-dest", {
        integrationKey: "x".repeat(32),
        severity: "critical",
      });

      const metadata = mockDestCreate.mock.calls[0][0].data.metadata;
      expect(metadata.routing_key).toBe("x".repeat(32));
      expect(metadata.severity).toBe("critical");
      expect(metadata).not.toHaveProperty("credential_integrationKey");
      expect(metadata).not.toHaveProperty("credential_severity");
    });

    it("does not log an Axios error object containing the webhook on failure", async () => {
      const secret = "https://hooks.slack.com/services/T000/B000/private";
      const error = Object.assign(new Error("create failed"), {
        config: { data: JSON.stringify({ url: secret }) },
        response: { data: { message: "create failed" } },
      });
      mockDestCreate.mockRejectedValue(error);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const { createDestination } = usePrebuiltDestinations();
      await expect(
        createDestination("slack", "slack-dest", { webhookUrl: secret }),
      ).rejects.toThrow("create failed");

      const logged = consoleError.mock.calls
        .flat()
        .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
        .join(" ");
      expect(consoleError.mock.calls.flat()).not.toContain(error);
      expect(logged).not.toContain(secret);
      consoleError.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // updateDestination
  // -------------------------------------------------------------------------
  describe("updateDestination", () => {
    it("calls alertDestinationService.update with original name", async () => {
      mockDestUpdate.mockResolvedValue({ data: {} });

      const { updateDestination } = usePrebuiltDestinations();
      await updateDestination("slack", "original-name", "new-name", makeSlackCredentials());

      expect(mockDestUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ destination_name: "original-name" }),
      );
    });

    it("throws when destination type is unknown", async () => {
      const { updateDestination } = usePrebuiltDestinations();

      await expect(updateDestination("unknownType" as any, "orig", "new", {})).rejects.toThrow(
        "Invalid destination type",
      );
    });

    it("shows positive notification on success", async () => {
      mockDestUpdate.mockResolvedValue({ data: {} });

      const { updateDestination } = usePrebuiltDestinations();
      await updateDestination("slack", "orig", "new", makeSlackCredentials());

      expect(vi.mocked(toast)).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success" }),
      );
    });

    it("sets isLoading to false after update", async () => {
      mockDestUpdate.mockResolvedValue({ data: {} });

      const { updateDestination, isLoading } = usePrebuiltDestinations();
      await updateDestination("slack", "orig", "new", makeSlackCredentials());
      expect(isLoading.value).toBe(false);
    });

    it("preserves OAuth setup metadata without flattening the webhook", async () => {
      mockDestUpdate.mockResolvedValue({ data: {} });
      const secret = "https://hooks.slack.com/services/T000/B000/secret";

      const { updateDestination } = usePrebuiltDestinations();
      const untrustedSetupMetadata = {
        setup_method: "oauth" as const,
        slack_team_id: "T000",
        slack_team_name: "Acme",
        slack_channel_id: "B000",
        prebuilt_type: "attacker-controlled",
        credential_webhookUrl: secret,
        arbitrary: "must-not-persist",
      };
      await updateDestination(
        "slack",
        "original",
        "renamed",
        { webhookUrl: secret, channel: "#alerts" },
        {},
        false,
        undefined,
        untrustedSetupMetadata,
      );

      const data = mockDestUpdate.mock.calls[0][0].data;
      expect(data.metadata).toEqual({
        prebuilt_type: "slack",
        credential_channel: "#alerts",
        setup_method: "oauth",
        slack_team_id: "T000",
        slack_team_name: "Acme",
        slack_channel_id: "B000",
      });
      expect(JSON.stringify(data.metadata)).not.toContain(secret);
      expect(data.metadata).not.toHaveProperty("credential_webhookUrl");
      expect(data.metadata).not.toHaveProperty("arbitrary");
      expect(JSON.stringify(data).split(secret)).toHaveLength(2);
    });

    it("preserves allowlisted manifest metadata without flattening the webhook", async () => {
      mockDestUpdate.mockResolvedValue({ data: {} });
      const secret = "https://hooks.slack.com/services/T000/B000/secret";

      const { updateDestination } = usePrebuiltDestinations();
      await updateDestination(
        "slack",
        "original",
        "renamed",
        { webhookUrl: secret, channel: "#alerts" },
        {},
        false,
        undefined,
        {
          setup_method: "manifest",
          slack_app_name: "  Operations Alerts  ",
          arbitrary: "must-not-persist",
        } as SlackSetupMetadata & { arbitrary: string },
      );

      const data = mockDestUpdate.mock.calls[0][0].data;
      expect(data.metadata).toEqual({
        prebuilt_type: "slack",
        credential_channel: "#alerts",
        setup_method: "manifest",
        slack_app_name: "Operations Alerts",
      });
      expect(JSON.stringify(data.metadata)).not.toContain(secret);
      expect(data.metadata).not.toHaveProperty("arbitrary");
      expect(JSON.stringify(data).split(secret)).toHaveLength(2);
    });

    it("uses the same credential allowlist when updating non-Slack destinations", async () => {
      mockDestUpdate.mockResolvedValue({ data: {} });
      const { updateDestination } = usePrebuiltDestinations();
      const secret = "https://discord.com/api/webhooks/123/private";

      await updateDestination("discord", "original", "renamed", {
        webhookUrl: secret,
        username: "OpenObserve",
      });

      const data = mockDestUpdate.mock.calls[0][0].data;
      expect(data.url).toBe(secret);
      expect(data.metadata.credential_username).toBe("OpenObserve");
      expect(data.metadata).not.toHaveProperty("credential_webhookUrl");
      expect(JSON.stringify(data.metadata)).not.toContain(secret);
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
      await expect(convertToPrebuilt("my-dest", "unknownType" as any)).rejects.toThrow(
        "Invalid target type",
      );
    });

    it("shows negative notification when conversion fails", async () => {
      mockDestGetByName.mockRejectedValue(new Error("not found"));

      const { convertToPrebuilt } = usePrebuiltDestinations();
      await expect(convertToPrebuilt("missing", "slack")).rejects.toThrow();

      expect(vi.mocked(toast)).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
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
