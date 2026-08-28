// Runs @openobserve/node-sql-parser's astify() off the main thread — it's a PEG
// parser whose runtime grows exponentially with WHERE-clause parenthesis nesting
// depth, so a pathologically nested query can take 10+ seconds. Off the main
// thread, that time no longer freezes the tab.
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";

const parser = new Parser();

self.onmessage = (event) => {
  const { id, sql } = event.data;
  try {
    const ast = parser.astify(sql);
    postMessage({ id, ok: true, ast });
  } catch (err) {
    postMessage({
      id,
      ok: false,
      error: {
        message: err?.message,
        location: err?.location,
        expected: err?.expected,
        found: err?.found,
        name: err?.name,
      },
    });
  }
};
