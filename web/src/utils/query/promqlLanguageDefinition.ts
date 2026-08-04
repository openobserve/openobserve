// Copyright 2026 OpenObserve Inc.
//
// Loads the PromQL grammar, which is vendored in promqlMonarch.ts — see the
// licence and the reasoning there; the short version is that importing the
// upstream package pulled ~376 KB of an unrelated editor's runtime into the
// bundle for a require it never uses.
//
// Still a wrapper, and still dynamic: it is the test seam the specs mock, and
// it keeps the grammar out of the initial chunk.

export const loadPromqlLanguage = async (): Promise<{
  language: any;
  languageConfiguration: any;
}> => {
  const { language, languageConfiguration } = await import("./promqlMonarch");
  return { language, languageConfiguration };
};
