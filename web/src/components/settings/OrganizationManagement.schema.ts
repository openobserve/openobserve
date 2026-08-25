// Copyright 2026 OpenObserve Inc.
//
// Validation schemas for the self-owned dialogs in OrganizationManagement.vue
// (meta-org admin): External Contract, Extend Trial, and AI Credits.
//
// Validation timing is owned by OForm (submit-then-change via revalidateLogic);
// these schemas only describe what is valid.

import { z } from "zod";

import type { TranslateFn } from "@/types/i18n";

// ── External Contract dialog ─────────────────────────────────────────────────
// The single date field is required. The message is mode-aware so it reads
// "End date is required." when creating a new contract and "New end date is
// required." when extending an existing one.
export const makeContractSchema = (t: TranslateFn, mode: "create" | "extend") =>
  z.object({
    contractEndDate: z.string().min(1, {
      error: () =>
        mode === "create"
          ? t("settings.contractEndDateRequired")
          : t("settings.contractNewEndDateRequired"),
    }),
  });

export type ContractForm = z.infer<ReturnType<typeof makeContractSchema>>;

export const contractDefaults = (): ContractForm => ({ contractEndDate: "" });

// ── Extend-Trial dialog ──────────────────────────────────────────────────────
// The week count comes from a custom pill grid (1–4), bridged into the form via
// setFieldValue. It must be at least one week. `z.coerce.number()` because the
// bridged value can arrive as a string.
export const makeExtendTrialSchema = (t: TranslateFn) =>
  z.object({
    extendedTrial: z.coerce.number().min(1, { error: () => t("settings.trialExtensionMinWeek") }),
  });

export type ExtendTrialForm = z.infer<ReturnType<typeof makeExtendTrialSchema>>;

export const extendTrialDefaults = (): ExtendTrialForm => ({ extendedTrial: 1 });

// ── AI credit allowance dialog ───────────────────────────────────────────────
export const makeAiCreditsSchema = (t: TranslateFn) =>
  z.object({
    creditsLimit: z.preprocess(
      (value) =>
        value === "" || value === null || value === undefined ? Number.NaN : Number(value),
      z
        .number()
        .int({ error: () => t("settings.aiCreditsWholeNumber") })
        .min(0, { error: () => t("settings.aiCreditsNegative") })
        .max(Number.MAX_SAFE_INTEGER, {
          error: () => t("settings.aiCreditsMax"),
        }),
    ),
  });

export type AiCreditsForm = z.infer<ReturnType<typeof makeAiCreditsSchema>>;

export const aiCreditsDefaults = (creditsLimit = 0): AiCreditsForm => ({
  creditsLimit,
});
