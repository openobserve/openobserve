import { differenceInSeconds, subSeconds } from "date-fns";

export const dateBin = (interval: number, date: Date, origin: Date): Date => {
  const durationSinceOrigin = differenceInSeconds(date, origin);

  const remainder = durationSinceOrigin % interval;

  //   if (remainder < interval / 2) {
  const adjustedDate = subSeconds(date, remainder);
  //     return adjustedDate;
  //   } else {
  //     const adjustedDate = addSeconds(date, interval - remainder);
  return adjustedDate;
  //   }
};

// function main(): void {

// const interval = 10 * 60; // 10 minutes in seconds

// const date = new Date(Date.UTC(2024, 5, 5, 21, 33, 0)); // Note: Months are 0-indexed in JavaScript

// const origin = new Date(Date.UTC(2001, 0, 1, 0, 0, 0)); // January is month 0

// const binnedDate = dateBin(interval, date, origin);

// }

// main();
