import { differenceInSeconds, subSeconds } from "date-fns";

export const dateBin = (interval: number, date: Date, origin: Date): Date => {
  const durationSinceOrigin = differenceInSeconds(date, origin);

  const remainder = durationSinceOrigin % interval;

  const adjustedDate = subSeconds(date, remainder);

  return adjustedDate;
};
