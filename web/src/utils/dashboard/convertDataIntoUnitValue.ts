const units: any = {
  bytes: [
    { unit: "B", divisor: 1 },
    { unit: "KB", divisor: 1024 },
    { unit: "MB", divisor: 1024 ** 2 },
    { unit: "GB", divisor: 1024 ** 3 },
    { unit: "TB", divisor: 1024 ** 4 },
    { unit: "PB", divisor: 1024 ** 5 },
  ],
  seconds: [
    { unit: "μs", divisor: 1e-6 },
    { unit: "ms", divisor: 1e-3 },
    { unit: "s", divisor: 1 },
    { unit: "m", divisor: 60 },
    { unit: "h", divisor: 3600 },
    { unit: "D", divisor: 86400 },
    { unit: "M", divisor: 2592000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000 }, // Assuming 365 days in a year
  ],
  microseconds: [
    { unit: "μs", divisor: 1 },
    { unit: "ms", divisor: 1e3 },
    { unit: "s", divisor: 1e6 },
    { unit: "m", divisor: 6e7 },
    { unit: "h", divisor: 36e8 },
    { unit: "D", divisor: 864e8 },
    { unit: "M", divisor: 2592e9 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536e9 }, // Assuming 365 days in a year
  ],
  milliseconds: [
    { unit: "μs", divisor: 1e-3 },
    { unit: "ms", divisor: 1 },
    { unit: "s", divisor: 1e3 },
    { unit: "m", divisor: 6e4 },
    { unit: "h", divisor: 36e5 },
    { unit: "D", divisor: 864e5 },
    { unit: "M", divisor: 2592e6 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536e6 }, // Assuming 365 days in a year
  ],
  bps: [
    { unit: "B/s", divisor: 1 },
    { unit: "KB/s", divisor: 1024 },
    { unit: "MB/s", divisor: 1024 ** 2 },
    { unit: "GB/s", divisor: 1024 ** 3 },
    { unit: "TB/s", divisor: 1024 ** 4 },
    { unit: "PB/s", divisor: 1024 ** 5 },
  ],
  kilobytes: [
    { unit: "B", divisor: 1 / 1024 },
    { unit: "KB", divisor: 1 },
    { unit: "MB", divisor: 1024 },
    { unit: "GB", divisor: 1024 ** 2 },
    { unit: "TB", divisor: 1024 ** 3 },
    { unit: "PB", divisor: 1024 ** 4 },
  ],
  megabytes: [
    { unit: "B", divisor: 1 / 1024 ** 2 },
    { unit: "KB", divisor: 1 / 1024 },
    { unit: "MB", divisor: 1 },
    { unit: "GB", divisor: 1024 },
    { unit: "TB", divisor: 1024 ** 2 },
    { unit: "PB", divisor: 1024 ** 3 },
  ],
};

/**
 * Converts a value to a specific unit of measurement.
 *
 * @param {any} value - The value to be converted.
 * @param {string} unit - The unit of measurement to convert to.
 * @param {string} customUnit - (optional) A custom unit of measurement.
 * @return {object} An object containing the converted value and unit.
 */
export const getUnitValue = (
  value: any,
  unit: string,
  customUnit: string,
  decimals: number = 2
) => {
  // console.time("getUnitValue:");
  // value sign: positive = 1, negative = -1
  const sign = Math.sign(value);
  // abs value
  const absValue = Math.abs(value);

  switch (unit) {
    case "bytes":
    case "seconds":
    case "microseconds":
    case "milliseconds":
    case "kilobytes":
    case "bps":
    case "megabytes": {
      // start with last index
      let unitIndex = units[unit].length - 1;
      // while the value is smaller than the divisor
      while (unitIndex > 0 && absValue < units[unit][unitIndex].divisor) {
        unitIndex--;
      }

      // calculate the final value: sign * absValue / divisor
      const finalValue = (
        (sign * absValue) /
        units[unit][unitIndex].divisor
      ).toFixed(decimals);
      const finalUnit = units[unit][unitIndex].unit;

      // console.timeEnd("getUnitValue:");
      return { value: finalValue, unit: finalUnit };
    }
    case "custom": {
      // console.timeEnd("getUnitValue:");
      return {
        value: `${parseFloat(value)?.toFixed(decimals) ?? 0}`,
        unit: `${customUnit ?? ""}`,
      };
    }
    case "percent-1": {
      // console.timeEnd("getUnitValue:");
      return {
        value: `${(parseFloat(value) * 100)?.toFixed(decimals) ?? 0}`,
        unit: "%",
      };
    }
    case "percent": {
      // console.timeEnd("getUnitValue:");
      return {
        value: `${parseFloat(value)?.toFixed(decimals) ?? 0}`,
        unit: "%",
      };
    }
    case "default":
    default: {
      // console.timeEnd("getUnitValue:");
      return {
        value: isNaN(value) ? value : (+value)?.toFixed(decimals) ?? 0,
        unit: "",
      };
    }
  }
};

/**
 * Formats a unit value.
 *
 * @param {any} obj - The object containing the value and unit.
 * @return {string} The formatted unit value.
 */
export const formatUnitValue = (obj: any) => {
  return `${obj.value}${obj.unit}`;
};

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
