// Copyright 2026 OpenObserve Inc.

import { DateTime } from "luxon";
import { durationFormatter } from "@/utils/formatters";

let moment: any;
let momentInitialized = false;

const importMoment = async () => {
  if (!momentInitialized) {
    const momentModule: any = await import("moment-timezone");
    moment = momentModule.default;
    momentInitialized = true;
  }
  return moment;
};

export const timestampToTimezoneDate = (
  unixMilliTimestamp: number,
  timezone: string = "UTC",
  format: string = "yyyy-MM-dd HH:mm:ss.SSS",
) => {
  if (unixMilliTimestamp > 1e14) {
    unixMilliTimestamp = Math.floor(unixMilliTimestamp / 1000);
  }

  return DateTime.fromMillis(Math.floor(unixMilliTimestamp))
    .setZone(timezone)
    .toFormat(format);
};

export const histogramDateTimezone: any = (
  utcTime: any,
  timezone: string = "UTC",
) => {
  if (timezone == "UTC") return Math.floor(new Date(utcTime).getTime());
  else {
    return (
      Math.floor(
        DateTime.fromISO(utcTime, { zone: "UTC" })
          .setZone(timezone)
          .toSeconds(),
      ) * 1000
    );
  }
};

export const convertToUtcTimestamp = (
  inputDatetime: string,
  inputTimezone: string,
) => {
  const dt = DateTime.fromFormat(inputDatetime, "yyyy/MM/dd HH:mm:ss", {
    zone: inputTimezone,
  });

  const utcTimestamp = Math.round(dt.toUTC().toMillis());

  return utcTimestamp * 1000;
};

export const localTimeSelectedTimezoneUTCTime = async (
  time: any,
  timezone: string,
) => {
  await importMoment();
  const date = new Date(time);

  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const second = date.getSeconds();

  const convertedDate = moment.tz(
    { year, month, day, hour, minute, second },
    timezone,
  );

  return convertedDate.unix() * 1000000;
};

export const getLocalTime = (datetime: string) => {
  try {
    if (datetime !== null) {
      const event = new Date(datetime);
      const local = event.toString();
      const dateobj = new Date(local);

      return (
        dateobj.getFullYear() +
        "/" +
        (dateobj.getMonth() + 1) +
        "/" +
        dateobj.getDate() +
        " " +
        dateobj.getHours() +
        ":" +
        dateobj.getMinutes()
      );
    } else {
      return datetime;
    }
  } catch (e) {
    console.log(`Error: Error while covert localtime ${datetime}`);
    return undefined;
  }
};

export const convertDateToTimestamp = (
  date: string,
  time: string,
  timezone: string,
) => {
  const browserTime =
    "Browser Time (" + Intl.DateTimeFormat().resolvedOptions().timeZone + ")";

  const [day, month, year] = date.split("-");
  const [hour, minute] = time.split(":");

  const _date = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };

  if (timezone.toLowerCase() == browserTime.toLowerCase()) {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  const dateTime = DateTime.fromObject(_date, { zone: timezone });

  const unixTimestampMillis = dateTime.toMillis();

  return { timestamp: unixTimestampMillis * 1000, offset: dateTime.offset };
};

export const getTimezoneOffset = (timezone: string | null = null) => {
  const now = new Date();

  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = now.getFullYear();

  const scheduleDate = `${day}-${month}-${year}`;

  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  const scheduleTime = `${hours}:${minutes}`;

  const ScheduleTimezone = timezone
    ? timezone
    : Intl.DateTimeFormat().resolvedOptions().timeZone;

  const convertedDateTime = convertDateToTimestamp(
    scheduleDate,
    scheduleTime,
    ScheduleTimezone,
  );

  return convertedDateTime.offset;
};

export const convertTimeFromMicroToMilli = (time: number) =>
  Math.floor(time / 1000);

export const convertTimeFromNsToMs = (time: number) =>
  Math.floor(time / 1000000);

export const convertTimeFromNsToUs = (time: number) =>
  Math.floor(time / 1000);

export const getTimezonesByOffset = async (offsetMinutes: number) => {
  await importMoment();
  const offsetHours = offsetMinutes / 60;
  const timezones = moment.tz.names();
  const filteredTimezones = timezones.filter((zone: string) => {
    const zoneOffset = moment.tz(zone).utcOffset() / 60;
    return zoneOffset === offsetHours;
  });

  return filteredTimezones;
};

export const localTimeToMicroseconds = () => {
  var date = new Date();
  var timestampMilliseconds = date.getTime();
  var timestampMicroseconds = timestampMilliseconds * 1000;
  return timestampMicroseconds;
};

export const getDuration = (createdAt: number) => {
  const currentTime = localTimeToMicroseconds();
  const durationInSeconds = Math.floor((currentTime - createdAt) / 1000000);

  return {
    durationInSeconds,
    duration: durationFormatter(durationInSeconds),
  };
};

export const getFunctionErrorMessage = (
  message: string,
  newStartTime: number,
  newEndTime: number,
  timezone = "UTC",
) => {
  try {
    const startTimeFormatted = timestampToTimezoneDate(
      newStartTime / 1000,
      timezone,
      "yyyy-MM-dd HH:mm:ss",
    );
    const endTimeFormatted = timestampToTimezoneDate(
      newEndTime / 1000,
      timezone,
      "yyyy-MM-dd HH:mm:ss",
    );

    return `${message} (Data returned for: ${startTimeFormatted} to ${endTimeFormatted})`;
  } catch (error) {
    return message;
  }
};

export const calculateRelativeTimePeriod = (
  startTime: number,
  endTime: number,
): string => {
  const diffInMicroseconds = endTime - startTime;
  const diffInSeconds = Math.floor(diffInMicroseconds / 1000000);

  const units = [
    { label: "M", value: 2592000 },
    { label: "w", value: 604800 },
    { label: "d", value: 86400 },
    { label: "h", value: 3600 },
    { label: "m", value: 60 },
    { label: "s", value: 1 },
  ];

  for (const unit of units) {
    if (diffInSeconds >= unit.value && diffInSeconds % unit.value === 0) {
      const value = Math.floor(diffInSeconds / unit.value);
      return `${value}${unit.label}`;
    }
  }

  return `${diffInSeconds}s`;
};

export const calculateAbsoluteDateTime = (
  startTime: number,
  endTime: number,
): {
  selectedDate: { from: string; to: string };
  selectedTime: { startTime: string; endTime: string };
} => {
  const startDate = new Date(startTime / 1000);
  const endDate = new Date(endTime / 1000);

  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}/${month}/${day}`;
  };

  const formatTime = (date: Date): string => {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  return {
    selectedDate: {
      from: formatDate(startDate),
      to: formatDate(endDate),
    },
    selectedTime: {
      startTime: formatTime(startDate),
      endTime: formatTime(endDate),
    },
  };
};

export const buildDateTimeObject = (
  startTime: number,
  endTime: number,
  type: "relative" | "absolute",
): any => {
  const baseObj: any = {
    startTime,
    endTime,
    type,
  };

  if (type === "relative") {
    baseObj.relativeTimePeriod = calculateRelativeTimePeriod(
      startTime,
      endTime,
    );
  } else if (type === "absolute") {
    const absoluteDateTime = calculateAbsoluteDateTime(startTime, endTime);
    baseObj.selectedDate = absoluteDateTime.selectedDate;
    baseObj.selectedTime = absoluteDateTime.selectedTime;
    baseObj.relativeTimePeriod = null;
  }

  return baseObj;
};
