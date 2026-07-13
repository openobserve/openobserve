// Copyright 2026 OpenObserve Inc.
//
// Row schema for the StreamFieldInputs field-array. The component OWNS the
// per-row contract (it is shared by AddStream + schema.vue), so the schema for
// a single row lives here and both parents compose it into their own form
// schema as `z.array(makeStreamFieldRowSchema(t))`.
//
// Restored from the component's legacy `validate()` (prop-mode), with the
// required messages now i18n-driven (pass useI18n's `t`) to match every other
// schema in this migration AND PR #13077's `logStream.fieldRequired` /
// `logStream.dataTypeRequired` keys:
//   • name → required (`logStream.fieldRequired`) + `/^[a-zA-Z0-9_:]+$/` on the
//            RAW value (no schema `.trim()` — see the field note below).
//   • type → required (`logStream.dataTypeRequired`; the data-type select,
//            enforced when it is visible, which both live parents do —
//            visibleInputs.data_type = true).
//
// Exposed as a factory (`makeStreamFieldRowSchema(t)`) so each parent composes it
// with its own `t`; AddStream's schema calls it inside `z.array(...)`.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";

// Allowed characters mirror the backend `format_stream_name` regex
// (src/config/src/utils/schema.rs): alphanumeric, underscore and colon only.
export const streamFieldNameRegex = /^[a-zA-Z0-9_:]+$/;

/**
 * Build the single-row schema.
 *
 * @param t useI18n's `t`, so required messages resolve from the shared
 *   `logStream.*` keys (also used by PR #13077).
 */
export const makeStreamFieldRowSchema = (t: (_key: string) => string) =>
  z.object({
    // Optional row id kept for parent bookkeeping. NOT the v-for key (rows key by
    // INDEX so index-based `name` bindings stay correct on a mid-list delete).
    uuid: z.string().optional(),
    // NO schema `.trim()`: OForm/TanStack VALIDATES with the schema but saves the
    // RAW row value. A `.trim()` would let " my_field " pass (regex judges the
    // trimmed copy) and diverge from `main`, which rejected any surrounding
    // whitespace via the regex on the raw value. Validating the raw value keeps
    // `streamFieldNameRegex` rejecting ANY whitespace, mirroring the scalar
    // `name` fix in AddStream.schema.ts.
    name: z
      .string()
      .min(1, t("logStream.fieldRequired"))
      .regex(streamFieldNameRegex, t("logStream.streamNameHelpText")),
    type: z.string().min(1, t("logStream.dataTypeRequired")),
    index_type: z.array(z.any()).optional().default([]),
  });

export type StreamFieldRow = z.infer<ReturnType<typeof makeStreamFieldRowSchema>>;

// Factory for a fresh blank row (parents push this via form.pushFieldValue).
export const makeStreamFieldRow = (): StreamFieldRow => ({
  uuid: crypto.randomUUID(),
  name: "",
  type: "",
  index_type: [],
});
