// Copyright 2026 OpenObserve Inc.


export const b64EncodeUnicode = (str: string) => {
  try {
    return btoa(
      encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode(parseInt(`0x${p1}`));
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, ".");
  } catch (e) {
    console.log("Error: getBase64Encode: error while encoding.");
    return null;
  }
};

export const b64DecodeUnicode = (str: string) => {
  try {
    return decodeURIComponent(
      Array.prototype.map
        .call(
          atob(str.replace(/\-/g, "+").replace(/\_/g, "/").replace(/\./g, "=")),
          function (c) {
            return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
          },
        )
        .join(""),
    );
  } catch (e) {
    console.log("Error: getBase64Decode: error while decoding.");
  }
};

export const b64DecodeUnicodeSafe = (str: string, fallback = ""): string => {
  if (!str) return fallback;
  return b64DecodeUnicode(str) ?? fallback;
};

const isBase64Encoded = (str: string): boolean => {
  if (!str || typeof str !== "string") return false;

  const base64Pattern = /^[A-Za-z0-9\-_\.]+$/;

  if (!base64Pattern.test(str)) return false;

  try {
    const decoded = b64DecodeUnicode(str);
    return decoded !== undefined && decoded !== null && decoded !== str;
  } catch (e) {
    return false;
  }
};

export const smartDecodeVrlFunction = (
  vrlFunction: string | null | undefined,
): string => {
  if (!vrlFunction) return "";

  try {
    const firstDecode = b64DecodeUnicode(vrlFunction);

    if (!firstDecode) return vrlFunction;

    if (isBase64Encoded(firstDecode)) {
      const secondDecode = b64DecodeUnicode(firstDecode);
      return secondDecode || firstDecode;
    }

    return firstDecode;
  } catch (e) {
    console.error("Error decoding VRL function:", e);
    return vrlFunction;
  }
};

export const b64EncodeStandard = (str: string) => {
  try {
    return btoa(
      encodeURIComponent(str).replace(
        /%([0-9A-F]{2})/g,
        function (match, p1: any) {
          return String.fromCharCode(parseInt(`0x${p1}`));
        },
      ),
    );
  } catch (e) {
    console.log("Error: getBase64Encode: error while encoding.");
  }
};

export const b64DecodeStandard = (str: string) => {
  try {
    return decodeURIComponent(
      Array.prototype.map
        .call(atob(str), function (c) {
          return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join(""),
    );
  } catch (e) {
    console.log("Error: getBase64Decode: error while decoding.");
  }
};

export const convertToTitleCase = (str: string) => {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export const truncateText = (text: string, maxLength: number): string => {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(maxLength - 1, 0))}…`;
};

export const formatLargeNumber = (number: number) => {
  if (number === undefined || number === null) return "";

  if (number >= 1000000000) {
    return (number / 1000000000).toFixed(1) + "B";
  } else if (number >= 1000000) {
    return (number / 1000000).toFixed(1) + "M";
  } else if (number >= 1000) {
    return (number / 1000).toFixed(1) + "K";
  } else {
    return number.toString();
  }
};

export const formatSizeFromMB = (sizeInMB: string) => {
  let size = parseFloat(sizeInMB);

  if (isNaN(size)) {
    return "0 MB";
  }

  const units = ["KB", "MB", "GB", "TB", "PB"];
  let index = 1;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }

  let new_size = size.toFixed(2);
  if (new_size == "0.00" && size > 0) {
    new_size = "0.01";
  }

  return `${new_size} ${units[index]}`;
};

export const addCommasToNumber = (number: number) => {
  if (number === null || number === undefined) return "0";
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export const formatTimeWithSuffix = (us: number) => {
  if (!us || us === 0) {
    return "0us";
  }

  if (us >= 1000 * 1000 * 60) {
    return `${(us / 1000 / 1000 / 60).toFixed(2)}m`;
  }

  if (us >= 1000 * 1000) {
    return `${(us / 1000 / 1000).toFixed(2)}s`;
  }

  if (us >= 1000) {
    return `${(us / 1000).toFixed(2)}ms`;
  }

  return `${us.toFixed(2)}us`;
};

export function formatDuration(ms: number) {
  if (!ms || ms === 0) return "0 sec";
  const seconds = (ms / 1000).toFixed(2);
  const minutes = (Number(seconds) / 60).toFixed(2);
  const hours = (Number(minutes) / 60).toFixed(2);
  const days = (Number(hours) / 24).toFixed(2);

  let formatted = `${seconds} sec`;

  if (ms > 86400000) {
    formatted = `${days} days ${hours} hr`;
  } else if (ms > 3600000) {
    formatted = `${hours} hr `;
  } else if (ms > 60000) {
    formatted = `${minutes} min`;
  }

  return formatted.trim();
}

export const durationFormatter = (durationInSeconds: number): string => {
  let formattedDuration;

  if (durationInSeconds < 0) {
    formattedDuration = "Invalid duration";
  } else if (durationInSeconds < 60) {
    formattedDuration = `${durationInSeconds}s`;
  } else if (durationInSeconds < 3600) {
    const minutes = Math.floor(durationInSeconds / 60);
    const seconds = durationInSeconds % 60;
    formattedDuration = `${minutes > 0 ? `${minutes}m ` : ""}${
      seconds > 0 ? `${seconds}s` : ""
    }`.trim();
  } else if (durationInSeconds < 86400) {
    const hours = Math.floor(durationInSeconds / 3600);
    const minutes = Math.floor((durationInSeconds % 3600) / 60);
    const seconds = durationInSeconds % 60;
    formattedDuration = `${hours > 0 ? `${hours}h ` : ""}${
      minutes > 0 ? `${minutes}m ` : ""
    }${seconds > 0 ? `${seconds}s` : ""}`.trim();
  } else {
    const days = Math.floor(durationInSeconds / 86400);
    const hours = Math.floor((durationInSeconds % 86400) / 3600);
    const minutes = Math.floor((durationInSeconds % 3600) / 60);
    const seconds = durationInSeconds % 60;
    formattedDuration = `${days > 0 ? `${days}d ` : ""}${
      hours > 0 ? `${hours}h ` : ""
    }${minutes > 0 ? `${minutes}m ` : ""}${
      seconds > 0 ? `${seconds}s` : ""
    }`.trim();
  }

  return formattedDuration;
};

export const maskText = (text: string) => {
  return text;
};

export const convertToCamelCase = (str: string) => {
  if (!str) {
    return "";
  }

  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

/**
 * Re-exported, not reimplemented: `@/utils/zincutils` barrels this module, so
 * this is how the many `import { convertUnixToDateFormat } from "@/utils/zincutils"`
 * call sites resolve. The implementation lives in `@/utils/date` — there is
 * exactly one.
 */
export { convertUnixToDateFormat } from "@/utils/date";
