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

import {
  INJECTION,
  RANGE,
  RANGE_TEXT,
  expectNoInjection,
  expectPromptRules,
} from "./__fixtures__/prompts";
import { buildAlertFiringPrompt, type AlertFiringInput } from "./alertFiring";

const input = (over: Partial<AlertFiringInput> = {}): AlertFiringInput => ({
  org: "default",
  alertId: "a1",
  name: "Checkout 5xx",
  firedAt: Date.UTC(2026, 9, 14, 13, 57, 0),
  observed: { value: 73, unit: "events" },
  threshold: { op: ">", value: 50, unit: "events" },
  window: RANGE,
  stream: "default",
  query: "SELECT count(*) FROM default WHERE code >= 500",
  timeZone: "UTC",
  ...over,
});

describe("buildAlertFiringPrompt", () => {
  it("pins the wording: observed value with unit, threshold and window; name, stream and query in the chip", () => {
    const build = buildAlertFiringPrompt(input());
    expect(build.text).toBe(
      `The alert in the attached Alert block fired at 2026-10-14 13:57:00 UTC: observed 73 events against threshold > 50 events over the evaluated window ${RANGE_TEXT}. The block holds its name, stream and query. Why did it fire and what changed?`,
    );
    expect(build.chips[0].data).toEqual({
      name: "Checkout 5xx",
      stream: "default",
      condition: input().query,
    });
    expectPromptRules(build);
  });

  it("chips one firing as `Alert · {name} · fired {HH:mm}` and titles the thread by time", () => {
    const build = buildAlertFiringPrompt(input());
    expect(build.chips[0]).toMatchObject({
      kind: "alert",
      label: "Alert · Checkout 5xx · fired 13:57",
      ref: { type: "alert_firing" },
    });
    expect(build.title).toBe("Alert · Checkout 5xx · 13:57");
  });

  it("omits what the row does not know", () => {
    const build = buildAlertFiringPrompt(
      input({
        observed: undefined,
        threshold: undefined,
        window: undefined,
        stream: undefined,
        query: "",
      }),
    );
    expect(build.text).toBe(
      "The alert in the attached Alert block fired at 2026-10-14 13:57:00 UTC. The block holds its name, stream and query. Why did it fire and what changed?",
    );
  });

  it("gives two firings of one alert two chips", () => {
    const a = buildAlertFiringPrompt(input()).chips[0].id;
    const b = buildAlertFiringPrompt(input({ firedAt: Date.UTC(2026, 9, 14, 14, 0, 0) })).chips[0]
      .id;
    expect(a).not.toBe(b);
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    expectNoInjection(
      buildAlertFiringPrompt(
        input({
          name: INJECTION,
          stream: INJECTION,
          query: INJECTION,
          observed: { value: 1, unit: INJECTION },
        }),
      ),
    );
  });
});
