// Copyright 2026 OpenObserve Inc.
//
// Validation schemas for AzureMarketplaceSetup.vue. The page hosts TWO
// independent small forms in the "select_org" state:
//   • Create card — a single "newOrgName" text field (required).
//   • Link card  — a single "selectedOrg" select (required; holds the org
//                  identifier, mirroring OSelect's value-key="identifier").
//
// Built via factories so messages stay i18n-driven (pass useI18n's `t`).
// Coupled with AwsMarketplaceSetup.schema.ts — keep the two structurally aligned.

import { z } from "zod";

// ── Create-org card ─────────────────────────────────────────────────────────
export const makeAzureCreateOrgSchema = (t: (_key: string) => string) =>
  z.object({
    newOrgName: z.string().min(1, t("validation.organizationNameRequired")),
  });
export type AzureCreateOrgForm = z.infer<ReturnType<typeof makeAzureCreateOrgSchema>>;
export const azureCreateOrgDefaults = (): AzureCreateOrgForm => ({
  newOrgName: "",
});

// ── Link-existing-org card ──────────────────────────────────────────────────
export const makeAzureLinkOrgSchema = (t: (_key: string) => string) =>
  z.object({
    selectedOrg: z.string().min(1, t("validation.selectOrganization")),
  });
export type AzureLinkOrgForm = z.infer<ReturnType<typeof makeAzureLinkOrgSchema>>;
export const azureLinkOrgDefaults = (): AzureLinkOrgForm => ({
  selectedOrg: "",
});
