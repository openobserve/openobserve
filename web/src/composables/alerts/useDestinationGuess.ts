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

import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { alertDependenciesQuery } from "@/services/alerts.queries";

export interface DestinationGuess {
  name: string;
  alertCount: number;
}

interface AlertRow {
  alert_id?: string;
  stream_type?: string;
  stream_name?: string;
  destinations?: string[];
}

/** The destination most alerts on this stream send to; a tie goes to the newest alert's. */
export function guessDestination(
  alerts: readonly AlertRow[],
  streamType: string,
  streamName: string,
): DestinationGuess | null {
  const tally = new Map<string, { count: number; newest: string }>();
  for (const alert of alerts) {
    if (alert?.stream_type !== streamType || alert?.stream_name !== streamName) continue;
    // The list carries no edit time; a KSUID id sorts by creation, the closest it has.
    const id = alert.alert_id ?? "";
    for (const name of new Set(alert.destinations ?? [])) {
      const seen = tally.get(name);
      tally.set(name, {
        count: (seen?.count ?? 0) + 1,
        newest: seen && seen.newest > id ? seen.newest : id,
      });
    }
  }
  let best: (DestinationGuess & { newest: string }) | null = null;
  for (const [name, { count, newest }] of tally) {
    if (!best || count > best.alertCount || (count === best.alertCount && newest > best.newest)) {
      best = { name, alertCount: count, newest };
    }
  }
  return best && { name: best.name, alertCount: best.alertCount };
}

/** Reads the org's alert list with destinations (the dependency view's cached read), never a second fetch. */
export function useDestinationGuess(
  streamType: MaybeRefOrGetter<string | undefined>,
  streamName: MaybeRefOrGetter<string | undefined>,
): { guess: ComputedRef<DestinationGuess | null>; pending: ComputedRef<boolean> } {
  const store = useStore();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const asked = computed(() => !!org.value && !!toValue(streamType) && !!toValue(streamName));
  const alerts = useQuery(() => ({ ...alertDependenciesQuery(org.value), enabled: asked.value }));
  const guess = computed(() =>
    asked.value && alerts.data.value
      ? guessDestination(alerts.data.value, toValue(streamType)!, toValue(streamName)!)
      : null,
  );
  const pending = computed(() => asked.value && alerts.isPending.value && !alerts.isError.value);
  return { guess, pending };
}
