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

import type { HLJSApi, Language, Mode } from "highlight.js";

const KEYWORDS = ["if", "else", "abort", "return", "for_each", "null", "true", "false"];

/** VRL for highlight.js: event paths, fallible and plain function calls, strings and operators. */
export function vrl(hljs: HLJSApi): Language {
  const string: Mode = {
    scope: "string",
    variants: [
      { begin: /[rs]'/, end: /'/ },
      { begin: /"/, end: /"/, contains: [hljs.BACKSLASH_ESCAPE] },
    ],
  };
  return {
    name: "VRL",
    contains: [
      hljs.HASH_COMMENT_MODE,
      string,
      // `.field.nested`, `%metadata` and `."quoted key"` are paths into the event.
      {
        scope: "variable",
        match:
          /[.%](?:[A-Za-z_][A-Za-z0-9_]*|"[^"]*")(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|"[^"]*")|\[\d+\])*/,
      },
      { scope: "keyword", match: new RegExp(`\\b(?:${KEYWORDS.join("|")})\\b`) },
      // A trailing `!` marks the fallible variant, which is still the same function.
      { scope: "title.function", match: /\b[A-Za-z_][A-Za-z0-9_]*!?(?=\s*\()/ },
      { scope: "number", match: /\b\d+(?:\.\d+)?\b/ },
      { scope: "operator", match: /\?\?|\|\||&&|==|!=|>=|<=|\|=|[-+*/!<>=|]/ },
      { scope: "punctuation", match: /[{}()[\],:;]/ },
    ],
  };
}
