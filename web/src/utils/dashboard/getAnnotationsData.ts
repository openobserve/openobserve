import { toZonedTime } from "date-fns-tz";

export const getAnnotationsData = (annotations: any, timezone: string) => {
  const markLines: any = [];
  const markAreas: any = [];

  annotations?.value?.forEach((annotation: any) => {
    if (annotation.start_time && annotation.end_time) {
      markAreas.push([
        {
          name: annotation.title,
          label: { show: true, formatter: annotation.title, distance: 0.2 },
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
        symbol: ["circle", "triangle"],
        name: annotation.title,
        type: "xAxis",
        xAxis: toZonedTime(new Date(annotation.start_time / 1000), timezone),
        label: { show: true, formatter: annotation.title, distance: 0.2 },
        annotationDetails: annotation,
      });
    }
  });

  return { markLines, markAreas };
};
