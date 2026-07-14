// Copyright 2026 OpenObserve Inc.
//
// Validation schema for AddAiToolset.vue. The form is keyed on `kind`
// (mcp / cli / skill): a few fields are always validated (name, kind) and the
// rest are conditional on the selected kind. Built as a base object +
// `superRefine` (rather than a discriminated union) so all kind-specific fields
// can coexist in one flat record — the template only renders the subset for the
// active kind, but switching kind never reshapes the form data. Factory keeps
// the messages i18n-driven (pass useI18n's `t`).
//
// Restores the BEFORE validation baseline for this form
// ("4 blocks → 6 sub-rules"):
//   • name : required + /^[a-zA-Z0-9_-]+$/ + max 256
//   • kind : required
//   • mcp.url      : required when kind === "mcp"   (superRefine)
//   • cli.command  : required when kind === "cli"   (superRefine)
//   • skill.content: required when kind === "skill" (superRefine)
// The skill-content rule was an imperative @submit check in the BEFORE state;
// its Monaco editor has no OForm* equivalent, but the VALUE is bridged into the
// form via setFieldValue, so the rule now lives here like every other field.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// this file only describes WHAT is valid.

import { z } from "zod";

// Name char rule from the BEFORE baseline: letters, digits, hyphen, underscore.
export const aiToolsetNameRegex = /^[a-zA-Z0-9_-]+$/;

// One row of a key/value secret list (mcp headers, cli env vars). All fields are
// free-form and optional (a blank starter row is valid — only non-empty rows are
// persisted on save). `visible` is the per-row password-visibility UI flag; it is
// form-owned bookkeeping (like the playbook's row `uuid`) and excluded from the
// saved payload.
export const secretRowSchema = z.object({
  key: z.string().optional(),
  value: z.string().optional(),
  visible: z.boolean().optional(),
});

// One row of a credential file (cli). `key` is the env-var name; `value` is the
// file content edited in a Monaco editor (bridged into the form — Monaco has no
// OForm* equivalent).
export const credFileRowSchema = z.object({
  key: z.string().optional(),
  value: z.string().optional(),
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

      // ── CLI fields (command validated only when kind === "cli") ───────────
      // `env` + `credFiles` are form-owned dynamic array-fields (no validation).
      cli: z.object({
        command: z.string().optional(),
        allowed_subcommands_raw: z.string().optional(),
        timeout_seconds: z.coerce.number().optional(),
        max_output_bytes: z.coerce.number().optional(),
        requires_confirmation: z.boolean().optional(),
        env: z.array(secretRowSchema).optional().default([]),
        credFiles: z.array(credFileRowSchema).optional().default([]),
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
      // mcp.url required when kind === "mcp". Bare empty check (NO trim) to match
      // the BEFORE baseline's `!url` — main accepted a whitespace-only url. (Note
      // main's asymmetry: skill.content below DOES trim; url/command do not.)
      if (val.kind === "mcp" && !String(val.mcp?.url ?? "")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mcp", "url"],
          message: t("aiToolset.mcpUrlRequired"),
        });
      }
      // cli.command required when kind === "cli". Bare empty check (NO trim) to
      // match the BEFORE baseline's `!command` — main accepted a whitespace-only
      // command.
      if (val.kind === "cli" && !String(val.cli?.command ?? "")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cli", "command"],
          message: t("aiToolset.cliCommandRequired"),
        });
      }
      // skill.content required when kind === "skill" (BEFORE: imperative check in
      // onSubmit that used `!content.trim()`). Trim is KEPT here to match main —
      // unlike url/command above, main's skill check trimmed.
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
  cli: {
    command: "",
    allowed_subcommands_raw: "",
    timeout_seconds: 30,
    max_output_bytes: 100000,
    requires_confirmation: false,
    env: [],
    credFiles: [],
  },
  skill: { content: "" },
});
