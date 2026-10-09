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

import { isHexColor } from "@/utils/announcementAppearance";
import { MAX_LINKS, parseDurationMs } from "./announcementDrafts";

/** Past this a banner wraps onto several lines on a laptop and stops reading as a notice. */
export const MESSAGE_MAX_LENGTH = 300;

/** A longer button label pushes the message into a narrow column on phones. */
export const CTA_MAX_LENGTH = 30;

const isHttpUrl = (value: string) => /^https?:\/\//.test(value.trim());

/** The same rules the API enforces, checked here so an author is told at the field. */
export const makeBannerSchema = (t: (_key: string) => string) =>
  z
    .object({
      id: z.string().optional(),
      message: z
        .string()
        .trim()
        .min(1, { message: t("announcements.form.messageRequired") })
        .max(MESSAGE_MAX_LENGTH, { message: t("announcements.form.messageTooLong") }),
      variant: z.enum(["info", "warning", "critical", "promo"]),
      start: z.enum(["now", "at"]),
      startsAt: z.string().optional(),
      end: z.enum(["never", "after", "at"]),
      duration: z.string().optional(),
      endsAt: z.string().optional(),
      dismissible: z.boolean(),
      links: z
        .array(
          z.object({
            text: z
              .string()
              .trim()
              .min(1, { message: t("announcements.form.ctaTextRequired") })
              .max(CTA_MAX_LENGTH, { message: t("announcements.editor.ctaTooLong") }),
            url: z.string().refine(isHttpUrl, { message: t("announcements.form.ctaUrlInvalid") }),
          }),
        )
        .max(MAX_LINKS),
      orgs: z.array(z.string()).optional(),
      textSize: z.enum(["small", "medium", "large"]),
      colorLight: z.string().optional(),
      colorDark: z.string().optional(),
      icon: z.string().optional(),
      styleId: z.string().optional(),
    })
    .superRefine((value, ctx) => {
      const issue = (path: string, key: string) =>
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: t(key) });

      if (value.start === "at" && !value.startsAt)
        issue("startsAt", "announcements.form.startRequired");
      if (value.end === "after" && !parseDurationMs(value.duration ?? "")) {
        issue("duration", "announcements.form.durationInvalid");
      }
      if (value.end === "at") {
        if (!value.endsAt) {
          issue("endsAt", "announcements.form.endRequired");
        } else {
          const start = value.start === "at" && value.startsAt ? value.startsAt : null;
          const startMs = start ? new Date(start).getTime() : Date.now();
          if (new Date(value.endsAt).getTime() <= startMs) {
            issue("endsAt", "announcements.form.windowBackwards");
          }
        }
      }

      for (const field of ["colorLight", "colorDark"] as const) {
        const color = value[field]?.trim();
        if (color && !isHexColor(color)) issue(field, "announcements.form.colorInvalid");
      }
    });

export type BannerForm = z.infer<ReturnType<typeof makeBannerSchema>>;
