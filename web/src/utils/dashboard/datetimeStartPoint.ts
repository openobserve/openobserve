import { format, differenceInSeconds, addSeconds, subSeconds } from "date-fns";
import { utcToZonedTime } from "date-fns-tz";

export const dateBin = (interval: number, date: Date, origin: Date): Date => {
    // console.log("dateBin function started.");
    
  // console.log(
  //   `Interval: ${interval}, Date: ${date.toISOString()}, Origin: ${origin.toISOString()}`
  // );

  const durationSinceOrigin = differenceInSeconds(date, origin);
  // console.log(`Duration since origin: ${durationSinceOrigin}`);

  const remainder = durationSinceOrigin % interval;
  // console.log(`Remainder: ${remainder}`);

//   if (remainder < interval / 2) {
    const adjustedDate = subSeconds(date, remainder);
//     console.log(
//       `Adjusted date (subtracted remainder): ${adjustedDate.toISOString()}`
//     );
//     return adjustedDate;
//   } else {
//     const adjustedDate = addSeconds(date, interval - remainder);
//     console.log(
//       `Adjusted date (added interval - remainder): ${adjustedDate.toISOString()}`
//     );
    return adjustedDate;
//   }
};

// function main(): void {
//   console.log("Main function started.");

//   // const interval = 10 * 60; // 10 minutes in seconds
//   // console.log(`Interval: ${interval}`);

//   // const date = new Date(Date.UTC(2024, 5, 5, 21, 33, 0)); // Note: Months are 0-indexed in JavaScript
//   // console.log(`Date: ${date.toISOString()}`);

//   // const origin = new Date(Date.UTC(2001, 0, 1, 0, 0, 0)); // January is month 0
//   // console.log(`Origin: ${origin.toISOString()}`);

//   // const binnedDate = dateBin(interval, date, origin);
//   // console.log("Binned date: ", format(utcToZonedTime(binnedDate, 'UTC'), "yyyy-MM-dd'T'HH:mm:ss'Z'"));

//   console.log("Main function ended.");
// }

// main();
