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
// Compiling every en-US message here turns that into a test failure instead.
// Literal braces/at-signs must be escaped as {'{'}, {'}'}, {'@'}.

import { describe, expect, it } from "vitest";
import { baseCompile } from "@intlify/message-compiler";
import enUS from "./languages/en-US.json";

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

describe("en-US messages", () => {
  it("should all compile with vue-i18n", () => {
    const broken: string[] = [];
    for (const [key, value] of flatten(enUS)) {
      try {
        // onError rethrows: baseCompile otherwise collects errors and returns a
        // best-effort AST, which would hide exactly what we are looking for.
        baseCompile(value, {
          onError: (err) => {
            throw err;
          },
        });
      } catch (err) {
        broken.push(`${key}: ${JSON.stringify(value)} — ${String(err).split("\n")[0]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
