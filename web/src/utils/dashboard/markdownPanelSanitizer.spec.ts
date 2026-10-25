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

import { describe, expect, it } from "vitest";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  isCrossOriginLink,
  markdownPanelPurifier,
  sanitizeMarkdownPanel,
} from "@/utils/dashboard/markdownPanelSanitizer";

const PAGE = "https://o2.example.com/web/dashboards/view?org_identifier=default";

const render = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = sanitizeMarkdownPanel(html);
  return container;
};

describe("markdownPanelSanitizer", () => {
  describe("isCrossOriginLink", () => {
    it("accepts http and https links on another origin", () => {
      expect(isCrossOriginLink("https://docs.example.org/runbook", PAGE)).toBe(true);
      expect(isCrossOriginLink("http://o2.example.com/web", PAGE)).toBe(true);
      expect(isCrossOriginLink("https://o2.example.com:8443/web", PAGE)).toBe(true);
      expect(isCrossOriginLink("//evil.example.net/x", PAGE)).toBe(true);
    });

    it("rejects same-origin, relative and fragment links", () => {
      expect(isCrossOriginLink("https://O2.EXAMPLE.COM:443/web/logs", PAGE)).toBe(false);
      expect(isCrossOriginLink("/web/dashboards/view?dashboard=1", PAGE)).toBe(false);
      expect(isCrossOriginLink("view?dashboard=2", PAGE)).toBe(false);
      expect(isCrossOriginLink("#section", PAGE)).toBe(false);
    });

    it("rejects non-web schemes and unparseable hrefs", () => {
      expect(isCrossOriginLink("mailto:oncall@example.org", PAGE)).toBe(false);
      expect(isCrossOriginLink("tel:+15551234", PAGE)).toBe(false);
      expect(isCrossOriginLink("http://[bad", PAGE)).toBe(false);
    });
  });

  describe("sanitizeMarkdownPanel", () => {
    it("opens a cross-origin Markdown link in a new tab with noopener", () => {
      const link = render(
        marked("[Runbook](https://docs.example.org/runbook)") as string,
      ).querySelector("a");

      expect(link?.getAttribute("href")).toBe("https://docs.example.org/runbook");
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("opens a cross-origin SVG anchor in a new tab", () => {
      const out = render(
        '<svg><a href="https://docs.example.org/a"><text>a</text></a>' +
          '<a xlink:href="https://docs.example.org/b"><text>b</text></a></svg>',
      );
      const anchors = Array.from(out.querySelectorAll("a"));

      expect(anchors).toHaveLength(2);
      anchors.forEach((a) => {
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      });
    });

    it("keeps same-origin and relative links in the tab", () => {
      const out = render(
        `<a href="${window.location.origin}/web/logs">a</a><a href="/web/dashboards">b</a><a href="#top">c</a>`,
      );

      out.querySelectorAll("a").forEach((a) => {
        expect(a.hasAttribute("target")).toBe(false);
      });
    });

    it("strips an authored target so the rule stays uniform", () => {
      const out = render(
        `<a href="/web/logs" target="_blank">same</a><a href="https://example.org" target="_self">x</a>`,
      );
      const [same, cross] = Array.from(out.querySelectorAll("a"));

      expect(same.hasAttribute("target")).toBe(false);
      expect(cross.getAttribute("target")).toBe("_blank");
    });

    it("leaves non-web links and dropped javascript hrefs without a target", () => {
      const out = render(
        `<a href="mailto:oncall@example.org">m</a><a href="javascript:alert(1)">j</a>`,
      );
      const [mail, js] = Array.from(out.querySelectorAll("a"));

      expect(mail.hasAttribute("target")).toBe(false);
      expect(js.hasAttribute("href")).toBe(false);
      expect(js.hasAttribute("target")).toBe(false);
    });

    it("uses a private DOMPurify instance, so the shared one keeps no link hook", () => {
      expect(markdownPanelPurifier).not.toBe(DOMPurify);
      expect(DOMPurify.sanitize('<a href="https://example.org">x</a>')).not.toContain("target");
    });
  });
});
