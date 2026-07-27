// Copyright 2026 OpenObserve Inc.
//
// Loads the official monaco-promql grammar verbatim. This wrapper is a test
// seam (the package imports monaco-editor — unresolvable under jsdom, and
// mocking the bare package path doesn't intercept it) and keeps the import
// dynamic so monaco-editor stays out of the initial chunk.

type PromqlMonacoModule = typeof import("monaco-promql/promql/promql");

export const loadPromqlLanguage = async (): Promise<{
  language: PromqlMonacoModule["language"];
  languageConfiguration: PromqlMonacoModule["languageConfiguration"];
}> => {
  const { language, languageConfiguration } = await import("monaco-promql/promql/promql");
  return { language, languageConfiguration };
};
