// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import config from "@/aws-exports";
import securityService from "@/services/security";
import { queryClient } from "@/composables/query/queryClient";
import {
  forbiddenReason,
  canManageRoles,
  isForbiddenError,
  loadSecurityAccess,
  securityFeatureState,
  securityPresetFor,
  useSecurityAccess,
} from "@/composables/security/useSecurityAccess";
import { viewDenial } from "@/composables/useAccessStore";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/services/security", () => ({ default: { getAccess: vi.fn() } }));

const getAccess = securityService.getAccess as unknown as ReturnType<typeof vi.fn>;

const answer = (read: boolean, triage = false, admin = false, author = false) =>
  getAccess.mockResolvedValue({ data: { read, triage, author, admin } });

const mountAccess = (zoConfig: Record<string, unknown> = {}) => {
  let access!: ReturnType<typeof useSecurityAccess>;
  const store = createStore({
    state: { selectedOrganization: { identifier: "acme" }, zoConfig },
  });
  mount(
    defineComponent({
      setup() {
        access = useSecurityAccess();
        return () => h("div");
      },
    }),
    { global: { plugins: [store] } },
  );
  return access;
};

beforeEach(() => {
  config.isEnterprise = "true";
  config.isCloud = "false";
  getAccess.mockReset();
});

afterEach(() => {
  queryClient.clear();
});

describe("loadSecurityAccess", () => {
  it("denies everything on an OSS build without asking the server", async () => {
    config.isEnterprise = "false";
    expect(await loadSecurityAccess("acme")).toEqual({
      read: false,
      triage: false,
      author: false,
      admin: false,
    });
    expect(getAccess).not.toHaveBeenCalled();
  });

  it("returns the server's answer for the org", async () => {
    answer(true, true);
    expect(await loadSecurityAccess("acme")).toEqual({
      read: true,
      triage: true,
      author: false,
      admin: false,
    });
    expect(getAccess).toHaveBeenCalledWith("acme");
  });

  it("fails closed when the request fails", async () => {
    getAccess.mockRejectedValue({ response: { status: 500 } });
    expect(await loadSecurityAccess("acme")).toEqual({
      read: false,
      triage: false,
      author: false,
      admin: false,
    });
  });

  it("asks once per org", async () => {
    answer(true);
    await loadSecurityAccess("acme");
    await loadSecurityAccess("acme");
    await loadSecurityAccess("other");
    expect(getAccess).toHaveBeenCalledTimes(2);
  });
});

describe("securityFeatureState", () => {
  it("reads the license map on enterprise, with a missing key enabled", () => {
    expect(securityFeatureState({ security: "locked" })).toBe("locked");
    expect(securityFeatureState({})).toBe("enabled");
  });

  it("hides Security on OSS whatever the license map says", () => {
    config.isEnterprise = "false";
    expect(securityFeatureState({ security: "enabled" })).toBe("hidden");
  });
});

describe("useSecurityAccess", () => {
  it("stays closed and unloaded while the answer is in flight", () => {
    getAccess.mockReturnValue(new Promise(() => {}));
    const access = mountAccess();
    expect(access.loaded.value).toBe(false);
    expect(access.canEnter.value).toBe(false);
  });

  it("lets a reader in without triage, author or admin", async () => {
    answer(true);
    const access = mountAccess();
    await flushPromises();
    expect(access.loaded.value).toBe(true);
    expect(access.canEnter.value).toBe(true);
    expect(access.canTriage.value).toBe(false);
    expect(access.canAuthor.value).toBe(false);
    expect(access.canAdmin.value).toBe(false);
  });

  it("keeps triage and authoring separate", async () => {
    answer(true, true);
    const analyst = mountAccess();
    await flushPromises();
    expect(analyst.canTriage.value).toBe(true);
    expect(analyst.canAuthor.value).toBe(false);

    queryClient.clear();
    answer(true, false, false, true);
    const engineer = mountAccess();
    await flushPromises();
    expect(engineer.canTriage.value).toBe(false);
    expect(engineer.canAuthor.value).toBe(true);
    expect(engineer.canAdmin.value).toBe(false);
  });

  it("grants triage, author and admin only on top of read", async () => {
    answer(false, true, true, true);
    const access = mountAccess();
    await flushPromises();
    expect(access.canEnter.value).toBe(false);
    expect(access.canTriage.value).toBe(false);
    expect(access.canAuthor.value).toBe(false);
    expect(access.canAdmin.value).toBe(false);
  });

  it("closes authoring when the license hides Security", async () => {
    answer(true, true, true, true);
    const access = mountAccess({ features: { security: "hidden" } });
    await flushPromises();
    expect(access.canAuthor.value).toBe(false);
  });

  it("keeps a reader out when the license hides Security", async () => {
    answer(true, true, true);
    const access = mountAccess({ features: { security: "hidden" } });
    await flushPromises();
    expect(access.canEnter.value).toBe(false);
    expect(access.canOpen.value).toBe(false);
  });

  it("opens the locked upsell to a member without read", async () => {
    answer(false);
    const access = mountAccess({ features: { security: "locked" } });
    await flushPromises();
    expect(access.licenseLocked.value).toBe(true);
    expect(access.canEnter.value).toBe(false);
    expect(access.canOpen.value).toBe(true);
  });

  it("fails closed when the request fails", async () => {
    getAccess.mockRejectedValue({ response: { status: 500 } });
    const access = mountAccess();
    await flushPromises();
    expect(access.loaded.value).toBe(true);
    expect(access.canEnter.value).toBe(false);
  });

  it("is hidden on an OSS build without a request", () => {
    config.isEnterprise = "false";
    const access = mountAccess();
    expect(access.loaded.value).toBe(true);
    expect(access.canOpen.value).toBe(false);
    expect(access.canTriage.value).toBe(false);
    expect(access.canAuthor.value).toBe(false);
    expect(getAccess).not.toHaveBeenCalled();
  });
});

describe("securityPresetFor", () => {
  it.each([
    ["get", "security_viewer"],
    ["update", "soc_analyst"],
    ["create", "detection_engineer"],
    ["delete", "security_admin"],
  ] as const)("points a missing Security %s at %s", (permission, preset) => {
    expect(securityPresetFor([viewDenial("security", permission)])).toBe(preset);
  });

  it.each(["streams", "alerts", "alert_folders"])(
    "points a missing %s read at the viewer preset",
    (key) => {
      expect(securityPresetFor([viewDenial(key, "list")])).toBe("security_viewer");
    },
  );

  it("points a missing threat-intel list read at the analyst preset, which grants it", () => {
    expect(securityPresetFor([viewDenial("enrichment_tables", "list")])).toBe("soc_analyst");
  });

  it("names no preset for a denial outside Security", () => {
    expect(securityPresetFor([viewDenial("dashboards", "list")])).toBeNull();
    expect(securityPresetFor([viewDenial("streams", "delete")])).toBeNull();
  });
});

describe("forbiddenReason", () => {
  const refused = (message: unknown) => ({ response: { status: 403, data: { message } } });

  it("keeps the server's reason when it names the streams", () => {
    expect(forbiddenReason(refused(" No read permission on streams: okta_auth "))).toBe(
      "No read permission on streams: okta_auth",
    );
  });

  it("says nothing for the bare refusal or a non-403", () => {
    expect(forbiddenReason(refused("Unauthorized Access"))).toBe("");
    expect(forbiddenReason(refused(undefined))).toBe("");
    expect(forbiddenReason({ response: { status: 500, data: { message: "boom" } } })).toBe("");
    expect(forbiddenReason(null)).toBe("");
  });
});

describe("canManageRoles", () => {
  it("lets admins and root link to a preset, and no one else", () => {
    expect(canManageRoles({ currentuser: { role: "admin" } })).toBe(true);
    expect(canManageRoles({ currentuser: { role: "Root" } })).toBe(true);
    expect(canManageRoles({ currentuser: { role: "editor" } })).toBe(false);
    expect(canManageRoles({})).toBe(false);
  });
});

describe("isForbiddenError", () => {
  it("is a role refusal, not a license denial", () => {
    expect(isForbiddenError({ response: { status: 403, data: "Unauthorized Access" } })).toBe(true);
    expect(
      isForbiddenError({
        response: { status: 403, data: { code: 40001, error_detail: "security" } },
      }),
    ).toBe(false);
    expect(isForbiddenError({ response: { status: 500 } })).toBe(false);
  });
});

describe("useSecurityAccess failure", () => {
  it("reads a refusal as an answer and an unreachable server as unknown", async () => {
    getAccess.mockRejectedValue({ response: { status: 403 } });
    const refused = mountAccess();
    await flushPromises();
    expect(refused.failed.value).toBe(false);

    queryClient.clear();
    getAccess.mockRejectedValue({ response: { status: 503 } });
    const unreachable = mountAccess();
    await vi.waitFor(() => expect(unreachable.loaded.value).toBe(true), { timeout: 8000 });
    expect(unreachable.failed.value).toBe(true);
    expect(unreachable.canEnter.value).toBe(false);
  }, 10000);
});
