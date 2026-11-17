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

import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import config from "@/aws-exports";
import { useOrgId } from "@/composables/query";
import autoobserve, { type AutoObservePagingSettings } from "@/services/autoobserve";
import { autoobservePagingQuery } from "@/services/autoobserve.queries";
import { autoobserveKeys } from "@/services/autoobserve.querykeys";
import type { I18nText, TranslateFn } from "@/types/i18n";
import { liveFailureOf, type LiveFailure } from "./liveCopy";

export type PagingWriteError = "denied" | "failed";

interface HttpErrorLike {
  response?: { status?: number; data?: { error?: unknown } };
}

const isSettings = (value: unknown): value is AutoObservePagingSettings =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as AutoObservePagingSettings).page_on_stop === "boolean" &&
  typeof (value as AutoObservePagingSettings).available === "boolean";

/** The shared denial and failure words a paging write ends in. */
export const pagingWriteErrorText = (t: TranslateFn, error: PagingWriteError): I18nText =>
  error === "denied"
    ? t("autoobserveLive.paging.denied", {
        denied: t("insight.decisions.error.denied"),
        askAdmin: t("accessBoundary.denied.askAdmin"),
      })
    : t("insight.decisions.error.failed");

/** The org's paging switch: `missing` on an OSS build or a server without the route, so callers keep today's UI. */
export function usePagingSetting() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const enterprise = config.isEnterprise === "true";
  const query = useQuery(() => ({ ...autoobservePagingQuery(orgId.value), enabled: enterprise }));
  const saving = ref(false);
  const pending = ref(false);
  const writeError = ref<PagingWriteError | null>(null);

  const settings = computed(() => query.data.value ?? null);
  const missing = computed(() => !enterprise || query.data.value === null);
  const loading = computed(() => enterprise && query.isPending.value);
  const loadFailed = computed(() => enterprise && query.isError.value);
  const loadFailure = computed<LiveFailure | null>(() =>
    loadFailed.value ? liveFailureOf(query.error.value) : null,
  );
  const available = computed(() => settings.value?.available !== false);
  // The switch shows the value being written, so a refused write flips it back; a deployment that cannot page reads off.
  const checked = computed(() =>
    saving.value ? pending.value : available.value && !!settings.value?.page_on_stop,
  );
  const retrying = computed(() => query.isFetching.value);
  const retry = () => query.refetch();

  async function set(next: boolean) {
    const org = orgId.value;
    const current = settings.value;
    if (saving.value || !current || !current.available) return;
    saving.value = true;
    pending.value = next;
    writeError.value = null;
    try {
      const body = (await autoobserve.setPagingSettings(org, { page_on_stop: next })).data;
      queryClient.setQueryData(
        autoobserveKeys.pagingSettings(org),
        isSettings(body) ? body : { ...current, page_on_stop: next },
      );
    } catch (error) {
      const response = (error as HttpErrorLike | null)?.response;
      if (response?.status === 409 && response.data?.error === "paging_unavailable") {
        queryClient.setQueryData(autoobserveKeys.pagingSettings(org), {
          ...current,
          available: false,
        });
      } else {
        writeError.value = response?.status === 403 ? "denied" : "failed";
      }
    } finally {
      saving.value = false;
    }
  }

  return {
    orgId,
    settings,
    missing,
    loading,
    loadFailed,
    loadFailure,
    retry,
    retrying,
    checked,
    available,
    saving,
    writeError,
    set,
  };
}
