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

import type { TranslateFn } from "@/types/i18n";
import { telephonyRefusalText } from "./telephony";

export type TelephonyDialogMode = "connect" | "update";

const SID_SHAPE = /^AC[0-9A-Za-z]+$/;
const E164 = /^\+[1-9][0-9]{6,14}$/;

/** Whether an update names a different account than the saved one, which then needs its own token. [pure] */
export function sidChanged(mode: TelephonyDialogMode, sid: string, savedSid: string | undefined) {
  return mode === "update" && sid.trim() !== (savedSid ?? "");
}

/** The same shapes the API checks, so a typo is caught at the field rather than by Twilio. */
export const makeTelephonySchema = (t: TranslateFn, mode: TelephonyDialogMode, savedSid?: string) =>
  z
    .object({
      account_sid: z
        .string()
        .trim()
        .min(1, { message: t("common.required") })
        .regex(SID_SHAPE, { message: telephonyRefusalText(t, "bad_sid") }),
      auth_token:
        mode === "connect"
          ? z.string().min(1, { message: telephonyRefusalText(t, "token_required") })
          : z.string(),
      from_number: z
        .string()
        .trim()
        .regex(E164, { message: telephonyRefusalText(t, "bad_from_number") }),
    })
    .superRefine((value, ctx) => {
      // A blank token on update keeps the stored one (P6), which only belongs to the saved SID.
      if (sidChanged(mode, value.account_sid, savedSid) && !value.auth_token.trim()) {
        ctx.addIssue({
          code: "custom",
          path: ["auth_token"],
          message: telephonyRefusalText(t, "token_required"),
        });
      }
    });

export type TelephonyForm = z.infer<ReturnType<typeof makeTelephonySchema>>;
