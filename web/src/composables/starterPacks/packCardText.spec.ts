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

import i18n from "@/locales";
import type { useI18nTyped } from "@/types/i18n";

import {
  MISSING,
  packCardText,
  type HasKey,
  type PackCardFacts,
  type PackCardKind,
} from "./packCardText";

type Translate = ReturnType<typeof useI18nTyped>["t"];

const t = i18n.global.t as unknown as Translate;
const te = i18n.global.te as unknown as HasKey;

const FULL: PackCardFacts = {
  clusters: ["prod-us-1", "prod-eu-1", "staging-eu-1"],
  stream: "k8s_events",
  alertNames: ["Pod crash looping", "Pod OOM killed", "Replica mismatch", "Node memory high"],
  title: "Kubernetes Overview",
  panels: 24,
};

const text = (packId: string, kind: PackCardKind, over: Partial<PackCardFacts> = {}) =>
  packCardText(t, te, packId, kind, { ...FULL, ...over });

const leaks = (value: string | null) =>
  !value || value.includes(MISSING) || /[{}]|undefined|null|, ,|^\s|\s$|\(\)/.test(value);

describe("packCardText", () => {
  it("fills every Kubernetes card from full facts", () => {
    expect(text("kubernetes", "dashboards")).toBe(
      "Kubernetes Overview: 24 panels for prod-us-1 and 2 more clusters.",
    );
    expect(text("kubernetes", "alerts")).toBe(
      "Pod crash looping, Pod OOM killed, Replica mismatch and 1 more. Fire for every cluster (prod-us-1 and 2 more). Off until you turn them on.",
    );
    expect(text("kubernetes", "savedViews")).toBe(
      "Kubernetes events: every event in k8s_events, one click from Logs.",
    );
  });

  it("names a single cluster without saying clusters", () => {
    expect(text("kubernetes", "dashboards", { clusters: ["staging-eu-1"] })).toBe(
      "Kubernetes Overview: 24 panels for staging-eu-1.",
    );
    expect(text("kubernetes", "alerts", { clusters: ["staging-eu-1"] })).toContain(
      "Fire for every cluster (staging-eu-1).",
    );
  });

  it("falls back to the whole sentence when no cluster is known", () => {
    expect(text("kubernetes", "dashboards", { clusters: [] })).toBe(
      "Kubernetes Overview: every node, pod and workload.",
    );
    expect(text("kubernetes", "alerts", { clusters: [] })).toBe(
      "Pod crash looping, Pod OOM killed, Replica mismatch and 1 more. Fire for every cluster. Off until you turn them on.",
    );
  });

  it("falls back when the panel count is not loaded yet", () => {
    expect(text("kubernetes", "dashboards", { panels: null })).toBe(
      "Kubernetes Overview: every node, pod and workload.",
    );
    expect(text("kubernetes", "dashboards", { panels: 0 })).toBe(
      "Kubernetes Overview: every node, pod and workload.",
    );
  });

  it("drops the names, not the scope, when no alert name is known", () => {
    expect(text("kubernetes", "alerts", { alertNames: [] })).toBe(
      "Fire for every cluster. Off until you turn them on.",
    );
    expect(text("kubernetes", "alerts", { alertNames: ["", " "] })).toBe(
      "Fire for every cluster. Off until you turn them on.",
    );
    expect(text("hosts", "alerts", { alertNames: [] })).toBe(
      "Fire for every host. Off until you turn them on.",
    );
  });

  it("lists up to three alert names, then counts the rest", () => {
    expect(text("hosts", "alerts", { alertNames: ["CPU high", "Out of memory"] })).toBe(
      "CPU high, Out of memory. Fire for every host. Off until you turn them on.",
    );
    expect(text("hosts", "alerts", { alertNames: ["A", "B", "C"] })).toBe(
      "A, B, C. Fire for every host. Off until you turn them on.",
    );
    expect(text("hosts", "alerts", { alertNames: ["A", "B", "C", "D", "E", "F"] })).toBe(
      "A, B, C and 3 more. Fire for every host. Off until you turn them on.",
    );
  });

  it("falls back for the saved view when its stream is not in the data", () => {
    expect(text("kubernetes", "savedViews", { stream: undefined })).toBe(
      "Kubernetes events, one click from Logs.",
    );
  });

  it("keeps the Hosts dashboard line fixed", () => {
    expect(text("hosts", "dashboards", { panels: null, title: undefined })).toBe(
      "Host Metrics: CPU, memory and disk for each host.",
    );
  });

  it("uses the default copy for a pack with none of its own", () => {
    expect(text("postgresql", "dashboards", { title: "PostgreSQL", panels: 1 })).toBe(
      "PostgreSQL: 1 panel for your data.",
    );
    expect(text("postgresql", "dashboards", { title: "PostgreSQL", panels: null })).toBe(
      "PostgreSQL, built for your streams.",
    );
    expect(text("github", "alerts", { alertNames: ["Job errors"] })).toBe(
      "Job errors. Fire across all your matching data. Off until you turn them on.",
    );
    expect(text("github", "alerts", { alertNames: [] })).toBe(
      "Fire across all your matching data. Off until you turn them on.",
    );
    expect(text("traces", "savedViews", { stream: "default" })).toBe(
      "default in Logs, one click away.",
    );
    expect(text("traces", "savedViews", { stream: undefined })).toBe("One click from Logs.");
  });

  it("never leaks a brace, an empty name or half a template", () => {
    const empties: Partial<PackCardFacts>[] = [
      {},
      { clusters: [] },
      { clusters: [""] },
      { alertNames: [] },
      { stream: "" },
      { title: "" },
      { title: undefined, panels: undefined },
      { clusters: [], alertNames: [], stream: undefined, title: undefined, panels: null },
    ];
    const packIds = ["kubernetes", "hosts", "traces", "postgresql", "docker"];
    const kinds: PackCardKind[] = ["dashboards", "alerts", "savedViews"];
    for (const over of empties) {
      for (const packId of packIds) {
        for (const kind of kinds) {
          const value = text(packId, kind, over);
          if (value === null) continue;
          expect(leaks(value), `${packId}/${kind}: ${value}`).toBe(false);
        }
      }
    }
  });

  it("says nothing rather than a broken line when even the fallback needs a missing fact", () => {
    expect(text("postgresql", "dashboards", { title: undefined, panels: null })).toBeNull();
  });
});
