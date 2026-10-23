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
import type { FleetDefaults, FleetSettings } from "@/services/fleet";

/** Form values are the raw input text; "" means inherit the organization default. */
export type SettingsForm = {
  heartbeat: string;
  offlineHeartbeats: string;
  retentionDays: string;
  offlineRatio: string;
  phaseTimeoutSecs: string;
  observeSecs: string;
  windowSecs: string;
  passPercent: string;
};

type Field = keyof SettingsForm;

const BOUNDS: Record<Field, [number, number]> = {
  heartbeat: [5, 3600],
  offlineHeartbeats: [1, 100],
  retentionDays: [0, 3650],
  offlineRatio: [1, 100],
  phaseTimeoutSecs: [60, 86400],
  observeSecs: [0, 86400],
  windowSecs: [30, 86400],
  passPercent: [1, 100],
};

const GATE: Field[] = ["observeSecs", "windowSecs", "passPercent"];

const text = (v: number | null | undefined) => (v == null ? "" : String(v));

export function toForm(s: Partial<FleetSettings> | null | undefined): SettingsForm {
  return {
    heartbeat: text(s?.heartbeat_interval_secs),
    offlineHeartbeats: text(s?.offline_heartbeats),
    retentionDays: text(s?.retention_days),
    offlineRatio: text(s?.offline_ratio_percent),
    phaseTimeoutSecs: text(s?.phase_timeout_secs),
    observeSecs: text(s?.gate?.observe_secs),
    windowSecs: text(s?.gate?.window_secs),
    passPercent: text(s?.gate?.pass_percent),
  };
}

// A number input may emit a number or its text, so both are read as text.
const str = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (str(v) === "" ? null : Number(str(v)));

/** A gate is overridden as a whole: any gate field set takes the rest from the defaults. */
export function fromForm(v: SettingsForm, defaults: FleetDefaults | null): FleetSettings {
  const anyGate = GATE.some((k) => str(v[k]) !== "");
  return {
    heartbeat_interval_secs: num(v.heartbeat),
    offline_heartbeats: num(v.offlineHeartbeats),
    retention_days: num(v.retentionDays),
    offline_ratio_percent: num(v.offlineRatio),
    phase_timeout_secs: num(v.phaseTimeoutSecs),
    gate: anyGate
      ? {
          observe_secs: num(v.observeSecs) ?? defaults?.gate.observe_secs ?? 600,
          window_secs: num(v.windowSecs) ?? defaults?.gate.window_secs ?? 300,
          pass_percent: num(v.passPercent) ?? defaults?.gate.pass_percent ?? 95,
        }
      : null,
  };
}

/** `required` is the organization form, where every field must hold a value. */
export const makeSettingsSchema = (t: TranslateFn, required: boolean) =>
  z
    .object({
      heartbeat: z.any(),
      offlineHeartbeats: z.any(),
      retentionDays: z.any(),
      offlineRatio: z.any(),
      phaseTimeoutSecs: z.any(),
      observeSecs: z.any(),
      windowSecs: z.any(),
      passPercent: z.any(),
    })
    .superRefine((v, ctx) => {
      for (const key of Object.keys(BOUNDS) as Field[]) {
        const raw = str(v[key]);
        if (raw === "") {
          if (required)
            ctx.addIssue({ code: "custom", path: [key], message: t("fleet.settings.required") });
          continue;
        }
        const [min, max] = BOUNDS[key];
        const n = Number(raw);
        if (!Number.isFinite(n) || n < min || n > max)
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: t("fleet.settings.outOfRange", { min, max }),
          });
      }
    });
