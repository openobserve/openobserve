import { escapeSingleQuotes, splitQuotedString } from "@/utils/zincutils";

// Shared helpers for building SQL where/in clauses

export const formatINValue = (value: any) => {
  // if variable is present, don't want to use splitQuotedString
  if (value?.includes("$")) {
    if (value.startsWith("(") && value.endsWith(")")) {
      return value.substring(1, value.length - 1);
    }
    return value;
  } else {
    return splitQuotedString(value ?? "")
      ?.map((it: any) => `'${escapeSingleQuotes(it)}'`)
      .join(", ");
  }
};

// Extract variables from the query string, returning unique variable names
export const extractVariables = (query: string): string[] => {
  const matches = query.match(/\$(\w+|\{\w+\})/g);
  return matches
    ? Array.from(new Set(matches.map((v) => v.replace(/^\$|\{|\}/g, ""))))
    : [];
};
