// Copyright 2026 OpenObserve Inc.
//
// Validation schema for BuildFieldPopUp.vue. The popup collects a single
// editable value: the field `label`. Restored rule (BEFORE inventory §4,
// dashboards): label was `v.length > 0 || 'Required'` → required. Factory keeps
// the message i18n-driven. Validation TIMING is owned by OForm.

import { z } from "zod";

export const makeBuildFieldPopUpSchema = (t: (_key: string) => string) =>
  z.object({
    label: z.string().min(1, t("common.required")),
  });

export type BuildFieldPopUpForm = z.infer<
  ReturnType<typeof makeBuildFieldPopUpSchema>
>;
