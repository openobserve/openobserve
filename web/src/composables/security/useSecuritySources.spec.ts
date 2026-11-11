// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";

import ocsfPacks from "@/services/ocsfPacks";
import securitySources from "@/services/securitySources";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import { sourceRow } from "@/views/Security/__fixtures__/securityFixtures";
import { useSecuritySources } from "@/composables/security/useSecuritySources";
import { isLocalPrefsMigrated, saveSourcePrefs } from "@/utils/security/sourcePrefs";

vi.mock("@/services/ocsfPacks", () => ({ default: { saveSetting: vi.fn() } }));
vi.mock("@/services/securitySources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/securitySources")>()),
  default: { list: vi.fn(), classify: vi.fn() },
}));
const access = vi.fn();
vi.mock("@/composables/security/useSecurityAccess", () => ({
  loadSecurityAccess: (...a: unknown[]) => access(...a),
}));

const api = securitySources as unknown as Record<string, ReturnType<typeof vi.fn>>;
const save = vi.mocked(ocsfPacks.saveSetting);

const mapped = {
  source_type: "aws_cloudtrail",
  pack_id: "aws_cloudtrail",
  pack_version: 1,
  attached_at: 1,
  pipeline_id: "p1",
  pipeline_created: true,
  included: null,
};

const listing = () => {
  const rows = [{ ...sourceRow("ct"), setting: mapped }, sourceRow("okta")];
  return {
    data: { streams: rows, sources: rows.map((r) => r.name), suggestions: [], notices: [] },
  };
};

function setup() {
  let sources!: ReturnType<typeof useSecuritySources>;
  mount(
    defineComponent({
      setup() {
        sources = useSecuritySources();
        return () => h("div");
      },
    }),
    { global: { plugins: [withQueryClient()] } },
  );
  return sources;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.list.mockResolvedValue(listing());
  api.classify.mockResolvedValue({ data: { classified: [] } });
  save.mockResolvedValue({ data: {} } as never);
  access.mockResolvedValue({ read: true, triage: false, admin: false });
});

describe("useSecuritySources", () => {
  it("reads the source list from the server", async () => {
    const sources = setup();
    await sources.load("org-read");
    expect(sources.sourceNames.value).toEqual(["ct", "okta"]);
    expect(sources.rows.value.map((r) => r.health)).toEqual(["live", "live"]);
  });

  it("has the server classify only for a user who may store verdicts", async () => {
    const reader = setup();
    await reader.load("org-a");
    await flushPromises();
    expect(api.classify).not.toHaveBeenCalled();

    access.mockResolvedValue({ read: true, triage: true, author: false, admin: false });
    const triager = setup();
    await triager.load("org-b");
    await flushPromises();
    expect(api.classify).not.toHaveBeenCalled();

    access.mockResolvedValue({ read: true, triage: false, author: true, admin: false });
    const author = setup();
    await author.load("org-d");
    await flushPromises();
    expect(api.classify).toHaveBeenCalledWith("org-d", []);
  });

  it("writes an include on top of the stored setting, keeping the pack", async () => {
    const sources = setup();
    await sources.load("org-c");
    await sources.exclude("ct");
    expect(save).toHaveBeenCalledWith("org-c", "ct", { ...mapped, included: false });
    await sources.include("okta");
    expect(save).toHaveBeenLastCalledWith(
      "org-c",
      "okta",
      expect.objectContaining({ pack_id: "", included: true }),
    );
  });

  it("hides dismissed suggestions", async () => {
    api.list.mockResolvedValue({
      data: {
        streams: [sourceRow("a"), sourceRow("b")],
        sources: [],
        suggestions: ["b", "a"],
        notices: [],
      },
    });
    const sources = setup();
    await sources.load("org-d");
    expect(sources.suggestions.value.map((r) => r.name)).toEqual(["b", "a"]);
    sources.dismiss("b");
    expect(sources.suggestions.value.map((r) => r.name)).toEqual(["a"]);
  });
});

describe("migrateIncludes", () => {
  it("moves local choices once, skipping streams the list does not contain", async () => {
    saveSourcePrefs("org-m", { include: ["okta", "gone"], exclude: [], dismissed: [] });
    const sources = setup();
    await sources.load("org-m");
    await sources.migrateIncludes(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("org-m", "okta", expect.objectContaining({ included: true }));
    expect(isLocalPrefsMigrated("org-m")).toBe(true);
  });

  it("aborts without marking done on a transient failure", async () => {
    saveSourcePrefs("org-n", { include: ["okta"], exclude: [], dismissed: [] });
    save.mockRejectedValue({ response: { status: 503 } });
    const sources = setup();
    await sources.load("org-n");
    await sources.migrateIncludes(true);
    expect(isLocalPrefsMigrated("org-n")).toBe(false);
  });

  it("does nothing for a user without write permission", async () => {
    saveSourcePrefs("org-o", { include: ["okta"], exclude: [], dismissed: [] });
    const sources = setup();
    await sources.load("org-o");
    await sources.migrateIncludes(false);
    expect(save).not.toHaveBeenCalled();
  });
});
