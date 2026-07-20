// Copyright 2026 OpenObserve Inc.
import { z } from "zod";

export const makeAddLocationSchema = (t: (k: string) => string) =>
  z.object({
    label: z.string().min(1, t("synthetics.privateLocations.form.nameRequired")),
    region: z.string().min(1, t("synthetics.privateLocations.form.regionRequired")),
    provider: z.string().optional(),
  });

export type AddLocationForm = z.infer<ReturnType<typeof makeAddLocationSchema>>;

export const addLocationDefaults = (): AddLocationForm => ({
  label: "",
  region: "",
  provider: "",
});
