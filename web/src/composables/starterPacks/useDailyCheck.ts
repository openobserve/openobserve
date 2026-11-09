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

import { ref } from "vue";
import { useMutation } from "@tanstack/vue-query";

import { readQuery } from "@/composables/query/readQuery";
import { deleteKvMutation, kvValueQuery, setKvMutation } from "@/services/kv.queries";

import { DAILY_ON_KEY, LAST_CHECK_KEY, type FindMoreResult } from "./findMore";
import { useFindMoreCheck } from "./useFindMore";

export const DAILY_CHECK_US = 24 * 60 * 60 * 1_000_000;

const running = new Set<string>();

/** The opt-in daily suggestion check; it stores matches and never creates anything. */
export function useDailyCheck(org: string) {
  const runner = useFindMoreCheck(org);
  const setKv = useMutation(() => setKvMutation(org));
  const deleteKv = useMutation(() => deleteKvMutation(org));
  const enabled = ref(false);
  const last = ref<FindMoreResult | null>(null);
  const loaded = ref(false);

  const load = async () => {
    try {
      enabled.value = (await readQuery(kvValueQuery(org, DAILY_ON_KEY), true)) === "1";
    } catch {
      enabled.value = false;
    }
    last.value = enabled.value ? await runner.readLast() : null;
    loaded.value = true;
  };

  const setEnabled = async (on: boolean) => {
    if (on) await setKv.mutateAsync({ key: DAILY_ON_KEY, value: "1" });
    else await deleteKv.mutateAsync(DAILY_ON_KEY);
    enabled.value = on;
  };

  /** Runs when the last check anyone in the org made is a day old; true when it ran. */
  const runIfDue = async (): Promise<boolean> => {
    if (running.has(org)) return false;
    running.add(org);
    try {
      await load();
      if (!enabled.value) return false;
      const nowUs = Date.now() * 1000;
      if (last.value && nowUs - last.value.checkedAt < DAILY_CHECK_US) return false;
      // Claimed before the slow check, so a second user opening the app meanwhile skips it.
      const previous = last.value;
      await runner.writeLast({ checkedAt: nowUs, sources: previous?.sources ?? [], dismissed: 0 });
      try {
        last.value = await runner.check();
      } catch (error) {
        // Released, so a failed run is retried on the next app open instead of in a day.
        await (previous ? runner.writeLast(previous) : deleteKv.mutateAsync(LAST_CHECK_KEY)).catch(
          () => {},
        );
        throw error;
      }
      await runner.writeLast(last.value);
      return true;
    } catch {
      return false;
    } finally {
      running.delete(org);
    }
  };

  return { enabled, last, loaded, load, setEnabled, runIfDue };
}
