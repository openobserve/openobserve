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

import { describe, expect, it } from "vitest";
import { JOB_PRESETS } from "@/components/iam/roles/jobPresets";

const securityGrant = (id: string) => JOB_PRESETS.find((p) => p.id === id)?.grants.security;

describe("Security job presets", () => {
  it("lets a detection engineer author detections without triage or delete", () => {
    expect(securityGrant("detection_engineer")).toEqual(["AllowList", "AllowGet", "AllowPost"]);
  });

  it("lets a detection engineer maintain threat-intel lists", () => {
    const grants = JOB_PRESETS.find((p) => p.id === "detection_engineer")?.grants;
    expect(grants?.enrichment_table).toEqual(["AllowAll"]);
    expect(grants?.stream).toEqual(["AllowList", "AllowGet"]);
  });

  it("keeps a SOC analyst to triage, without authoring", () => {
    expect(securityGrant("soc_analyst")).toEqual(["AllowList", "AllowGet", "AllowPut"]);
  });

  it("lets a detection engineer and a security admin attach OCSF packs", () => {
    for (const id of ["detection_engineer", "security_admin"]) {
      const grants = JOB_PRESETS.find((p) => p.id === id)?.grants;
      expect(grants?.function).toEqual(["AllowAll"]);
      expect(grants?.pipeline).toEqual(["AllowAll"]);
    }
  });

  it("lets a SOC analyst read threat-intel lists", () => {
    const grants = JOB_PRESETS.find((p) => p.id === "soc_analyst")?.grants;
    expect(grants?.enrichment_table).toEqual(["AllowList", "AllowGet"]);
  });

  it("lets a security viewer read the source streams", () => {
    const grants = JOB_PRESETS.find((p) => p.id === "security_viewer")?.grants;
    expect(grants?.stream).toEqual(["AllowList", "AllowGet"]);
  });

  it("lets a security admin read the source streams its detections query", () => {
    const grants = JOB_PRESETS.find((p) => p.id === "security_admin")?.grants;
    expect(grants?.stream).toEqual(["AllowList", "AllowGet"]);
  });

  it("lets a detection engineer read cases without triaging them", () => {
    const grants = JOB_PRESETS.find((p) => p.id === "detection_engineer")?.grants;
    expect(grants?.incidents).toEqual(["AllowList", "AllowGet"]);
  });

  it("gives every Security preset the stream and incident reads its pages need", () => {
    for (const preset of JOB_PRESETS.filter((p) => p.tone === "security")) {
      expect(preset.grants.stream, preset.id).toBeDefined();
      expect(preset.grants.incidents, preset.id).toBeDefined();
    }
  });

  it("gives a security admin everything and a viewer only reads", () => {
    expect(securityGrant("security_admin")).toEqual(["AllowAll"]);
    expect(securityGrant("security_viewer")).toEqual(["AllowList", "AllowGet"]);
  });
});
