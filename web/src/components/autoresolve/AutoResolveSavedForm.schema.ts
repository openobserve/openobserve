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
import type {
  AutoResolveConnectionRef,
  AutoResolveRun,
  AutoResolveSaved,
} from "@/services/autoresolve";
import type { TranslateFn } from "@/types/i18n";

// The server's limits; a longer value is refused there with the same sentence.
export const NAME_MAX = 100;
export const GOAL_MAX = 4000;

export const TRIGGER_KINDS = ["person", "alert", "incident"] as const;

export const makeAutoResolveSavedSchema = (t: TranslateFn) =>
  z
    .object({
      name: z
        .string()
        .trim()
        .min(1, t("autoresolve.saved.form.nameRequired"))
        .max(NAME_MAX, t("autoresolve.saved.form.tooLong", { max: NAME_MAX })),
      goal: z
        .string()
        .trim()
        .min(1, t("autoresolve.saved.form.goalRequired"))
        .max(GOAL_MAX, t("autoresolve.saved.form.tooLong", { max: GOAL_MAX })),
      connection_ids: z.array(z.string()).min(1, t("autoresolve.connectionPicker.chooseOne")),
      trigger_kind: z.enum(TRIGGER_KINDS),
      trigger_alert_id: z.string(),
    })
    .superRefine((value, ctx) => {
      if (value.trigger_kind !== "person" && !value.trigger_alert_id) {
        ctx.addIssue({
          code: "custom",
          path: ["trigger_alert_id"],
          message: t("autoresolve.saved.form.alertRequired"),
        });
      }
    });

export type AutoResolveSavedFormValues = z.infer<ReturnType<typeof makeAutoResolveSavedSchema>>;

/** The connections the run was started with; an older run without them gives its plan's. */
export function runConnectionRefs(run: AutoResolveRun): AutoResolveConnectionRef[] {
  if (run.connections?.length) return run.connections;
  const chosen = run.plan?.options.find((o) => o.id === run.chosen_option_id);
  const steps = chosen?.steps ?? [
    ...run.steps,
    ...(run.plan?.options.flatMap((o) => o.steps) ?? []),
  ];
  const byId = new Map(steps.map((s) => [s.connection.id, s.connection]));
  return [...byId.values()];
}

/** A run's connections that no longer exist, so a new AutoResolve cannot be prefilled with them. */
export const removedRunConnections = (run: AutoResolveRun): AutoResolveConnectionRef[] =>
  runConnectionRefs(run).filter((c) => c.removed === true);

/** A run's goal, its chosen option's live connections, and its trigger kind and alert. */
function fromRunDefaults(run: AutoResolveRun): AutoResolveSavedFormValues {
  const removed = new Set(removedRunConnections(run).map((c) => c.id));
  const kind = run.trigger.kind;
  return {
    name: run.goal.split("\n")[0].trim().slice(0, NAME_MAX),
    goal: run.goal,
    connection_ids: runConnectionRefs(run)
      .map((c) => c.id)
      .filter((id) => !removed.has(id)),
    trigger_kind: kind === "alert" || kind === "incident" ? kind : "person",
    trigger_alert_id: run.trigger.alert_id ?? "",
  };
}

export function autoresolveSavedDefaults(source: {
  saved?: AutoResolveSaved | null;
  run?: AutoResolveRun | null;
}): AutoResolveSavedFormValues {
  const { saved, run } = source;
  if (saved) {
    return {
      name: saved.name,
      goal: saved.goal,
      connection_ids: saved.connections.map((c) => c.id),
      trigger_kind: saved.trigger.kind,
      trigger_alert_id: saved.trigger.alert_id ?? "",
    };
  }
  if (run) return fromRunDefaults(run);
  return { name: "", goal: "", connection_ids: [], trigger_kind: "person", trigger_alert_id: "" };
}
