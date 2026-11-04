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
import type { TranslateFn } from "@/types/i18n";
import {
  MAX_BODY_KIB,
  httpLimitsDefaults,
  makeHttpLimitsSchema,
} from "./WorkflowHttpAdvanced.schema";

const t = i18n.global.t as unknown as TranslateFn;

describe("WorkflowHttpAdvanced schema", () => {
  const schema = makeHttpLimitsSchema(t, 600);

  it("accepts whole numbers inside both ranges, from the strings number inputs emit", () => {
    expect(schema.parse({ maxBodyKib: "512", rateLimit: "600" })).toEqual({
      maxBodyKib: 512,
      rateLimit: 600,
    });
  });

  it("caps the body at 1024 KiB and the rate at the org budget", () => {
    expect(MAX_BODY_KIB).toBe(1024);
    const body = schema.safeParse({ maxBodyKib: 1025, rateLimit: 60 });
    expect(body.success).toBe(false);
    expect(body.error?.issues[0].message).toBe(t("workflow.http.maxBodyRange"));
    const rate = schema.safeParse({ maxBodyKib: 1024, rateLimit: 601 });
    expect(rate.error?.issues[0].message).toBe(t("workflow.http.rateLimitRange", { org: 600 }));
  });

  it("refuses zero, fractions and empty values", () => {
    for (const bad of [0, 1.5, "", "abc"]) {
      expect(schema.safeParse({ maxBodyKib: bad, rateLimit: 60 }).success, String(bad)).toBe(false);
      expect(schema.safeParse({ maxBodyKib: 1, rateLimit: bad }).success, String(bad)).toBe(false);
    }
  });

  it("defaults read the stored bytes as KiB", () => {
    expect(httpLimitsDefaults(1_048_576, 60)).toEqual({ maxBodyKib: 1024, rateLimit: 60 });
  });
});
