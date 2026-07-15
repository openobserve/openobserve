// Copyright 2026 OpenObserve Inc.

import config from "../aws-exports";
import { useStore } from "vuex";
import CronExpressionParser from "cron-parser";
import { getFunctionErrorMessage } from "@/utils/timezone";

export const getPath = () => {
  const pos = window.location.pathname.indexOf("/web/");
  const path =
    window.location.origin == "http://localhost:8081"
      ? pos > -1
        ? "/web/"
        : "/"
      : pos > -1
        ? window.location.pathname.slice(0, pos + 5)
        : "";
  return config.isCloud == "true" ? path : path;
};

export const getImageURL = (image_path: string) => {
  return getPath() + "src/assets/" + image_path;
};

export const queryIndexSplit = (query: string, splitWord: string) => {
  const lowerCaseQuery: string = query.toLowerCase();
  const lowerCaseSplitWord: string = splitWord.toLowerCase();

  const splitWordIndex = lowerCaseQuery.indexOf(lowerCaseSplitWord);

  if (splitWordIndex === -1) {
    return [query, ""];
  }

  const beforeSplit = query.slice(0, splitWordIndex);
  const afterSplit = query.slice(splitWordIndex + splitWord.length);

  return [beforeSplit, afterSplit];
};

export function addSpacesToOperators(input: string): string {
  let result = "";
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let parenDepth = 0;
  while (i < input.length) {
    const char = input[i];
    const nextChar = input[i + 1];
    const prevChar = i > 0 ? input[i - 1] : "";
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    }
    if (!inSingleQuote && !inDoubleQuote) {
      if (char === "(") {
        parenDepth++;
      } else if (char === ")") {
        parenDepth--;
      }
    }

    const shouldProcessOperators =
      !inSingleQuote && !inDoubleQuote && parenDepth === 0;

    if (shouldProcessOperators) {
      if (i < input.length - 1) {
        const twoChar = char + nextChar;
        if (twoChar === "!=" || twoChar === "<=" || twoChar === ">=") {
          if (prevChar && prevChar !== " ") {
            result += " ";
          }
          result += twoChar;
          if (i + 2 < input.length && input[i + 2] !== " ") {
            result += " ";
          }
          i += 2;
          continue;
        }
      }
      if (
        char === "!" &&
        nextChar === " " &&
        i + 2 < input.length &&
        input[i + 2] === "="
      ) {
        if (prevChar && prevChar !== " ") {
          result += " ";
        }
        result += "!=";
        if (i + 3 < input.length && input[i + 3] !== " ") {
          result += " ";
        }
        i += 3;
        continue;
      }
      if (char === "=" || char === ">" || char === "<") {
        if (prevChar && prevChar !== " ") {
          result += " ";
        }
        result += char;
        if (nextChar && nextChar !== " ") {
          result += " ";
        }
        i++;
        continue;
      }
    }
    result += char;
    i++;
  }
  return result;
}

export const mergeRoutes: any = (route1: any, route2: any) => {
  const mergedRoutes = [];

  for (const r1 of route1) {
    const matchingRoute = route2.find(
      (r2: any) => r2.path === r1.path && r2.name === r1.name,
    );

    if (matchingRoute) {
      const mergedChildren = mergeRoutes(
        r1.children || [],
        matchingRoute.children || [],
      );
      mergedRoutes.push({
        ...r1,
        children: mergedChildren.length ? mergedChildren : undefined,
      });

      route2 = route2.filter((r2: any) => r2 !== matchingRoute);
    } else {
      mergedRoutes.push({ ...r1 });
    }
  }

  mergedRoutes.push(...route2);

  return mergedRoutes;
};

const isObject = (obj: any) => obj !== null && typeof obj === "object";

const isValidKey = (key: string) => {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
};

export const mergeDeep = (target: any, source: any) => {
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (
        isValidKey(key) &&
        Object.prototype.hasOwnProperty.call(source, key)
      ) {
        if (isObject(source[key])) {
          if (!target[key]) target[key] = {};
          mergeDeep(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    }
  }
  return target;
};

export const validateEmail = (email: string) => {
  try {
    if (email != null) {
      const re = /\S+@\S+\.\S+/;
      return re.test(email);
    } else {
      return false;
    }
  } catch (e) {
    console.log(`Error: Error while validatig email id ${email}`);
  }
};

export const isValidResourceName = (name: string) => {
  const roleNameRegex = /^[^:#?&%'"\/\s]+$/;
  return roleNameRegex.test(name);
};

export const escapeSingleQuotes = (value: any) => {
  return value?.replace(/'/g, "''");
};

export const splitQuotedString = (input: any) => {
  if (input == null) {
    return input;
  }

  input = input.trim();

  const regex = /'([^']*?)'|"([^"]*?)"|([^,()]+)/g;

  const result = [];

  let match;
  while ((match = regex.exec(input)) !== null) {
    const value = match[1] || match[2] || match[3];

    const trimmedValue = value.trim();

    if (trimmedValue) {
      result.push(trimmedValue);
    }
  }

  return result;
};

export const arraysMatch = (arr1: Array<any>, arr2: Array<any>) => {
  if (arr1.length !== arr2.length) return false;

  arr1 = arr1.slice().sort();
  arr2 = arr2.slice().sort();

  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) return false;
  }

  return true;
};

export const deepCopy = (value: any) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.error("Error deep copying value", error);
    return value;
  }
};

export const mergeAndRemoveDuplicates = (
  arr1: string[],
  arr2: string[],
): string[] => {
  return [...new Set([...arr1, ...arr2])];
};

export const maxLengthCharValidation = (
  val: string = "",
  char_length: number = 50,
) => {
  return (
    (val && val.length <= char_length) ||
    `Maximum ${char_length} characters allowed`
  );
};

export const validateUrl = (val: string) => {
  try {
    const url = new URL(val);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return "Please provide correct URL.";
  }
};

export const getWebSocketUrl = (
  request_id: string,
  org_identifier: string,
  apiEndPoint: string,
) => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${apiEndPoint.split("//")[1]}/api/${org_identifier}/ws/v2/${request_id}`;
};

export const isWebSocketEnabled = (data: any) => {
  return false;
};

export const isStreamingEnabled = (data: any) => {
  return true;
};

export const getIngestionURL = () => {
  const store = useStore();
  let ingestionURL: string = store.state.API_ENDPOINT;
  if (
    Object.hasOwn(store.state.zoConfig, "ingestion_url") &&
    store.state.zoConfig.ingestion_url !== ""
  ) {
    ingestionURL = store.state.zoConfig.ingestion_url;
  }
  return ingestionURL;
};

export const getEndPoint = (ingestionURL: string) => {
  const url = new URL(ingestionURL);
  const endpoint = {
    url: ingestionURL,
    host: url.hostname,
    port: url.port || (url.protocol === "https:" ? "443" : "80"),
    protocol: url.protocol.replace(":", ""),
    tls: url.protocol === "https:" ? "On" : "Off",
  };
  return endpoint;
};

export function getCronIntervalDifferenceInSeconds(cronExpression: string) {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
      utc: true,
    });

    const firstExecution = interval.next();
    const secondExecution = interval.next();

    return (secondExecution.getTime() - firstExecution.getTime()) / 1000;
  } catch (err) {
    throw new Error("Invalid cron expression");
  }
}

export const getCronIntervalInMinutes = (cronExpression: string): number => {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
      utc: true,
    });

    const first = interval.next();
    const second = interval.next();

    const diffMs = second.getTime() - first.getTime();
    const diffMinutes = diffMs / (1000 * 60);

    return diffMinutes;
  } catch (err) {
    throw new Error("Invalid cron expression");
  }
};

export function isAboveMinRefreshInterval(
  value: number,
  config: { min_auto_refresh_interval?: string | number },
) {
  const minInterval = Number(config?.min_auto_refresh_interval) || 1;
  return value >= minInterval;
}

export const describeCron = (
  cronExpression: string,
  timezone?: string,
): string => {
  if (!cronExpression || !cronExpression.trim()) return "";
  try {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 6) return "invalid cron (expected 6 fields)";

    const [sec, min, hour, dom, month, dow] = parts;
    const tz = timezone || "UTC";
    const tzLabel = tz.replace(/_/g, " ");

    const isEvery = (f: string) => f === "*";
    const getStep = (f: string) => {
      const m = f.match(/^\*\/(\d+)$/);
      return m ? parseInt(m[1]) : null;
    };
    const getFixed = (f: string) => {
      const m = f.match(/^(\d+)$/);
      return m ? parseInt(m[1]) : null;
    };

    const minStep = getStep(min);
    const hourStep = getStep(hour);
    const fixedMin = getFixed(min);
    const fixedHour = getFixed(hour);
    const fixedSec = getFixed(sec);

    if (
      fixedSec === 0 &&
      minStep &&
      isEvery(hour) &&
      isEvery(dom) &&
      isEvery(month) &&
      isEvery(dow)
    ) {
      return `every ${minStep} minute${minStep > 1 ? "s" : ""}`;
    }

    if (
      fixedSec === 0 &&
      fixedMin === 0 &&
      hourStep &&
      isEvery(dom) &&
      isEvery(month) &&
      isEvery(dow)
    ) {
      return `every ${hourStep} hour${hourStep > 1 ? "s" : ""}`;
    }

    if (
      fixedSec === 0 &&
      fixedMin !== null &&
      fixedHour !== null &&
      isEvery(dom) &&
      isEvery(month) &&
      isEvery(dow)
    ) {
      const hh = String(fixedHour).padStart(2, "0");
      const mm = String(fixedMin).padStart(2, "0");
      return `daily at ${hh}:${mm} (${tzLabel})`;
    }

    if (
      fixedSec === 0 &&
      fixedMin !== null &&
      isEvery(hour) &&
      isEvery(dom) &&
      isEvery(month) &&
      isEvery(dow)
    ) {
      return `every hour at minute ${fixedMin}`;
    }

    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
      tz,
    });
    const next = interval.next();
    const nextDate = new Date(next.getTime());
    const nextStr = nextDate.toLocaleString("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return `next check at ${nextStr} (${tzLabel})`;
  } catch {
    return "invalid cron expression";
  }
};

export const convertMinutesToCron = (minutes: number): string => {
  if (!minutes || minutes <= 0) {
    return "";
  }

  return `0 */${minutes} * * * *`;
};

export const processQueryMetadataErrors = (
  metadata: any,
  timezone: string = "UTC",
): string => {
  if (!metadata || metadata.length === 0) {
    return "";
  }

  const combinedWarnings: string[] = [];

  if (Array.isArray(metadata[0])) {
    metadata.forEach((queryChunks: any[]) => {
      queryChunks.forEach((chunk: any) => {
        if (
          chunk?.function_error &&
          chunk?.new_start_time &&
          chunk?.new_end_time
        ) {
          const combinedMessage = getFunctionErrorMessage(
            chunk.function_error,
            chunk.new_start_time,
            chunk.new_end_time,
            timezone,
          );
          combinedWarnings.push(combinedMessage);
        } else if (chunk?.function_error) {
          combinedWarnings.push(...chunk.function_error);
        }
      });
    });
  } else {
    const query = metadata[0];
    if (query?.function_error && query?.new_start_time && query?.new_end_time) {
      const combinedMessage = getFunctionErrorMessage(
        query.function_error,
        query.new_start_time,
        query.new_end_time,
        timezone,
      );
      combinedWarnings.push(combinedMessage);
    } else if (query?.function_error) {
      combinedWarnings.push(query.function_error);
    }
  }

  const dedupedWarnings = mergeAndRemoveDuplicates(combinedWarnings, []);
  return dedupedWarnings.join("\n");
};
