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
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useOrgId } from "@/composables/query";
import { useI18nTyped } from "@/types/i18n";
import {
  activeDismissalsQuery,
  reopenDismissalMutation,
} from "@/services/alert_calibration.queries";
import { alertCalibrationKeys } from "@/services/alert_calibration.querykeys";
import {
  activeIds,
  dismissalCopy,
  type DismissalView,
} from "@/components/alert_calibration/dismissals";

/** The page that owns the list reports a failed refetch, since TanStack keeps the last good rows on screen. */
export function useActiveDismissals(
  options: { reportRefetchFailure?: boolean; freshOnMount?: boolean } = {},
) {
  const { t } = useI18nTyped();
  const orgId = useOrgId();
  const query = useQuery(() => activeDismissalsQuery(orgId.value));
  const active = computed(() => activeIds(query.data.value));
  const byId = computed(
    () =>
      new Map(
        (query.data.value?.items ?? []).filter((v) => v.state === "active").map((v) => [v.id, v]),
      ),
  );
  // A refetch with no data returns the query to pending, so "settled" counts any answer, not the current status.
  const settled = computed(() =>
    options.freshOnMount
      ? query.isFetchedAfterMount.value
      : query.data.value !== undefined || query.errorUpdateCount.value > 0,
  );
  /** No read has succeeded, so the page cannot tell which findings are dismissed; it stays so while a retry runs. */
  const unknown = computed(
    () => query.data.value === undefined && query.errorUpdateCount.value > 0,
  );

  if (options.reportRefetchFailure) {
    watch(
      () => query.errorUpdateCount.value,
      () => {
        if (query.data.value) {
          toast({ message: t("alertCalibration.dismiss.loadFailedTitle"), variant: "error" });
        }
      },
    );
  }

  return { query, active, byId, settled, unknown };
}

/** One click, no confirmation (P5a-D8): reopening hides nothing, and dismissing again undoes it. */
export function useReopenDismissal() {
  const { t, locale } = useI18nTyped();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const mutation = useMutation(() => reopenDismissalMutation(orgId.value));
  const pending = ref<ReadonlySet<string>>(new Set());

  const setPending = (id: string, on: boolean) => {
    const next = new Set(pending.value);
    if (on) next.add(id);
    else next.delete(id);
    pending.value = next;
  };

  async function reopen(view: DismissalView) {
    if (pending.value.has(view.id)) return;
    setPending(view.id, true);
    const copy = dismissalCopy(t, locale.value);
    try {
      await mutation.mutateAsync({ id: view.id, revision: view.revision });
      toast({ message: copy.reopened(), variant: "success" });
    } catch (error) {
      const result = copy.reopenResult(error);
      if (result.refetch) {
        void queryClient.invalidateQueries({
          queryKey: alertCalibrationKeys.dismissals(orgId.value),
        });
      }
      toast({ message: result.text, variant: result.variant });
    } finally {
      setPending(view.id, false);
    }
  }

  return { reopen, isPending: (id: string) => pending.value.has(id) };
}
