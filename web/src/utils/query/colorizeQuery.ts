import { editor, languages } from "monaco-editor/esm/vs/editor/editor.api";
import { vrlLanguageDefinition } from "@/utils/query/vrlLanguageDefinition";
import { loadPromqlLanguage } from "@/utils/query/promqlLanguageDefinition";

let languagesRegistered = false;

const registerLanguages = async () => {
  if (languagesRegistered) return;

  // Monaco has no built-in PromQL — register the official grammar.
  languages.register({ id: "promql" });
  const promql = await loadPromqlLanguage();
  languages.setMonarchTokensProvider("promql", promql.language as any);
  languages.setLanguageConfiguration("promql", promql.languageConfiguration as any);

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

// Monaco's own `.mtkN` classes are indices into whichever Monaco theme is active, which stays light "vs" on pages with no editor.
const TOKEN_CLASS: Record<string, string> = {
  keyword: "text-query-syntax-keyword",
  predefined: "text-query-syntax-function",
  type: "text-query-syntax-function",
  string: "text-query-syntax-string",
  regexp: "text-query-syntax-string",
  number: "text-query-syntax-number",
  comment: "text-query-syntax-comment",
};

const tokensToHtml = (query: string, lang: string): string => {
  const lines = editor.tokenize(query, lang);
  return query
    .split(/\r\n|\r|\n/)
    .map((line, i) => {
      const tokens = lines[i] ?? [];
      if (!tokens.length) return escapeHtml(line);
      return tokens
        .map((token, t) => {
          const text = escapeHtml(line.slice(token.offset, tokens[t + 1]?.offset ?? line.length));
          const cls = TOKEN_CLASS[token.type.split(".")[0]];
          return cls && text ? `<span class="${cls}">${text}</span>` : text;
        })
        .join("");
    })
    .join("\n");
};

export const colorizeQuery = async (query: string, language: string): Promise<string> => {
  if (!query) return "";

  await registerLanguages();

  const lang = language.toLowerCase();

  try {
    // Awaited only so the lazily loaded grammar is ready before the synchronous tokenize.
    await editor.colorize(query, lang, {});
    return tokensToHtml(query, lang);
  } catch (e) {
    // Monaco failed — fall back to plain escaped text so the caller can
    // safely render via v-html without XSS risk (GHSA-hx23-g7m8-h76j class).
    return escapeHtml(query);
  }
};
