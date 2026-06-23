// Copyright 2026 OpenObserve Inc.
//
// Validation schema for MemberInvitation.vue (the inline invite row).
//
// MemberInvitation had no Quasar `:rules` — it validated imperatively
// (`validateEmail()` per address + a button-disable on empty). This encodes that
// intent into Zod: `email` is required AND every address (split on `;`/`,`) must
// be a valid email. `role` defaults to "admin" (the old `selectedRole` default).
// The component keeps the multi-email split/dedup in its submit handler.

import { z } from "zod";
import { validateEmail } from "@/utils/zincutils";

const EMAIL_MESSAGE = "Please enter correct email id.";

/** Split a raw multi-email string on `;`/`,`, trim, and drop empties. */
export const splitInviteEmails = (raw: string): string[] =>
  raw
    .split(";")
    .flatMap((email) => email.split(","))
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

export const memberInvitationSchema = z.object({
  email: z
    .string()
    .min(1, EMAIL_MESSAGE)
    .refine((val) => {
      const emails = splitInviteEmails(val);
      return emails.length > 0 && emails.every((e) => validateEmail(e) === true);
    }, EMAIL_MESSAGE),
  role: z.string().default("admin"),
});

export type MemberInvitationForm = z.infer<typeof memberInvitationSchema>;

// Static defaults — create / "add another" form: blank email + the default role.
export const memberInvitationDefaults = (): MemberInvitationForm => ({
  email: "",
  role: "admin",
});
