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
import type { BrowserCheck, BrowserStep } from "@/types/synthetics";
import { buildCreateBrowserTestPayload, mapResponseToBrowserCheck } from "./buildPayload";

/**
 * The cross-repo contract.
 *
 * Every other spec here builds its own fixture and checks one field, so all of
 * them can pass while the bytes actually posted to the server are refused. This
 * one pins the whole payload for a journey that exercises the surface at once:
 * a recorded bundle, a locator the author wrote, a combined one with its parts,
 * an author-owned order, a settle block and a typed assertion.
 *
 * **Its twin is `test_the_payload_the_web_app_sends_validates` in
 * `src/config/src/meta/synthetics.rs`**, which embeds the same JSON and runs it
 * through the real validator. Neither repo can import from the other, so two
 * copies of the same bytes is the only mechanism there is — if they drift, one
 * of them fails.
 */

const COMBINED =
  '[data-test="org-row"] >> internal:and="div >> internal:has-text=/^acme_prod$/"';

function journey(): BrowserStep[] {
  return [
    { id: "s1", action: "navigate", name: "Open app", value: "https://app.test/login" },
    {
      id: "s2",
      action: "type",
      name: "Username",
      value: "omkar",
      locator: {
        candidates: [
          {
            kind: "test_attribute",
            value: '[data-test="login-user-id-field"]',
            origin: "recorded",
          },
        ],
      },
    },
    {
      id: "s3",
      action: "click",
      name: "Switch org",
      locator: {
        candidates: [
          {
            kind: "test_attribute",
            value: COMBINED,
            origin: "composite",
            from: [
              { value: '[data-test="org-row"]' },
              { relation: "and", value: "div >> internal:has-text=/^acme_prod$/" },
            ],
          },
          { kind: "css", value: "#my-own", origin: "authored" },
          { kind: "test_attribute", value: '[data-test="org-row"] >> nth=1', origin: "recorded" },
        ],
        author_ordered: true,
      },
      settle: {
        navigation: { url_pattern: "**/web/**" },
        responses: [{ url_pattern: "**/auth/login", method: "POST", required: false }],
      },
    },
    {
      id: "s4",
      action: "assert",
      name: "Profile visible",
      // No `origin` at all — the shape every bundle recorded before Phase 2b
      // has, which must keep round-tripping while the deploy catches up.
      locator: {
        candidates: [
          { kind: "test_attribute", value: '[data-test="header-my-account-profile-icon"]' },
        ],
      },
      assertion: { kind: "element_visible" },
    },
  ];
}

function check(steps: BrowserStep[] = journey()): BrowserCheck {
  return {
    name: "Cloud login",
    url: "https://app.test/login",
    enabled: true,
    tags: [],
    journey: steps,
    schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
    locations: ["us-east"],
    notifications: { destinations: [] },
    rum: { collect: true, sessionReplay: false },
    capture: { screenshot: "on-fail", trace: "on-fail" },
  };
}

function stepsOf(c: BrowserCheck = check()) {
  const payload = buildCreateBrowserTestPayload(c);
  return (payload.config as Record<string, unknown>).steps;
}

describe("the payload the web app posts", () => {
  it("matches the bytes the Rust validator is tested against", () => {
    expect(stepsOf()).toEqual([
      { id: "s1", action: "navigate", name: "Open app", url: "https://app.test/login" },
      {
        id: "s2",
        action: "fill",
        name: "Username",
        value: "omkar",
        locator: {
          candidates: [
            {
              kind: "test_attribute",
              value: '[data-test="login-user-id-field"]',
              origin: "recorded",
            },
          ],
        },
      },
      {
        id: "s3",
        action: "click",
        name: "Switch org",
        locator: {
          candidates: [
            {
              kind: "test_attribute",
              value: COMBINED,
              origin: "composite",
              from: [
                { value: '[data-test="org-row"]' },
                { value: "div >> internal:has-text=/^acme_prod$/", relation: "and" },
              ],
            },
            { kind: "css", value: "#my-own", origin: "authored" },
            { kind: "test_attribute", value: '[data-test="org-row"] >> nth=1', origin: "recorded" },
          ],
          author_ordered: true,
        },
        settle: {
          navigation: { url_pattern: "**/web/**" },
          responses: [{ url_pattern: "**/auth/login", method: "POST", required: false }],
        },
      },
      {
        id: "s4",
        action: "assert",
        name: "Profile visible",
        locator: {
          candidates: [
            { kind: "test_attribute", value: '[data-test="header-my-account-profile-icon"]' },
          ],
        },
        assertion: { kind: "element_visible" },
      },
    ]);
  });

  // deny_unknown_fields is what closes the arbitrary-code hole, so anything the
  // schema does not declare is a 400 rather than a harmless extra. The editor
  // model carries fields the wire has no home for, and the payload is built key
  // by key precisely so none of them leak.
  it("emits no field the step schema would refuse", () => {
    const allowed = new Set([
      "id",
      "action",
      "name",
      "url",
      "locator",
      "value",
      "key",
      "files",
      "settle",
      "assertion",
      "optional",
      "always_run",
      "timeout_ms",
    ]);
    for (const step of stepsOf() as Record<string, unknown>[]) {
      for (const key of Object.keys(step)) {
        expect(allowed.has(key), `step ${step.id} sent an unknown field "${key}"`).toBe(true);
      }
    }
  });
});

// Save → reopen → save. The editor reconstructs its model from the stored steps
// rather than keeping the payload around, so anything the inbound mapper drops
// is silently deleted the next time the author presses Save. Provenance is the
// obvious casualty: nothing would fail, and healing would later overwrite an
// authored entry because nothing recorded that a human wrote it.
describe("reopening a saved monitor and saving it again", () => {
  function reopened() {
    const config = buildCreateBrowserTestPayload(check()).config;
    return mapResponseToBrowserCheck({
      config,
      target: "https://app.test/login",
      name: "Cloud login",
      enabled: true,
      tags: [],
      locations: ["us-east"],
      destinations: [],
      frequency: { type: "minutes", interval: 5, cron: "" },
    });
  }

  // Everything except the step id, which `mapWireStep` deliberately reassigns:
  // it mints a fresh UUIDv7 per step so two recordings cannot collide on the
  // recorder's `s1`, `s2`, … Worth knowing that the churn is real — stored run
  // results reference `step_id`, so history stops lining up with the journey
  // after a re-save. That predates this work and is not changed by it.
  it("changes nothing but the step ids", () => {
    const strip = (steps: unknown) =>
      (steps as Record<string, unknown>[]).map(({ id: _id, ...rest }) => rest);

    expect(strip(stepsOf({ ...check(), journey: reopened().journey }))).toEqual(strip(stepsOf()));
  });

  it("does reassign every step id", () => {
    const before = (stepsOf() as { id: string }[]).map((s) => s.id);
    const after = (stepsOf({ ...check(), journey: reopened().journey }) as { id: string }[]).map(
      (s) => s.id,
    );

    expect(before).toEqual(["s1", "s2", "s3", "s4"]);
    expect(after.some((id, i) => id === before[i])).toBe(false);
  });

  it("keeps provenance and the author's order across the round trip", () => {
    const reloaded = reopened().journey[2].locator!;

    expect(reloaded.author_ordered).toBe(true);
    expect(reloaded.candidates.map((c) => c.origin)).toEqual(["composite", "authored", "recorded"]);
    // The parts survive too, so the compact row can still describe a combined
    // locator as prose rather than as escaped selector syntax.
    expect(reloaded.candidates[0].from).toEqual([
      { value: '[data-test="org-row"]' },
      { value: "div >> internal:has-text=/^acme_prod$/", relation: "and" },
    ]);
  });
});
