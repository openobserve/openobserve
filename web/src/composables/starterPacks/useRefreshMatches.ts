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

import { computed, onScopeDispose, ref } from "vue";

import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import { STARTER_PACKS } from "./kubernetesPack";
import type { PackInstallRecord } from "./types";
import { useBrowserMatches, type BrowserInterrupted } from "./useBrowserMatches";
import { useFindMore } from "./useFindMore";
import { useInstallRecords } from "./useInstallRecords";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const LOCAL_TIME: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

// Same counting as the setup flow's progress: folders are not items, kept items were never made.
const progressOf = (record: PackInstallRecord) => {
  const items = record.items.filter(({ kind }) => kind !== "folder");
  return {
    done: items.filter(({ status }) => status === "created").length,
    total: items.filter(({ status }) => status !== "existing" && status !== "skipped").length,
  };
};

/** Runs the full match check and saves it as this browser's copy; shared by the header chip and the Starter Packs page. */
export function useRefreshMatches(org: string) {
  const { t } = useI18nTyped();
  const finder = useFindMore(org);
  const records = useInstallRecords(org);
  const matches = useBrowserMatches(org);
  const running = ref(false);
  const nowMs = ref(Date.now());
  const clock = setInterval(() => (nowMs.value = Date.now()), MINUTE_MS);
  onScopeDispose(() => clearInterval(clock));

  const installState = async () => {
    const live = await Promise.all(
      STARTER_PACKS.map(async (pack) => ({
        pack,
        rows: (await records.list(pack.id)).filter(({ status }) => status !== "removed"),
      })),
    );
    const installedPackIds = live
      .filter(({ rows }) => rows.some(({ status }) => status === "complete"))
      .map(({ pack }) => pack.id);
    let interrupted: BrowserInterrupted | null = null;
    for (const { pack, rows } of live) {
      const stopped = rows.find(({ status }) => status !== "complete");
      if (stopped && !interrupted) {
        interrupted = { packId: pack.id, label: t(pack.titleKey), ...progressOf(stopped) };
      }
    }
    return { installedPackIds, interrupted };
  };

  const refresh = async (): Promise<boolean> => {
    if (running.value) return false;
    running.value = true;
    try {
      await finder.check();
      const result = finder.result.value;
      if (finder.state.value !== "ready" || !result) throw new Error("check failed");
      const { installedPackIds, interrupted } = await installState();
      matches.saveFull(result, installedPackIds, interrupted);
      nowMs.value = Date.now();
      return true;
    } catch {
      // The last good result stays; the header never shows an error state.
      toast({
        variant: "error",
        message: t("starterPacks.matchCheck.failed"),
        action: { label: t("common.retry"), handler: () => void refresh() },
      });
      return false;
    } finally {
      running.value = false;
    }
  };

  const checkedAt = computed(() => matches.copy.value?.checkedAt ?? null);

  const checkedLabel = computed((): I18nText | null => {
    if (checkedAt.value === null) return null;
    const age = Math.max(0, nowMs.value - checkedAt.value);
    let when: I18nText;
    if (age < MINUTE_MS) when = t("starterPacks.matchCheck.justNow");
    else if (age < HOUR_MS) {
      const count = Math.floor(age / MINUTE_MS);
      when = t("starterPacks.matchCheck.minutesAgo", { count }, count);
    } else if (age < DAY_MS) {
      const count = Math.floor(age / HOUR_MS);
      when = t("starterPacks.matchCheck.hoursAgo", { count }, count);
    } else {
      const count = Math.floor(age / DAY_MS);
      when = t("starterPacks.matchCheck.daysAgo", { count }, count);
    }
    return t("starterPacks.matchCheck.checked", { when });
  });

  const checkedTip = computed((): I18nText | null =>
    checkedAt.value === null
      ? null
      : t("starterPacks.matchCheck.checkedAt", {
          time: raw(new Date(checkedAt.value).toLocaleString(undefined, LOCAL_TIME)),
        }),
  );

  return { running, refresh, checkedLabel, checkedTip };
}
