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

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "@/locales";
import { raw, type TranslateFn } from "@/types/i18n";
import type { ProtocolCheck } from "@/types/synthetics";
import {
  blankHttpCheck as blankCheck,
  internalPrefill,
  prefillLocations as locations,
  publicPrefill,
} from "@/test/unit/mockData/syntheticPrefill";
import {
  SYNTHETIC_PREFILL_KEY,
  takeSyntheticPrefill,
  writeSyntheticPrefill,
  type SyntheticPrefillInput,
} from "./syntheticPrefillContract";
import {
  applySyntheticPrefill,
  buildSyntheticPrefillView,
  chipFieldsOf,
  isInternalHost,
  pickPrefillLocations,
  reachOf,
  readSyntheticPrefill,
  runsPerDay,
} from "./useSyntheticPrefill";

const t = i18n.global.t as unknown as TranslateFn;
const DESCRIPTION = raw("Created from an AutoObserve suggestion for svc-c on Nov 6.");

function viewFor(prefill: SyntheticPrefillInput, check: ProtocolCheck, extra = {}) {
  return buildSyntheticPrefillView(prefill, check, {
    t,
    locale: "en-us",
    locations,
    chosenLocations: new Set(pickPrefillLocations(prefill.locations, locations, reachOf(prefill))),
    description: DESCRIPTION,
    preSaveRun: null,
    ...extra,
  });
}

function prefilledCheck(prefill: SyntheticPrefillInput) {
  const check = applySyntheticPrefill(blankCheck(), prefill, DESCRIPTION);
  const ids = pickPrefillLocations(prefill.locations, locations, reachOf(prefill));
  return { ...check, locations: ids };
}

describe("synthetic prefill storage", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it("reads the prefill once, so a reload shows the plain form", () => {
    writeSyntheticPrefill(internalPrefill);
    expect(takeSyntheticPrefill()?.name).toBe("svc-c health");
    expect(takeSyntheticPrefill()).toBeNull();
    expect(sessionStorage.getItem(SYNTHETIC_PREFILL_KEY)).toBeNull();
  });

  it("ignores a prefill of another version or source", () => {
    sessionStorage.setItem(
      SYNTHETIC_PREFILL_KEY,
      JSON.stringify({ ...internalPrefill, version: 2 }),
    );
    expect(takeSyntheticPrefill()).toBeNull();
    sessionStorage.setItem(SYNTHETIC_PREFILL_KEY, "{not json");
    expect(takeSyntheticPrefill()).toBeNull();
  });
});

describe("readSyntheticPrefill gate", () => {
  const open = {
    isEnterprise: "true",
    prefillQuery: "autoobserve",
    checkType: "http" as const,
  };
  beforeEach(() => writeSyntheticPrefill(internalPrefill));
  afterEach(() => sessionStorage.clear());

  it("reads on an enterprise create visit that asks for the AutoObserve prefill", () => {
    expect(readSyntheticPrefill(open)?.service.name).toBe("svc-c");
  });

  it.each([
    ["an OSS build", { isEnterprise: "false" }],
    ["another prefill value", { prefillQuery: "calibration" }],
    ["no prefill query", { prefillQuery: undefined }],
    ["a TCP check", { checkType: "tcp" as const }],
    ["a browser test", { checkType: "browser" as never }],
    ["an edit", { editId: "check-1" }],
  ])("stays shut and leaves the prefill stored for %s", (_label, override) => {
    expect(readSyntheticPrefill({ ...open, ...override })).toBeNull();
    expect(sessionStorage.getItem(SYNTHETIC_PREFILL_KEY)).not.toBeNull();
  });
});

describe("prefill rules", () => {
  it("fills every field of the check from the prefill", () => {
    const check = applySyntheticPrefill(blankCheck(), internalPrefill, DESCRIPTION);
    expect(check).toMatchObject({
      name: "svc-c health",
      folder: "ops",
      description: DESCRIPTION,
      url: "http://svc-c.ns-a.svc.cluster.local:8080/healthz",
      locations: ["cluster-k-agents", "us-east"],
      notifications: { destinations: ["ops-webhook"] },
      schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
      alertIfFails: 2,
    });
    expect(check.http?.method).toBe("GET");
    expect(check.http?.assertions).toEqual([
      { field: "status_code", operator: "eq", value: "200" },
    ]);
  });

  it("writes service, namespace and cluster as separate tags", () => {
    const check = applySyntheticPrefill(blankCheck(), internalPrefill, DESCRIPTION);
    expect(check.tags).toEqual(["service:svc-c", "namespace:ns-a", "cluster:cluster-k"]);
  });

  it("adds the service tag when the prefill forgot it", () => {
    const check = applySyntheticPrefill(
      blankCheck(),
      { ...internalPrefill, tags: [] },
      DESCRIPTION,
    );
    expect(check.tags).toEqual(["service:svc-c"]);
  });

  it("leaves the URL empty when AutoObserve found none", () => {
    const unknown = { ...internalPrefill, url: "" };
    expect(applySyntheticPrefill(blankCheck(), unknown, DESCRIPTION).url).toBe("");
    expect([...chipFieldsOf(unknown)]).not.toContain("url");
  });

  it("marks exactly the inferred fields", () => {
    expect([...chipFieldsOf(internalPrefill)].sort()).toEqual(
      ["destinations", "folder", "locations", "tags", "url"].sort(),
    );
    const some = {
      ...internalPrefill,
      suggested: ["name", "folder"] as SyntheticPrefillInput["suggested"],
    };
    expect([...chipFieldsOf(some)]).toEqual(["folder"]);
  });

  it.each([
    ["svc-c.ns-a.svc.cluster.local", true],
    ["svc-c", true],
    ["10.2.3.4", true],
    ["172.20.0.1", true],
    ["checkout.demo.test", false],
    ["8.8.8.8", false],
  ])("treats %s as internal: %s", (host, internal) => {
    expect(isInternalHost(host)).toBe(internal);
  });

  it("picks only the ready private location for an internal service", () => {
    expect(
      pickPrefillLocations(["cluster-k-agents", "us-east", "dc-east"], locations, "private"),
    ).toEqual(["cluster-k-agents"]);
  });

  it("picks the public regions for a public address and never an unknown id", () => {
    expect(
      pickPrefillLocations([...publicPrefill.locations, "made-up"], locations, "public"),
    ).toEqual(["us-east", "eu-west", "ap-south"]);
  });

  it("counts runs a day per location", () => {
    const every5 = {
      type: "interval" as const,
      intervalValue: 5,
      intervalUnit: "minutes" as const,
    };
    expect(runsPerDay(every5, 1)).toBe(288);
    expect(runsPerDay(every5, 3)).toBe(864);
    expect(runsPerDay(every5, 0)).toBeNull();
    expect(runsPerDay({ type: "cron", cron: "0 * * * * *" }, 1)).toBeNull();
  });
});

describe("prefill view copy", () => {
  it("explains each inferred field of an internal service", () => {
    const view = viewFor(internalPrefill, prefilledCheck(internalPrefill));
    expect(view.where).toBe("cluster-k / ns-a");
    expect(view.notes).toEqual({
      folder: "Where svc-c's 3 alerts live.",
      description: "Kept with the check, so reviewers can see where it came from.",
      tags: "Links this check to svc-c in AutoObserve, whatever its URL looks like.",
      url: "From svc-c's traces: in-cluster address, port 8080 and the health route /healthz.",
      destinations: "svc-c's 3 alerts notify ops-webhook. Change it if your team uses another.",
    });
  });

  it("says why the public locations are not selected for an internal service", () => {
    const view = viewFor(internalPrefill, prefilledCheck(internalPrefill));
    expect(view.locationNotes.map((n) => [n.key, n.text])).toEqual([
      [
        "public",
        "Not selected: svc-c isn't reachable from the internet, so a public location would fail every run.",
      ],
      [
        "private",
        "A private location is an agent inside your network that runs checks. svc-c runs in cluster-k, and these agents run there too.",
      ],
    ]);
    expect(view.runsPerDay).toBe("288 runs a day");
    expect(view.afterRuns).toBe("The check runs every 5 minutes from cluster-k agents.");
    expect(view.afterNotify).toBe("If 2 runs in a row fail, ops-webhook is notified.");
  });

  it("says why no private location is needed for a public address", () => {
    const view = viewFor(publicPrefill, prefilledCheck(publicPrefill));
    expect(view.where).toBe("public address");
    expect(view.locationNotes.map((n) => n.text)).toEqual([
      "Not selected: the address is public, so no agent inside your network is needed.",
    ]);
    expect(view.notes.url).toBe(
      "From checkout's traces: the public server address and its health route.",
    );
    expect(view.runsPerDay).toBe("864 runs a day across 3 regions");
    expect(view.afterRuns).toBe("The check runs every 5 minutes from 3 public regions.");
  });

  it("asks for the URL when AutoObserve found none, and drops the note once typed", () => {
    const unknown = { ...internalPrefill, url: "" };
    const check = prefilledCheck(unknown);
    expect(viewFor(unknown, check).notes.url).toBe(
      "svc-c's URL isn't in its traces or logs, so you enter it; location, folder and destination are filled in.",
    );
    expect(viewFor(unknown, { ...check, url: "http://svc-c:8080/" }).notes.url).toBeUndefined();
  });

  it("drops a note once its field no longer holds the suggestion", () => {
    const check = {
      ...prefilledCheck(internalPrefill),
      folder: "pay",
      notifications: { destinations: ["pager"] },
    };
    const view = viewFor(internalPrefill, check);
    expect(view.notes.folder).toBeUndefined();
    expect(view.notes.destinations).toBeUndefined();
  });

  it("drops the counts it has no evidence for", () => {
    const bare = { ...internalPrefill, evidence: undefined };
    const view = viewFor(bare, prefilledCheck(bare));
    expect(view.notes.folder).toBe("Where svc-c's alerts live.");
    expect(view.notes.destinations).toBe(
      "svc-c's alerts notify ops-webhook. Change it if your team uses another.",
    );
    expect(view.notes.url).toBeUndefined();
  });

  it("states the alert rule without a location quorum until the server offers one", () => {
    const check = prefilledCheck(publicPrefill);
    expect(viewFor(publicPrefill, check).alertLine).toBe("Alert after 2 failed runs in a row.");
    const preSaveRun = { quorum: 2, run: async () => ({ ok: true, location: "US East" }) };
    const withQuorum = viewFor(publicPrefill, check, { preSaveRun });
    expect(withQuorum.alertLine).toBe("Alert after 2 failed runs in a row from 2 of 3 locations.");
    expect(withQuorum.afterNotify).toBe(
      "If 2 of the 3 locations fail 2 runs in a row, ops-webhook is notified.",
    );
  });

  it("lists many destinations as three names and a count", () => {
    const many = { ...internalPrefill, destinations: ["a", "b", "c", "d", "e"] };
    const view = viewFor(many, prefilledCheck(many));
    expect(view.afterNotify).toBe("If 2 runs in a row fail, a, b, c, and 2 more are notified.");
  });

  it("says who is told when nobody is", () => {
    const none = { ...internalPrefill, destinations: [] };
    expect(viewFor(none, prefilledCheck(none)).afterNotify).toBe(
      "If 2 runs in a row fail, no one is notified until you choose a destination.",
    );
  });

  it("uses the synthetic check term and never probe or uptime", () => {
    const messages = JSON.stringify(
      (i18n.global.getLocaleMessage("en-us") as any).synthetics.prefill,
    ).toLowerCase();
    expect(messages).toContain("synthetic check");
    expect(messages).not.toMatch(/probe|uptime/);
  });
});

describe("prefill view when the org's lists fail to load", () => {
  const both = { unconfirmed: new Set(["locations", "destinations"]) };

  it("warns that the suggested locations and destinations are not confirmed", () => {
    const check = applySyntheticPrefill(blankCheck(), internalPrefill, DESCRIPTION);
    const view = viewFor(internalPrefill, check, both);
    expect(view.unconfirmed).toEqual({
      locations:
        "Locations didn't load, so the suggested ones aren't confirmed. Refresh the list before you save.",
      destinations:
        "Destinations didn't load, so the suggested ones aren't confirmed. Refresh the list before you save.",
    });
    expect(view.notes.destinations).toBeUndefined();
  });

  it("drops a warning once its field no longer holds the suggestion", () => {
    const check = {
      ...applySyntheticPrefill(blankCheck(), internalPrefill, DESCRIPTION),
      locations: ["eu-west"],
      notifications: { destinations: ["pager"] },
    };
    expect(viewFor(internalPrefill, check, both).unconfirmed).toEqual({});
  });

  it("warns about nothing while the lists load or after they do", () => {
    const view = viewFor(internalPrefill, prefilledCheck(internalPrefill));
    expect(view.unconfirmed).toEqual({});
  });
});
