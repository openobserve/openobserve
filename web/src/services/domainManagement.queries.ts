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

import { mutationOptions, queryOptions } from "@tanstack/vue-query";
import domainManagement from "./domainManagement";
import { domainManagementKeys } from "./domainManagement.querykeys";
import { userKeys } from "./users.querykeys";
import {
  buildDomainRestrictionsBody,
  enablingAppliesDormantRules,
  parseDomainRestrictions,
  withBlockedEmail,
  withoutBlockedEmail,
  type DomainRestrictions,
} from "@/utils/domainRestrictions";

/** `dormant-rules`: nothing was written, as enabling the config would start applying its rules. */
export type BlockWriteOutcome = "saved" | "dormant-rules";

const readDomainRestrictions = async (metaOrg: string): Promise<DomainRestrictions> =>
  parseDomainRestrictions((await domainManagement.getDomainRestrictions(metaOrg)).data);

// The SSO management page writes this config without a mutation, so every load asks the server.
export const domainRestrictionsQuery = (metaOrg: string) =>
  queryOptions({
    queryKey: domainManagementKeys.config(metaOrg),
    queryFn: () => readDomainRestrictions(metaOrg),
    staleTime: 0,
  });

export const setUserBlockedMutation = (metaOrg: string) =>
  mutationOptions({
    // Read-modify-write: starts from the server's copy so a concurrent edit is not overwritten.
    mutationFn: async (vars: { email: string; blocked: boolean }): Promise<BlockWriteOutcome> => {
      const current = await readDomainRestrictions(metaOrg);
      if (enablingAppliesDormantRules(current)) return "dormant-rules";
      const next = vars.blocked
        ? withBlockedEmail(current, vars.email)
        : withoutBlockedEmail(current, vars.email);
      await domainManagement.updateDomainRestrictions(metaOrg, buildDomainRestrictionsBody(next));
      return "saved";
    },
    meta: {
      invalidates: [domainManagementKeys.all(metaOrg), userKeys.usersAll(metaOrg)],
      silentError: true,
    },
  });
