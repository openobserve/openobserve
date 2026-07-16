// Copyright 2026 OpenObserve Inc.
//
// Validation schema for MemberInvitation.vue (the inline invite row).
//
// MemberInvitation had no declarative validation rules — it validated imperatively
// (`validateEmail()` per address + a button-disable on empty). This encodes that
// intent into Zod: `email` is required AND every address (split on `;`/`,`) must
// be a valid email. `role` defaults to "admin" (the old `selectedRole` default).
// The component keeps the multi-email split/dedup in its submit handler.
//
// Built via a factory so the invalid-email message stays i18n-driven (pass
// useI18n's `t`).

import { z } from "zod";
import { validateEmail } from "@/utils/zincutils";

/** Split a raw multi-email string on `;`/`,`, trim, and drop empties. */
export const splitInviteEmails = (raw: string): string[] =>
  raw
    .split(";")
    .flatMap((email) => email.split(","))
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

export const makeMemberInvitationSchema = (t: (_key: string) => string) =>
  z.object({
    email: z
      .string()
      .min(1, t("user.inviteEmailInvalid"))
      .refine((val) => {
        const emails = splitInviteEmails(val);
        return (
          emails.length > 0 && emails.every((e) => validateEmail(e) === true)
        );
      }, t("user.inviteEmailInvalid")),
    role: z.string().default("admin"),
  });

export type MemberInvitationForm = z.infer<
  ReturnType<typeof makeMemberInvitationSchema>
>;

// Static defaults — create / "add another" form: blank email + the default role.
export const memberInvitationDefaults = (): MemberInvitationForm => ({
  email: "",
  role: "admin",
});
