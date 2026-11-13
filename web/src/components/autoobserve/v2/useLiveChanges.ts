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

import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { useI18nTyped } from "@/types/i18n";
import { useOrgId } from "@/composables/query";
import { useNow } from "@/composables/useNow";
import {
  appliedDecisionsQuery,
  useDecisionRoute,
} from "@/composables/autoobserve/useDecisionRoute";
import { applyCopy } from "@/components/alert_calibration/applySuggestion";
import { useAppliedChanges } from "../decisions/appliedChanges";
import { liveFailureOf, liveNotice } from "../live/liveCopy";
import { useHeldSkeleton, useLiveZone } from "../live/liveModel";
import { actorLines, toChanges, type Change } from "./changes";

/** Every apply AutoObserve made, newest first, with the state the change pages render. */
export const useLiveChanges = () => {
  const { t, locale } = useI18nTyped();
  const store = useStore();
  const router = useRouter();
  const orgId = useOrgId();
  const route = useDecisionRoute();
  const zone = useLiveZone();
  const now = useNow();
  const listed = useQuery(() => ({
    ...appliedDecisionsQuery(orgId.value),
    enabled: route.enabled.value,
  }));
  const entries = useAppliedChanges(orgId, () => listed.data.value ?? []);
  const copy = computed(() => applyCopy(t, locale.value));
  const changes = computed<Change[]>(() =>
    toChanges(entries.value, copy.value, zone.value.timeZone),
  );
  // A switched-off route or an OSS build lists nothing but this session's own applies.
  const pending = computed(
    () =>
      route.transport.value === "pending" ||
      (route.enabled.value && listed.data.value === undefined && !listed.isError.value),
  );
  const error = computed(() => {
    if (route.transport.value === "failed") return route.probe.error.value;
    return listed.isError.value && listed.data.value === undefined ? listed.error.value : null;
  });
  const notice = computed(() =>
    error.value ? liveNotice(t, "history", liveFailureOf(error.value)) : null,
  );
  const skeleton = useHeldSkeleton(() => pending.value);
  const retry = () => {
    if (route.transport.value === "failed") void route.probe.refetch();
    else void listed.refetch();
  };
  const me = computed<string | undefined>(() => store.state.userInfo?.email);
  const actorsOf = (change: Change) => actorLines(t, zone.value, change.entry, me.value, now.value);
  /** A new tab, so the page stays where it was; a session row from an older server names no alert. */
  const alertHref = (change: Change): string | null => {
    const alertId = change.entry.view.change?.alert.id ?? change.entry.alertId;
    if (!alertId) return null;
    return router.resolve({
      name: "alertDetail",
      params: { alert_id: alertId },
      query: { org_identifier: change.entry.org },
    }).href;
  };
  const undo = (change: Change) =>
    route.undo([{ org: change.entry.org, view: change.entry.view, title: change.entry.title }]);
  return {
    changes,
    pending,
    skeleton,
    notice,
    busy: computed(() => listed.isFetching.value || route.probe.isFetching.value),
    retry,
    zone,
    now,
    me,
    actorsOf,
    alertHref,
    undo,
    isUndoing: (change: Change) => route.isUndoing(change.id),
  };
};
