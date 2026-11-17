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

import { computed, type Ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import incidentsService from "@/services/incidents";
import securityCases, { type CaseRef, type PromoteFiring } from "@/services/securityCases";
import { caseLookupQuery, securityCaseKeys } from "@/services/securityCases.queries";

/** Triage from the Alerts page: every action lands on the case the firing belongs to. */
export function useAlertTriage(orgId: Ref<string>, alertIds: Ref<string[]>, enabled: Ref<boolean>) {
  const client = useQueryClient();
  const lookup = useQuery(() =>
    Object.assign(caseLookupQuery(orgId.value, alertIds.value), {
      enabled: enabled.value && !!orgId.value && alertIds.value.length > 0,
    }),
  );
  const caseByAlert = computed<Record<string, CaseRef>>(() => lookup.data.value ?? {});

  /** Open cases among the looked-up ones, one entry per case. */
  const openCases = computed<CaseRef[]>(() => {
    const seen = new Map<string, CaseRef>();
    for (const c of Object.values(caseByAlert.value)) seen.set(c.id, c);
    return [...seen.values()];
  });

  const refetch = () => client.invalidateQueries({ queryKey: securityCaseKeys.all(orgId.value) });

  async function acknowledge(caseId: string) {
    await incidentsService.updateStatus(orgId.value, caseId, "acknowledged");
    await refetch();
  }

  async function addNote(caseId: string, alertName: string, note: string) {
    await incidentsService.postComment(orgId.value, caseId, `${alertName}: ${note}`);
  }

  async function promote(firings: PromoteFiring[], caseId?: string) {
    const res = await securityCases.promote(orgId.value, firings, caseId);
    await refetch();
    return res.data;
  }

  return { caseByAlert, openCases, lookup, acknowledge, addNote, promote };
}
