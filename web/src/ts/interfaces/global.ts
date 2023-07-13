export interface IDateTime {
  startTime: number;
  endTime: number;
  relativeTimePeriod: string;
  type?: "relative" | "absolute";
  valueType?: "relative" | "absolute" | "relative-custom";
}
