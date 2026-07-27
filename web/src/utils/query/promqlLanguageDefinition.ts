// Copyright 2026 OpenObserve Inc.
//
// PromQL language support for Monaco, based on the official community package
// (prometheus-community/monaco-promql) — we do NOT maintain our own grammar.
// Monaco ships no built-in PromQL, and registering only the language id (all
// we did historically) renders queries in a single colour.
//
// The stock grammar is extended with three app-specific rules, prepended so
// they win over the package's own string/identifier rules:
//   1-2. Quoted label values that are purely numeric ("200", "0.138.0") colour
//        as numbers (green) — same /^-?[\d.]+$/ split the builder chips use,
//        mirroring SQL's number colouring (PromQL values are always quoted).
//   3.   Dashboard variables ($__rate_interval, ${var}) colour as variables.
//   4.   Label-matcher operators (= and =~) colour as operators — the stock
//        grammar only recognises the binary-op list (!=, ==, ...), leaving
//        bare = / =~ uncoloured and inconsistent with the rest.
//
// The import is dynamic so callers that lazy-load Monaco don't pull
// monaco-editor into their initial chunk (monaco-promql imports it directly).

type PromqlMonacoModule = typeof import("monaco-promql/promql/promql");

export const loadPromqlLanguage = async (): Promise<{
  language: Record<string, unknown>;
  languageConfiguration: PromqlMonacoModule["languageConfiguration"];
}> => {
  const { language, languageConfiguration } = await import("monaco-promql/promql/promql");

  const extendedLanguage = {
    ...language,
    tokenizer: {
      ...language.tokenizer,
      root: [
        [/"-?[\d.]+"/, "number"],
        [/'-?[\d.]+'/, "number"],
        [/\$\{?[a-zA-Z_]\w*\}?/, "variable"],
        [/=~|!~|!=|==|=/, "delimiter"],
        ...language.tokenizer.root,
      ],
    },
  };

  return { language: extendedLanguage, languageConfiguration };
};
