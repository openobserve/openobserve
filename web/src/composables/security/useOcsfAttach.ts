// Copyright 2026 OpenObserve Inc.

import { ref } from "vue";

import ocsfPacks, { type OcsfPack } from "@/services/ocsfPacks";
import analytics from "@/services/product_analytics";
import {
  consistencyState,
  entityFunctionName,
  entityProgram,
  findOurNode,
  fullFunctionName,
  insertNode,
  newPipeline,
  ourNode,
  preAttachChecks,
  removeNode,
  type AttachConfig,
  type ConsistencyState,
  type Pipeline,
  type PipelineNode,
  type PreAttachBlock,
  type SecuritySetting,
  type StreamForChecks,
} from "@/utils/security/ocsfPipeline";

export type AttachErrorCode =
  | "functionEditedOutside"
  | "pipelineNoAccess"
  | "pipelineChanged"
  | "packConflict"
  | "noPipeline"
  | "permissionDenied";

export class OcsfAttachError extends Error {
  code: AttachErrorCode;
  params: Record<string, unknown>;
  constructor(code: AttachErrorCode, params: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

/** An i18n key with its params, or a server-supplied message shown as-is. */
export type AttachErrorView = { key: string; params?: Record<string, unknown> } | { raw: string };

export interface DetachResult {
  pipeline_skipped: boolean;
}

export interface AttachResult {
  pipeline_id: string;
  pipeline_created: boolean;
  setting: SecuritySetting;
}

const functionName = (pack: Pick<OcsfPack, "id" | "version" | "kind">, stream: string): string =>
  pack.kind === "entity"
    ? entityFunctionName(pack.version, stream)
    : fullFunctionName(pack.id, pack.version);

const nowMicros = (): number => Date.now() * 1000;

const httpStatus = (err: unknown): number | undefined =>
  (err as { response?: { status?: number } })?.response?.status;

const httpMessage = (err: unknown): string =>
  String((err as { response?: { data?: { message?: unknown } } })?.response?.data?.message ?? "");

const isAlreadyExists = (err: unknown): boolean =>
  httpStatus(err) === 400 && /already exist/i.test(httpMessage(err));

// The server appends " \n ." to VRL that lacks a trailing ".", so compare only the body before it.
const sameVrl = (a: string, b: string): boolean =>
  a.replace(/[\s.]+$/, "") === b.replace(/[\s.]+$/, "");

/** Lowest pipeline_id wins, so parallel attaches converge on one survivor without both deleting. */
const pickWinner = (pipelines: Pipeline[]): string =>
  pipelines.map((p) => p.pipeline_id ?? "").sort()[0] ?? "";

const toPipeline = (raw: any): Pipeline => ({
  pipeline_id: raw?.pipeline_id ?? raw?.id ?? "",
  name: raw?.name ?? "",
  description: raw?.description ?? "",
  source: raw?.source ?? {},
  nodes: Array.isArray(raw?.nodes) ? raw.nodes : [],
  edges: Array.isArray(raw?.edges) ? raw.edges : [],
  version: raw?.version,
  enabled: raw?.enabled,
  org: raw?.org,
});

export function realtimePipelinesFor(list: any[], stream: string): Pipeline[] {
  return (list ?? [])
    .map(toPipeline)
    .filter(
      (p) =>
        p.source?.source_type === "realtime" &&
        p.source?.stream_name === stream &&
        (p.source?.stream_type ?? "logs") === "logs",
    );
}

/** A pipeline we can delete on detach: exactly source → ours → the same stream. */
function isSoleOcsfPipeline(pipeline: Pipeline, stream: string): boolean {
  if (pipeline.nodes.length !== 3) return false;
  const our = findOurNode(pipeline);
  if (!our) return false;
  const source = pipeline.nodes[0];
  const dest = pipeline.nodes.find((n) => n.data?.node_type === "stream" && n.io_type === "output");
  if (!dest || dest.data?.stream_name !== stream) return false;
  const want = new Set([`${source.id}->${our.id}`, `${our.id}->${dest.id}`]);
  const have = new Set(pipeline.edges.map((e) => `${e.source}->${e.target}`));
  return want.size === have.size && [...want].every((p) => have.has(p));
}

/** Reuse the stored function when its text equals the registry's, else refuse. */
async function ensureFunction(org: string, name: string, program: string): Promise<void> {
  const find = async (): Promise<string | null> => {
    const res = await ocsfPacks.listFunctions(org);
    const list: any[] = res.data?.list ?? res.data ?? [];
    const found = list.find((f) => f?.name === name);
    return found ? String(found.function ?? "") : null;
  };
  const existing = await find();
  if (existing !== null) {
    if (!sameVrl(existing, program)) {
      throw new OcsfAttachError("functionEditedOutside", { name });
    }
    return;
  }
  try {
    await ocsfPacks.saveFunction(org, name, program);
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    const afterRace = await find();
    if (afterRace !== null && !sameVrl(afterRace, program)) {
      throw new OcsfAttachError("functionEditedOutside", { name });
    }
  }
}

/** Locate the stream's realtime pipeline id, distinguishing "none" from "no access". */
async function findPipelineId(org: string, stream: string): Promise<string | null> {
  const [streamsRes, listRes] = await Promise.all([
    ocsfPacks.streamPipelines(org),
    ocsfPacks.listPipelines(org),
  ]);
  const streamList: any[] = streamsRes.data?.list ?? streamsRes.data ?? [];
  const listed = streamList.some(
    (p) =>
      (p?.stream_name ?? p?.source?.stream_name) === stream &&
      (p?.stream_type ?? p?.source?.stream_type ?? "logs") === "logs",
  );
  const matches = realtimePipelinesFor(listRes.data?.list ?? listRes.data ?? [], stream);
  if (matches.length) return matches[0].pipeline_id ?? "";
  if (listed) {
    throw new OcsfAttachError("pipelineNoAccess");
  }
  return null;
}

/** The recorded pipeline is only ours to change when it is this org's, sources this stream, and runs this pack. */
function isDetachTarget(
  pipeline: Pipeline,
  org: string,
  stream: string,
  setting: SecuritySetting,
): boolean {
  if (pipeline.org && pipeline.org !== org) return false;
  if (!realtimePipelinesFor([pipeline], stream).length) return false;
  const tag = (findOurNode(pipeline)?.meta as { o2_ocsf_pack?: string } | undefined)?.o2_ocsf_pack;
  return tag === `${setting.pack_id}@${setting.pack_version}`;
}

async function listRealtime(org: string, stream: string): Promise<Pipeline[]> {
  const listRes = await ocsfPacks.listPipelines(org);
  return realtimePipelinesFor(listRes.data?.list ?? listRes.data ?? [], stream);
}

async function createOcsfPipeline(
  org: string,
  stream: string,
  node: PipelineNode,
): Promise<{ id: string; created: boolean }> {
  const pipeline = newPipeline(org, stream, node);
  let id: string;
  try {
    const res = await ocsfPacks.createPipeline(org, pipeline);
    id = res.data?.pipeline_id ?? res.data?.id ?? "";
  } catch (err) {
    if (httpStatus(err) === 403) {
      throw new OcsfAttachError("permissionDenied");
    }
    // A 400 is a lost race only if a realtime pipeline now exists; a validation error is re-raised.
    const existing = await listRealtime(org, stream);
    if (existing.length) return { id: pickWinner(existing), created: false };
    throw err;
  }
  // The StreamInUse check is read-then-insert, so two parallel creates can both land; keep one.
  const mine = await listRealtime(org, stream);
  if (mine.length > 1) {
    const winner = pickWinner(mine);
    if (id && id !== winner) await ocsfPacks.deletePipeline(org, id);
    return { id: winner, created: id === winner };
  }
  return { id, created: true };
}

async function extendPipeline(
  org: string,
  id: string,
  pack: OcsfPack,
  stream: string,
  cfg: AttachConfig | null,
  retry = true,
): Promise<void> {
  const res = await ocsfPacks.getPipeline(org, id);
  const pipeline = toPipeline(res.data);
  // Re-check the live pipeline (disabled / rerouted since the page snapshot) before reusing or editing it.
  if (cfg && preAttachChecks({ name: stream }, pipeline, cfg).length) {
    throw new OcsfAttachError("pipelineChanged");
  }
  const present = findOurNode(pipeline);
  if (present) {
    const tag = (present.meta as { o2_ocsf_pack?: string })?.o2_ocsf_pack;
    if (tag === `${pack.id}@${pack.version}` && present.data?.name === functionName(pack, stream)) {
      return;
    }
    // A different pack or a renamed function is an out-of-scope upgrade/conflict, not a silent reuse.
    throw new OcsfAttachError("packConflict", { pack: tag });
  }
  const source = pipeline.nodes[0];
  const node = ourNode(pack.id, pack.version, functionName(pack, stream), {
    x: Number(source?.position?.x ?? 0),
    y: Number(source?.position?.y ?? 0),
  });
  const next = insertNode(pipeline, node);
  try {
    await ocsfPacks.updatePipeline(org, next);
  } catch (err) {
    // The recursive call re-fetches and re-runs the live re-check above, so no second guard is needed.
    if (httpStatus(err) === 409 && retry) {
      await extendPipeline(org, id, pack, stream, cfg, false);
      return;
    }
    if (httpStatus(err) === 403) {
      throw new OcsfAttachError("permissionDenied");
    }
    throw err;
  }
}

export async function attach(
  org: string,
  stream: string,
  pack: OcsfPack,
  included = true,
  cfg: AttachConfig | null = null,
): Promise<AttachResult> {
  const name = functionName(pack, stream);
  const program = entityProgram(pack.vrl, stream);
  await ensureFunction(org, name, program);

  let pipelineId = await findPipelineId(org, stream);
  let pipelineCreated = false;
  if (pipelineId === null) {
    const node = ourNode(pack.id, pack.version, name, { x: 100, y: 100 });
    const created = await createOcsfPipeline(org, stream, node);
    pipelineId = created.id || null;
    pipelineCreated = created.created;
  }
  // Never record a mapped setting without a pipeline that actually runs the pack.
  if (!pipelineId) {
    throw new OcsfAttachError("noPipeline");
  }
  if (!pipelineCreated) {
    await extendPipeline(org, pipelineId, pack, stream, cfg);
  }

  const setting: SecuritySetting = {
    source_type: pack.source_type,
    pack_id: pack.id,
    pack_version: pack.version,
    attached_at: nowMicros(),
    pipeline_id: pipelineId ?? "",
    pipeline_created: pipelineCreated,
    included,
  };
  await ocsfPacks.saveSetting(org, stream, setting);
  analytics.track("security_source_pack_attached", {
    source_type: pack.source_type,
    kind: pack.kind,
    pipeline_created: pipelineCreated,
  });
  return { pipeline_id: setting.pipeline_id, pipeline_created: pipelineCreated, setting };
}

export async function detach(
  org: string,
  stream: string,
  setting: SecuritySetting,
  persistSetting = true,
): Promise<DetachResult> {
  let pipelineSkipped = false;
  if (setting.pipeline_id) {
    try {
      const res = await ocsfPacks.getPipeline(org, setting.pipeline_id);
      const pipeline = toPipeline(res.data);
      if (!isDetachTarget(pipeline, org, stream, setting)) {
        pipelineSkipped = true;
      } else if (setting.pipeline_created && isSoleOcsfPipeline(pipeline, stream)) {
        await ocsfPacks.deletePipeline(org, setting.pipeline_id);
      } else {
        await ocsfPacks.updatePipeline(org, removeNode(pipeline));
      }
    } catch (err) {
      // The pipeline was removed outside the SIEM; clear the record anyway.
      if (httpStatus(err) !== 404) throw err;
    }
  }

  // An undecided stream (an unrecorded node, no prior setting) must not gain an explicit included:false.
  if (persistSetting) {
    const cleared: SecuritySetting = {
      source_type: setting.source_type,
      pack_id: "",
      pack_version: 0,
      attached_at: nowMicros(),
      pipeline_id: "",
      pipeline_created: false,
      included: setting.included,
    };
    await ocsfPacks.saveSetting(org, stream, cleared);
  }
  analytics.track("security_source_pack_detached", {
    source_type: setting.source_type,
    pipeline_skipped: pipelineSkipped,
  });

  try {
    // The setting carries no pack kind, and the name must be derived exactly as attach did.
    const { packs } = await ocsfPacks.listPacks(org);
    const pack = packs.find((p) => p.id === setting.pack_id);
    if (!pack) return { pipeline_skipped: pipelineSkipped };
    const name = functionName({ ...pack, version: setting.pack_version }, stream);
    const deps = await ocsfPacks.functionDependencies(org, name);
    const list: any[] = deps.data?.list ?? deps.data ?? [];
    if (!list.length) await ocsfPacks.deleteFunction(org, name);
  } catch {
    /* a missing function or a lookup error leaves it in place; detach still succeeds */
  }
  return { pipeline_skipped: pipelineSkipped };
}

export function useOcsfAttach() {
  const busy = ref(false);
  const error = ref<AttachErrorView | null>(null);

  async function run<T>(op: () => Promise<T>): Promise<T | null> {
    busy.value = true;
    error.value = null;
    try {
      return await op();
    } catch (err) {
      if (err instanceof OcsfAttachError) {
        error.value = { key: `siem.sources.attachErrors.${err.code}`, params: err.params };
      } else {
        const text = httpMessage(err) || (err as Error)?.message;
        error.value = text ? { raw: text } : { key: "siem.sources.attachErrors.failed" };
      }
      return null;
    } finally {
      busy.value = false;
    }
  }

  return {
    busy,
    error,
    run,
    attach: (
      org: string,
      stream: string,
      pack: OcsfPack,
      included = true,
      cfg: AttachConfig | null = null,
    ) => run(() => attach(org, stream, pack, included, cfg)),
    detach: (org: string, stream: string, setting: SecuritySetting, persistSetting = true) =>
      run(() => detach(org, stream, setting, persistSetting)),
    checks: (
      stream: StreamForChecks,
      pipeline: Pipeline | null,
      cfg: AttachConfig,
    ): PreAttachBlock[] => preAttachChecks(stream, pipeline, cfg),
    consistency: (setting: SecuritySetting | null, pipeline: Pipeline | null): ConsistencyState =>
      consistencyState(setting, pipeline),
  };
}
