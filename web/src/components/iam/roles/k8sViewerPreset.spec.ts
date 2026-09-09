// Copyright 2026 OpenObserve Inc.
//
// Unit tests for the "Kubernetes viewer" role preset: the metric streams the
// curated Infrastructure pages query, and the permission objects built from
// them. The drift guard below is the point of this file.

import { describe, it, expect } from "vitest";

import { curatedPacks } from "@/views/Infrastructure/curated/packs";
import { K8S_VIEWER_PERMS, K8S_VIEWER_STREAMS, buildK8sViewerPermissions } from "./k8sViewerPreset";

const OFGA_UNSUPPORTED = /[:\s#&?]/;

const manifestStreams = (manifest: any): string[] =>
  manifest.sections.flatMap((section: any) =>
    section.panels.flatMap((panel: any) =>
      panel.variants.flatMap((variant: any) => variant.requiresStreams ?? []),
    ),
  );

describe("K8S_VIEWER_STREAMS", () => {
  it("is sorted and free of duplicates", () => {
    expect(K8S_VIEWER_STREAMS).toEqual([...new Set(K8S_VIEWER_STREAMS)]);
    expect(K8S_VIEWER_STREAMS).toEqual([...K8S_VIEWER_STREAMS].sort());
  });

  it("carries only OFGA-safe names", () => {
    // The frontend has no counterpart to the backend's into_ofga_supported_format,
    // so a name needing the transform could not be granted from here at all.
    for (const name of K8S_VIEWER_STREAMS) {
      expect(OFGA_UNSUPPORTED.test(name), name).toBe(false);
    }
  });
});

describe("buildK8sViewerPermissions", () => {
  it("emits AllowList + AllowGet under the metrics resource for every stream", () => {
    const perms = buildK8sViewerPermissions();
    expect(perms).toHaveLength(K8S_VIEWER_STREAMS.length * K8S_VIEWER_PERMS.length);
    expect(K8S_VIEWER_PERMS).toEqual(["AllowList", "AllowGet"]);
    for (const name of K8S_VIEWER_STREAMS) {
      expect(perms).toContainEqual({ object: `metrics:${name}`, permission: "AllowList" });
      expect(perms).toContainEqual({ object: `metrics:${name}`, permission: "AllowGet" });
    }
  });

  it("is pure — it builds from the streams it is given, not the default list", () => {
    expect(buildK8sViewerPermissions(["a_one", "b_two"])).toEqual([
      { object: "metrics:a_one", permission: "AllowList" },
      { object: "metrics:a_one", permission: "AllowGet" },
      { object: "metrics:b_two", permission: "AllowList" },
      { object: "metrics:b_two", permission: "AllowGet" },
    ]);
    expect(buildK8sViewerPermissions([])).toEqual([]);
  });
});

describe("drift guard against the curated packs", () => {
  const preset = new Set(K8S_VIEWER_STREAMS);

  it.each(Object.entries(curatedPacks))(
    "%s: every requiresStreams entry is granted by the preset",
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

  it("grants nothing no pack asks for", () => {
    // The inverse half: a stale name left behind after a pack drops a panel is a
    // permission the role carries for a stream that no curated page reads.
    const required = new Set(Object.values(curatedPacks).flatMap((m: any) => manifestStreams(m)));
    const extra = K8S_VIEWER_STREAMS.filter((name) => !required.has(name));
    expect(
      extra,
      `K8S_VIEWER_STREAMS grants streams no curated pack requires: ${extra.join(", ")} — ` +
        `remove them, or point the preset at the pack that needs them`,
    ).toEqual([]);
  });
});
