import { editor, languages } from "monaco-editor/esm/vs/editor/editor.api";
import { vrlLanguageDefinition } from "@/utils/query/vrlLanguageDefinition";

let languagesRegistered = false;

const registerLanguages = async () => {
  if (languagesRegistered) return;

  // Register PromQL
  languages.register({ id: "promql" });

  // Register VRL
  languages.register({ id: "vrl" });
  languages.setMonarchTokensProvider("vrl", vrlLanguageDefinition as any);

  // Load standard languages (SQL, JSON, etc.)
  // We explicitly import SQL contribution for ensuring it's available
  await import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js");

  // You might want to add other language contributions here if needed
  // await import("monaco-editor/esm/vs/basic-languages/python/python.contribution.js");

  languagesRegistered = true;
};

/** Escape a plain string for safe insertion into an HTML context. */
const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const colorizeQuery = async (query: string, language: string): Promise<string> => {
  if (!query) return "";

  await registerLanguages();

  const lang = language.toLowerCase();

  try {
    // Determine language ID to pass to Monaco
    // Some basic languages might need specific IDs or are auto-handled if loaded
    const colorized = await editor.colorize(query, lang, {});
    return colorized;
  } catch (e) {
    // Monaco failed — fall back to plain escaped text so the caller can
    // safely render via v-html without XSS risk (GHSA-hx23-g7m8-h76j class).
    return escapeHtml(query);
  }
};