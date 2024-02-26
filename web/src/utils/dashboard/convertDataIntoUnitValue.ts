const units: any = {
  bytes: [
    { unit: "B", divisor: 1 },
    { unit: "KB", divisor: 1024 },
    { unit: "MB", divisor: 1024 * 1024 },
    { unit: "GB", divisor: 1024 * 1024 * 1024 },
    { unit: "TB", divisor: 1024 * 1024 * 1024 * 1024 },
    { unit: "PB", divisor: 1024 * 1024 * 1024 * 1024 * 1024 },
  ],
  seconds: [
    { unit: "μs", divisor: 0.000001 },
    { unit: "ms", divisor: 0.001 },
    { unit: "s", divisor: 1 },
    { unit: "m", divisor: 60 },
    { unit: "h", divisor: 3600 },
    { unit: "D", divisor: 86400 },
    { unit: "M", divisor: 2592000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000 }, // Assuming 365 days in a year
  ],
  microseconds: [
    { unit: "μs", divisor: 1 },
    { unit: "ms", divisor: 1000 },
    { unit: "s", divisor: 1000000 },
    { unit: "m", divisor: 60000000 },
    { unit: "h", divisor: 3600000000 },
    { unit: "D", divisor: 86400000000 },
    { unit: "M", divisor: 2592000000000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000000000 }, // Assuming 365 days in a year
  ],
  milliseconds: [
    { unit: "μs", divisor: 0.001 },
    { unit: "ms", divisor: 1 },
    { unit: "s", divisor: 1000 },
    { unit: "m", divisor: 60000 },
    { unit: "h", divisor: 3600000 },
    { unit: "D", divisor: 86400000 },
    { unit: "M", divisor: 2592000000 }, // Assuming 30 days in a month
    { unit: "Y", divisor: 31536000000 }, // Assuming 365 days in a year
  ],
  bps: ["B", "KB", "MB", "GB", "TB"],
  kilobytes: [
    { unit: "B", divisor: 1 / 1024 },
    { unit: "KB", divisor: 1 },
    { unit: "MB", divisor: 1024 },
    { unit: "GB", divisor: 1024 * 1024 },
    { unit: "TB", divisor: 1024 * 1024 * 1024 },
    { unit: "PB", divisor: 1024 * 1024 * 1024 * 1024 },
  ],
  megabytes: [
    { unit: "B", divisor: 1 / (1024 * 1024) },
    { unit: "KB", divisor: 1 / 1024 },
    { unit: "MB", divisor: 1 },
    { unit: "GB", divisor: 1024 },
    { unit: "TB", divisor: 1024 * 1024 },
    { unit: "PB", divisor: 1024 * 1024 * 1024 },
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
  switch (unit) {
    case "bytes": {
      for (let unitInfo of units[unit]) {
        const unitValue: any = value ? value / unitInfo.divisor : 0;

        if (Math.abs(unitValue) < 1024) {
          return {
            value: `${value < 0 ? "-" : ""}${
              parseFloat(Math.abs(unitValue)?.toString()).toFixed(decimals) ?? 0
            }`,
            unit: unitInfo.unit,
          };
        }
      }

      // Handle both positive and negative values for PB
      const absValue: any = Math.abs(value)
        ? Math.abs(value / units[unit][units[unit].length - 1].divisor)
        : 0;
      return {
        value: `${value < 0 ? "-" : ""}${
          parseFloat(absValue).toFixed(decimals) ?? 0
        }`,
        unit: "PB",
      };
    }
    case "custom": {
      return {
        value: `${parseFloat(value)?.toFixed(decimals) ?? 0}`,
        unit: `${customUnit ?? ""}`,
      };
    }
    case "seconds": {
      for (let i = units[unit].length - 1; i >= 0; i--) {
        const unitInfo = units[unit][i];
        const unitValue = value / unitInfo.divisor;
        if (Math.abs(unitValue) >= 1) {
          return {
            value: `${value < 0 ? "-" : ""}${parseFloat(
              Math.abs(unitValue)?.toFixed(decimals) ?? 0
            )}`,
            unit: unitInfo.unit,
          };
        }
      }

      // If the value is too small to fit in any unit, return in microseconds
      return {
        value: `${value < 0 ? "-" : ""}${parseFloat(
          Math.abs(value / units[unit][0].divisor)?.toFixed(decimals) ?? 0
        )}`,
        unit: units[unit][0].unit,
      };
    }

    case "microseconds": {
      for (let i = units[unit].length - 1; i >= 0; i--) {
        const unitInfo = units[unit][i];
        const unitValue = value / unitInfo.divisor;
        if (Math.abs(unitValue) >= 1) {
          return {
            value: `${value < 0 ? "-" : ""}${parseFloat(
              Math.abs(unitValue)?.toFixed(decimals) ?? 0
            )}`,
            unit: unitInfo.unit,
          };
        }
      }

      // If the value is too small to fit in any unit, return in microseconds
      return {
        value: `${value < 0 ? "-" : ""}${parseFloat(
          Math.abs(value / units[unit][0].divisor)?.toFixed(decimals) ?? 0
        )}`,
        unit: units[unit][0].unit,
      };
    }

    case "milliseconds": {
      for (let i = units[unit].length - 1; i >= 0; i--) {
        const unitInfo = units[unit][i];
        const unitValue = value / unitInfo.divisor;
        if (Math.abs(unitValue) >= 1) {
          return {
            value: `${value < 0 ? "-" : ""}${parseFloat(
              Math.abs(unitValue)?.toFixed(decimals) ?? 0
            )}`,
            unit: unitInfo.unit,
          };
        }
      }

      // If the value is too small to fit in any unit, return in microseconds
      return {
        value: `${value < 0 ? "-" : ""}${parseFloat(
          Math.abs(value / units[unit][0].divisor)?.toFixed(decimals) ?? 0
        )}`,
        unit: units[unit][0].unit,
      };
    }
    case "bps": {
      for (let unitInfo of units[unit]) {
        const absValue: any = Math.abs(value);

        if (absValue < 1024) {
          return {
            value: `${value < 0 ? "-" : ""}${
              parseFloat(absValue)?.toFixed(decimals) ?? 0
            }`,
            unit: `${unitInfo}/s`,
          };
        }
        value /= 1024;
      }

      // Handle both positive and negative values for PB/s
      return {
        value: `${value < 0 ? "-" : ""}${
          parseFloat(Math.abs(value)?.toString())?.toFixed(decimals) ?? 0
        }`,
        unit: "PB/s",
      };
    }
    case "percent-1": {
      return {
        value: `${(parseFloat(value) * 100)?.toFixed(decimals) ?? 0}`,
        unit: "%",
      };
      // `${parseFloat(value) * 100}`;
    }
    case "percent": {
      return {
        value: `${parseFloat(value)?.toFixed(decimals) ?? 0}`,
        unit: "%",
      };
      // ${parseFloat(value)}`;
    }
    case "kilobytes": {
      for (let unitInfo of units[unit]) {
        const unitValue: any = value ? value / unitInfo.divisor : 0;

        if (Math.abs(unitValue) < 1024) {
          return {
            value: `${value < 0 ? "-" : ""}${
              parseFloat(Math.abs(unitValue)?.toString())?.toFixed(decimals) ??
              0
            }`,
            unit: unitInfo.unit,
          };
        }
      }
      const val: any = Math.abs(value)
        ? Math.abs(value / units[unit][units[unit].length - 1].divisor)
        : 0;
      return {
        value: `${value < 0 ? "-" : ""}${
          parseFloat(val)?.toFixed(decimals) ?? 0
        }`,
        unit: "PB",
      };
    }
    case "megabytes": {
      for (let unitInfo of units[unit]) {
        const unitValue: any = value ? value / unitInfo.divisor : 0;
        if (Math.abs(unitValue) < 1024) {
          return {
            value: `${value < 0 ? "-" : ""}${
              parseFloat(Math.abs(unitValue)?.toString())?.toFixed(decimals) ??
              0
            }`,
            unit: unitInfo.unit,
          };
        }
      }
      const val: any = Math.abs(value)
        ? Math.abs(value / units[unit][units[unit].length - 1].divisor)
        : 0;
      return {
        value: `${value < 0 ? "-" : ""}${
          parseFloat(val)?.toFixed(decimals) ?? 0
        }`,
        unit: "PB",
      };
    }
    case "default": {
      return {
        value: isNaN(value) ? value : (+value)?.toFixed(decimals) ?? 0,
        unit: "",
      };
    }
    default: {
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
