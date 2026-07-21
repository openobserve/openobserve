import { z } from "zod";

type Translate = (key: string) => string;

export const makeSpanSelectorSchema = (
  t: Translate,
  options: {
    defaultFieldCount: number;
    isDuplicateName: (name: string, id: string) => boolean;
  },
) =>
  z
    .object({
      id: z.string(),
      name: z.string().refine((value) => value.trim().length > 0, {
        message: t("onlineEvals.job.spanSelector.validation.name"),
      }),
      fieldMode: z.enum(["default", "custom"]),
      fields: z.array(z.string()),
      maximumSpans: z.coerce
        .number()
        .int()
        .min(1, {
          message: t("onlineEvals.job.spanSelector.validation.maximumSpans"),
        }),
      filterReady: z.boolean(),
    })
    .superRefine((value, ctx) => {
      if (options.isDuplicateName(value.name, value.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["name"],
          message: t("onlineEvals.job.spanSelector.validation.duplicateName"),
        });
      }

      if (!value.filterReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["filterReady"],
          message: t("onlineEvals.job.spanSelector.validation.filter"),
        });
      }

      if (value.fieldMode === "custom" && value.fields.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["fields"],
          message: t("onlineEvals.job.spanSelector.validation.fields"),
        });
      }

      const fieldCount =
        value.fieldMode === "default"
          ? options.defaultFieldCount
          : value.fields.length;
      if (value.maximumSpans * fieldCount * 1000 > 40000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["maximumSpans"],
          message: t("onlineEvals.job.spanSelector.validation.budget"),
        });
      }
    });

export type SpanSelectorForm = z.infer<
  ReturnType<typeof makeSpanSelectorSchema>
>;
