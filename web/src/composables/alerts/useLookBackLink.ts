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

import { computed, ref, watch } from "vue";
import { convertMinutesToCron } from "@/utils/zincutils";

/** The setting a link move rewrote: Look back after a Check every edit, or the other way round. */
export type LinkedField = "period" | "frequency";

type Trigger = Record<string, any>;

interface LookBackLinkOptions {
  /** The trigger as the form holds it now (a fresh read, not a render snapshot). */
  trigger: () => Trigger;
  /** Reactive read of the period, to notice values written from outside (load, prefill). */
  period: () => unknown;
  /** Reactive read of Check every in minutes, to follow the user's edits of it. */
  frequency: () => unknown;
  /** An object the form replaces only when it is re-seeded (load, prefill, JSON editor). */
  formSeed: () => unknown;
  minFrequency: () => number;
  emit: (trigger: Trigger) => void;
}

interface Move {
  field: LinkedField;
  value: number;
  previous: unknown;
}

const getBrowserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const isBlank = (value: unknown) => value === undefined || value === null || value === "";

/** Keeps Look back and Check every equal while linked, whichever one the user edits. */
export function useLookBackLink(options: LookBackLinkOptions) {
  // Baseline the link is measured against; re-taken whenever the period changes from outside the handlers.
  let baselinePeriod = Number(options.period());
  let lastHandledPeriod: unknown;
  const followed = ref<number | null>(null);
  const unlinked = ref(false);
  const move = ref<Move | null>(null);

  const rebaseline = (period: unknown) => {
    baselinePeriod = Number(period);
    followed.value = null;
    unlinked.value = false;
    move.value = null;
  };

  // Runs after the handler (pre-flush), so a user edit is recognised by lastHandledPeriod and kept as ours.
  watch(options.period, (period) => {
    if (String(period) !== String(lastHandledPeriod)) rebaseline(period);
  });

  // A new alert's default frequency is raised to the refresh floor, so that raised value is still linked.
  const followedValue = () => followed.value ?? Math.max(baselinePeriod, options.minFrequency());

  // A baseline taken while the period was unset is not finite and leaves nothing to compare, so it still follows.
  const follows = (value: unknown) => {
    if (unlinked.value) return false;
    const target = followedValue();
    return !Number.isFinite(target) || isBlank(value) || Number(value) === target;
  };

  const isCron = (trigger: Trigger) => trigger?.frequency_type === "cron";

  /** Whether Check every follows Look back; a cron schedule has no Check every to follow. */
  const isLinked = () => {
    const trigger = options.trigger() ?? {};
    void options.period();
    void followed.value;
    void unlinked.value;
    if (isCron(trigger)) return false;
    return follows(trigger.frequency);
  };

  /** The last move, while both settings still hold the value it gave them. */
  const lastMove = computed<Move | null>(() => {
    const current = move.value;
    if (!current) return null;
    const trigger = options.trigger() ?? {};
    void options.period();
    const holds =
      Number(trigger.period) === current.value && Number(trigger.frequency) === current.value;
    return holds ? current : null;
  });

  // Typing "15" moves the other setting twice; Undo goes back to before the first keystroke.
  const record = (field: LinkedField, value: number, previous: unknown) => {
    const prior = lastMove.value;
    move.value = { field, value, previous: prior?.field === field ? prior.previous : previous };
  };

  const handlePeriodChange = (value: unknown) => {
    const next: Trigger = { ...options.trigger(), period: value };
    lastHandledPeriod = value;
    const period = Number(value);
    if (period > 0) {
      // A cron schedule the user wrote is what runs the alert, so the period must not replace it.
      if (!isCron(next)) {
        if (period >= options.minFrequency() && follows(next.frequency)) {
          followed.value = period;
          if (Number(next.frequency) !== period) record("frequency", period, next.frequency);
          next.frequency = period;
        }
        next.cron = convertMinutesToCron(period);
      }
      if (!next.timezone) next.timezone = getBrowserTimezone();
    }
    options.emit(next);
  };

  const handleFrequencyChange = (value: unknown, previous: unknown) => {
    const trigger = options.trigger() ?? {};
    const frequency = Number(value);
    if (isCron(trigger) || !(frequency > 0) || !follows(previous)) return;
    followed.value = frequency;
    if (Number(trigger.period) === frequency) return;
    record("period", frequency, trigger.period);
    lastHandledPeriod = frequency;
    options.emit({ ...trigger, period: frequency });
  };

  // Only a write that leaves the period and the rest of the form alone is the user editing Check every.
  watch(
    () => [
      options.frequency(),
      options.period(),
      options.formSeed(),
      options.trigger()?.frequency_type,
    ],
    ([frequency, period, seed, type], [oldFrequency, oldPeriod, oldSeed, oldType]) => {
      if (String(frequency) === String(oldFrequency)) return;
      if (seed !== oldSeed) return rebaseline(period);
      if (type !== oldType || String(period) !== String(oldPeriod)) return;
      handleFrequencyChange(frequency, oldFrequency);
    },
  );

  const emitWithPeriod = (next: Trigger) => {
    lastHandledPeriod = next.period;
    options.emit(next);
  };

  const undo = () => {
    const current = lastMove.value;
    move.value = null;
    if (!current) return;
    unlinked.value = true;
    emitWithPeriod({ ...options.trigger(), [current.field]: current.previous });
  };

  const unlink = () => {
    unlinked.value = true;
    move.value = null;
  };

  /** Sets Check every alone, unlinked, so the look back the condition reads stays as it is. */
  const setCheckEvery = (minutes: number) => {
    unlink();
    emitWithPeriod({ ...options.trigger(), frequency: minutes });
  };

  /** Links again; Check every takes the look back, since the look back is what the condition reads. */
  const relink = () => {
    unlinked.value = false;
    move.value = null;
    const trigger = options.trigger() ?? {};
    const period = Number(trigger.period);
    if (!(period > 0)) return;
    followed.value = period;
    if (period < options.minFrequency() || Number(trigger.frequency) === period) return;
    record("frequency", period, trigger.frequency);
    emitWithPeriod({ ...trigger, frequency: period });
  };

  return { handlePeriodChange, isLinked, lastMove, undo, unlink, relink, setCheckEvery };
}
