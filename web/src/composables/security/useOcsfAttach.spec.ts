// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

import ocsfPacks from "@/services/ocsfPacks";
import analytics from "@/services/product_analytics";
import {
  attach,
  detach,
  OcsfAttachError,
  useOcsfAttach,
} from "@/composables/security/useOcsfAttach";
import { findOurNode } from "@/utils/security/ocsfPipeline";

vi.mock("@/services/ocsfPacks", () => ({
  default: {
    listPacks: vi.fn(),
    listFunctions: vi.fn(),
    functionDependencies: vi.fn(),
    saveFunction: vi.fn(),
    deleteFunction: vi.fn(),
    streamPipelines: vi.fn(),
    listPipelines: vi.fn(),
    getPipeline: vi.fn(),
    createPipeline: vi.fn(),
    updatePipeline: vi.fn(),
    deletePipeline: vi.fn(),
    saveSetting: vi.fn(),
  },
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const svc = ocsfPacks as unknown as Record<string, ReturnType<typeof vi.fn>>;

const PACK = {
  id: "entity",
  version: 1,
  label: "Entity",
  kind: "entity" as const,
  source_type: "entity",
  ocsf_classes: [0],
  requires_all: [],
  product_name: "__O2_STREAM__",
  vendor_name: "Unknown",
  vrl: '.metadata_product_name = "__O2_STREAM__"\n.',
};

const FULL_PACK = {
  ...PACK,
  id: "aws_cloudtrail",
  version: 2,
  label: "CloudTrail",
  kind: "full" as const,
  source_type: "aws_cloudtrail",
};

const httpError = (status: number, message = "") => ({ response: { status, data: { message } } });

const existingPipeline = () => ({
  pipeline_id: "p1",
  name: "custom",
  source: { source_type: "realtime", stream_name: "web", stream_type: "logs" },
  version: 3,
  enabled: true,
  nodes: [
    {
      id: "src",
      io_type: "input",
      position: { x: 0, y: 0 },
      data: { node_type: "stream", stream_name: "web", stream_type: "logs" },
    },
    {
      id: "fn",
      io_type: "default",
      position: { x: 0, y: 0 },
      data: { node_type: "function", name: "cust" },
    },
    {
      id: "dst",
      io_type: "output",
      position: { x: 0, y: 0 },
      data: { node_type: "stream", stream_name: "web", stream_type: "logs" },
    },
  ],
  edges: [
    { id: "esrc-fn", source: "src", target: "fn" },
    { id: "efn-dst", source: "fn", target: "dst" },
  ],
});

const soleOcsf = () => ({
  pipeline_id: "p1",
  source: { source_type: "realtime", stream_name: "web", stream_type: "logs" },
  nodes: [
    {
      id: "src",
      io_type: "input",
      position: { x: 0, y: 0 },
      data: { node_type: "stream", stream_name: "web", stream_type: "logs" },
    },
    {
      id: "ours",
      io_type: "default",
      position: { x: 0, y: 0 },
      meta: { o2_ocsf_pack: "entity@1" },
      data: { node_type: "function", name: "ocsf_entity_v1_web" },
    },
    {
      id: "dst",
      io_type: "output",
      position: { x: 0, y: 0 },
      data: { node_type: "stream", stream_name: "web", stream_type: "logs" },
    },
  ],
  edges: [
    { id: "esrc-ours", source: "src", target: "ours" },
    { id: "eours-dst", source: "ours", target: "dst" },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  svc.listPacks.mockResolvedValue({ ocsf_version: "1.3.0", packs: [PACK, FULL_PACK] });
  svc.listFunctions.mockResolvedValue({ data: { list: [] } });
  svc.saveFunction.mockResolvedValue({ data: {} });
  svc.saveSetting.mockResolvedValue({ data: {} });
  svc.streamPipelines.mockResolvedValue({ data: { list: [] } });
  svc.listPipelines.mockResolvedValue({ data: { list: [] } });
  svc.createPipeline.mockResolvedValue({ data: { pipeline_id: "new1" } });
  svc.updatePipeline.mockResolvedValue({ data: {} });
  svc.deletePipeline.mockResolvedValue({ data: {} });
});

describe("attach (R11)", () => {
  it("creates a pipeline and records the setting when the stream has none", async () => {
    svc.listPipelines.mockResolvedValueOnce({ data: { list: [] } }).mockResolvedValueOnce({
      data: {
        list: [
          {
            pipeline_id: "new1",
            source: { source_type: "realtime", stream_name: "web", stream_type: "logs" },
          },
        ],
      },
    });

    const res = await attach("org1", "web", PACK);

    expect(svc.saveFunction).toHaveBeenCalledWith(
      "org1",
      "ocsf_entity_v1_web",
      '.metadata_product_name = "web"\n.',
    );
    expect(svc.createPipeline).toHaveBeenCalled();
    expect(res.pipeline_created).toBe(true);
    const setting = svc.saveSetting.mock.calls[0][2];
    expect(setting).toMatchObject({
      pack_id: "entity",
      pack_version: 1,
      pipeline_created: true,
      included: true,
    });
    expect(svc.saveSetting.mock.invocationCallOrder[0]).toBeGreaterThan(
      svc.createPipeline.mock.invocationCallOrder[0],
    );
    expect(analytics.track).toHaveBeenCalledWith("security_source_pack_attached", {
      source_type: "entity",
      kind: "entity",
      pipeline_created: true,
    });
  });

  it("extends an existing pipeline without creating a second one", async () => {
    svc.listPipelines.mockResolvedValue({ data: { list: [existingPipeline()] } });
    svc.getPipeline.mockResolvedValue({ data: existingPipeline() });

    const res = await attach("org1", "web", PACK);

    expect(svc.createPipeline).not.toHaveBeenCalled();
    expect(res.pipeline_created).toBe(false);
    const saved = svc.updatePipeline.mock.calls[0][1];
    expect(findOurNode(saved)).toBeTruthy();
    expect(saved.nodes[0].id).toBe("src");
  });

  it("reuses a matching function and refuses an edited one", async () => {
    svc.listFunctions.mockResolvedValue({
      data: {
        list: [{ name: "ocsf_entity_v1_web", function: '.metadata_product_name = "web"\n.' }],
      },
    });
    svc.listPipelines.mockResolvedValue({ data: { list: [existingPipeline()] } });
    svc.getPipeline.mockResolvedValue({ data: existingPipeline() });
    await attach("org1", "web", PACK);
    expect(svc.saveFunction).not.toHaveBeenCalled();

    svc.listFunctions.mockResolvedValue({
      data: { list: [{ name: "ocsf_entity_v1_web", function: ".x = 1\n." }] },
    });
    await expect(attach("org1", "web", PACK)).rejects.toMatchObject({
      code: "functionEditedOutside",
      params: { name: "ocsf_entity_v1_web" },
    });
  });

  const realtime = (id: string) => ({
    pipeline_id: id,
    source: { source_type: "realtime", stream_name: "web", stream_type: "logs" },
  });

  it("keeps its own pipeline when it is the winner of two parallel creates (F10)", async () => {
    svc.createPipeline.mockResolvedValue({ data: { pipeline_id: "aaa" } });
    svc.listPipelines
      .mockResolvedValueOnce({ data: { list: [] } })
      .mockResolvedValueOnce({ data: { list: [realtime("aaa"), realtime("zzz")] } });

    const res = await attach("org1", "web", PACK);

    expect(svc.deletePipeline).not.toHaveBeenCalled();
    expect(res.pipeline_id).toBe("aaa");
    expect(res.pipeline_created).toBe(true);
  });

  it("deletes only its own pipeline when it is the loser of two parallel creates (F10)", async () => {
    svc.createPipeline.mockResolvedValue({ data: { pipeline_id: "zzz" } });
    svc.listPipelines
      .mockResolvedValueOnce({ data: { list: [] } })
      .mockResolvedValueOnce({ data: { list: [realtime("aaa"), realtime("zzz")] } });
    svc.getPipeline.mockResolvedValue({ data: { ...soleOcsf(), pipeline_id: "aaa" } });

    const res = await attach("org1", "web", PACK);

    expect(svc.deletePipeline).toHaveBeenCalledWith("org1", "zzz");
    expect(svc.deletePipeline).toHaveBeenCalledTimes(1);
    expect(res.pipeline_id).toBe("aaa");
    expect(res.pipeline_created).toBe(false);
  });

  it("surfaces a validation 400 instead of recording a mapped setting (F2)", async () => {
    svc.createPipeline.mockRejectedValue(httpError(400, "InvalidPipeline: bad config"));
    svc.listPipelines.mockResolvedValue({ data: { list: [] } });

    await expect(attach("org1", "web", PACK)).rejects.toBeDefined();
    expect(svc.saveSetting).not.toHaveBeenCalled();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("treats a 400 as a lost race only when a realtime pipeline now exists (F2)", async () => {
    svc.createPipeline.mockRejectedValue(httpError(400, "already exists"));
    svc.listPipelines.mockResolvedValue({ data: { list: [realtime("raced")] } });
    svc.getPipeline.mockResolvedValue({ data: { ...soleOcsf(), pipeline_id: "raced" } });

    const res = await attach("org1", "web", PACK);

    expect(res.pipeline_id).toBe("raced");
    expect(svc.saveSetting).toHaveBeenCalled();
  });

  it("reuses the function when the stored text is the server-normalised body (F4)", async () => {
    svc.listFunctions.mockResolvedValue({
      data: {
        list: [{ name: "ocsf_entity_v1_web", function: '.metadata_product_name = "web"\n. \n .' }],
      },
    });
    svc.listPipelines.mockResolvedValue({ data: { list: [existingPipeline()] } });
    svc.getPipeline.mockResolvedValue({ data: existingPipeline() });

    await attach("org1", "web", PACK);

    expect(svc.saveFunction).not.toHaveBeenCalled();
    expect(svc.saveSetting).toHaveBeenCalled();
  });

  it("refuses to adopt a different pack already on the pipeline (F5)", async () => {
    const other = existingPipeline();
    other.nodes.push({
      id: "ours",
      io_type: "default",
      position: { x: 0, y: 0 },
      meta: { o2_ocsf_pack: "entity@2" },
      data: { node_type: "function", name: "ocsf_entity_v2_web" },
    } as any);
    svc.listPipelines.mockResolvedValue({ data: { list: [other] } });
    svc.getPipeline.mockResolvedValue({ data: other });

    await expect(attach("org1", "web", PACK)).rejects.toMatchObject({
      code: "packConflict",
      params: { pack: "entity@2" },
    });
    expect(svc.saveSetting).not.toHaveBeenCalled();
  });

  it("rechecks the live pipeline in extendPipeline and refuses a disabled one (F16)", async () => {
    const disabled = { ...existingPipeline(), enabled: false };
    svc.listPipelines.mockResolvedValue({ data: { list: [disabled] } });
    svc.getPipeline.mockResolvedValue({ data: disabled });

    await expect(
      attach("org1", "web", PACK, true, { globalFlattenLevel: 0, guaranteedColumns: [] }),
    ).rejects.toMatchObject({ code: "pipelineChanged" });
    expect(svc.updatePipeline).not.toHaveBeenCalled();
    expect(svc.saveSetting).not.toHaveBeenCalled();
  });

  it("re-checks even when a matching node is already present on a disabled pipeline (F25)", async () => {
    const disabledWithNode = { ...soleOcsf(), enabled: false };
    svc.listPipelines.mockResolvedValue({ data: { list: [disabledWithNode] } });
    svc.getPipeline.mockResolvedValue({ data: disabledWithNode });

    await expect(
      attach("org1", "web", PACK, true, { globalFlattenLevel: 0, guaranteedColumns: [] }),
    ).rejects.toMatchObject({ code: "pipelineChanged" });
    expect(svc.saveSetting).not.toHaveBeenCalled();
  });

  it("does not raise no-access for a same-named pipeline of another stream_type (F10)", async () => {
    svc.streamPipelines.mockResolvedValue({
      data: { list: [{ stream_name: "web", stream_type: "metrics" }] },
    });
    svc.listPipelines
      .mockResolvedValueOnce({ data: { list: [] } })
      .mockResolvedValueOnce({ data: { list: [realtime("new1")] } });

    await attach("org1", "web", PACK);

    expect(svc.createPipeline).toHaveBeenCalled();
  });

  it("recovers from a stale-version 409 by reloading and re-applying once", async () => {
    svc.listPipelines.mockResolvedValue({ data: { list: [existingPipeline()] } });
    svc.getPipeline.mockResolvedValue({ data: existingPipeline() });
    svc.updatePipeline
      .mockRejectedValueOnce(httpError(409, "stale version"))
      .mockResolvedValueOnce({ data: {} });

    await attach("org1", "web", PACK, true, { globalFlattenLevel: 0, guaranteedColumns: [] });

    expect(svc.updatePipeline).toHaveBeenCalledTimes(2);
  });
});

describe("detach (R12)", () => {
  const setting = () => ({
    source_type: "entity",
    pack_id: "entity",
    pack_version: 1,
    attached_at: 0,
    pipeline_id: "p1",
    pipeline_created: true,
    included: true,
  });

  it("deletes the pipeline we created when it is exactly source→ours→stream", async () => {
    svc.getPipeline.mockResolvedValue({ data: soleOcsf() });
    svc.functionDependencies.mockResolvedValue({ data: { list: [] } });
    svc.deleteFunction.mockResolvedValue({ data: {} });

    await detach("org1", "web", setting());

    expect(svc.deletePipeline).toHaveBeenCalledWith("org1", "p1");
    expect(svc.deleteFunction).toHaveBeenCalledWith("org1", "ocsf_entity_v1_web");
    const cleared = svc.saveSetting.mock.calls[0][2];
    expect(cleared).toMatchObject({
      pack_id: "",
      pack_version: 0,
      source_type: "entity",
      included: true,
    });
    expect(analytics.track).toHaveBeenCalledWith("security_source_pack_detached", {
      source_type: "entity",
      pipeline_skipped: false,
    });
  });

  it("removes only our node from a shared pipeline and keeps a depended-on function", async () => {
    const shared = existingPipeline();
    shared.nodes.push({
      id: "ours",
      io_type: "default",
      position: { x: 0, y: 0 },
      meta: { o2_ocsf_pack: "entity@1" },
      data: { node_type: "function", name: "ocsf_entity_v1_web" },
    } as any);
    shared.edges = [
      { id: "esrc-ours", source: "src", target: "ours" },
      { id: "eours-fn", source: "ours", target: "fn" },
      { id: "efn-dst", source: "fn", target: "dst" },
    ];
    svc.getPipeline.mockResolvedValue({ data: shared });
    svc.functionDependencies.mockResolvedValue({ data: { list: [{ name: "other-pipeline" }] } });

    await detach("org1", "web", { ...setting(), pipeline_created: false });

    expect(svc.deletePipeline).not.toHaveBeenCalled();
    const saved = svc.updatePipeline.mock.calls[0][1];
    expect(findOurNode(saved)).toBeNull();
    expect(svc.deleteFunction).not.toHaveBeenCalled();
  });

  it("removes the node but writes no setting for an undecided orphan (persistSetting false, F20)", async () => {
    svc.getPipeline.mockResolvedValue({ data: soleOcsf() });
    svc.functionDependencies.mockResolvedValue({ data: { list: [] } });
    svc.deleteFunction.mockResolvedValue({ data: {} });

    await detach("org1", "web", { ...setting(), source_type: "" }, false);

    expect(svc.deletePipeline).toHaveBeenCalledWith("org1", "p1");
    expect(svc.saveSetting).not.toHaveBeenCalled();
    expect(svc.deleteFunction).toHaveBeenCalledWith("org1", "ocsf_entity_v1_web");
  });

  it("clears the setting even when the recorded pipeline is already gone (F1)", async () => {
    svc.getPipeline.mockRejectedValue(httpError(404, "pipeline not found"));
    svc.functionDependencies.mockResolvedValue({ data: { list: [] } });
    svc.deleteFunction.mockResolvedValue({ data: {} });

    await expect(detach("org1", "web", setting())).resolves.toEqual({ pipeline_skipped: false });

    expect(svc.deletePipeline).not.toHaveBeenCalled();
    const cleared = svc.saveSetting.mock.calls[0][2];
    expect(cleared).toMatchObject({ pack_id: "", pack_version: 0 });
    expect(svc.deleteFunction).toHaveBeenCalledWith("org1", "ocsf_entity_v1_web");
  });

  it("names the function by the pack kind, the same way attach does", async () => {
    svc.getPipeline.mockRejectedValue(httpError(404));
    svc.functionDependencies.mockResolvedValue({ data: { list: [] } });
    svc.deleteFunction.mockResolvedValue({ data: {} });
    svc.listPacks.mockResolvedValue({
      ocsf_version: "1.3.0",
      packs: [{ ...PACK, id: "entity_alt" }, FULL_PACK],
    });

    await detach("org1", "Web", { ...setting(), pack_id: "entity_alt", pack_version: 3 });
    expect(svc.deleteFunction).toHaveBeenLastCalledWith("org1", "ocsf_entity_v3_web");

    await detach("org1", "web", { ...setting(), pack_id: "aws_cloudtrail", pack_version: 2 });
    expect(svc.deleteFunction).toHaveBeenLastCalledWith("org1", "ocsf_aws_cloudtrail_v2");
  });

  it("leaves a recorded pipeline that sources another stream untouched but clears the setting", async () => {
    const other = soleOcsf();
    other.source = { source_type: "realtime", stream_name: "other", stream_type: "logs" };
    svc.getPipeline.mockResolvedValue({ data: other });
    svc.functionDependencies.mockResolvedValue({ data: { list: [{ name: "p1" }] } });

    const res = await detach("org1", "web", setting());

    expect(res).toEqual({ pipeline_skipped: true });
    expect(svc.deletePipeline).not.toHaveBeenCalled();
    expect(svc.updatePipeline).not.toHaveBeenCalled();
    expect(svc.saveSetting.mock.calls[0][2]).toMatchObject({ pack_id: "", pipeline_id: "" });
  });

  it("leaves a recorded pipeline from another org or running another pack untouched", async () => {
    svc.getPipeline.mockResolvedValue({ data: { ...soleOcsf(), org: "org2" } });
    svc.functionDependencies.mockResolvedValue({ data: { list: [{ name: "p1" }] } });
    await expect(detach("org1", "web", setting())).resolves.toEqual({ pipeline_skipped: true });

    svc.getPipeline.mockResolvedValue({ data: soleOcsf() });
    await expect(
      detach("org1", "web", { ...setting(), pack_id: "aws_cloudtrail", pack_version: 2 }),
    ).resolves.toEqual({ pipeline_skipped: true });

    expect(svc.deletePipeline).not.toHaveBeenCalled();
    expect(svc.updatePipeline).not.toHaveBeenCalled();
    expect(svc.saveSetting).toHaveBeenCalledTimes(2);
  });

  it("still deletes a matching pipeline that carries this org", async () => {
    svc.getPipeline.mockResolvedValue({ data: { ...soleOcsf(), org: "org1" } });
    svc.functionDependencies.mockResolvedValue({ data: { list: [] } });
    svc.deleteFunction.mockResolvedValue({ data: {} });

    await expect(detach("org1", "web", setting())).resolves.toEqual({ pipeline_skipped: false });

    expect(svc.deletePipeline).toHaveBeenCalledWith("org1", "p1");
    expect(svc.saveSetting).toHaveBeenCalled();
  });

  it("leaves the function in place when the pack is no longer in the registry", async () => {
    svc.getPipeline.mockRejectedValue(httpError(404));
    svc.functionDependencies.mockResolvedValue({ data: { list: [] } });

    await detach("org1", "web", { ...setting(), pack_id: "gone" });

    expect(svc.saveSetting).toHaveBeenCalled();
    expect(svc.deleteFunction).not.toHaveBeenCalled();
  });
});

describe("useOcsfAttach error", () => {
  it("exposes an attach failure as an i18n key with its params", async () => {
    const flow = useOcsfAttach();
    await flow.run(() => Promise.reject(new OcsfAttachError("packConflict", { pack: "x@1" })));
    expect(flow.error.value).toEqual({
      key: "siem.sources.attachErrors.packConflict",
      params: { pack: "x@1" },
    });
  });

  it("keeps a server message as raw text and falls back to a key", async () => {
    const flow = useOcsfAttach();
    await flow.run(() => Promise.reject(httpError(400, "bad config")));
    expect(flow.error.value).toEqual({ raw: "bad config" });
    await flow.run(() => Promise.reject({}));
    expect(flow.error.value).toEqual({ key: "siem.sources.attachErrors.failed" });
  });
});
