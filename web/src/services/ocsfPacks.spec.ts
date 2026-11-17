// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

import ocsfPacks from "@/services/ocsfPacks";
import http from "@/services/http";
import jstransform from "@/services/jstransform";
import streamService from "@/services/stream";

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() })),
}));
vi.mock("@/services/jstransform", () => ({
  default: {
    test: vi.fn(),
  },
}));
vi.mock("@/services/stream", () => ({ default: { updateSettings: vi.fn() } }));

describe("ocsfPacks service", () => {
  let instance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    instance = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
    (http as any).mockReturnValue(instance);
  });

  it("listPacks hits the Phase 1 endpoint and returns the typed body", async () => {
    const body = { ocsf_version: "1.6.0", packs: [{ id: "entity", version: 1 }] };
    instance.get.mockResolvedValue({ data: body });
    const res = await ocsfPacks.listPacks("org1");
    expect(instance.get).toHaveBeenCalledWith("/api/org1/security/ocsf/packs");
    expect(res).toEqual(body);
  });

  it("delegates the pack preview to the shared jstransform service", () => {
    ocsfPacks.preview("org1", ".x = 1", [{ a: 1 }]);
    expect(jstransform.test).toHaveBeenCalledWith("org1", {
      function: ".x = 1",
      events: [{ a: 1 }],
      trans_type: 0,
    });
  });

  it("saveSetting wraps the setting under the security key via the stream settings service", () => {
    const setting = {
      source_type: "entity",
      pack_id: "entity",
      pack_version: 1,
      attached_at: 1,
      pipeline_id: "p1",
      pipeline_created: true,
      included: true,
    };
    ocsfPacks.saveSetting("org1", "web", setting);
    expect(streamService.updateSettings).toHaveBeenCalledWith("org1", "web", "logs", {
      security: setting,
    });
  });
});
