// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

import ocsfPacks from "@/services/ocsfPacks";
import streamService from "@/services/stream";
import { runSql } from "@/composables/security/useSecurityStreamPlans";
import { useSecuritySources } from "@/composables/security/useSecuritySources";
import { isLocalPrefsMigrated } from "@/utils/security/sourceSelection";

vi.mock("@/services/ocsfPacks", () => ({ default: { saveSetting: vi.fn() } }));
vi.mock("@/services/stream", () => ({ default: { nameList: vi.fn(), schema: vi.fn() } }));
vi.mock("@/composables/security/useSecurityStreamPlans", () => ({ runSql: vi.fn() }));

const svc = ocsfPacks as unknown as Record<string, ReturnType<typeof vi.fn>>;
const streamMock = streamService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const security = (over: Record<string, unknown> = {}) => ({
  source_type: "entity",
  pack_id: "entity",
  pack_version: 1,
  attached_at: 0,
  pipeline_id: "p1",
  pipeline_created: true,
  included: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  streamMock.schema.mockResolvedValue({ data: { schema: [] } });
  vi.mocked(runSql).mockResolvedValue({ hits: [], partial: false, functionError: "" });
  svc.saveSetting.mockResolvedValue({ data: {} });
});

describe("sourceNames honours the setting's include flag (F11)", () => {
  it("drops a mapped stream the user excluded", async () => {
    streamMock.nameList.mockResolvedValue({
      data: {
        list: [
          { name: "mapped-inc", settings: { security: security({ included: true }) } },
          { name: "mapped-excl", settings: { security: security({ included: false }) } },
        ],
      },
    });
    const sources = useSecuritySources();
    await sources.load("org1");
    expect(sources.sourceNames.value).toContain("mapped-inc");
    expect(sources.sourceNames.value).not.toContain("mapped-excl");
  });
});

describe("migrateIncludes (R15 / F6)", () => {
  it("skips a stale stream name and still marks the migration done", async () => {
    localStorage.setItem(
      "oo_sec_sources_org1",
      JSON.stringify({ include: ["real", "ghost"], exclude: [], dismissed: [], classified: {} }),
    );
    streamMock.nameList.mockResolvedValue({ data: { list: [{ name: "real" }] } });
    const sources = useSecuritySources();
    await sources.load("org1");
    await sources.migrateIncludes(true);

    expect(svc.saveSetting).toHaveBeenCalledTimes(1);
    expect(svc.saveSetting.mock.calls[0][1]).toBe("real");
    expect(isLocalPrefsMigrated("org1")).toBe(true);
  });

  it("continues past a per-entry 4xx failure", async () => {
    localStorage.setItem(
      "oo_sec_sources_org1",
      JSON.stringify({ include: ["a", "b"], exclude: [], dismissed: [], classified: {} }),
    );
    streamMock.nameList.mockResolvedValue({ data: { list: [{ name: "a" }, { name: "b" }] } });
    svc.saveSetting
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({ data: {} });
    const sources = useSecuritySources();
    await sources.load("org1");
    await sources.migrateIncludes(true);

    expect(svc.saveSetting).toHaveBeenCalledTimes(2);
    expect(isLocalPrefsMigrated("org1")).toBe(true);
  });

  it("does not mark migrated when the stream list failed to load (F6)", async () => {
    localStorage.setItem(
      "oo_sec_sources_org1",
      JSON.stringify({ include: ["real"], exclude: [], dismissed: [], classified: {} }),
    );
    streamMock.nameList.mockRejectedValue({ response: { status: 500 } });
    const sources = useSecuritySources();
    await sources.load("org1");
    await sources.migrateIncludes(true);

    expect(svc.saveSetting).not.toHaveBeenCalled();
    expect(isLocalPrefsMigrated("org1")).toBe(false);
  });

  it("aborts without marking done on a transient 5xx (F6)", async () => {
    localStorage.setItem(
      "oo_sec_sources_org1",
      JSON.stringify({ include: ["a", "b"], exclude: [], dismissed: [], classified: {} }),
    );
    streamMock.nameList.mockResolvedValue({ data: { list: [{ name: "a" }, { name: "b" }] } });
    svc.saveSetting.mockRejectedValue({ response: { status: 503 } });
    const sources = useSecuritySources();
    await sources.load("org1");
    await sources.migrateIncludes(true);

    expect(isLocalPrefsMigrated("org1")).toBe(false);
  });

  it("aborts without marking done on a 403", async () => {
    localStorage.setItem(
      "oo_sec_sources_org1",
      JSON.stringify({ include: ["a", "b"], exclude: [], dismissed: [], classified: {} }),
    );
    streamMock.nameList.mockResolvedValue({ data: { list: [{ name: "a" }, { name: "b" }] } });
    svc.saveSetting.mockRejectedValue({ response: { status: 403 } });
    const sources = useSecuritySources();
    await sources.load("org1");
    await sources.migrateIncludes(true);

    expect(isLocalPrefsMigrated("org1")).toBe(false);
  });

  it("does nothing for a user without write permission", async () => {
    localStorage.setItem(
      "oo_sec_sources_org1",
      JSON.stringify({ include: ["a"], exclude: [], dismissed: [], classified: {} }),
    );
    streamMock.nameList.mockResolvedValue({ data: { list: [{ name: "a" }] } });
    const sources = useSecuritySources();
    await sources.load("org1");
    await sources.migrateIncludes(false);

    expect(svc.saveSetting).not.toHaveBeenCalled();
    expect(isLocalPrefsMigrated("org1")).toBe(false);
  });
});
