// Copyright 2026 OpenObserve Inc.
//
// Form schema for AddAnnotation.vue. `title` is required; `text` (description)
// and `panels` (selected panel ids) are form-owned but unvalidated — the form
// is the single source of truth for all three.

import { z } from "zod";

export const addAnnotationSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  // Optional annotation description.
  text: z.string().optional().default(""),
  // Selected panel ids (the OSelect options use `value: panel.id`, a string).
  // Empty = annotation applies to all panels of the dashboard.
  panels: z.array(z.string()).default([]),
});

export type AddAnnotationForm = z.infer<typeof addAnnotationSchema>;
