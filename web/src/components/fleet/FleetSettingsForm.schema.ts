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
  phaseTimeoutMin: string;
  observeMin: string;
  windowMin: string;
  passPercent: string;
};

type Field = keyof SettingsForm;

const BOUNDS: Record<Field, [number, number]> = {
  heartbeat: [5, 3600],
  offlineHeartbeats: [1, 100],
  retentionDays: [0, 3650],
  offlineRatio: [1, 100],
  phaseTimeoutMin: [1, 1440],
  observeMin: [0, 1440],
  windowMin: [1, 1440],
  passPercent: [1, 100],
};

const GATE: Field[] = ["observeMin", "windowMin", "passPercent"];

const text = (v: number | null | undefined) => (v == null ? "" : String(v));
const minutes = (secs: number | null | undefined) => (secs == null ? "" : String(secs / 60));

export function toForm(s: Partial<FleetSettings> | null | undefined): SettingsForm {
  return {
    heartbeat: text(s?.heartbeat_interval_secs),
    offlineHeartbeats: text(s?.offline_heartbeats),
    retentionDays: text(s?.retention_days),
    offlineRatio: text(s?.offline_ratio_percent),
    phaseTimeoutMin: minutes(s?.phase_timeout_secs),
    observeMin: minutes(s?.gate?.observe_secs),
    windowMin: minutes(s?.gate?.window_secs),
    passPercent: text(s?.gate?.pass_percent),
  };
}

// A number input may emit a number or its text, so both are read as text.
const str = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (str(v) === "" ? null : Number(str(v)));
const secs = (v: unknown) => (str(v) === "" ? null : Math.round(Number(str(v)) * 60));

/** A gate is overridden as a whole: any gate field set takes the rest from the defaults. */
export function fromForm(v: SettingsForm, defaults: FleetDefaults | null): FleetSettings {
  const anyGate = GATE.some((k) => str(v[k]) !== "");
  return {
    heartbeat_interval_secs: num(v.heartbeat),
    offline_heartbeats: num(v.offlineHeartbeats),
    retention_days: num(v.retentionDays),
    offline_ratio_percent: num(v.offlineRatio),
    phase_timeout_secs: secs(v.phaseTimeoutMin),
    gate: anyGate
      ? {
          observe_secs: secs(v.observeMin) ?? defaults?.gate.observe_secs ?? 600,
          window_secs: secs(v.windowMin) ?? defaults?.gate.window_secs ?? 300,
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
      phaseTimeoutMin: z.any(),
      observeMin: z.any(),
      windowMin: z.any(),
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
