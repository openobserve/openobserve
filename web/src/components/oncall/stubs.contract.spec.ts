// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Every on-call spec stubs the components around the one under test, and a
 * stub declaring a prop the real component does not have makes every
 * assertion about that prop VACUOUS — it tests the stub. Four bugs shipped
 * behind that in a single day, and none of them could fail a test, a type
 * check or a lint rule:
 *
 *   - `ODialog` stubbed with `modelValue`, which it does not have: three
 *     dialogs bound with `v-model` could never open at all.
 *   - `ODialog` stubbed with `primaryDisabled` (really `primaryButtonDisabled`)
 *     in two specs: three dialogs rendered with no Save and no Cancel, because
 *     `hasFooter` reads the real names and saw none of them.
 *   - `OTooltip` stubbed without `content`: an assertion that a truncated cell
 *     had a tooltip passed with no tooltip mounted.
 *   - `OButton` stubbed without `ariaLabel`: three icon-only row actions with
 *     no accessible name each read as named.
 *
 * Unknown props fall through as plain attributes and Vue says nothing, so the
 * only thing that ever caught one was opening the page in a browser. This
 * reads both sides instead: the props a spec CLAIMS a component has, against
 * the props that component actually declares.
 *
 * Deliberately one-directional — a stub may declare FEWER props than the real
 * component (that is the point of a stub); it may never declare one that does
 * not exist.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const WEB_SRC = resolve(process.cwd(), "src");

/// The specs this guards. On-call is where the four instances were found and
/// where the component surface is widest; the machinery is not on-call
/// specific and can be pointed at another feature by adding a directory.
const SPEC_DIRS = ["components/oncall", "views/OnCall"];

/// Components whose props cannot be read from source with confidence. Listed
/// with a reason rather than skipped silently, so the count below fails when
/// one is added carelessly.
const UNRESOLVABLE: Record<string, string> = {
  // Vue's own built-ins and router components have no file in src/.
  RouterLink: "vue-router built-in",
  "router-link": "vue-router built-in",
  Teleport: "Vue built-in",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Every `.vue` in `src`, indexed by component file name. */
const componentIndex = (() => {
  const index = new Map<string, string[]>();
  for (const path of walk(WEB_SRC)) {
    if (!path.endsWith(".vue")) continue;
    const name = basename(path, ".vue");
    index.set(name, [...(index.get(name) ?? []), path]);
  }
  return index;
})();

/**
 * The prop names a component declares.
 *
 * Handles the three shapes this codebase uses: an inline type literal, a named
 * interface in a sibling `*.types.ts` (following `extends`), and a runtime
 * object. Returns null when none of them can be read — the caller then skips
 * rather than guessing, because a wrong "real prop list" would fail honest
 * stubs and get this file deleted.
 */
function declaredProps(file: string): Set<string> | null {
  const source = readFileSync(file, "utf8");

  const typed = /defineProps<\s*/.exec(source);
  if (typed) {
    const after = source.slice(typed.index + typed[0].length);
    if (after.startsWith("{")) return propsFromTypeBody(braceBody(after, 0));
    // A named interface — sibling `.types.ts` first, then this file.
    const named = after.match(/^([A-Za-z_$][\w$]*)/);
    return named ? propsFromNamedType(named[1], file, source) : null;
  }

  const runtime = /defineProps\(\s*\{/.exec(source);
  if (runtime) {
    return propsFromTypeBody(braceBody(source, runtime.index + runtime[0].length - 1));
  }

  return null;
}

/** Comments carry colons and braces of their own, and would parse as members. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

/** The text between `{` at `open` and its matching `}`. */
function braceBody(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return "";
}

/**
 * `{ a: string; b?: number }` → {a, b}.
 *
 * Members are cut at top-level `;` and newlines, so a one-line type literal
 * declares as many props as a formatted interface does — and a nested object
 * type's own members stay out, because the cut only happens at depth zero.
 */
function propsFromTypeBody(body: string): Set<string> {
  const names = new Set<string>();
  let depth = 0;
  let member = "";

  const take = () => {
    const found = member.trim().match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:/);
    if (found) names.add(found[1]);
    member = "";
  };

  // Angle brackets are deliberately NOT counted: `(row: TData) => Tone | null`
  // closes a bracket that was never opened, and one arrow-typed member would
  // otherwise push the depth negative and hide every prop after it — which is
  // exactly how the first draft of this file declared OTable had no `error`.
  for (const ch of stripComments(body)) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;

    if (depth === 0 && (ch === ";" || ch === "," || ch === "\n")) take();
    else member += ch;
  }
  take();
  return names;
}

function propsFromNamedType(
  typeName: string,
  file: string,
  source: string,
): Set<string> | null {
  const bare = typeName.replace(/<.*/, "").trim();
  const candidates = [
    join(dirname(file), `${basename(file, ".vue")}.types.ts`),
    ...readdirSync(dirname(file))
      .filter((f) => f.endsWith(".types.ts"))
      .map((f) => join(dirname(file), f)),
  ];

  for (const candidate of [file, ...candidates]) {
    let text: string;
    try {
      text = candidate === file ? source : readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
    const declared = new RegExp(`interface\\s+${bare}\\b([^{]*)\\{`).exec(text);
    if (!declared) continue;

    const props = propsFromTypeBody(
      braceBody(text, declared.index + declared[0].length - 1),
    );
    // `extends Base` contributes its own members.
    const parents = declared[1].match(/extends\s+([\w,\s]+)/);
    if (parents) {
      for (const parent of parents[1].split(",").map((p) => p.trim())) {
        if (!parent) continue;
        const inherited = propsFromNamedType(parent, file, source);
        inherited?.forEach((p) => props.add(p));
      }
    }
    return props;
  }
  return null;
}

/** `{ name: "OTag", props: ["a", "b"], … }` occurrences in a spec. */
function stubsIn(specSource: string): { component: string; props: string[] }[] {
  const found: { component: string; props: string[] }[] = [];
  const re = /name:\s*"([A-Za-z][\w-]*)"\s*,([\s\S]{0,400}?)(?:\n\s*\}|template:)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(specSource)) !== null) {
    const props = match[2].match(/props:\s*\[([^\]]*)\]/);
    if (!props) continue;
    found.push({
      component: match[1],
      props: props[1]
        .split(",")
        .map((p) => p.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean),
    });
  }
  return found;
}

const specs = SPEC_DIRS.flatMap((dir) =>
  walk(join(WEB_SRC, dir)).filter(
    // Not itself: the examples in this file's own prose are stub literals too.
    (f) => f.endsWith(".spec.ts") && basename(f) !== "stubs.contract.spec.ts",
  ),
);

describe("on-call spec stubs mirror the components they stand in for", () => {
  it("finds the specs it is meant to be guarding", () => {
    // A refactor that moves the specs must not turn this file into a no-op.
    expect(specs.length).toBeGreaterThan(30);
  });

  /// The failure mode of a checker like this is silence: one parser change and
  /// every component resolves to "cannot read its props", every stub is
  /// skipped, and the suite stays green while guarding nothing. So count what
  /// was actually compared, and fail if it collapses.
  it("actually resolves the components it checks", () => {
    let compared = 0;
    for (const specPath of specs) {
      for (const stub of stubsIn(readFileSync(specPath, "utf8"))) {
        const files = componentIndex.get(stub.component);
        if (!files || files.length !== 1) continue;
        const real = declaredProps(files[0]);
        if (real && real.size) compared += stub.props.length;
      }
    }
    expect(compared).toBeGreaterThan(150);
  });

  it.each(specs.map((s) => [s.slice(WEB_SRC.length + 1), s] as const))(
    "%s",
    (_label, specPath) => {
      const stubs = stubsIn(readFileSync(specPath, "utf8"));
      const problems: string[] = [];

      for (const stub of stubs) {
        if (stub.component in UNRESOLVABLE) continue;
        const files = componentIndex.get(stub.component);
        // A stub for something that is not a single-file component in this
        // repo (a local test double, a renamed component) is not this test's
        // business.
        if (!files || files.length !== 1) continue;

        const real = declaredProps(files[0]);
        if (!real || real.size === 0) continue;

        for (const prop of stub.props) {
          if (!real.has(prop)) {
            problems.push(
              `${stub.component} has no prop "${prop}" — real props: ${[...real]
                .sort()
                .join(", ")}`,
            );
          }
        }
      }

      expect(problems).toEqual([]);
    },
  );
});
