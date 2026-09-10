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

// The four toggle values map to the numeric wire impact (0/1/2/3) at submit.
export type ImpactMode = "degraded" | "partial_outage" | "major_outage";

export const makePostUpdateSchema = (t: (k: string) => string) =>
  z.object({
    impact: z.enum(["degraded", "partial_outage", "major_outage"]),
    component_ids: z
      .array(z.string())
      .min(1, t("statusPages.postUpdate.validation.componentsRequired")),
    title: z.string().trim().min(1, t("statusPages.postUpdate.validation.titleRequired")),
    body: z.string().trim().min(1, t("statusPages.postUpdate.validation.messageRequired")),
  });

export type PostUpdateForm = z.infer<ReturnType<typeof makePostUpdateSchema>>;

export const postUpdateDefaults = (componentIds: string[]): PostUpdateForm => ({
  impact: "partial_outage",
  component_ids: componentIds,
  title: "",
  body: "",
});

const IMPACT_WIRE: Record<ImpactMode, 1 | 2 | 3> = {
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

export function impactToWire(mode: ImpactMode): 1 | 2 | 3 {
  return IMPACT_WIRE[mode];
}

const IMPACT_FROM_WIRE: Record<1 | 2 | 3, ImpactMode> = {
  1: "degraded",
  2: "partial_outage",
  3: "major_outage",
};

export function impactFromWire(wire: 0 | 1 | 2 | 3): ImpactMode {
  return IMPACT_FROM_WIRE[wire === 0 ? 1 : wire];
}

// A follow-up narrative on the already-open incident. Impact is optional and
// only ever WIDENS the incident (see the dialog's escalation-only guard) —
// narrowing it back down is what resolving the notice is for.
export const makeAttachUpdateSchema = (t: (k: string) => string) =>
  z.object({
    body: z.string().trim().min(1, t("statusPages.postUpdate.validation.messageRequired")),
    escalateTo: z.enum(["none", "degraded", "partial_outage", "major_outage"]),
  });

export type AttachUpdateForm = z.infer<ReturnType<typeof makeAttachUpdateSchema>>;

export const attachUpdateDefaults = (): AttachUpdateForm => ({
  body: "",
  escalateTo: "none",
});
