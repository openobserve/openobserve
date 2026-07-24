// Copyright 2026 OpenObserve Inc.
//
// Validation schemas for the self-owned dialogs in OrganizationManagement.vue
// (meta-org admin): External Contract, Extend Trial, and AI Credits.
//
// Validation timing is owned by OForm (submit-then-change via revalidateLogic);
// these schemas only describe what is valid.

import { z } from "zod";

// ── External Contract dialog ─────────────────────────────────────────────────
// The single date field is required. The message is mode-aware so it reads
// "End date is required." when creating a new contract and "New end date is
// required." when extending an existing one.
export const makeContractSchema = (mode: "create" | "extend") =>
  z.object({
    contractEndDate: z
      .string()
      .min(1, mode === "create" ? "End date is required." : "New end date is required."),
  });

export type ContractForm = z.infer<ReturnType<typeof makeContractSchema>>;

export const contractDefaults = (): ContractForm => ({ contractEndDate: "" });

// ── Extend-Trial dialog ──────────────────────────────────────────────────────
// The week count comes from a custom pill grid (1–4), bridged into the form via
// setFieldValue. It must be at least one week. `z.coerce.number()` because the
// bridged value can arrive as a string.
export const extendTrialSchema = z.object({
  extendedTrial: z.coerce.number().min(1, "Trial extension must be at least 1 week."),
});

export type ExtendTrialForm = z.infer<typeof extendTrialSchema>;

export const extendTrialDefaults = (): ExtendTrialForm => ({ extendedTrial: 1 });

// ── AI credit allowance dialog ───────────────────────────────────────────────
export const aiCreditsSchema = z.object({
  creditsLimit: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? Number.NaN : Number(value)),
    z
      .number()
      .int("AI credits must be a whole number.")
      .min(0, "AI credits cannot be negative.")
      .max(Number.MAX_SAFE_INTEGER, "AI credits exceed the supported maximum."),
  ),
});

export type AiCreditsForm = z.infer<typeof aiCreditsSchema>;

export const aiCreditsDefaults = (creditsLimit = 0): AiCreditsForm => ({
  creditsLimit,
});
