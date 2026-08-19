// Copyright 2026 OpenObserve Inc.
//
// Validation for OnCallCoverForm.vue. Mirrors the server's own checks on
// `POST .../overrides` so a bad window is caught before the round trip; the
// server still enforces them, since the UI is not the only caller.
//
// **Validate the shape the FORM holds, not the shape the API takes.** This
// schema used to require `start_at` and `end_at` — the two fields the request
// body carries — while the form rendered a single `window` range picker. Zod
// therefore failed on two keys with no control to attach an error to, so
// nothing appeared on screen, `@submit` never fired, and Save issued no HTTP
// request at all. The mapping to `start_at`/`end_at` belongs in the submit
// handler, which is where it now is.

import { z } from "zod";

import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";
import type { TranslateFn } from "@/types/i18n";

/** The server refuses a cover spanning more than 90 days. */
const MAX_SPAN_MICROS = 90 * MICROS_PER_DAY;

/**
 * The server refuses a start more than 730 days ahead. That bound exists to
 * catch a milliseconds-for-microseconds mistake, which lands roughly 55,000
 * years out — so the message says the limit rather than guessing at the cause.
 */
const MAX_AHEAD_MICROS = 730 * MICROS_PER_DAY;

export const makeOnCallCoverSchema = (t: TranslateFn, now: () => number = () => Date.now() * 1000) =>
  z
    .object({
      user_email: z.string().min(1, t("oncall.coverWhoRequired")),
      // Which rotation the cover lands on. Absent means the default slot,
      // which is what every cover meant before slots existed.
      slot: z.string().optional(),
      // What OFormDateTimeRange carries: micros, matching every other instant
      // on this API, alongside the picker's own `type`/`period` bookkeeping.
      window: z.object(
        {
          from: z.number({ error: t("oncall.coverWindowRequired") }).int(),
          to: z.number({ error: t("oncall.coverWindowRequired") }).int(),
        },
        { error: t("oncall.coverWindowRequired") },
      ),
    })
    // Every refine below reports on `window`, because that is the control the
    // reader can act on — an error attached to a key with no field on screen
    // is the failure this file exists to prevent.
    //
    // A zero-length window is not a cover, and an inverted one silently covers
    // nothing while reading as saved — the server rejects both.
    .refine((value) => value.window.to > value.window.from, {
      message: t("oncall.coverInvalidRange"),
      path: ["window"],
    })
    .refine((value) => value.window.to - value.window.from <= MAX_SPAN_MICROS, {
      message: t("oncall.coverTooLong"),
      path: ["window"],
    })
    .refine((value) => value.window.from - now() <= MAX_AHEAD_MICROS, {
      message: t("oncall.coverTooFarAhead"),
      path: ["window"],
    });

export type OnCallCoverValue = z.infer<ReturnType<typeof makeOnCallCoverSchema>>;
