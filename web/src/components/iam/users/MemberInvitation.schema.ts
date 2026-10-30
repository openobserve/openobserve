// Copyright 2026 OpenObserve Inc.
//
// Schema for InviteMembersDialog.vue; the dialog's submit handler owns the split/lowercase/dedupe.

import { z } from "zod";
import { validateEmail } from "@/utils/zincutils";

/** Split a raw multi-email string on `;`/`,`, trim, and drop empties. */
export const splitInviteEmails = (raw: string): string[] =>
  raw
    .split(";")
    .flatMap((email) => email.split(","))
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

/** Least-privileged usable default: `editor` when the org offers it, else the first option. */
export const pickDefaultInviteRole = (
  options: ReadonlyArray<{ value?: unknown }> | null | undefined,
): string => {
  const values = (options ?? []).map((option) => String(option?.value ?? "")).filter(Boolean);
  return values.includes("editor") ? "editor" : (values[0] ?? "");
};

export const makeMemberInvitationSchema = (t: (_key: string) => string) =>
  z.object({
    email: z
      .string()
      .min(1, t("user.inviteEmailInvalid"))
      .refine((val) => {
        const emails = splitInviteEmails(val);
        return emails.length > 0 && emails.every((e) => validateEmail(e) === true);
      }, t("user.inviteEmailInvalid")),
    role: z.string().min(1, t("user.roleRequired")),
  });

export type MemberInvitationForm = z.infer<ReturnType<typeof makeMemberInvitationSchema>>;

export const memberInvitationDefaults = (email = "", role = ""): MemberInvitationForm => ({
  email,
  role,
});
