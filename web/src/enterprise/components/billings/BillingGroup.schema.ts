// Copyright 2026 OpenObserve Inc.
//
// Validation schema for the "Invite Organization" drawer in BillingGroup.vue.
// Built via a factory: both messages are i18n-driven (`t`), and the current
// org id is read at validation time through a getter (it can change between
// opens).
//
// Two rules:
//   • inviteOrgId required;
//   • cannot invite your own org.

import { z } from "zod";

export const makeBillingGroupInviteSchema = (
  t: (_key: string) => string,
  getCurrentOrg: () => string,
) =>
  z
    .object({
      inviteOrgId: z.string(),
    })
    .superRefine((val, ctx) => {
      const target = val.inviteOrgId.trim();
      if (!target) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inviteOrgId"],
          message: t("billing.billingGroup.inviteOrgIdRequired"),
        });
      } else if (target === getCurrentOrg()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inviteOrgId"],
          message: t("billing.billingGroup.inviteSameOrg"),
        });
      }
    });

export type BillingGroupInviteForm = z.infer<ReturnType<typeof makeBillingGroupInviteSchema>>;

export const billingGroupInviteDefaults = (): BillingGroupInviteForm => ({
  inviteOrgId: "",
});
