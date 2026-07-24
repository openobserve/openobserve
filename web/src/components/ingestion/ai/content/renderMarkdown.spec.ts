// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { renderCardSegments, safeHttpUrl } from "./renderMarkdown";

const SUBS = {
  url: "https://api.example.com",
  org: "myorg",
  token: "dG9rZW4=",
};

describe("renderCardSegments", () => {
  it("substitutes {url}/{org}/{token} into code segments (raw, for copy)", () => {
    const segs = renderCardSegments(
      '```bash\ncurl --url={url} --org={org} --token="Basic {token}"\n```',
      SUBS,
    );
    const code = segs.find((s) => s.type === "code");
    expect(code).toBeDefined();
    expect(code?.type === "code" && code.code).toContain("--url=https://api.example.com");
    expect(code?.type === "code" && code.code).toContain("--org=myorg");
    expect(code?.type === "code" && code.code).toContain("Basic dG9rZW4=");
    expect(code?.type === "code" && code.lang).toBe("bash");
  });

  it("does NOT substitute placeholders in prose (only in code)", () => {
    const segs = renderCardSegments(
      "Use `{url}` and `{token}` here.\n\n```bash\necho {url}\n```",
      SUBS,
    );
    const prose = segs.find((s) => s.type === "html");
    expect(prose?.type === "html" && prose.html).toContain("{url}");
    expect(prose?.type === "html" && prose.html).not.toContain("https://api.example.com");
    const code = segs.find((s) => s.type === "code");
    expect(code?.type === "code" && code.code).toContain("echo https://api.example.com");
  });

  it("splits prose and code into ordered segments", () => {
    const segs = renderCardSegments("text before\n\n```bash\necho hi\n```\n\ntext after", SUBS);
    expect(segs.map((s) => s.type)).toEqual(["html", "code", "html"]);
    expect(segs[0].type === "html" && segs[0].html).toContain("text before");
    expect(segs[2].type === "html" && segs[2].html).toContain("text after");
  });

  it("sanitizes prose HTML (strips script tags)", () => {
    const segs = renderCardSegments("<script>alert(1)</script>\n\nhello", SUBS);
    const html = segs
      .filter((s) => s.type === "html")
      .map((s) => (s.type === "html" ? s.html : ""))
      .join("");
    expect(html).not.toContain("<script");
  });

  it("renders gfm tables inside prose segments", () => {
    const segs = renderCardSegments("| A | B |\n|---|---|\n| 1 | 2 |", SUBS);
    const html = segs
      .filter((s) => s.type === "html")
      .map((s) => (s.type === "html" ? s.html : ""))
      .join("");
    expect(html).toContain("<table");
  });
});

describe("safeHttpUrl", () => {
  it("allows http(s) and mailto URLs", () => {
    expect(safeHttpUrl("https://openobserve.ai/docs")).toBe("https://openobserve.ai/docs");
    expect(safeHttpUrl("http://x.test")).toBe("http://x.test");
    expect(safeHttpUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
  });

  it("blocks javascript: / data: and other schemes (returns '#')", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBe("#");
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBe("#");
  });

  it("returns '#' for empty / invalid input", () => {
    expect(safeHttpUrl(undefined)).toBe("#");
    expect(safeHttpUrl("")).toBe("#");
  });
});
