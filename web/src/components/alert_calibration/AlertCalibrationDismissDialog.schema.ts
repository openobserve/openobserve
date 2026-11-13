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
import {
  DEFAULT_DURATION,
  DURATION_OPTIONS,
  isDismissReason,
  NOTE_MAX_CHARS,
  noteLength,
  type DismissForm,
} from "./dismissals";

/** The server's own checks, so a refused body is rare; the server stays the backstop. */
export const makeDismissSchema = (t: TranslateFn) =>
  z
    .object({
      reason: z.string().refine(isDismissReason, t("alertCalibration.dismiss.reasonRequired")),
      note: z
        .string()
        .refine(
          (note) => noteLength(note) <= NOTE_MAX_CHARS,
          t("alertCalibration.dismiss.noteTooLong"),
        ),
      duration: z.enum(DURATION_OPTIONS as [string, ...string[]]),
    })
    .superRefine((form, ctx) => {
      if (form.reason === "other" && noteLength(form.note) === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["note"],
          message: t("alertCalibration.dismiss.noteRequired"),
        });
      }
    });

/** No reason is preselected (Q1), so the owner always says why. */
export const dismissDefaults = (): DismissForm => ({
  reason: "",
  note: "",
  duration: String(DEFAULT_DURATION) as DismissForm["duration"],
});
