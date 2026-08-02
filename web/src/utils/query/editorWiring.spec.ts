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

// A STRUCTURAL guard on how the query editor is wired across the app.
//
// Three separate per-surface wiring gaps have shipped from this workstream:
// Alerts bound the base keyword list instead of the context-aware one; the SLO
// form never triggered the server catalog load; and Traces omitted the
// `suggestions` prop entirely, so it silently fell back to the component's
// static 26-function catalog and never saw the ~330 from the registry.
//
// Every one was invisible to unit tests because each surface is wired by hand
// and no test asserted anything ACROSS surfaces. This file does: it reads the
// components that mount an editor and checks the invariants a reviewer would
// otherwise have to hold in their head.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

// resolve from THIS file rather than cwd: vitest's root is src/, so a bare
// "/src" path resolves against the filesystem root.
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../") + "/";

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "test") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".vue")) out.push(full);
  }
  return out;
};

/** Files that bind :keywords on an editor — i.e. every editor host. */
const editorHosts = walk(SRC)
  .map((path) => ({ path: path.replace(SRC, ""), source: readFileSync(path, "utf-8") }))
  .filter((f) => /:keywords\s*=/.test(f.source));

describe("editor wiring — every surface supplies both completion sources", () => {
  it("finds the editor hosts at all (guards against the walk silently breaking)", () => {
    expect(editorHosts.length).toBeGreaterThan(8);
  });

  it.each(editorHosts.map((f) => f.path))("%s binds :suggestions as well as :keywords", (path) => {
    const { source } = editorHosts.find((f) => f.path === path)!;
    // Omitting :suggestions is not inert — CodeQueryEditor falls back to the
    // STATIC local catalog, so the surface silently loses every function the
    // server reports. That is exactly how Traces ended up short.
    expect(
      /:suggestions\s*=/.test(source),
      `${path} binds :keywords but not :suggestions, so it falls back to the ` +
        `static catalog and loses the server-supplied functions`,
    ).toBe(true);
  });

  it.each(editorHosts.map((f) => f.path))("%s supplies a field-value resolver", (path) => {
    const { source } = editorHosts.find((f) => f.path === path)!;
    // C4 moves the field-VALUE lookup inside the provider, which can only
    // await a resolver something hands it. A surface that omits this gets a
    // working editor with no value completion — silently, exactly like the
    // three prop-wiring gaps before it.
    //
    // DECIDED: applies to EVERY host, with no exemption list. A surface with no
    // stream context supplies a resolver returning [] — which the composable's
    // resolveFieldValues already does when streamName is unset, so complying
    // costs nothing. Pass-throughs (QueryEditor.vue, SloExpressionField.vue)
    // forward the prop as they already forward keywords and suggestions.
    // An exemption list is where the next silent gap would hide: every wiring
    // bug in this workstream reached production because one surface was quietly
    // different from the rest.
    expect(
      /:field-value-resolver\s*=|:fieldValueResolver\s*=/.test(source),
      `${path} mounts an editor without a field-value resolver`,
    ).toBe(true);
  });

  // A resolver that can never resolve anything is the same class of silent gap
  // as a missing prop: the wiring test passes, the editor works, and value
  // completion just quietly does nothing. resolveFieldValues reads the stored
  // values under the composite key "org|streamType|streamName|field", so a
  // surface that never sets those three gets [] on every lookup and the
  // provider falls straight through to the ordinary function list.
  const composableHosts = editorHosts.filter((f) => /useSqlSuggestions\s*\(/.test(f.source));

  it("finds the surfaces that own a composable (not the pass-through wrappers)", () => {
    expect(composableHosts.length).toBeGreaterThan(8);
    // QueryEditor.vue and SloExpressionField.vue forward a resolver prop rather
    // than owning one; they have no stream context to set and must not be
    // required to have any.
    expect(composableHosts.map((f) => f.path)).not.toContain("components/QueryEditor.vue");
  });

  it.each(composableHosts.map((f) => f.path))(
    "%s sets the stream context its resolver looks values up under",
    (path) => {
      const { source } = composableHosts.find((f) => f.path === path)!;
      for (const key of ["org", "streamType", "streamName"]) {
        expect(
          new RegExp(`[Aa]utoCompleteData(\\.value)?\\.${key}\\s*=`).test(source),
          `${path} owns a useSqlSuggestions resolver but never sets ` +
            `autoCompleteData.${key}, so every field-value lookup returns []`,
        ).toBe(true);
      }
    },
  );

  it.each(editorHosts.map((f) => f.path))("%s does not bind the base keyword list", (path) => {
    const { source } = editorHosts.find((f) => f.path === path)!;
    // autoCompleteKeywords is the pre-context list; binding it means field
    // VALUES and stream names never reach the editor.
    expect(
      /:keywords\s*=\s*"autoCompleteKeywords"/.test(source),
      `${path} binds the base keyword list instead of the context-aware view`,
    ).toBe(false);
  });

  it.each(editorHosts.map((f) => f.path))("%s does not bind the base suggestion list", (path) => {
    const { source } = editorHosts.find((f) => f.path === path)!;
    expect(
      /:suggestions\s*=\s*"autoCompleteSuggestions"/.test(source),
      `${path} binds the base suggestion list instead of the context-aware view`,
    ).toBe(false);
  });
});
