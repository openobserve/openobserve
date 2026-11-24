// Copyright 2026 OpenObserve Inc.
//
// One flat record with `superRefine`, not a discriminated union, so switching `kind` (mcp / skill)
// never reshapes the form data.

import { z } from "zod";
import {
  emptyAuth,
  isAuthorizationHeader,
  isHttpsUrl,
  usesClientCredentials,
  type ToolsetAuth,
} from "./toolsetAuth";

// The server's create rule: the name the agent sees, so normalization never changes it.
export const aiToolsetNameRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const AI_TOOLSET_NAME_MAX = 64;

// All optional: a blank starter row is valid, and only keyed rows are saved, without `visible`.
export const secretRowSchema = z.object({
  key: z.string().optional(),
  value: z.string().optional(),
  visible: z.boolean().optional(),
});

// Saved toolsets keep legacy names (names are immutable), so the name rule only gates a create.
export const makeAddAiToolsetSchema = (
  t: (_key: string) => string,
  isEditing: () => boolean = () => false,
  // A row replicated without this region's secret takes edits that leave its credentials alone.
  missingSecretOk: (_mcp: { url?: string; auth: ToolsetAuth }) => boolean = () => false,
) =>
  z
    .object({
      // ── Always validated ────────────────────────────────────────────────
      name: z.string().min(1, t("aiToolset.nameRequired")),
      kind: z.string().min(1, t("aiToolset.kindRequired")),
      description: z.string().optional(),
      region_only: z.boolean().optional(),

      // Validated only when kind === "mcp" (see superRefine); number inputs emit strings.
      mcp: z.object({
        url: z.string().optional(),
        timeout_seconds: z.coerce.number().optional(),
        headers: z.array(secretRowSchema).optional().default([]),
        auth: z
          .object({
            token_url: z.string().optional(),
            client_id: z.string().optional(),
            client_secret: z.string().optional(),
            scope: z.string().optional(),
            extra: z.record(z.string(), z.any()).optional().default({}),
          })
          .optional()
          .default(emptyAuth()),
        // `null` is an absent key, so the agent's default for that list applies.
        allowed_tools: z.array(z.string()).nullable().default(null),
        blocked_tools: z.array(z.string()).nullable().default(null),
        write_tools: z.array(z.string()).nullable().default(null),
        // Stored keys this form doesn't edit (e.g. `tool_classes`), sent back as they are.
        extra: z.record(z.string(), z.any()).optional().default({}),
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
      if (!isEditing() && val.name) {
        if (!aiToolsetNameRegex.test(val.name)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["name"],
            message: t("aiToolset.nameInvalid"),
          });
        }
        if (val.name.length > AI_TOOLSET_NAME_MAX) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["name"],
            message: t("aiToolset.nameTooLong"),
          });
        }
      }
      // Not trimmed, unlike skill.content below: a whitespace-only url is accepted here.
      if (val.kind === "mcp" && !String(val.mcp?.url ?? "")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mcp", "url"],
          message: t("aiToolset.mcpUrlRequired"),
        });
      }
      if (val.kind === "mcp") {
        const auth = val.mcp.auth;
        const refuse = (path: (string | number)[], message: string) =>
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mcp", ...path],
            message: t(message),
          });
        if (usesClientCredentials(auth)) {
          if (!auth.token_url?.trim()) {
            refuse(["auth", "token_url"], "aiToolset.tokenUrlRequired");
          } else if (!isHttpsUrl(auth.token_url)) {
            refuse(["auth", "token_url"], "aiToolset.tokenUrlHttps");
          }
          if (!auth.client_secret?.trim() && !missingSecretOk(val.mcp)) {
            refuse(["auth", "client_secret"], "aiToolset.clientSecretRequired");
          }
          val.mcp.headers.forEach((row, index) => {
            if (isAuthorizationHeader(row) && row.value) {
              refuse(["headers", index, "key"], "aiToolset.authorizationWithOauth");
            }
          });
        } else if (auth.client_secret?.trim()) {
          // Without a client id the secret would be dropped without a word.
          refuse(["auth", "client_id"], "aiToolset.clientIdRequired");
        }
      }
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
  region_only: false,
  // A new custom MCP starts with every tool off; the picker turns tools on.
  mcp: {
    url: "",
    timeout_seconds: 30,
    headers: [],
    auth: emptyAuth(),
    allowed_tools: [],
    blocked_tools: null,
    write_tools: null,
    extra: {},
  },
  skill: { content: "" },
});
