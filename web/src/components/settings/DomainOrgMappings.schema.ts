// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the add/edit dialog behind the Domain → organization
// mappings section of OrganizationSettings.vue. Only the dialog is
// OForm-validated; the rendered mapping list is display state merged into the
// org-settings payload at submit (the same composite exception CrossLinkManager
// takes). Validation TIMING is owned by OForm; this file describes WHAT is valid.

import { z } from "zod";
import { isValidDomain } from "./DomainManagement.schema";

// The only values the backend accepts. `allowed_user` is the OpenFGA relation
// name for the User role, not a separate role — see user_fga_role() in core.
export const DOMAIN_ORG_BASE_ROLES = ["admin", "editor", "viewer", "allowed_user"] as const;

export type DomainOrgBaseRole = (typeof DOMAIN_ORG_BASE_ROLES)[number];

export interface DomainOrgMapping {
  domain: string;
  org_id: string;
  base_role: DomainOrgBaseRole;
  user_group?: string;
}

export const makeDomainOrgMappingSchema = (t: (_key: string) => string) =>
  z.object({
    // NO .trim(): OForm validates with the schema but saves the raw value, so a
    // trim here would let " acme.com" pass and persist the space.
    domain: z
      .string()
      .min(1, t("settings.domainRequired"))
      .refine((v) => isValidDomain(v), { message: t("settings.invalidDomain") }),
    org_id: z.string().min(1, t("settings.domainOrgMappings.organizationRequired")),
    base_role: z.enum(DOMAIN_ORG_BASE_ROLES),
    // "" is the cleared state of the group select; normalized away at submit.
    user_group: z.string().optional(),
  });

export type DomainOrgMappingForm = z.infer<ReturnType<typeof makeDomainOrgMappingSchema>>;

export const domainOrgMappingDefaults = (): DomainOrgMappingForm => ({
  domain: "",
  org_id: "",
  base_role: "admin",
  user_group: "",
});
