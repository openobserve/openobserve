// Copyright 2026 OpenObserve Inc.
//
// Validation schema + synthetic-email helpers for AddServiceAccount.vue.
//
// The form asks only for a NAME (a lowercase slug); the UI derives the stored
// identifier as `<name>.<org_id>@sa.internal` — org-scoped so two orgs creating
// the same name can never collide.
//
// The exact shape is dictated by the backend EMAIL_REGEX, which requires a
// letters-only final domain label and forbids underscores anywhere in the
// domain, so the org id must live in the LOCAL part (which permits underscores,
// digits, and mixed case). `k1.my_org1@sa.internal`, `k1._meta@sa.internal`,
// and ksuid cloud orgs all pass; an org-in-domain scheme like `k1@sa.my_org1`
// would be rejected server-side. The fixed `sa.internal` domain uses the
// ICANN-reserved `.internal` TLD, so it can never collide with a real
// registrable domain. The whole identifier is lowercased to match the backend,
// which lowercases emails on save.
//
// `name` is CREATE-ONLY: required + slug + length-capped in create mode (the
// local part `<name>.<org_id>` must stay within the 64-char email local-part
// limit, so the cap is org-dependent). In update mode the field is neither
// rendered nor submitted, so it is skipped. `first_name` (the description) and
// the `roles`/`groups` pickers are always optional.

import { z } from "zod";

export const SERVICE_ACCOUNT_EMAIL_DOMAIN = "sa.internal";

// Lowercase slug: letters/digits, optional interior hyphens, no leading or
// trailing hyphen. Dots and underscores are excluded so `.` stays the
// name/org separator in the synthesized identifier.
export const serviceAccountNameRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

// Email local parts are capped at 64 chars; the local part is `<name>.<org>`.
export const maxServiceAccountNameLength = (orgId: string) =>
  Math.max(1, 64 - orgId.length - 1);

const serviceAccountSuffix = (orgId: string) =>
  `.${orgId}@${SERVICE_ACCOUNT_EMAIL_DOMAIN}`.toLowerCase();

export const buildServiceAccountEmail = (name: string, orgId: string) =>
  `${name}${serviceAccountSuffix(orgId)}`.toLowerCase();

// Synthetic identifiers are recognized per-org (`.<org_id>@sa.internal`
// exactly), so a legacy real email — even one under some other domain — never
// false-positives against the current org.
export const isSyntheticServiceAccountEmail = (email: string, orgId: string) =>
  email.toLowerCase().endsWith(serviceAccountSuffix(orgId));

// Friendly display name for a synthetic identifier: strip `.<org>@sa.internal`.
// Legacy (real-email) accounts fall through unchanged.
export const serviceAccountDisplayName = (email: string, orgId: string) => {
  const suffix = serviceAccountSuffix(orgId);
  const lower = email.toLowerCase();
  return lower.endsWith(suffix) ? lower.slice(0, -suffix.length) : email;
};

// The form always carries every editable field (`name`/`roles`/`groups` are
// empty in update mode); the type derives straight from this base shape.
const addServiceAccountBaseSchema = z.object({
  name: z.string(),
  first_name: z.string(),
  roles: z.array(z.string()),
  groups: z.array(z.string()),
});

export type AddServiceAccountForm = z.infer<typeof addServiceAccountBaseSchema>;

// `name` is CREATE-ONLY, modelled as a conditional superRefine so the base
// shape (and its z.infer type) stay stable across modes. The component supplies
// `beingUpdated` and the org-dependent `maxNameLength`.
export const makeAddServiceAccountSchema = (
  beingUpdated: boolean,
  t: (_key: string, _named?: Record<string, unknown>) => string,
  maxNameLength: number,
) =>
  addServiceAccountBaseSchema.superRefine((val, ctx) => {
    if (beingUpdated) return;
    if (
      val.name.length < 1 ||
      val.name.length > maxNameLength ||
      !serviceAccountNameRegex.test(val.name)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: t("serviceAccounts.nameInvalid", { max: maxNameLength }),
      });
    }
  });
