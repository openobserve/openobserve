import { toZonedTime } from "date-fns-tz";

const changeFormatOfDateTime = (timestamp: any) => {
  const date = new Date(timestamp / 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

export const getAnnotationsData = (annotations: any, timezone: string) => {
  const markLines: any = [];
  const markAreas: any = [];

  annotations?.value?.forEach((annotation: any) => {
    if (annotation.start_time && annotation.end_time) {
      markAreas.push([
        {
          name: annotation.title,
          xAxis: toZonedTime(new Date(annotation.start_time / 1000), timezone),
        },
        {
          xAxis: toZonedTime(new Date(annotation.end_time / 1000), timezone),
        },
      ]);
    } else if (annotation.start_time) {
      markLines.push({
        symbol: ["none", "none"],
        name: annotation.title,
        type: "xAxis",
        xAxis: changeFormatOfDateTime(annotation.start_time),
        label: {
          formatter: annotation.title ? "{b}:{c}" : "{c}",
          position: "insideEndTop",
        },
        annotationDetails: annotation,
      });
    }
  });

  return { markLines, markAreas };
};
