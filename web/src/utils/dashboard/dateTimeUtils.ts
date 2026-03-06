import { date } from "quasar";
import { fromZonedTime } from "date-fns-tz";

/**
 * Formats the given date into a string in the format "YY-MM-DD HH:MM:SS".
 *
 * @param {any} date - The date to be formatted.
 * @return {string} The formatted date string.
 */
export const formatDate = (date: any) => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// Check if the sample is time series
export const isTimeSeries = (sample: any) => {
  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
  return sample.every((value: any) => {
    return iso8601Pattern.test(value);
  });
};

// Check if the sample is timestamp (16 digit microseconds)
/**
 * Checks if the sample is timestamp (16 digit microseconds) based on treatAsNonTimestamp object.
 * treatAsNonTimestamp: { value: true | false | null | undefined | "auto" }
 * - If treatAsNonTimestamp.value === true (not timestamp field): Return false
 * - If treatAsNonTimestamp.value === false (timestamp field): Check if all values are 16 digits, return true if they are
 * - If treatAsNonTimestamp.value === null or undefined (auto mode): Check if all values are 16 digits, return true if they are
 * - Otherwise: Return false
 */
export const isTimeStamp = (sample: any, treatAsNonTimestamp: any) => {
  const microsecondsPattern = /^\d{16}$/;

  // If treatAsNonTimestamp is true (not timestamp field), return false
  if (treatAsNonTimestamp === true) {
    return false;
  }

  // If treatAsNonTimestamp is false (timestamp field), check if all values are 16 digit numbers
  if (treatAsNonTimestamp === false) {
    return sample.every((value: any) =>
      microsecondsPattern.test(value?.toString()),
    );
  }
  // If treatAsNonTimestamp is null or undefined, check if all values are 16 digits
  if (treatAsNonTimestamp === null || treatAsNonTimestamp === undefined) {
    return sample.every((value: any) =>
      microsecondsPattern.test(value?.toString()),
    );
  }
};

export function convertOffsetToSeconds(
  offset: string,
  endISOTimestamp: number,
) {
  try {
    const periodValue = parseInt(offset.slice(0, -1)); // Extract the numeric part
    const period = offset.slice(-1); // Extract the last character (unit)

    if (isNaN(periodValue)) {
      return {
        seconds: 0,
        periodAsStr: "",
      };
    }

    const subtractObject: any = {};

    let periodAsStr = periodValue.toString();

    switch (period) {
      case "s": // Seconds
        subtractObject.seconds = periodValue;
        periodAsStr += " Seconds ago";
        break;
      case "m": // Minutes
        subtractObject.minutes = periodValue;
        periodAsStr += " Minutes ago";
        break;
      case "h": // Hours
        subtractObject.hours = periodValue;
        periodAsStr += " Hours ago";
        break;
      case "d": // Days
        subtractObject.days = periodValue;
        periodAsStr += " Days ago";
        break;
      case "w": // Weeks
        subtractObject.days = periodValue * 7;
        periodAsStr += " Weeks ago";
        break;
      case "M": // Months (approximate, using 30 days per month)
        subtractObject.months = periodValue;
        periodAsStr += " Months ago";
        break;
      default:
        return {
          seconds: 0,
          periodAsStr: "",
        };
    }

    // subtract period from endISOTimestamp
    const startTimeStamp = date.subtractFromDate(
      endISOTimestamp,
      subtractObject,
    );

    // return difference of seconds between endISOTimestamp and startTimeStamp
    return {
      seconds: endISOTimestamp - startTimeStamp.getTime(),
      periodAsStr: periodAsStr,
    };
  } catch (error) {
    console.log(error);
    return {
      seconds: 0,
      periodAsStr: "",
    };
  }
}

// Function to convert chart timestamp (timezone-adjusted) back to UTC
export const getUTCTimestampFromZonedTimestamp = (
  timestampMs: number,
  currentTimeZone: string,
) => {
  if (!timestampMs) return null;

  // Use fromZonedTime to convert from currentTimeZone back to UTC
  const zonedDate = new Date(timestampMs);
  const utcDate = fromZonedTime(zonedDate, currentTimeZone);
  const utcMs = utcDate.getTime();

  return Math.trunc(utcMs * 1000); // milliseconds to microseconds
};
