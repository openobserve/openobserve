// Copyright 2026 OpenObserve Inc.
//
// Validation schema for PrebuiltDestinationForm.vue (config-driven credentials).
//
// The schema is built DYNAMICALLY from `getPrebuiltConfig(type).credentialFields`
// for the ACTIVE destination type — that config is the SINGLE SOURCE OF TRUTH for
// the per-type required + validator rules. The parent remounts this form (its
// `:key` includes destination_type) whenever the type changes, so the schema is
// always rebuilt for the active type at setup.
//
// Per credential field:
//   • required + empty            → `${label} is required`   (validator NOT run)
//   • required/optional + present → run `field.validator` (if any); its returned
//                                    i18n message becomes the field's error
//   • optional + empty            → OK (no issue)
//
// The config modules are Vue-less and cannot translate, so they carry i18n KEYS
// (`labelKey`, and a `{ key, params }` from each validator). This factory is one
// of the two sites that owns a `t` and resolves them — see `CredentialField`.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";
import { getPrebuiltConfig } from "@/utils/prebuilt-templates";
import type { CredentialField } from "@/utils/prebuilt-templates/types";

/** Credentials are a dynamic, per-type record keyed by credentialField `key`. */
export type PrebuiltCredentials = Record<string, unknown>;

const credentialFieldsFor = (destinationType: string): CredentialField[] =>
  getPrebuiltConfig(destinationType)?.credentialFields ?? [];

/** True only for a genuine `true` or the STRING "true". Everything else (incl.
 *  the string "false") is false. */
const toBool = (v: unknown): boolean => v === true || v === "true";

/**
 * A toggle credential.
 *
 * ⚠️ Toggles round-trip through destination METADATA as STRINGS: the persist
 * path (`usePrebuiltDestinations.ts` — the `credential_${k}` flattening at
 * :504/:531/:628/:653) writes every credential with `String(v)`, so a stored
 * toggle comes back as `"true"` / `"false"`, never a boolean. A bare
 * `z.boolean()` REJECTS that on edit-prefill, which blocks the child's submit
 * emit and makes the destination permanently unsaveable.
 *
 * ⚠️ Do NOT "simplify" this to `z.coerce.boolean()`: `Boolean("false") === true`,
 * which would flip a stored-off toggle ON — for Opsgenie's `euRegion` that
 * silently reroutes a US instance to the EU endpoint (see
 * `generateDestinationUrl` in utils/prebuilt-templates/index.ts, which reads the
 * flag TRUTHILY).
 */
const toggleSchema = () => z.preprocess((v) => toBool(v), z.boolean()).optional();

/**
 * Build the Zod schema for one destination type from its `credentialFields`.
 * Toggle fields → boolean; every other field → string. The required + custom
 * validator rules are enforced in a single object-level `superRefine` (so
 * TanStack routes each issue to the field whose `name` matches the credential key).
 */
export const makePrebuiltDestinationSchema = (
  t: (_key: string, _named?: Record<string, unknown>) => string,
  destinationType: string,
) => {
  const fields = credentialFieldsFor(destinationType);

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    shape[field.key] = field.type === "toggle" ? toggleSchema() : z.string().optional();
  }

  return z.object(shape).superRefine((val, ctx) => {
    const values = val as Record<string, unknown>;
    for (const field of fields) {
      const value = values[field.key];
      const isEmpty = value === undefined || value === null || value.toString().trim() === "";

      // Required + empty → "<label> is required" (do NOT run the validator).
      if (field.required && isEmpty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field.key],
          message: t("alerts.validation.credentialFieldRequired", {
            field: t(field.labelKey),
          }),
        });
        continue;
      }
      // Optional + empty → nothing to validate.
      if (!field.required && isEmpty) continue;
      // Present → run the per-type validator (if any); resolve its i18n message.
      if (field.validator && value) {
        const result = field.validator(value.toString());
        if (result !== true) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field.key],
            message: t(result.key, result.params),
          });
        }
      }
    }
  });
};

/**
 * Typed default values for the active type, seeded from an existing credentials
 * object (edit-prefill). Toggle → boolean (default false); every other field →
 * string. Only the active type's fields are included, so the payload never
 * carries stale credential keys from another type.
 */
export const prebuiltDestinationDefaults = (
  destinationType: string,
  modelValue: Record<string, unknown> = {},
): PrebuiltCredentials => {
  const fields = credentialFieldsFor(destinationType);
  const out: PrebuiltCredentials = {};
  for (const field of fields) {
    if (field.type === "toggle") {
      // Coerce at RUNTIME — a `as boolean | undefined` cast is compile-time only
      // and would leave the persisted STRING "false" in the form verbatim, which
      // then reads TRUTHY downstream (generateDestinationUrl → EU endpoint for a
      // US Opsgenie instance). See `toggleSchema` above for the full round-trip.
      out[field.key] = toBool(modelValue[field.key]);
    } else {
      const v = modelValue[field.key];
      out[field.key] = v !== undefined && v !== null ? String(v) : "";
    }
  }
  return out;
};
