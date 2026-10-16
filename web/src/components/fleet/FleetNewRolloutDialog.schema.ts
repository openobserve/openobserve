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

export const STRATEGIES = ["immediate", "canary", "progressive", "scheduled"] as const;

// A number input emits a string, so the raw value is validated and coerced when the payload is built.
const isCount = (v: unknown) => Number.isInteger(Number(v)) && Number(v) >= 1 && v !== "";

/** Gates need a second phase, which canary and progressive have only when the fleet has more members than the first batch. */
export const planHasPhases = (members: number, initial: unknown) =>
  isCount(initial) && members > Number(initial);

export const makeRolloutSchema = (t: TranslateFn) =>
  z
    .object({
      fleet: z.string().min(1, t("fleet.rollouts.pickFleet")),
      /** The fleet's member count, which the plan is cut from. */
      members: z.number(),
      config: z.string().min(1, t("fleet.rollouts.pickConfig")),
      version: z.number().int().min(1, t("fleet.rollouts.pickVersion")),
      strategy: z.enum(STRATEGIES),
      initial: z.any(),
      multiplier: z.any(),
      max: z.any(),
      when: z.string(),
      gates: z.boolean(),
      autoRollback: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const batched = v.strategy === "canary" || v.strategy === "progressive";
      const counts = v.strategy === "progressive" ? ["initial", "multiplier", "max"] : ["initial"];
      for (const key of batched ? counts : []) {
        if (!isCount(v[key as "initial"]))
          ctx.addIssue({ code: "custom", path: [key], message: t("fleet.rollouts.batchInvalid") });
      }
      if (
        v.strategy === "progressive" &&
        isCount(v.initial) &&
        isCount(v.max) &&
        Number(v.max) < Number(v.initial)
      )
        ctx.addIssue({
          code: "custom",
          path: ["max"],
          message: t("fleet.rollouts.maxBelowInitial"),
        });
      if (v.strategy === "scheduled" && !(new Date(v.when).getTime() > Date.now()))
        ctx.addIssue({
          code: "custom",
          path: ["when"],
          message: t("fleet.rollouts.startAtFuture"),
        });
      if (batched && v.gates && !planHasPhases(v.members, v.initial))
        ctx.addIssue({
          code: "custom",
          path: ["gates"],
          message: t("fleet.rollouts.gatesNeedPhases"),
        });
    });

export type RolloutForm = z.infer<ReturnType<typeof makeRolloutSchema>>;
