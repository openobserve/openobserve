// Copyright 2026 OpenObserve Inc.
//
// Validation for OnCallCoverForm.vue. Mirrors the server's own checks on
// `POST .../overrides` so a bad window is caught before the round trip; the
// server still enforces them, since the UI is not the only caller.

import { z } from "zod";

import type { TranslateFn } from "@/types/i18n";

export const makeOnCallCoverSchema = (t: TranslateFn) =>
  z
    .object({
      user_email: z.string().min(1, t("oncall.coverWhoRequired")),
      // Micros, matching every other instant on this API.
      start_at: z.number().int(),
      end_at: z.number().int(),
    })
    // A zero-length window is not a cover, and an inverted one silently covers
    // nothing while reading as saved — the server rejects both.
    .refine((value) => value.end_at > value.start_at, {
      message: t("oncall.coverInvalidRange"),
      path: ["end_at"],
    });

export type OnCallCoverValue = z.infer<ReturnType<typeof makeOnCallCoverSchema>>;
