// Copyright 2026 OpenObserve Inc.
//
// Validation schemas for AwsMarketplaceSetup.vue. The page hosts TWO
// independent small forms in the "select_org" state:
//   • Create card — a single "newOrgName" text field (required).
//   • Link card  — a single "selectedOrg" select (required; holds the org
//                  identifier, mirroring OSelect's value-key="identifier").
//
// Built via factories so messages stay i18n-driven (pass useI18n's `t`),
// matching the t()-factory style used by the other migrated schemas.
//
// Field rules:
//   newOrgName — `!!v || 'Organization name is required'`
//             → z.string().min(1, t("validation.organizationNameRequired")).
// selectedOrg was enforced imperatively (a toast) → encoded as min(1).
//
// Kept structurally identical to AzureMarketplaceSetup.schema.ts (coupled pair).

import { z } from "zod";

// ── Create-org card ─────────────────────────────────────────────────────────
export const makeAwsCreateOrgSchema = (t: (_key: string) => string) =>
  z.object({
    newOrgName: z.string().min(1, t("validation.organizationNameRequired")),
  });
export type AwsCreateOrgForm = z.infer<ReturnType<typeof makeAwsCreateOrgSchema>>;
export const awsCreateOrgDefaults = (): AwsCreateOrgForm => ({
  newOrgName: "",
});

// ── Link-existing-org card ──────────────────────────────────────────────────
export const makeAwsLinkOrgSchema = (t: (_key: string) => string) =>
  z.object({
    selectedOrg: z.string().min(1, t("validation.selectOrganization")),
  });
export type AwsLinkOrgForm = z.infer<ReturnType<typeof makeAwsLinkOrgSchema>>;
export const awsLinkOrgDefaults = (): AwsLinkOrgForm => ({
  selectedOrg: "",
});
