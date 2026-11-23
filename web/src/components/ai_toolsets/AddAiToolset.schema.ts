// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddAiToolset.vue. The form is keyed on `kind`
// (mcp / skill): a few fields are always validated (name, kind) and the
// rest are conditional on the selected kind. Built as a base object +
// `superRefine` (rather than a discriminated union) so all kind-specific fields
// can coexist in one flat record — the template only renders the subset for the
// active kind, but switching kind never reshapes the form data. Factory keeps
// the messages i18n-driven (pass useI18n's `t`).
//
// Validation timing is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes what is valid.

import { z } from "zod";

// Name char rule: letters, digits, hyphen, underscore.
export const aiToolsetNameRegex = /^[a-zA-Z0-9_-]+$/;

// One row of a key/value secret list (mcp headers). All fields are
// free-form and optional (a blank starter row is valid — only non-empty rows are
// persisted on save). `visible` is the per-row password-visibility UI flag; it is
// form-owned bookkeeping excluded from the saved payload.
export const secretRowSchema = z.object({
  key: z.string().optional(),
  value: z.string().optional(),
  visible: z.boolean().optional(),
});

export const makeAddAiToolsetSchema = (t: (_key: string) => string) =>
  z
    .object({
      // ── Always validated ────────────────────────────────────────────────
      name: z
        .string()
        .min(1, t("aiToolset.nameRequired"))
        .regex(aiToolsetNameRegex, t("aiToolset.nameInvalid"))
        .max(256, t("aiToolset.nameTooLong")),
      kind: z.string().min(1, t("aiToolset.kindRequired")),
      description: z.string().optional(),

      // ── MCP fields (validated only when kind === "mcp" — see superRefine) ─
      // Number inputs emit strings → z.coerce.number(); consumers coerce at use.
      // `headers` is a form-owned dynamic array-field (no validation rule).
      mcp: z.object({
        url: z.string().optional(),
        timeout_seconds: z.coerce.number().optional(),
        headers: z.array(secretRowSchema).optional().default([]),
      }),

      // ── Skill fields (content validated only when kind === "skill") ───────
      // The editor is a Monaco widget (no OForm* equivalent) bridged into the
      // form via setFieldValue, so the value is form-owned and the required rule
      // lives here (superRefine) like every other field — no @submit gate.
      skill: z.object({
        content: z.string().optional(),
      }),
    })
    .superRefine((val, ctx) => {
      // mcp.url required when kind === "mcp". Bare empty check (NO trim): a
      // whitespace-only url is accepted. (Note the asymmetry: skill.content below
      // DOES trim; url does not.)
      if (val.kind === "mcp" && !String(val.mcp?.url ?? "")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mcp", "url"],
          message: t("aiToolset.mcpUrlRequired"),
        });
      }
      // skill.content required when kind === "skill". Trim IS applied here —
      // unlike url above.
      if (val.kind === "skill" && !String(val.skill?.content ?? "").trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["skill", "content"],
          message: t("aiToolset.skillContentRequired"),
        });
      }
    });

export type AddAiToolsetForm = z.infer<ReturnType<typeof makeAddAiToolsetSchema>>;

// Static (create-only) defaults for the form. Every value the form collects —
// including the dynamic arrays and the (Monaco-edited) skill content — is
// form-owned and seeded here.
export const addAiToolsetDefaults = (): AddAiToolsetForm => ({
  name: "",
  kind: "mcp",
  description: "",
  mcp: { url: "", timeout_seconds: 30, headers: [] },
  skill: { content: "" },
});
