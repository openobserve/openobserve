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

/**
 * Credential payloads: ingestion tokens, the org passcode, RUM tokens and
 * synthetics agent tokens.
 *
 * Every one of these is `persist: "none"`, explicitly, on every query in this
 * file — not by accident of tier. They would otherwise be org configuration by
 * shape and land in localStorage. The override is what stops a token reaching
 * disk, so it must survive anyone re-tiering these later.
 */

import organizationsService from "@/services/organizations";
import apiKeysService from "@/services/api_keys";
import syntheticsService from "@/services/synthetics";
import { qk } from "../queryKeys";
import { tierOptions } from "../tiers";
import { queryClient } from "../queryClient";

/** Memory-only, short-lived: a credential list should not outlive the page. */
const SECRET = tierOptions("ENTITY_LIST", { persist: "none" });

const ingestionTokensOptions = (org: string) => ({
  queryKey: [...qk.organizations.root(org), "ingestionTokens"] as const,
  queryFn: async (): Promise<any> => (await organizationsService.list_org_ingestion_tokens(org)).data,
  ...SECRET,
});

export const fetchIngestionTokens = (org: string): Promise<any> =>
  queryClient.fetchQuery(ingestionTokensOptions(org));

export const invalidateIngestionTokens = (org: string) =>
  queryClient.invalidateQueries({ queryKey: [...qk.organizations.root(org), "ingestionTokens"] });

const passcodeOptions = (org: string) => ({
  queryKey: [...qk.organizations.root(org), "passcode"] as const,
  queryFn: async (): Promise<any> =>
    (await organizationsService.get_organization_passcode(org)).data,
  ...SECRET,
});

export const fetchOrgPasscode = (org: string): Promise<any> =>
  queryClient.fetchQuery(passcodeOptions(org));

export const invalidateOrgPasscode = (org: string) =>
  queryClient.invalidateQueries({ queryKey: [...qk.organizations.root(org), "passcode"] });

const rumTokensOptions = (org: string) => ({
  queryKey: [...qk.organizations.root(org), "rumTokens"] as const,
  queryFn: async (): Promise<any> => (await apiKeysService.listRUMTokens(org)).data,
  ...SECRET,
});

export const fetchRumTokens = (org: string): Promise<any> =>
  queryClient.fetchQuery(rumTokensOptions(org));

export const invalidateRumTokens = (org: string) =>
  queryClient.invalidateQueries({ queryKey: [...qk.organizations.root(org), "rumTokens"] });

const agentTokensOptions = (org: string) => ({
  queryKey: [...qk.synthetics.root(org), "agentTokens"] as const,
  queryFn: async (): Promise<any> => (await syntheticsService.listAgentTokens(org)).data,
  ...SECRET,
});

export const fetchAgentTokens = (org: string): Promise<any> =>
  queryClient.fetchQuery(agentTokensOptions(org));

export const invalidateAgentTokens = (org: string) =>
  queryClient.invalidateQueries({ queryKey: [...qk.synthetics.root(org), "agentTokens"] });
