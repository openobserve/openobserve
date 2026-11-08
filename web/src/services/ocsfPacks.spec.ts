// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

import ocsfPacks from "@/services/ocsfPacks";
import http from "@/services/http";
import jstransform from "@/services/jstransform";
import pipelines from "@/services/pipelines";
import streamService from "@/services/stream";

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() })),
}));
vi.mock("@/services/jstransform", () => ({
  default: {
    list: vi.fn(),
    create: vi.fn(),
    getAssociatedPipelines: vi.fn(),
    delete: vi.fn(),
    test: vi.fn(),
  },
}));
vi.mock("@/services/pipelines", () => ({
  default: {
    getPipelines: vi.fn(),
    getPipeline: vi.fn(),
    getPipelineStreams: vi.fn(),
    createPipeline: vi.fn(),
    updatePipeline: vi.fn(),
    deletePipeline: vi.fn(),
  },
}));
vi.mock("@/services/stream", () => ({ default: { updateSettings: vi.fn() } }));

describe("ocsfPacks service (R1, F13 delegation)", () => {
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

  it("delegates function reads/writes to the shared jstransform service", () => {
    ocsfPacks.listFunctions("org1");
    expect(jstransform.list).toHaveBeenCalledWith(1, 1000, "name", false, "", "org1");

    ocsfPacks.saveFunction("org1", "ocsf_entity_v1_web", ".foo = 1\n.");
    expect(jstransform.create).toHaveBeenCalledWith("org1", {
      name: "ocsf_entity_v1_web",
      function: ".foo = 1\n.",
      params: "row",
      transType: 0,
    });

    ocsfPacks.functionDependencies("org1", "ocsf_entity_v1_web");
    expect(jstransform.getAssociatedPipelines).toHaveBeenCalledWith("org1", "ocsf_entity_v1_web");

    ocsfPacks.deleteFunction("org1", "ocsf_entity_v1_web");
    expect(jstransform.delete).toHaveBeenCalledWith("org1", "ocsf_entity_v1_web");

    ocsfPacks.preview("org1", ".x = 1", [{ a: 1 }]);
    expect(jstransform.test).toHaveBeenCalledWith("org1", {
      function: ".x = 1",
      events: [{ a: 1 }],
      trans_type: 0,
    });
  });

  it("delegates pipeline CRUD to the shared pipelines service", () => {
    const data = { name: "ocsf-web", nodes: [], edges: [] } as any;
    ocsfPacks.getPipeline("org1", "p1");
    expect(pipelines.getPipeline).toHaveBeenCalledWith({ name: "p1", org_identifier: "org1" });

    ocsfPacks.createPipeline("org1", data);
    expect(pipelines.createPipeline).toHaveBeenCalledWith({ data, org_identifier: "org1" });

    ocsfPacks.updatePipeline("org1", data);
    expect(pipelines.updatePipeline).toHaveBeenCalledWith({ org_identifier: "org1", data });

    ocsfPacks.deletePipeline("org1", "p1");
    expect(pipelines.deletePipeline).toHaveBeenCalledWith({ pipeline_id: "p1", org_id: "org1" });
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
