// Copyright 2026 OpenObserve Inc.
//
// Validation schema for ImportDashboard.vue — a deliberate PARTIAL. The OForm
// covers only the input-collection fields: `url` and `jsonFiles`. The deep
// JSON-content validation (title / stream_type / structure via
// `validateDashboardJson`) cannot be expressed per-field in Zod and stays
// imperative — it drives the error side-panel + recovery inputs, which remain
// outside this form. Monaco `jsonStr` and the custom `selectedFolder` dropdown
// also stay bare.
//
// The only field rule is the http(s) URL format check. It is intentionally
// NON-required: the URL tab also accepts JSON pasted straight into the Monaco
// editor (no URL), so requiring the URL would break that flow. `url`/`jsonFiles`
// are form-owned (name=); the page reads them via form.useStore for the import
// logic / watchers (no v-model, no mirror).

import { z } from "zod";

export const makeImportDashboardSchema = (t: (_key: string) => string) =>
  z.object({
    // Optional, but if provided it must be an http(s) URL.
    url: z
      .string()
      .optional()
      .refine((v) => !v || /^https?:\/\//i.test(String(v)), {
        message: t("dashboard.onlyHttpsUrlsAllowed"),
      }),
    // The selected .json file(s). Optional (the same import can come from a URL
    // or pasted JSON); content validity is checked imperatively after parse.
    jsonFiles: z.any().optional(),
  });

export type ImportDashboardForm = z.infer<
  ReturnType<typeof makeImportDashboardSchema>
>;

export const importDashboardDefaults = (): ImportDashboardForm => ({
  url: "",
  jsonFiles: undefined,
});
