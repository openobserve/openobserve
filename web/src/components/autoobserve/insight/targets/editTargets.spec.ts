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

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/services/http", () => ({ default: () => ({ get }) }));
vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/stores", () => ({
  default: { state: { selectedOrganization: { identifier: "demo-org" } } },
}));

import config from "@/aws-exports";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import { applyCopy } from "@/components/alert_calibration/applySuggestion";
import { editAlertRoute } from "@/components/alert_calibration/alertEditorLink";
import { ALERT_PREFILL_KEY, takeAlertEditHandoff } from "@/utils/alerts/alertPrefillStorage";
import { isEditHandoffPrefill, planEditHandoff } from "@/utils/alerts/alertEditHandoff";
import type { TranslateFn } from "@/types/i18n";
import { destinationHandoff, handoffCopy, reviewTarget } from "./editTargets";

const stored = () => JSON.parse(sessionStorage.getItem(ALERT_PREFILL_KEY) ?? "null");

beforeEach(() => {
  queryClient.clear();
  sessionStorage.clear();
  get.mockReset();
  get.mockResolvedValue({
    data: { list: [{ alert_id: "a1", name: "svc_c_errors", folder_id: "ops" }] },
  });
});

afterEach(() => {
  config.isEnterprise = "true";
});

describe("reviewTarget", () => {
  it("writes a handoff the editor accepts and links with prefill=autoobserve", async () => {
    const route = await reviewTarget("a1", "query", { alertName: "svc_c_errors" });

    expect(route).toEqual({
      name: "editAlert",
      params: { alert_id: "a1" },
      query: { org_identifier: "demo-org", prefill: "autoobserve", folder: "ops" },
    });
    expect(stored()).toEqual({
      version: 1,
      source: "calibration",
      target: { alertId: "a1", findingId: "" },
      focus: "query",
    });
    expect(planEditHandoff(stored(), { id: "a1" }, [])).toMatchObject({
      status: "review",
      focusField: "query",
    });
    expect(takeAlertEditHandoff("a1")).not.toBeNull();
    expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
  });

  it("focuses the threshold, and settings focuses nothing, as calibration's Review settings does", async () => {
    await reviewTarget("a1", "threshold");
    expect(stored().focus).toBe("threshold");

    await reviewTarget("a1", "settings");
    expect(stored()).not.toHaveProperty("focus");
  });

  it("leaves the folder to the editor when the alert name is unknown", async () => {
    const route = await reviewTarget("a1", "query");

    expect(route?.query).toEqual({ org_identifier: "demo-org", prefill: "autoobserve" });
    expect(get).not.toHaveBeenCalled();
  });

  it("calibration callers still get prefill=calibration", () => {
    expect(editAlertRoute("demo-org", "a1", "ops").query.prefill).toBe("calibration");
  });
});

describe("destinationHandoff", () => {
  it("fills in the suggested destination and focuses destinations", async () => {
    await destinationHandoff("a1", ["ops-webhook"]);

    expect(stored()).toMatchObject({
      focus: "destinations",
      patch: { destinations: { from: [], to: ["ops-webhook"] } },
    });
    expect(planEditHandoff(stored(), { id: "a1", destinations: [] }, ["ops-webhook"]).status).toBe(
      "apply",
    );
  });

  it("states the current destinations, so an alert changed since reads as stale", async () => {
    await destinationHandoff("a1", ["ops-webhook", "ops-webhook"], { current: ["old-hook"] });

    expect(stored().patch.destinations).toEqual({ from: ["old-hook"], to: ["ops-webhook"] });
    expect(planEditHandoff(stored(), { id: "a1", destinations: [] }, ["ops-webhook"]).status).toBe(
      "stale",
    );
  });

  it("with nothing to suggest, only opens the editor at destinations", async () => {
    await destinationHandoff("a1", []);

    expect(stored()).toEqual({
      version: 1,
      source: "calibration",
      target: { alertId: "a1", findingId: "" },
      focus: "destinations",
    });
  });
});

describe("a handoff whose click is no longer current (F11)", () => {
  const lateFolder = () => {
    let answer!: (value: unknown) => void;
    get.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    return () =>
      answer({ data: { list: [{ alert_id: "a1", name: "svc_c_errors", folder_id: "ops" }] } });
  };
  const newer = JSON.stringify({ version: 1, source: "calibration", target: { alertId: "b1" } });

  it("never writes over a newer handoff when the org changed during the folder lookup", async () => {
    let current = true;
    const answer = lateFolder();
    const route = destinationHandoff("a1", ["ops-webhook"], {
      alertName: "svc_c_errors",
      isCurrent: () => current,
    });
    current = false;
    sessionStorage.setItem(ALERT_PREFILL_KEY, newer);
    answer();
    expect(await route).toBeNull();
    expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBe(newer);
  });

  it("drops a review handoff the same way", async () => {
    let current = true;
    const answer = lateFolder();
    const route = reviewTarget("a1", "query", {
      alertName: "svc_c_errors",
      isCurrent: () => current,
    });
    current = false;
    sessionStorage.setItem(ALERT_PREFILL_KEY, newer);
    answer();
    expect(await route).toBeNull();
    expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBe(newer);
  });
});

describe("the editor's reading of prefill=autoobserve", () => {
  it("is a handoff only on the edit route of an enterprise build", () => {
    expect(isEditHandoffPrefill("autoobserve", true)).toBe(true);
    expect(isEditHandoffPrefill("autoobserve", false)).toBe(false);
    expect(isEditHandoffPrefill("calibration", false)).toBe(true);
    expect(isEditHandoffPrefill("logs", true)).toBe(false);

    config.isEnterprise = "false";
    expect(isEditHandoffPrefill("autoobserve", true)).toBe(false);
    expect(isEditHandoffPrefill("calibration", true)).toBe(true);
  });

  it("the banner names AutoObserve for its handoffs and keeps calibration's words otherwise", () => {
    const base = applyCopy(i18n.global.t as unknown as TranslateFn, "en-US");
    const fields = [{ key: "destinations" as const, from: [], to: ["ops-webhook"], live: [] }];

    expect(handoffCopy("autoobserve", base).review()).toBe(
      "Opened from an AutoObserve suggestion.",
    );
    expect(handoffCopy("autoobserve", base).applied(fields)).toBe(
      "Suggested by AutoObserve: Destinations No destination → ops-webhook. Review, then click Save.",
    );
    expect(handoffCopy("calibration", base).review()).toBe(
      "Opened from an Alert calibration finding.",
    );
  });
});

describe("on an OSS build", () => {
  it("no edit target is built and nothing is written", async () => {
    config.isEnterprise = "false";

    expect(await reviewTarget("a1", "query")).toBeNull();
    expect(await destinationHandoff("a1", ["ops-webhook"])).toBeNull();
    expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
  });
});
