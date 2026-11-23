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

import { describe, it, expect, afterEach, vi } from "vitest";
import enLocale from "@/locales/languages/en-US.json";
import type { StatusPageDomain } from "@/services/status_pages";
import { builtInView, proxyView } from "@/test/unit/helpers/statusPageDomains";
import { domainStateBadge, publicPageUrl, shownServingState } from "./statusPageBadges";

const ALL_STATES = [
  ["pending", "default-outline", "statusPages.domains.state.pending", "Pending"],
  ["verified", "success-outline", "statusPages.domains.state.verified", "Verified"],
  [
    "waiting_for_dns",
    "warning-outline",
    "statusPages.domains.state.waitingForDns",
    "Waiting for DNS",
  ],
  ["setting_up", "info-outline", "statusPages.domains.state.settingUp", "Setting up"],
  ["ready", "primary-outline", "statusPages.domains.state.ready", "Ready"],
  ["serving", "success-soft", "statusPages.domains.state.serving", "Serving"],
  ["delayed", "warning-soft", "statusPages.domains.state.delayed", "Delayed"],
  ["not_serving", "error-outline", "statusPages.domains.state.notServing", "Not serving"],
  ["expired", "warning-outline", "statusPages.domains.state.expired", "Expired"],
];

describe("domainStateBadge", () => {
  it.each(ALL_STATES)("gives %s its own variant and label", (state, variant, labelKey, label) => {
    const badge = domainStateBadge(state);

    expect(badge).toEqual({ variant, labelKey });
    const text = labelKey
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        enLocale,
      );
    expect(text).toBe(label);
  });

  it("gives the nine states nine different variant and label pairs", () => {
    const badges = ALL_STATES.map(([state]) => JSON.stringify(domainStateBadge(state)));

    expect(new Set(badges).size).toBe(9);
  });

  it.each(["from_a_newer_backend", ""])(
    "falls back to a neutral badge with no label key for %j",
    (state) => {
      expect(domainStateBadge(state)).toEqual({ variant: "default-soft", labelKey: null });
    },
  );
});

const PROBED = { ...builtInView().evidence, probe_checked_at: 1_700_000_100_000_000 };

function serving(overrides: Partial<StatusPageDomain> = {}): StatusPageDomain {
  return builtInView({
    serving_state: "serving",
    is_holder: true,
    verification_state: 1,
    evidence: PROBED,
    ...overrides,
  });
}

describe("shownServingState", () => {
  it("keeps serving when the probe has been seen", () => {
    expect(shownServingState(serving())).toBe("serving");
  });

  it("shows serving without probe evidence as setting up", () => {
    expect(shownServingState(serving({ evidence: { ...PROBED, probe_checked_at: null } }))).toBe(
      "setting_up",
    );
  });

  it("leaves every other state as it is", () => {
    expect(shownServingState(proxyView({ serving_state: "verified" }))).toBe("verified");
    expect(shownServingState(builtInView({ serving_state: "waiting_for_dns" }))).toBe(
      "waiting_for_dns",
    );
  });
});

describe("publicPageUrl", () => {
  const SLUG_URL = `${window.location.origin}/status/acme`;

  afterEach(() => vi.restoreAllMocks());

  it("is the custom domain's root for a serving domain", () => {
    expect(publicPageUrl("acme", [serving({ domain: "status.brand.com" })])).toBe(
      "https://status.brand.com/",
    );
  });

  it.each([
    ["no domain", []],
    ["domains that could not be loaded", null],
    ["a pending domain", [builtInView({ serving_state: "pending" })]],
    [
      "a verified proxy-mode holder",
      [proxyView({ serving_state: "verified", reason: "proxy_mode" })],
    ],
    ["a waiting domain", [builtInView({ serving_state: "waiting_for_dns" })]],
    ["a setting-up domain", [builtInView({ serving_state: "setting_up" })]],
    ["a ready domain", [builtInView({ serving_state: "ready" })]],
    ["a delayed domain", [builtInView({ serving_state: "delayed" })]],
    ["a not-serving domain", [builtInView({ serving_state: "not_serving" })]],
    ["an expired domain", [builtInView({ serving_state: "expired" })]],
    ["a serving view with no probe evidence", [serving({ evidence: builtInView().evidence })]],
  ] as [string, StatusPageDomain[] | null][])("is the slug URL for %s", (_label, domains) => {
    expect(publicPageUrl("acme", domains)).toBe(SLUG_URL);
  });

  it("takes the serving domain among domains that are not", () => {
    const domains = [
      builtInView({ id: "a", domain: "a.brand.com", serving_state: "pending" }),
      serving({ id: "b", domain: "b.brand.com" }),
    ];

    expect(publicPageUrl("acme", domains)).toBe("https://b.brand.com/");
  });

  it("takes the serving domain with the smallest created_at, whatever the list order", () => {
    const older = serving({ id: "old", domain: "old.brand.com", created_at: 1_000 });
    const newer = serving({ id: "new", domain: "new.brand.com", created_at: 2_000 });

    expect(publicPageUrl("acme", [newer, older])).toBe("https://old.brand.com/");
    expect(publicPageUrl("acme", [older, newer])).toBe("https://old.brand.com/");
  });
});
