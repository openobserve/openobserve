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

import { computed, ref, type Ref } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import settings from "@/services/settings";
import { settingQuery } from "@/services/settings.queries";
import { settingKeys } from "@/services/settings.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useI18nTyped } from "@/types/i18n";
import type { StartChoice, StartDefault, StarterKind, StarterPane } from "./createStarter.types";

const SETTING_CATEGORY = "ui";
const CHOICES: readonly StartChoice[] = ["ai", "library", "form"];

/** What the first-open rule needs to know about one pane. */
export interface StartCandidate {
  id: StarterPane["id"];
  /** Available AND has a body to show. */
  openable: boolean;
  count: number | null;
}

// One ref per storage key, so every starter of a kind sees a use recorded by another.
const lastRefs = new Map<string, Ref<StartChoice | null>>();

const isChoice = (v: unknown): v is StartChoice => CHOICES.includes(v as StartChoice);

export const parseStartDefault = (v: unknown): StartDefault =>
  v === "last" || isChoice(v) ? v : "last";

export const startLastKey = (org: string, kind: StarterKind) => `o2:start_last:${org}:${kind}`;

const readLast = (key: string): StartChoice | null => {
  try {
    const v = window.localStorage.getItem(key);
    return isChoice(v) ? v : null;
  } catch {
    return null;
  }
};

const lastRef = (key: string): Ref<StartChoice | null> => {
  let r = lastRefs.get(key);
  if (!r) {
    r = ref(readLast(key));
    lastRefs.set(key, r);
  }
  return r;
};

/** The stored default; else the last choice used; else the first pane not known to be empty; else the form. */
export function resolveStart(
  def: StartDefault,
  last: StartChoice | null,
  panes: readonly StartCandidate[],
): StartChoice {
  const can = (c: StartChoice) => c === "form" || panes.some((p) => p.id === c && p.openable);
  if (def !== "last" && can(def)) return def;
  if (last && can(last)) return last;
  // count is null while loading or failed, so only a known 0 rules a pane out.
  return panes.find((p) => p.openable && p.count !== 0)?.id ?? "form";
}

export function useStartPreference(kind: StarterKind) {
  const store = useStore();
  const { t } = useI18nTyped();
  const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
  const userId = computed<string>(() => store.state.userInfo?.email ?? "");
  const settingKey = `start_with_${kind}`;

  const setting = useQuery(() =>
    Object.assign(settingQuery(org.value, settingKey, userId.value), {
      enabled: !!org.value && !!userId.value,
    }),
  );
  const def = computed<StartDefault>(() => parseStartDefault(setting.data.value));

  const last = computed<StartChoice | null>(() => lastRef(startLastKey(org.value, kind)).value);

  const setDefault = async (v: StartDefault) => {
    if (!org.value || !userId.value) return;
    const cacheKey = settingKeys.one(org.value, settingKey, userId.value);
    const prev = queryClient.getQueryData(cacheKey);
    // A personal preference: show the pick at once and roll back if the write fails.
    queryClient.setQueryData(cacheKey, v);
    try {
      await settings.setUserSetting(org.value, userId.value, settingKey, v, SETTING_CATEGORY);
    } catch {
      queryClient.setQueryData(cacheKey, prev);
      toast({ variant: "error", message: t("createStarter.saveDefaultFailed") });
    }
  };

  const recordUse = (choice: StartChoice) => {
    const key = startLastKey(org.value, kind);
    lastRef(key).value = choice;
    try {
      window.localStorage.setItem(key, choice);
    } catch {
      // Storage off (private window): the choice still counts for this page's life.
    }
  };

  return { def, last, setDefault, recordUse };
}
