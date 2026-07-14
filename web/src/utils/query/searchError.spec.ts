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

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseSearchError, toSearchErrorObject } from "./searchError";

/** The exact body the range endpoint returns on a timed-out PromQL query. */
const REAL_ENVELOPE = {
  status: "error",
  errorType: "bad_data",
  error:
    'Error during planning: ErrorCode# {"code":20010,"message":"Search query timed out","inner":"[PromQL] grpc search load data task timeout"}',
  trace_id: "c411073d6ad32609a8e590e4229949d4",
};

describe("the backend's ErrorCode envelope", () => {
  it("shows the sentence, not the envelope", () => {
    const parsed = parseSearchError({ response: { data: REAL_ENVELOPE } });

    expect(parsed.message).toBe("Search query timed out");
    expect(parsed.code).toBe(20010);
    expect(parsed.detail).toBe("[PromQL] grpc search load data task timeout");
  });

  it("keeps the trace id, which is the first thing support asks for", () => {
    const parsed = parseSearchError({ response: { data: REAL_ENVELOPE } });
    expect(parsed.traceId).toBe("c411073d6ad32609a8e590e4229949d4");
  });

  it("prefers the envelope's code over the HTTP status", () => {
    // 500 says the request failed; 20010 says WHY.
    const parsed = parseSearchError({
      response: { data: REAL_ENVELOPE, status: 500 },
    });
    expect(parsed.code).toBe(20010);
  });

  it("falls back to the raw string when the envelope's JSON is malformed", () => {
    // Better a mangled message than none: a blank tooltip reads as a second bug.
    const raw = "Error during planning: ErrorCode# {not json";
    expect(parseSearchError({ response: { data: { error: raw } } }).message).toBe(
      raw,
    );
  });

  it("leaves a plain message alone", () => {
    const parsed = parseSearchError({
      response: { data: { error: "Invalid PromQL: unexpected }" } },
    });
    expect(parsed.message).toBe("Invalid PromQL: unexpected }");
    expect(parsed.code).toBeUndefined();
    expect(parsed.detail).toBeUndefined();
  });
});

describe("the shapes a failed search arrives in", () => {
  it("reads a plain-text body, rather than falling back to axios's message", () => {
    // Not every failure comes back as an envelope. A `text/plain` response, or a
    // proxy's error page in front of us, arrives as a bare STRING — so there is
    // no `.error` and no `.message` to read, and what was shown instead was
    // axios's own "Request failed with status code 502": a sentence that tells
    // the user nothing they cannot already see, while the server's actual
    // explanation sits unread in the body.
    const parsed = parseSearchError({
      message: "Request failed with status code 502",
      response: {
        status: 502,
        data: "upstream connect error: connection timed out",
      },
    });

    expect(parsed.message).toBe("upstream connect error: connection timed out");
    expect(parsed.code).toBe(502);
  });

  it("still unwraps an ErrorCode envelope delivered as plain text", () => {
    const parsed = parseSearchError({
      message: "Request failed with status code 500",
      response: {
        status: 500,
        data: 'ErrorCode# {"code":20010,"message":"Search query timed out"}',
      },
    });

    expect(parsed.message).toBe("Search query timed out");
    expect(parsed.code).toBe(20010);
  });

  it("prefers the envelope's fields when the body is an object", () => {
    // The plain-text path must not outrank a structured body.
    const parsed = parseSearchError({
      message: "Request failed with status code 400",
      response: { status: 400, data: { error: "bad selector" } },
    });

    expect(parsed.message).toBe("bad selector");
  });

  it("reads an axios error body", () => {
    const parsed = parseSearchError({
      response: {
        status: 400,
        data: { message: "stream not found", trace_id: "abc" },
      },
    });
    expect(parsed).toEqual({
      message: "stream not found",
      code: 400,
      detail: undefined,
      traceId: "abc",
    });
  });

  it("reads a streaming error payload", () => {
    const parsed = parseSearchError({
      content: {
        message: "Search SQL execute error",
        code: 20009,
        trace_id: "xyz",
      },
    });
    expect(parsed.message).toBe("Search SQL execute error");
    expect(parsed.code).toBe(20009);
    expect(parsed.traceId).toBe("xyz");
  });

  it("prefers `error` over `message`, which is often just the HTTP wrapper", () => {
    const parsed = parseSearchError({
      response: {
        data: {
          error: "Search query timed out",
          message: "Request failed with status code 500",
        },
      },
    });
    expect(parsed.message).toBe("Search query timed out");
  });

  it("reads a thrown Error", () => {
    expect(parseSearchError(new Error("boom")).message).toBe("boom");
  });

  it("reads a bare string", () => {
    expect(parseSearchError("boom").message).toBe("boom");
  });

  it("passes an already-parsed error straight through", () => {
    // The streaming path parses at the point of failure, where the payload is
    // still intact. Re-deriving from the Error it rejects with would lose the
    // code and trace id.
    const original = toSearchErrorObject({
      message: "Search query timed out",
      code: 20010,
      traceId: "abc",
    });
    expect(parseSearchError(original)).toEqual({
      message: "Search query timed out",
      code: 20010,
      traceId: "abc",
    });
    expect(original.message).toBe("Search query timed out");
  });
});

describe("no call site is allowed to defeat the never-empty guarantee", () => {
  // The guarantee lives in the `fallback` parameter, so the ONLY way to break it
  // is at a call site: `parseSearchError(err, "")` hands back "" for any error
  // carrying no `error`, no `message` and no `error.message` — a bare network
  // failure, a 502 with an empty body — and the panel then renders a failure
  // state with nothing in it, which reads as a second bug on top of the first.
  // usePanelDataLoader did exactly this on the PromQL branch.
  //
  // Checked here rather than in each caller's spec because the rule is about
  // every caller, including the ones not written yet, and because most callers
  // reach this through paths their own specs cannot easily drive.
  const SOURCE_EXTENSIONS = [".ts", ".vue"];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(path));
      else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
        out.push(path);
    }
    return out;
  };

  it("nobody passes an empty fallback", () => {
    const EMPTY_FALLBACK = /parseSearchError\(\s*[^,()]+,\s*(""|''|``)\s*\)/;

    const offenders = walk("src")
      .filter((file) => !file.endsWith(".spec.ts"))
      .filter((file) => EMPTY_FALLBACK.test(readFileSync(file, "utf-8")));

    expect(offenders).toEqual([]);
  });
});

describe("never renders as a blank error", () => {
  it.each([undefined, null, {}, "", { response: {} }, new Error("")])(
    "falls back to a message for %o",
    (input) => {
      expect(parseSearchError(input).message).toBe("Query failed");
    },
  );

  it("takes a caller-supplied fallback", () => {
    expect(parseSearchError(null, "Preview failed").message).toBe(
      "Preview failed",
    );
  });

  it("truncates a message too long to display", () => {
    const parsed = parseSearchError("x".repeat(400));
    expect(parsed.message).toHaveLength(302);
    expect(parsed.message.endsWith(" …")).toBe(true);
  });
});

describe("the HTTP status is folded into code (which is why callers need no fallback)", () => {
  it("uses the HTTP status when the payload carries no code of its own", () => {
    // `usePanelDataLoader` used to write `parsed.code ?? error.response.status ??
    // error.status ?? ""`. Those fallbacks were unreachable — this is the behaviour
    // that made them so, and the test that keeps them unnecessary.
    const parsed = parseSearchError({
      response: { data: { message: "stream not found" }, status: 404 },
    });

    expect(parsed.message).toBe("stream not found");
    expect(parsed.code).toBe(404);
  });

  it("uses a bare error.status too", () => {
    const parsed = parseSearchError({ status: 503, message: "unavailable" });
    expect(parsed.code).toBe(503);
  });
});
