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

import { z } from "zod";
import type { TranslateFn } from "@/types/i18n";
import type { FleetSetDesiredRequest } from "@/services/fleet";

export const STARTS = ["now", "at"] as const;
export const BATCHINGS = ["one", "canary", "progressive"] as const;

// A number input emits a string, so the raw value is validated and coerced when the payload is built.
const isCount = (v: unknown) => v !== "" && Number.isInteger(Number(v)) && Number(v) >= 1;

export const makeRolloutSchema = (t: TranslateFn) =>
  z
    .object({
      fleet: z.string().min(1, t("fleet.rollouts.pickFleet")),
      config: z.string().min(1, t("fleet.rollouts.pickConfig")),
      version: z.number().int().min(1, t("fleet.rollouts.pickVersion")),
      start: z.enum(STARTS),
      when: z.string(),
      batching: z.enum(BATCHINGS),
      first: z.any(),
      initial: z.any(),
      multiplier: z.any(),
      max: z.any(),
      verify: z.boolean(),
      autoRollback: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const counts =
        v.batching === "canary"
          ? ["first"]
          : v.batching === "progressive"
            ? ["initial", "multiplier", "max"]
            : [];
      for (const key of counts) {
        if (!isCount(v[key as "first"]))
          ctx.addIssue({ code: "custom", path: [key], message: t("fleet.rollouts.batchInvalid") });
      }
      if (
        v.batching === "progressive" &&
        isCount(v.initial) &&
        isCount(v.max) &&
        Number(v.max) < Number(v.initial)
      )
        ctx.addIssue({
          code: "custom",
          path: ["max"],
          message: t("fleet.rollouts.maxBelowInitial"),
        });
      if (v.start === "at" && !(new Date(v.when).getTime() > Date.now()))
        ctx.addIssue({
          code: "custom",
          path: ["when"],
          message: t("fleet.rollouts.startAtFuture"),
        });
    });

export type RolloutForm = z.infer<ReturnType<typeof makeRolloutSchema>>;

/** The request for the form's values, or null while a field the server needs is not valid yet. */
export function requestOf(v: RolloutForm): FleetSetDesiredRequest | null {
  if (!v.config || !(v.version > 0)) return null;
  let batching: FleetSetDesiredRequest["batching"];
  if (v.batching === "canary") {
    if (!isCount(v.first)) return null;
    batching = { kind: "canary", first: Number(v.first) };
  } else if (v.batching === "progressive") {
    if (!isCount(v.initial) || !isCount(v.multiplier) || !isCount(v.max)) return null;
    batching = {
      kind: "progressive",
      initial: Number(v.initial),
      multiplier: Number(v.multiplier),
      max: Number(v.max),
    };
  } else batching = { kind: "one" };
  const at = new Date(v.when).getTime();
  if (v.start === "at" && !Number.isFinite(at)) return null;
  return {
    config: v.config,
    version: v.version,
    start: v.start === "at" ? { kind: "at", at } : { kind: "now" },
    batching,
    verify: v.verify,
    auto_rollback: v.autoRollback,
  };
}
