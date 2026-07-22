import { z } from "zod";

type Translate = (key: string) => string;

function isJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value || "{}");
    return Boolean(
      parsed && typeof parsed === "object" && !Array.isArray(parsed),
    );
  } catch {
    return false;
  }
}

export const makeManualEvalSchema = (t: Translate) =>
  z.object({
    targetId: z.string().refine((value) => value.trim().length > 0, {
      message: t("onlineEvals.job.detail.manualTargetRequired"),
    }),
    spanId: z.string(),
    traceId: z.string(),
    sessionId: z.string(),
    reason: z.string(),
    variablesJson: z.string().refine(isJsonObject, {
      message: t("onlineEvals.job.detail.manualVariablesObjectError"),
    }),
  });

export type ManualEvalForm = z.infer<ReturnType<typeof makeManualEvalSchema>>;
