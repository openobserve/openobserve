// Copyright 2026 OpenObserve Inc.
//
// Validation schemas for the two self-owned dialogs in OrganizationManagement.vue
// (meta-org admin): the External Contract dialog and the Extend-Trial dialog.
//
// Both dialogs previously gated their POST on imperative JS guards inside the
// @click:primary handlers (a toast + early-return for a missing contract end
// date). Those guards are replaced here by Zod rules wired to <OForm>, so the
// footer Save + Enter submit through `form-id` and validation is schema-driven.
//
// Validation TIMING is owned by OForm (submit-then-change via revalidateLogic);
// these schemas only describe WHAT is valid.

import { z } from "zod";

// ── External Contract dialog ─────────────────────────────────────────────────
// The single date field is required. The message is mode-aware so it reads
// "End date is required." when creating a new contract and "New end date is
// required." when extending an existing one (mirrors the old toast guards).
export const makeContractSchema = (mode: "create" | "extend") =>
  z.object({
    contractEndDate: z
      .string()
      .min(
        1,
        mode === "create"
          ? "End date is required."
          : "New end date is required.",
      ),
  });

export type ContractForm = z.infer<ReturnType<typeof makeContractSchema>>;

export const contractDefaults = (): ContractForm => ({ contractEndDate: "" });

// ── Extend-Trial dialog ──────────────────────────────────────────────────────
// The week count comes from a custom pill grid (1–4), bridged into the form via
// setFieldValue. It must be at least one week. `z.coerce.number()` because the
// bridged value can arrive as a string.
export const extendTrialSchema = z.object({
  extendedTrial: z.coerce
    .number()
    .min(1, "Trial extension must be at least 1 week."),
});

export type ExtendTrialForm = z.infer<typeof extendTrialSchema>;

export const extendTrialDefaults = (): ExtendTrialForm => ({ extendedTrial: 1 });
