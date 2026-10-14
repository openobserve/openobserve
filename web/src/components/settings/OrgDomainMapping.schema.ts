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

// The backend accepts only these; `allowed_user` is the OpenFGA name of the User role.
export const BASE_ROLES = ["admin", "editor", "viewer", "allowed_user"] as const;
export type BaseRole = (typeof BASE_ROLES)[number];

export const LINK_METHODS = ["dns", "request"] as const;
export type LinkMethod = (typeof LINK_METHODS)[number];

type Translate = (_key: string) => string;

export const makeOrgDomainMappingSchema = (t: Translate) =>
  z.object({
    domain: z.string().min(1, t("settings.orgDomainMapping.domainRequired")),
    org_id: z.string().min(1, t("settings.orgDomainMapping.organizationRequired")),
    base_role: z.enum(BASE_ROLES),
    role_claim_name: z.string(),
    create_missing_roles: z.boolean(),
  });

export type OrgDomainMappingForm = z.infer<ReturnType<typeof makeOrgDomainMappingSchema>>;

export const orgDomainMappingDefaults = (orgId = "", domain = ""): OrgDomainMappingForm => ({
  domain,
  org_id: orgId,
  base_role: "allowed_user",
  role_claim_name: "",
  create_missing_roles: false,
});

export const makeLinkDomainSchema = (t: Translate) =>
  z.object({
    // No .trim(): OForm saves the raw value, so the submit handler normalizes it.
    domain: z
      .string()
      .min(1, t("settings.domainRequired"))
      .refine((v) => isValidDomain(v), { message: t("settings.invalidDomain") }),
    method: z.enum(LINK_METHODS),
  });

export type LinkDomainForm = z.infer<ReturnType<typeof makeLinkDomainSchema>>;

export const linkDomainDefaults = (): LinkDomainForm => ({ domain: "", method: "dns" });

// Read lazily: one form serves both approve (reason optional) and reject (reason required).
export const makeRequestDecisionSchema = (t: Translate, isReasonRequired: () => boolean) =>
  z.object({ reason: z.string() }).superRefine((value, ctx) => {
    if (isReasonRequired() && value.reason.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: t("settings.orgDomainMapping.reasonRequired"),
      });
    }
  });

export type RequestDecisionForm = z.infer<ReturnType<typeof makeRequestDecisionSchema>>;
