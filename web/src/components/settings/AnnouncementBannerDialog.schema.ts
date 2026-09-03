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

import { parseDurationMs } from "./announcementDrafts";

/**
 * The same rules the API enforces, checked here so an author is told at the
 * field rather than by a rejected save that names a banner index.
 */
export const makeBannerSchema = (t: (_key: string) => string) =>
  z
    .object({
      id: z.string().optional(),
      message: z
        .string()
        .trim()
        .min(1, { message: t("announcements.form.messageRequired") }),
      variant: z.enum(["info", "warning", "critical", "promo"]),
      schedule: z.enum(["always", "duration", "window"]),
      duration: z.string().optional(),
      startsAt: z.string().optional(),
      endsAt: z.string().optional(),
      dismissible: z.boolean(),
      hasCta: z.boolean(),
      ctaText: z.string().optional(),
      ctaUrl: z.string().optional(),
      orgs: z.array(z.string()).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.schedule === "duration" && !parseDurationMs(value.duration ?? "")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["duration"],
          message: t("announcements.form.durationInvalid"),
        });
      }

      if (value.schedule === "window") {
        if (!value.startsAt && !value.endsAt) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["startsAt"],
            message: t("announcements.form.windowRequired"),
          });
        }
        // The API rejects a backwards window; catching it here saves a round trip.
        if (
          value.startsAt &&
          value.endsAt &&
          new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["endsAt"],
            message: t("announcements.form.windowBackwards"),
          });
        }
      }

      if (value.hasCta) {
        if (!value.ctaText?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ctaText"],
            message: t("announcements.form.ctaTextRequired"),
          });
        }
        const url = value.ctaUrl?.trim() ?? "";
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["ctaUrl"],
            message: t("announcements.form.ctaUrlInvalid"),
          });
        }
      }
    });

export type BannerForm = z.infer<ReturnType<typeof makeBannerSchema>>;
