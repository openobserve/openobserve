// Copyright 2026 OpenObserve Inc.

import http from "./http";
import jstransform from "./jstransform";
import pipelines from "./pipelines";
import streamService from "./stream";
import type { Pipeline, SecuritySetting } from "@/utils/security/ocsfPipeline";

export interface OcsfPackManifest {
  id: string;
  version: number;
  label: string;
  kind: "full" | "entity";
  source_type: string;
  ocsf_classes: number[];
  requires_all: string[];
  product_name: string;
  vendor_name: string;
}

export interface OcsfPack extends OcsfPackManifest {
  vrl: string;
}

export interface PacksResponse {
  ocsf_version: string;
  packs: OcsfPack[];
}

export interface StoredFunction {
  name: string;
  function: string;
  [key: string]: unknown;
}

const ocsfPacks = {
  async listPacks(org: string): Promise<PacksResponse> {
    const res = await http().get(`/api/${org}/security/ocsf/packs`);
    return res.data as PacksResponse;
  },

  // The list handler ignores paging/name params, so there is no single-function text lookup; list and filter.
  listFunctions(org: string) {
    return jstransform.list(1, 1000, "name", false, "", org);
  },

  functionDependencies(org: string, name: string) {
    return jstransform.getAssociatedPipelines(org, name);
  },

  saveFunction(org: string, name: string, program: string) {
    return jstransform.create(org, { name, function: program, params: "row", transType: 0 });
  },

  deleteFunction(org: string, name: string) {
    return jstransform.delete(org, name);
  },

  streamPipelines(org: string) {
    return pipelines.getPipelineStreams(org);
  },

  listPipelines(org: string) {
    return pipelines.getPipelines(org);
  },

  getPipeline(org: string, id: string) {
    return pipelines.getPipeline({ name: id, org_identifier: org });
  },

  createPipeline(org: string, data: Pipeline) {
    return pipelines.createPipeline({ data, org_identifier: org });
  },

  updatePipeline(org: string, data: Pipeline) {
    return pipelines.updatePipeline({ org_identifier: org, data });
  },

  deletePipeline(org: string, id: string) {
    return pipelines.deletePipeline({ pipeline_id: id, org_id: org });
  },

  saveSetting(org: string, stream: string, security: SecuritySetting) {
    return streamService.updateSettings(org, stream, "logs", { security });
  },

  preview(org: string, program: string, events: unknown[]) {
    return jstransform.test(org, { function: program, events, trans_type: 0 });
  },
};

export default ocsfPacks;
