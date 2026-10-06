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

import { z } from "zod";
import { isValidDomain } from "./DomainManagement.schema";

export const BUILT_IN_ROLES = ["admin", "editor", "viewer", "user"] as const;

export interface OrgDomainMapping {
  domain: string;
  org_id: string;
  role_name?: string;
}

export const makeOrgDomainMappingSchema = (t: (_key: string) => string) =>
  z.object({
    // No .trim(): OForm saves the raw value, so the submit handler normalizes it.
    domain: z
      .string()
      .min(1, t("settings.domainRequired"))
      .refine((v) => isValidDomain(v), { message: t("settings.invalidDomain") }),
    org_id: z.string().min(1, t("settings.orgDomainMapping.organizationRequired")),
    role_name: z.string().min(1, t("settings.orgDomainMapping.roleRequired")),
  });

export type OrgDomainMappingForm = z.infer<ReturnType<typeof makeOrgDomainMappingSchema>>;

export const orgDomainMappingDefaults = (orgId = ""): OrgDomainMappingForm => ({
  domain: "",
  org_id: orgId,
  role_name: "user",
});

export const makeOrgSsoSettingsSchema = () =>
  z.object({
    // Clearing the select yields null; an empty string turns the parser off.
    claimParserFunction: z.string().nullable(),
    roleNameClaim: z.string(),
    createMissingRole: z.boolean(),
  });

export type OrgSsoSettingsForm = z.infer<ReturnType<typeof makeOrgSsoSettingsSchema>>;
