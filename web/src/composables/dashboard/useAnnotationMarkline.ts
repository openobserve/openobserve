import { toZonedTime } from "date-fns-tz";

export const getAnnotationsData = (annotations: any, timezone: string) => {
  const markLines: any = [];
  const markAreas: any = [];

  annotations?.value?.forEach((annotation: any) => {
    if (annotation.start_time && annotation.end_time) {
      markAreas.push([
        {
          name: annotation.title,
          xAxis: toZonedTime(new Date(annotation.start_time / 1000), timezone),
          annotationDetails: annotation,
        },
        {
          xAxis: toZonedTime(new Date(annotation.end_time / 1000), timezone),
          annotationDetails: annotation,
        },
      ]);
    } else if (annotation.start_time) {
      markLines.push({
        symbol: ["none", "none"],
        name: annotation.title,
        type: "xAxis",
        xAxis: toZonedTime(new Date(annotation.start_time / 1000), timezone),
        label: { show: true, formatter: annotation.title },
        annotationDetails: annotation,
      });
    }
  });

  return { markLines, markAreas };
};
