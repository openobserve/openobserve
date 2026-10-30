// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { toYaml } from "./k8sYaml";

describe("toYaml", () => {
  it("drops managedFields but keeps the rest of the metadata", () => {
    const text = toYaml({
      kind: "Pod",
      metadata: { name: "a", managedFields: [{ manager: "kubelet" }] },
      spec: { nodeName: "n1" },
      status: { phase: "Running" },
    });
    expect(text).not.toContain("managedFields");
    expect(text).toContain("name: a");
    expect(text.startsWith("kind: Pod")).toBe(true);
  });
});
