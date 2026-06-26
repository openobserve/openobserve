// Copyright 2026 OpenObserve Inc.
//
// Validation schemas for AzureMarketplaceSetup.vue. The page hosts TWO
// independent small forms in the "select_org" state:
//   • Create card — a single "newOrgName" text field (required).
//   • Link card  — a single "selectedOrg" select (required; holds the org
//                  identifier, mirroring OSelect's value-key="identifier").
//
// Restored from the Quasar BEFORE baseline:
//   newOrgName — `!!v || 'Organization name is required'`
//             → z.string().min(1, "Organization name is required").
// selectedOrg was enforced imperatively (a toast) → encoded as min(1).
//
// Kept structurally identical to AwsMarketplaceSetup.schema.ts (coupled pair).

import { z } from "zod";

// ── Create-org card ─────────────────────────────────────────────────────────
export const azureCreateOrgSchema = z.object({
  newOrgName: z.string().min(1, "Organization name is required"),
});
export type AzureCreateOrgForm = z.infer<typeof azureCreateOrgSchema>;
export const azureCreateOrgDefaults = (): AzureCreateOrgForm => ({
  newOrgName: "",
});

// ── Link-existing-org card ──────────────────────────────────────────────────
export const azureLinkOrgSchema = z.object({
  selectedOrg: z.string().min(1, "Please select an organization"),
});
export type AzureLinkOrgForm = z.infer<typeof azureLinkOrgSchema>;
export const azureLinkOrgDefaults = (): AzureLinkOrgForm => ({
  selectedOrg: "",
});
