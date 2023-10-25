
/**
 * Converts a value to a specific unit of measurement.
 *
 * @param {any} value - The value to be converted.
 * @param {string} unit - The unit of measurement to convert to.
 * @param {string} customUnit - (optional) A custom unit of measurement.
 * @return {object} An object containing the converted value and unit.
 */
export const getUnitValue = (value: any, unit: string, customUnit: string) => {
    switch (unit) {
      case "bytes": {
        const units = ["B", "KB", "MB", "GB", "TB"];
        for (let unit of units) {
          if (value < 1024) {
            return {
              value: `${parseFloat(value).toFixed(2)}`,
              unit: `${unit}`,
            };
          }
          value /= 1024;
        }
        return {
          value: `${parseFloat(value).toFixed(2)}`,
          unit: "PB",
        };
      }
      case "custom": {
        return {
          value: `${value}`,
          unit: `${customUnit ?? ""}`,
        };
      }
      case "seconds": {
        const units = [
          { unit: "μs", divisor: 0.000001 },
          { unit: "ms", divisor: 0.001 },
          { unit: "s", divisor: 1 },
          { unit: "m", divisor: 60 },
          { unit: "h", divisor: 3600 },
          { unit: "D", divisor: 86400 },
          { unit: "M", divisor: 2592000 }, // Assuming 30 days in a month
          { unit: "Y", divisor: 31536000 }, // Assuming 365 days in a year
        ];
        for (const unitInfo of units) {
          const unitValue = value ? value / unitInfo.divisor : 0;
          if (unitValue >= 1 && unitValue < 1000) {
            return {
              value: unitValue.toFixed(2),
              unit: unitInfo.unit,
            };
          }
        }
  
        // If the value is too large to fit in any unit, return the original seconds
        return {
          value: value,
          unit: "s",
        };
      }
      case "microseconds": {
        const units = [
          { unit: "μs", divisor: 1 },
          { unit: "ms", divisor: 1000 },
          { unit: "s", divisor: 1000000 },
          { unit: "m", divisor: 60000000 },
          { unit: "h", divisor: 3600000000 },
          { unit: "D", divisor: 86400000000 },
          { unit: "M", divisor: 2592000000000 }, // Assuming 30 days in a month
          { unit: "Y", divisor: 31536000000000 }, // Assuming 365 days in a year
        ];
        for (let unitInfo of units) {
          const unitValue = value ? value / unitInfo.divisor : 0;
          if (unitValue < 1000) {
            return {
              value: unitValue.toFixed(2),
              unit: unitInfo.unit,
            };
          }
        }
        return {
          value: value,
          unit: "s",
        };
      }
      case "milliseconds": {
        const units = [
          { unit: "μs", divisor: 0.001 },
          { unit: "ms", divisor: 1 },
          { unit: "s", divisor: 1000 },
          { unit: "m", divisor: 60000 },
          { unit: "h", divisor: 3600000 },
          { unit: "D", divisor: 86400000 },
          { unit: "M", divisor: 2592000000 }, // Assuming 30 days in a month
          { unit: "Y", divisor: 31536000000 }, // Assuming 365 days in a year
        ];
        for (let unitInfo of units) {
          const unitValue = value ? value / unitInfo.divisor : 0;
          if (unitValue < 1000) {
            return {
              value: unitValue.toFixed(2),
              unit: unitInfo.unit,
            };
          }
        }
        return {
          value: value,
          unit: "s",
        };
      }
      case "bps": {
        const units = ["B", "KB", "MB", "GB", "TB"];
        for (let unit of units) {
          if (value < 1024) {
            return {
              value: `${parseFloat(value).toFixed(2)}`,
              unit: `${unit}/s`,
            };
          }
          value /= 1024;
        }
        return {
          value: `${parseFloat(value).toFixed(2)}`,
          unit: "PB/s",
        };
      }
      case "percent-1": {
        return {
          value: `${(parseFloat(value) * 100).toFixed(2)}`,
          unit: "%",
        };
        // `${parseFloat(value) * 100}`;
      }
      case "percent": {
        return {
          value: `${parseFloat(value).toFixed(2)}`,
          unit: "%",
        };
        // ${parseFloat(value)}`;
      }
      case "kilobytes": {
        const units = ["B", "KB", "MB", "GB", "TB"];
        for (let unit of units) {
          if (value < 1024) {
            return {
              value: `${parseFloat(value).toFixed(2)}`,
              unit: `${unit}`,
            };
          }
          value /= 1024;
        }
        return {
          value: `${parseFloat(value).toFixed(2)}`,
          unit: "PB",
        };
      }
      case "megabytes": {
        const units = ["B", "KB", "MB", "GB", "TB"];
        for (let unit of units) {
          if (value < 1024) {
            return {
              value: `${parseFloat(value).toFixed(2)}`,
              unit: `${unit}`,
            };
          }
          value /= 1024;
        }
        return {
          value: `${parseFloat(value).toFixed(2)}`,
          unit: "PB",
        };
      }
      case "default": {
        return {
          value: isNaN(value)
            ? value
            : Number.isInteger(value)
            ? value
            : value.toFixed(2),
          unit: "",
        };
      }
      default: {        
        return {
          value: isNaN(value)
            ? value
            : Number.isInteger(value)
            ? value
            : typeof value === "string" ? value : value.toFixed(2),
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
 * Formats the given date into a string in the format "DD-MM-YY HH:MM:SS".
 *
 * @param {any} date - The date to be formatted.
 * @return {string} The formatted date string.
 */
export const formatDate = (date: any) => {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = String(date.getFullYear()).slice(2);
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");
  
    return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
  };
  