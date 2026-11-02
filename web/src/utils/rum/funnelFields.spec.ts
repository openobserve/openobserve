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
import { fieldsOnStep, foldFieldSample, isSampledField } from "@/utils/rum/funnelFields";
import type { StepRef } from "@/utils/rum/productAnalyticsQueries";

const c = (key: string): StepRef => ({ kind: "c", key });
const STEPS = [c("product_viewed"), c("payment_info_submitted"), c("order_completed")];
const FIELDS = ["context_category", "context_coupon", "context_payment_method"];

describe("isSampledField", () => {
  it("keeps the app's own columns and leaves the SDK's out", () => {
    expect(isSampledField("context_payment_method")).toBe(true);
    expect(isSampledField("plan")).toBe(true);
    for (const f of [
      "view_url",
      "action_id",
      "usr_email",
      "user_agent_os_family",
      "date",
      "o2tags",
    ])
      expect(isSampledField(f)).toBe(false);
    expect(isSampledField("geo_info_country")).toBe(false);
    expect(isSampledField("env")).toBe(false);
  });
});

describe("foldFieldSample", () => {
  const rows = [
    { s1: 1, s2: 0, s3: 0, context_category: "shoes" },
    { s1: 1, s2: 0, s3: 0, context_category: "bags" },
    { s1: 1, s2: 0, s3: 0, context_category: "shoes" },
    { s1: 0, s2: 1, s3: 0, context_payment_method: "card" },
    { s1: 0, s2: 1, s3: 0, context_payment_method: "upi" },
    { s1: 0, s2: 1, s3: 0, context_payment_method: "card" },
    { s1: 0, s2: 1, s3: 0, context_payment_method: "cod" },
    { s1: 0, s2: 1, s3: 0, context_payment_method: "paypal" },
    { s1: 0, s2: 0, s3: 1, context_payment_method: "card", context_coupon: "" },
  ];

  it("lists each field at the first step that carries it, with its top values there", () => {
    const { fields } = foldFieldSample(rows, STEPS, FIELDS);
    expect(fields.map((f) => [f.field, f.steps, f.top, f.more, f.many])).toEqual([
      ["context_category", [1], ["shoes", "bags"], 0, false],
      ["context_payment_method", [2, 3], ["card", "cod", "paypal"], 1, false],
    ]);
  });

  it("flags a field with more distinct values than a breakdown can show", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      s1: 1,
      s2: 0,
      s3: 0,
      context_category: `c${i}`,
    }));
    expect(foldFieldSample(many, STEPS, FIELDS).fields[0]).toMatchObject({ many: true });
  });

  it("gives a row that matches two steps to both", () => {
    const both = [{ s1: 1, s2: 1, s3: 0, context_category: "shoes" }];
    const { fields } = foldFieldSample(both, STEPS, FIELDS);
    expect(fields[0]).toMatchObject({ field: "context_category", steps: [1, 2] });
  });

  it("limits a step's list to the fields its events carry", () => {
    const sample = foldFieldSample(rows, STEPS, FIELDS);
    expect(fieldsOnStep(sample, 3).map((f) => f.field)).toEqual(["context_payment_method"]);
    expect(fieldsOnStep(null, 1)).toEqual([]);
  });
});
