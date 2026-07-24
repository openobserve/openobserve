import { z } from "zod";

export const makeManualEvaluationDialogSchema = (
  t: (_key: string) => string,
) =>
  z.object({
    jobId: z
      .string()
      .trim()
      .min(1, t("onlineEvals.manualEvaluation.jobRequired")),
  });

export type ManualEvaluationDialogForm = z.infer<
  ReturnType<typeof makeManualEvaluationDialogSchema>
>;
