// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

import config from "@/aws-exports";
import { raw } from "@/types/i18n";
import type { SyntheticsLocation } from "@/types/synthetics";
import type { NotifyPick, TeamPick } from "@/utils/alerts/prefill/fromAutoObserve";
import {
  SYNTHETIC_PREFILL_KEY,
  clearSyntheticPrefill,
  isInternalUrl,
  syntheticPrefillFor,
  takeSyntheticPrefill,
  writeSyntheticPrefill,
} from "./syntheticPrefill";

const team: TeamPick = {
  name: "ops",
  folderId: "ops-id",
  folderName: "ops",
  source: "folder",
  reason: raw("Where svc-c's 3 alerts live."),
};
const notify: NotifyPick = {
  destinations: ["ops-webhook"],
  reason: raw("svc-c's 3 alerts notify ops-webhook."),
};
const service = { name: "svc-c", cluster: "cluster-k", namespace: "ns-a" };

const location = (overrides: Partial<SyntheticsLocation>): SyntheticsLocation => ({
  id: "loc",
  label: raw("loc"),
  region: "",
  provider: "o2",
  kind: "public",
  enabled: true,
  types: ["http", "browser"],
  status: "online",
  ...overrides,
});

const privateK = location({
  id: "pl-k",
  label: raw("cluster-k agents"),
  kind: "private",
  region: "dc",
});
const publics = ["us-east", "eu-west", "ap-south", "sa-east"].map((id) =>
  location({ id, label: raw(id), region: id }),
);
const internal = { url: "http://svc-c.ns-a.svc.cluster.local:8080/healthz" };

beforeEach(() => sessionStorage.clear());

afterEach(() => {
  config.isEnterprise = "true";
});

describe("syntheticPrefillFor", () => {
  it("an internal service with a ready private location in its cluster runs from there", () => {
    const prefill = syntheticPrefillFor(service, {
      locations: [...publics, privateK],
      address: internal,
      team,
      notify,
    })!;

    expect(prefill).toEqual({
      version: 1,
      source: "autoobserve",
      sourceLabel: "Suggested by AutoObserve for svc-c",
      name: "svc-c health",
      folder: "ops-id",
      type: "http",
      url: internal.url,
      method: "GET",
      locations: ["pl-k"],
      destinations: ["ops-webhook"],
      intervalMinutes: 5,
      tags: ["service:svc-c", "namespace:ns-a", "cluster:cluster-k"],
      suggested: ["folder", "tags", "url", "locations", "destinations"],
      service: { name: "svc-c", cluster: "cluster-k", namespace: "ns-a" },
      evidence: { reach: "private" },
    });
  });

  it("an internal service with no ready location there picks none and does not suggest one", () => {
    const offline = { ...privateK, status: "offline" as const };
    const unknown = { ...privateK, id: "pl-u", live_status_unknown: true };
    const elsewhere = location({ id: "pl-x", label: raw("cluster-x agents"), kind: "private" });
    const prefill = syntheticPrefillFor(service, {
      locations: [...publics, offline, unknown, elsewhere],
      address: internal,
      team,
      notify,
    })!;

    expect(prefill.locations).toEqual([]);
    expect(prefill.suggested).not.toContain("locations");
  });

  it("a public https address runs from three public regions", () => {
    const prefill = syntheticPrefillFor(service, {
      locations: [...publics, location({ id: "off", status: "offline" })],
      address: { url: "https://api.example.com/healthz" },
      team,
      notify,
    })!;

    expect(prefill.locations).toEqual(["us-east", "eu-west", "ap-south"]);
  });

  it("with no address the URL is empty and not marked suggested", () => {
    const prefill = syntheticPrefillFor(service, { locations: [], address: null, team, notify })!;

    expect(prefill.url).toBe("");
    expect(prefill.suggested).not.toContain("url");
  });

  it("writes service, namespace and cluster tags only when discovery has them", () => {
    const prefill = syntheticPrefillFor(
      { name: "svc-c", cluster: null, namespace: null },
      { locations: [], address: null, team, notify },
    )!;

    expect(prefill.tags).toEqual(["service:svc-c"]);
  });

  it("does not mark the org default folder or an empty destination list as suggested", () => {
    const prefill = syntheticPrefillFor(service, {
      locations: [],
      address: null,
      team: { ...team, source: "default", folderId: "default" },
      notify: { destinations: [], reason: "none" },
    })!;

    expect(prefill.suggested).toEqual(["tags"]);
    expect(prefill.folder).toBe("default");
  });

  it("tells internal hosts from public ones", () => {
    expect(isInternalUrl("http://svc-c:8080/healthz")).toBe(true);
    expect(isInternalUrl("http://10.0.3.4/healthz")).toBe(true);
    expect(isInternalUrl("http://svc-c.internal/healthz")).toBe(true);
    expect(isInternalUrl("https://api.example.com/healthz")).toBe(false);
    expect(isInternalUrl("not a url")).toBe(false);
  });
});

describe("evidence behind the field notes", () => {
  const counted = { ...team, alertCount: 3 };
  const notified = { ...notify, alertCount: 2 } as NotifyPick;

  it("carries the alert counts, where the URL came from and how the service is reached", () => {
    const prefill = syntheticPrefillFor(service, {
      locations: [privateK],
      address: { ...internal, from: "traces" },
      team: counted,
      notify: notified,
    })!;

    expect(prefill.evidence).toEqual({
      reach: "private",
      urlFrom: "traces",
      folderAlerts: 3,
      destinationAlerts: 2,
    });
  });

  it("reads a public address as reachable from the internet", () => {
    const prefill = syntheticPrefillFor(service, {
      locations: publics,
      address: { url: "https://api.example.com/healthz", from: "logs" },
      team: counted,
      notify: notified,
    })!;

    expect(prefill.evidence).toMatchObject({ reach: "public", urlFrom: "logs" });
  });

  it("leaves out what it does not know, so no clause is invented", () => {
    const prefill = syntheticPrefillFor(service, {
      locations: [privateK],
      address: null,
      team: { ...team, source: "default", alertCount: undefined },
      notify: { destinations: [], reason: "none" },
    })!;

    expect(prefill).not.toHaveProperty("evidence");
  });

  it("survives the write and the read", () => {
    const prefill = syntheticPrefillFor(service, {
      locations: [privateK],
      address: { ...internal, from: "traces" },
      team: counted,
      notify: notified,
    })!;
    writeSyntheticPrefill(prefill);

    expect(takeSyntheticPrefill()?.evidence).toEqual(prefill.evidence);
  });
});

describe("storage", () => {
  it("reads once and clears", () => {
    const prefill = syntheticPrefillFor(service, { locations: [], address: null, team, notify })!;
    writeSyntheticPrefill(prefill);

    expect(takeSyntheticPrefill()).toEqual(prefill);
    expect(sessionStorage.getItem(SYNTHETIC_PREFILL_KEY)).toBeNull();
    expect(takeSyntheticPrefill()).toBeNull();
  });

  it("ignores and clears a blob of another version or source", () => {
    sessionStorage.setItem(
      SYNTHETIC_PREFILL_KEY,
      JSON.stringify({ version: 2, source: "autoobserve" }),
    );
    expect(takeSyntheticPrefill()).toBeNull();
    expect(sessionStorage.getItem(SYNTHETIC_PREFILL_KEY)).toBeNull();

    sessionStorage.setItem(SYNTHETIC_PREFILL_KEY, JSON.stringify({ version: 1, source: "logs" }));
    expect(takeSyntheticPrefill()).toBeNull();

    sessionStorage.setItem(SYNTHETIC_PREFILL_KEY, "{not json");
    expect(takeSyntheticPrefill()).toBeNull();
  });

  it("clear removes a pending prefill", () => {
    sessionStorage.setItem(SYNTHETIC_PREFILL_KEY, "{}");
    clearSyntheticPrefill();
    expect(sessionStorage.getItem(SYNTHETIC_PREFILL_KEY)).toBeNull();
  });
});

describe("on an OSS build", () => {
  it("builds nothing and reads nothing", () => {
    const prefill = syntheticPrefillFor(service, { locations: [], address: null, team, notify })!;
    writeSyntheticPrefill(prefill);
    config.isEnterprise = "false";

    expect(syntheticPrefillFor(service, { locations: [], address: null, team, notify })).toBeNull();
    expect(takeSyntheticPrefill()).toBeNull();
    expect(sessionStorage.getItem(SYNTHETIC_PREFILL_KEY)).toBeNull();
  });
});
