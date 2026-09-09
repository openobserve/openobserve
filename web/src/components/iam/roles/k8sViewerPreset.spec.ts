// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";

import { curatedPacks } from "@/views/Infrastructure/curated/packs";
import { K8S_VIEWER_PERMS, K8S_VIEWER_STREAMS } from "./k8sViewerPreset";

// Mirrors RE_OFGA_UNSUPPORTED_NAME in src/config/src/utils/str.rs:45-46.
const OFGA_UNSUPPORTED = /[:#?\s'"%&]/;

// A stream reachable ONLY via anchorStream/probe/stalenessStreams/valuesFrom still needs a grant (resolve.ts:492, :915).
const manifestStreamRefs = (manifest: any): { name: string; streamType: string }[] => {
  const refs: { name: string; streamType: string }[] = [];
  const groupById = new Map<string, any>(
    (manifest.groups ?? []).map((group: any) => [group.id, group]),
  );

  for (const group of manifest.groups ?? []) {
    const streamType = group.streamType;
    for (const name of group.probe?.streams ?? []) refs.push({ name, streamType });
    for (const name of group.stalenessStreams ?? []) refs.push({ name, streamType });
    if (group.anchorStream) refs.push({ name: group.anchorStream, streamType });
  }

  for (const picker of manifest.scopePickers ?? []) {
    if (picker.valuesFrom?.stream) {
      refs.push({ name: picker.valuesFrom.stream, streamType: picker.valuesFrom.streamType });
    }
  }

  for (const section of manifest.sections ?? []) {
    for (const panel of section.panels ?? []) {
      const streamType = groupById.get(panel.groupId)?.streamType;
      for (const variant of panel.variants ?? []) {
        for (const name of variant.requiresStreams ?? []) refs.push({ name, streamType });
      }
    }
  }

  return refs;
};

const manifestStreams = (manifest: any): string[] =>
  manifestStreamRefs(manifest).map((ref) => ref.name);

describe("K8S_VIEWER_STREAMS", () => {
  it("is sorted and free of duplicates", () => {
    expect(K8S_VIEWER_STREAMS).toEqual([...new Set(K8S_VIEWER_STREAMS)]);
    expect(K8S_VIEWER_STREAMS).toEqual([...K8S_VIEWER_STREAMS].sort());
  });

  it("carries only OFGA-safe names", () => {
    // The frontend has no into_ofga_supported_format, so a name needing it cannot be granted at all.
    for (const name of K8S_VIEWER_STREAMS) {
      expect(OFGA_UNSUPPORTED.test(name), name).toBe(false);
    }
  });
});

describe("K8S_VIEWER_PERMS", () => {
  it("is the two read permissions EditRole offers a stream row", () => {
    expect(K8S_VIEWER_PERMS).toEqual(["AllowList", "AllowGet"]);
  });
});

describe("drift guard against the curated packs", () => {
  const preset = new Set(K8S_VIEWER_STREAMS);

  it.each(Object.entries(curatedPacks))(
    "%s: every declared stream is granted by the preset",
    (packId, manifest) => {
      const required = [...new Set(manifestStreams(manifest))].sort();
      expect(required.length, `${packId} declares no streams`).toBeGreaterThan(0);
      const missing = required.filter((name) => !preset.has(name));
      expect(
        missing,
        `${packId} queries streams the Kubernetes viewer preset does not grant: ` +
          `${missing.join(", ")} — add them to K8S_VIEWER_STREAMS in k8sViewerPreset.ts ` +
          `(sorted), or the role silently cannot read those panels`,
      ).toEqual([]);
    },
  );

  it.each(Object.entries(curatedPacks))(
    "%s: every declared stream is metrics-backed, which is what the preset grants",
    (packId, manifest) => {
      const foreign = [
        ...new Set(
          manifestStreamRefs(manifest)
            .filter((ref) => ref.streamType !== "metrics")
            .map((ref) => `${ref.streamType}:${ref.name}`),
        ),
      ].sort();
      expect(
        foreign,
        `${packId} declares non-metrics streams: ${foreign.join(", ")} — the Kubernetes ` +
          `viewer preset grants every K8S_VIEWER_STREAMS entry as metrics:<name>, so these ` +
          `need a grant object for their own stream type, NOT an entry in K8S_VIEWER_STREAMS`,
      ).toEqual([]);
    },
  );

  it("catches a stream declared only through anchorStream", () => {
    const pack = {
      groups: [{ id: "g", streamType: "metrics", anchorStream: "zz_anchor_only" }],
      scopePickers: [],
      sections: [],
    };
    expect(manifestStreams(pack)).toEqual(["zz_anchor_only"]);
    expect(preset.has("zz_anchor_only")).toBe(false);
  });

  it("reads a stream out of each of the five stream-declaring fields", () => {
    const pack = {
      groups: [
        {
          id: "g",
          streamType: "metrics",
          probe: { streams: ["zz_probe"], sqlFilter: "", fields: [] },
          stalenessStreams: ["zz_staleness"],
          anchorStream: "zz_anchor",
        },
      ],
      scopePickers: [
        { name: "p", valuesFrom: { groupId: "g", stream: "zz_values", streamType: "metrics" } },
      ],
      sections: [
        { id: "s", panels: [{ groupId: "g", variants: [{ requiresStreams: ["zz_requires"] }] }] },
      ],
    };
    expect(manifestStreams(pack).sort()).toEqual([
      "zz_anchor",
      "zz_probe",
      "zz_requires",
      "zz_staleness",
      "zz_values",
    ]);
  });

  it("flags a logs-backed stream instead of sending the author to K8S_VIEWER_STREAMS", () => {
    const pack = {
      groups: [{ id: "g", streamType: "logs" }],
      scopePickers: [],
      sections: [
        { id: "s", panels: [{ groupId: "g", variants: [{ requiresStreams: ["zz_log"] }] }] },
      ],
    };
    expect(manifestStreamRefs(pack)).toEqual([{ name: "zz_log", streamType: "logs" }]);
  });

  it("grants nothing no pack asks for", () => {
    // A name left behind after a pack drops a panel grants a stream no curated page reads.
    const required = new Set(Object.values(curatedPacks).flatMap((m: any) => manifestStreams(m)));
    const extra = K8S_VIEWER_STREAMS.filter((name) => !required.has(name));
    expect(
      extra,
      `K8S_VIEWER_STREAMS grants streams no curated pack requires: ${extra.join(", ")} — ` +
        `remove them, or point the preset at the pack that needs them`,
    ).toEqual([]);
  });
});
