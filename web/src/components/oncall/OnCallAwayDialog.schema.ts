// Copyright 2026 OpenObserve Inc.
//
// Validation for OnCallAwayDialog.vue: the window the form holds, mapped to `start_at`/`end_at` on submit.

import { z } from "zod";

import type { TranslateFn } from "@/types/i18n";

export const makeOnCallAwaySchema = (t: TranslateFn, now: () => number = () => Date.now() * 1000) =>
  z
    .object({
      window: z.object(
        {
          from: z.number({ error: t("oncall.awayWindowRequired") }).int(),
          to: z.number({ error: t("oncall.awayWindowRequired") }).int(),
        },
        { error: t("oncall.awayWindowRequired") },
      ),
      reason: z.string().optional(),
    })
    .refine((value) => value.window.to > value.window.from, {
      message: t("oncall.coverInvalidRange"),
      path: ["window"],
    })
    // An absence that has already ended changes no rota.
    .refine((value) => value.window.to > now(), {
      message: t("oncall.coverWindowPast"),
      path: ["window"],
    });

export type OnCallAwayValue = z.infer<ReturnType<typeof makeOnCallAwaySchema>>;
