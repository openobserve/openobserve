// Copyright 2026 OpenObserve Inc.
//
// vue-i18n compiles a message the first time it is rendered (JIT compilation is
// on — see __INTLIFY_JIT_COMPILATION__ in vite.config.ts). A message whose text
// contains raw `{`, `}` or `@` is not a string to vue-i18n: it is interpolation
// or linked-message syntax, and compiling it throws. The throw happens inside
// render, so it does not surface as a nice error — it tears down whatever
// component asked for the message.
//
// That is invisible until the exact branch that renders the message runs. A
// `{"key": "value"}` placeholder on the HTTP check's request-body field only
// renders for non-GET methods, so picking POST made the entire HTTP Request
// card disappear with nothing but `SyntaxError: 2` in the console.
//
// This ran against en-US only, which left the far likelier source uncovered: the
// other 14 locales are machine-translated, and a translator that localises a
// placeholder NAME produces exactly the same crash in exactly the same way.
//
//   en-US  "Are you sure you want to delete {identifier}?"
//   zh-CN  "您确定要删除 {标识符} 吗？"        -> SyntaxError: 2
//
// IAM -> Service Accounts rendered blank in Chinese for that reason, and the
// same class also arrives as mangled literal escapes — {'{'}team{'}'} coming
// back as {'{'} '}, an unbalanced brace.
//
// So every locale is compiled here, and every translated message is additionally
// checked to interpolate only names en-US defines. A translated `{Anzahl}` for
// `{count}` compiles fine and then silently renders as an empty string, because
// nothing passes a value under that name.
//
// Literal braces/at-signs must be escaped as {'{'}, {'}'}, {'@'}.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@intlify/core-base";

const LANGUAGES_DIR = resolve(__dirname, "./languages");
const SOURCE_LOCALE = "en-US";

const localeFiles = readdirSync(LANGUAGES_DIR)
  .filter((name) => name.endsWith(".json"))
  .sort();

function flatten(node: unknown, path = "", out: [string, string][] = []): [string, string][] {
  if (typeof node === "string") {
    out.push([path, node]);
    return out;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      flatten(v, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}

function loadLocale(stem: string): [string, string][] {
  return flatten(JSON.parse(readFileSync(resolve(LANGUAGES_DIR, `${stem}.json`), "utf8")));
}

/**
 * Compiles `message` and returns the interpolation tokens vue-i18n would resolve
 * for it — named (`{count}`), list (`{0}`) and linked (`@:some.key`).
 *
 * Throws if the message does not compile, so this doubles as the compile check.
 * onError rethrows: the compiler otherwise collects errors and returns a
 * best-effort result, which would hide exactly what we are looking for.
 *
 * The names come from *running* the compiled message against a recording
 * context rather than from pattern-matching the source text, because only the
 * compiler knows which braces are placeholders and which are literal escapes —
 * `{'}'}` is one token whose body is the character a `{...}` regex stops at.
 * Every branch of a pluralized message is evaluated, so a name used only in the
 * plural form still counts.
 */
export function interpolationTokens(message: string, key = "", locale = ""): string[] {
  const seen = new Set<string>();
  const render = compile(message, {
    key,
    locale,
    onError: (err) => {
      throw err;
    },
    // Locale files legitimately contain <strong> and friends; that advisory is
    // not this test's business and would drown its output.
    warnHtmlMessage: false,
  });

  render({
    type: "text",
    normalize: (values: unknown[]) => values.join(""),
    interpolate: (value: unknown) => String(value),
    named: (key: string) => {
      seen.add(`{${key}}`);
      return "";
    },
    list: (index: number) => {
      seen.add(`{${index}}`);
      return "";
    },
    linked: (key: string) => {
      seen.add(`@:${key}`);
      return "";
    },
    message: () => () => "",
    plural: (branches: unknown[]) => branches[0],
    values: {},
  } as never);

  return [...seen].sort();
}

describe("interpolationTokens", () => {
  it("reports named, list and linked tokens", () => {
    expect(interpolationTokens("Hi {name}, {0} new @:common.alerts")).toEqual([
      "@:common.alerts",
      "{0}",
      "{name}",
    ]);
  });

  it("ignores vue-i18n literal escapes", () => {
    expect(interpolationTokens("{'{'}pod{'}'}: {'{'}level{'}'}")).toEqual([]);
  });

  it("sees a name that appears only in a plural branch", () => {
    expect(interpolationTokens("{one} day | {many} days")).toEqual(["{many}", "{one}"]);
  });

  it("throws on a placeholder name vue-i18n cannot tokenize", () => {
    // The zh-CN Service Accounts crash, reduced.
    expect(() => interpolationTokens("您确定要删除 {标识符} 吗？")).toThrow();
  });
});

describe.each(localeFiles)("%s", (file) => {
  const stem = file.replace(/\.json$/, "");
  const messages = loadLocale(stem);

  it("should all compile with vue-i18n", () => {
    const broken: string[] = [];
    for (const [key, value] of messages) {
      try {
        interpolationTokens(value, key, stem);
      } catch (err) {
        broken.push(`${key}: ${JSON.stringify(value)} — ${String(err).split("\n")[0]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  if (stem !== SOURCE_LOCALE) {
    it("should only interpolate names en-US defines", () => {
      const source = new Map(loadLocale(SOURCE_LOCALE));
      const unknown: string[] = [];

      for (const [key, value] of messages) {
        const english = source.get(key);
        // Keys en-US no longer has are pruned by the translation script, not here.
        if (english === undefined) continue;

        let defined: string[];
        let used: string[];
        try {
          defined = interpolationTokens(english, key, SOURCE_LOCALE);
          used = interpolationTokens(value, key, stem);
        } catch {
          continue; // already reported by the compile test above
        }

        // A subset, not an exact match: dropping a placeholder the target
        // language does not need is legitimate (an English plural suffix like
        // {plural} has no equivalent in Japanese). Introducing a name en-US
        // never passes a value for is always a bug.
        const extra = used.filter((token) => !defined.includes(token));
        if (extra.length) {
          unknown.push(
            `${key}: ${extra.join(", ")} — en-US has ${JSON.stringify(english)}, this has ${JSON.stringify(value)}`,
          );
        }
      }

      expect(unknown).toEqual([]);
    });
  }
});

// The checks above are subset checks: a locale that is MISSING a key is skipped
// (`if (english === undefined) continue` guards the reverse direction only).
// That is deliberate for the corpus at large — machine translation runs behind
// en-US, and a missing key falls back to en-US at runtime, which is survivable.
//
// It is not survivable for a message the UI composes at render time. The alert
// preview badge builds its sentence from a label fragment
// ("{count} {label} match ({comparison})"), and vue-i18n's fallback for an
// unknown key is the key PATH — so a locale missing one fragment renders
// "1 alerts.previewEvaluation.matchingSeries match (1 >= 1)" mid-sentence,
// which reads as a crash rather than as untranslated English.
//
// Nothing else catches it: `I18nKey` is derived from en-US alone
// (src/types/i18n.ts:37), so type-check sees a valid key, and the interpolation
// check above never looks at keys a locale does not have.
describe("alerts.previewEvaluation key parity", () => {
  const PREFIX = "alerts.previewEvaluation.";
  const sourceKeys = loadLocale(SOURCE_LOCALE)
    .map(([key]) => key)
    .filter((key) => key.startsWith(PREFIX));

  it("en-US defines the block at all", () => {
    expect(sourceKeys.length).toBeGreaterThan(0);
  });

  it.each(localeFiles.filter((file) => file !== `${SOURCE_LOCALE}.json`))(
    "%s defines every key en-US does",
    (file) => {
      const locale = new Map(loadLocale(file.replace(/\.json$/, "")));
      const missing = sourceKeys.filter((key) => !locale.has(key));
      expect(missing).toEqual([]);
    },
  );
});
