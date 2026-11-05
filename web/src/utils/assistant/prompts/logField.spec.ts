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
  ROW_US,
  expectNoInjection,
  expectPromptRules,
} from "./__fixtures__/prompts";
import { buildLogFieldPrompt, type LogFieldInput } from "./logField";
import { REDACTED } from "./redact";

const input = (over: Partial<LogFieldInput> = {}): LogFieldInput => ({
  org: "default",
  stream: "default",
  field: "http_status",
  value: 502,
  row: { _timestamp: ROW_US, _o2_id: "r1", http_status: 502 },
  range: RANGE,
  timeZone: "UTC",
  ...over,
});

describe("buildLogFieldPrompt", () => {
  it("pins the wording; the value is only in the chip (S10)", () => {
    const build = buildLogFieldPrompt(input());
    expect(build.text).toBe(
      "Explain the field `http_status` in this log row from `default` at 13:57:46 UTC. Its name and value are in the attached Field block. What does this value mean and is it expected?",
    );
    expect(build.text).not.toContain("502");
    expectPromptRules(build);
  });

  it("attaches {field, value} with the name, never the value alone (D9)", () => {
    const [chip] = buildLogFieldPrompt(input()).chips;
    expect(chip).toMatchObject({
      kind: "field",
      label: "Field · http_status = 502",
      data: { field: "http_status", value: 502, stream: "default" },
      ref: { type: "log_field", stream: "default", from: RANGE.from, to: RANGE.to },
    });
  });

  it.each(["password", "api_key", "x-auth-token", "client_secret"])(
    "redacts the value of a secret-named field %s in the chip, label and title (F1)",
    (field) => {
      const build = buildLogFieldPrompt(input({ field, value: "hunter22" }));
      expect(JSON.stringify(build)).not.toContain("hunter22");
      expect(build.chips[0].data).toMatchObject({ field, value: REDACTED });
      expect(build.title).toContain(REDACTED);
    },
  );

  it("gives two fields of one row two chips, and one field the same chip twice", () => {
    const a = buildLogFieldPrompt(input()).chips[0].id;
    const b = buildLogFieldPrompt(input({ field: "service", value: "checkout" })).chips[0].id;
    expect(a).not.toBe(b);
    expect(buildLogFieldPrompt(input()).chips[0].id).toBe(a);
  });

  it("puts the dashboard panel in the chip, never in the text", () => {
    const build = buildLogFieldPrompt(input({ row: undefined, panelTitle: "Errors" }));
    expect(build.text).toContain(
      "the dashboard panel it came from are in the attached Field block",
    );
    expect(build.text).not.toContain("Errors");
    expect(build.chips[0].data).toMatchObject({ panel: "Errors" });
  });

  it("keeps a planted string in every input out of the text (S1)", () => {
    const build = buildLogFieldPrompt(
      input({ field: INJECTION, value: INJECTION, stream: INJECTION, panelTitle: INJECTION }),
    );
    expectNoInjection(build);
    expect(build.text).toContain("Explain the field in this log row");
  });
});
