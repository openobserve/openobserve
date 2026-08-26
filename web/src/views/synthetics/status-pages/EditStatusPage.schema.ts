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

// The three form values map to the numeric wire visibility (0/1/2) at submit.
export type VisibilityMode = "draft" | "public" | "password";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const makeEditStatusPageSchema = (t: (k: string) => string) =>
  z
    .object({
      name: z.string().trim().min(1, t("statusPages.validation.nameRequired")),
      description: z.string().optional().default(""),
      brand_name: z.string().optional().default(""),
      logo_img: z.string().optional().default(""),
      accent_color: z
        .string()
        .optional()
        .default("")
        .refine((v) => !v || HEX_RE.test(v), t("statusPages.validation.accentColor")),
      visibility: z.enum(["draft", "public", "password"]),
      // Only meaningful when visibility === "password". Left blank on edit keeps
      // the stored password (password_set stays true); a new value replaces it.
      password: z.string().optional().default(""),
      noindex: z.boolean().default(false),
      show_uptime_percent: z.boolean().default(true),
      show_timeline_bars: z.boolean().default(true),
      show_response_time: z.boolean().default(true),
      // <input type="number"> emits a string — validate the raw value, coerce at use.
      confirm_failures: z
        .any()
        .refine((v) => v === "" || Number(v) >= 0, t("statusPages.validation.nonNegative")),
      confirm_recovery: z
        .any()
        .refine((v) => v === "" || Number(v) >= 0, t("statusPages.validation.nonNegative")),
    })
    .superRefine((val, ctx) => {
      // Require a password only when switching an as-yet-unprotected page to
      // password visibility; the component tells the schema via _passwordSet.
      if (val.visibility === "password" && !val.password && !(val as any)._passwordSet) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["password"],
          message: t("statusPages.validation.passwordRequired"),
        });
      }
    });

export type EditStatusPageForm = z.infer<ReturnType<typeof makeEditStatusPageSchema>> & {
  // Non-persisted flag threaded in so the schema knows a password already exists.
  _passwordSet?: boolean;
};

export function visibilityToMode(visibility: 0 | 1 | 2): VisibilityMode {
  return visibility === 1 ? "public" : visibility === 2 ? "password" : "draft";
}

export function modeToVisibility(mode: VisibilityMode): 0 | 1 | 2 {
  return mode === "public" ? 1 : mode === "password" ? 2 : 0;
}
