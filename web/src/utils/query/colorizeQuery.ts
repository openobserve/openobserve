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
    console.error("Colorization failed", e);
    return query;
  }
};
