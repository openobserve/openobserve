// Copyright 2026 OpenObserve Inc.

import http from "./http";
import jstransform from "./jstransform";
import streamService from "./stream";
import type { SecuritySetting } from "./securitySources";

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

const ocsfPacks = {
  async listPacks(org: string): Promise<PacksResponse> {
    const res = await http().get(`/api/${org}/security/ocsf/packs`);
    return res.data as PacksResponse;
  },

  saveSetting(org: string, stream: string, security: SecuritySetting) {
    return streamService.updateSettings(org, stream, "logs", { security });
  },

  preview(org: string, program: string, events: unknown[]) {
    return jstransform.test(org, { function: program, events, trans_type: 0 });
  },
};

export default ocsfPacks;
