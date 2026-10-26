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

import { describe, expect, it, vi } from "vitest";
import DOMPurify from "dompurify";
import {
  escapeStyleText,
  htmlPanelPurifier,
  isAllowedIframeSrc,
  sanitizeHtmlPanel,
} from "@/utils/dashboard/htmlPanelSanitizer";

const ORIGIN = "https://o2.example.com";

const render = (html: string, prefix = "#o2-html-panel-p1") => {
  const container = document.createElement("div");
  container.appendChild(sanitizeHtmlPanel(html, prefix));
  return container;
};

describe("htmlPanelSanitizer", () => {
  describe("escapeStyleText", () => {
    it("escapes every </ so serialized CSS cannot end its style element", () => {
      const out = escapeStyleText('a { content: "</style><img src=x onerror=alert(1)></STYLE>"; }');

      expect(out).not.toContain("</");
      expect(out).toBe('a { content: "\\3c /style><img src=x onerror=alert(1)>\\3c /STYLE>"; }');
    });

    it("keeps < in CSS range media and container queries", () => {
      const css =
        "@media (width < 37.5rem) { #p .a { color: red; } }\n" +
        "@container (25rem <= width) { #p .b { color: blue; } }";

      expect(escapeStyleText(css)).toBe(css);
    });
  });

  describe("isAllowedIframeSrc", () => {
    it("accepts a cross-origin https embed", () => {
      expect(isAllowedIframeSrc("https://www.youtube.com/embed/abc", ORIGIN)).toBe(true);
    });

    it("rejects a same-origin src", () => {
      expect(isAllowedIframeSrc(`${ORIGIN}/web/logs?org_identifier=default`, ORIGIN)).toBe(false);
      expect(isAllowedIframeSrc("https://O2.EXAMPLE.COM:443/api", ORIGIN)).toBe(false);
    });

    it("rejects non-https, relative and unparsable sources", () => {
      for (const src of [
        "http://example.com",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "/web/logs",
        "//o2.example.com/web",
        "https://",
      ]) {
        expect(isAllowedIframeSrc(src, ORIGIN)).toBe(false);
      }
    });
  });

  describe("sanitizeHtmlPanel", () => {
    it("scopes author CSS and strips scripts", () => {
      const out = render("<style>.big { color: red; }</style><script>alert(1)</script><p>ok</p>");

      expect(out.querySelector("script")).toBeNull();
      expect(out.querySelector("style")?.textContent).toContain("#o2-html-panel-p1 .big");
      expect(out.querySelector("p")?.textContent).toBe("ok");
    });

    it("escapes a decoded </ in a rewritten attribute selector", () => {
      const out = render(
        '<style>a[title="\\3c/style\\3e\\3cimg src=x onerror=alert(1)\\3e"]{color:red}</style>',
      );

      expect(out.querySelector("style")?.textContent).not.toContain("</");
      expect(out.innerHTML).not.toMatch(/<\/style>[\s\S]*<img/i);
      const reparsed = document.createElement("div");
      reparsed.innerHTML = out.innerHTML;
      expect(reparsed.querySelector("img")).toBeNull();
    });

    it("never lets a decoded CSS content string close the style element", () => {
      const out = render(
        '<style>a{content:"\\3c/style\\3e\\3cimg src=x onerror=alert(1)\\3e"}</style><p>hi</p>',
      );
      const reparsed = document.createElement("div");
      reparsed.innerHTML = out.innerHTML;

      expect(out.querySelector("style")?.textContent).not.toContain("</");
      expect(reparsed.querySelector("img")).toBeNull();
      expect(reparsed.querySelector("p")?.textContent).toBe("hi");
    });

    it("keeps a range media query in panel CSS", () => {
      const out = render(
        "<style>@media (width < 37.5rem) { .r { color: red; } }</style><p class='r'>r</p>",
      );

      expect(out.querySelector("style")?.textContent).toContain("(width < 37.5rem)");
    });

    it("keeps target=_blank on links and forms and forces rel=noopener noreferrer", () => {
      const out = render(
        '<a href="https://example.com/a" target="_blank" rel="opener">a</a>' +
          '<a href="https://example.com/b" target=" _BLANK ">b</a>' +
          '<form action="https://example.com/f" target="_blank"></form>',
      );
      const [a, b] = Array.from(out.querySelectorAll("a"));
      const form = out.querySelector("form");

      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(b.getAttribute("target")).toBe("_blank");
      expect(b.getAttribute("rel")).toBe("noopener noreferrer");
      expect(form?.getAttribute("target")).toBe("_blank");
      expect(form?.getAttribute("rel")).toBe("noopener noreferrer");
    });

    it("applies the same target rule to area and SVG links", () => {
      const out = render(
        '<map name="m"><area href="https://example.com/a" target="_blank"><area href="/x" target="f1"></map>' +
          '<svg><a href="https://example.com/s" target="_blank"><text>s</text></a><a href="/y" target="f1"><text>t</text></a></svg>',
      );
      const [area, namedArea] = Array.from(out.querySelectorAll("area"));
      const [svgLink, namedSvgLink] = Array.from(out.querySelectorAll("svg a"));

      expect(area.getAttribute("target")).toBe("_blank");
      expect(area.getAttribute("rel")).toBe("noopener noreferrer");
      expect(namedArea.hasAttribute("target")).toBe(false);
      expect(svgLink.getAttribute("target")).toBe("_blank");
      expect(svgLink.getAttribute("rel")).toBe("noopener noreferrer");
      expect(namedSvgLink.hasAttribute("target")).toBe(false);
    });

    it("drops any target other than _blank and leaves untargeted links alone", () => {
      const out = render(
        '<iframe name="f1" src="https://example.com"></iframe>' +
          '<a href="/web/x" target="f1">named</a>' +
          '<a href="https://example.com" target="_top">top</a>' +
          '<form action="/web/x" target="f1"></form>' +
          '<a href="https://example.com" rel="nofollow">plain</a>',
      );
      const [named, top, plain] = Array.from(out.querySelectorAll("a"));

      expect(named.hasAttribute("target")).toBe(false);
      expect(top.hasAttribute("target")).toBe(false);
      expect(out.querySelector("form")?.hasAttribute("target")).toBe(false);
      expect(plain.hasAttribute("target")).toBe(false);
      expect(plain.getAttribute("rel")).toBe("nofollow");
    });

    it("handles a form whose own attribute methods are shadowed by named controls", () => {
      const proto = HTMLFormElement.prototype as any;
      const shadow = () => {
        throw new Error("shadowed");
      };
      // jsdom has no form named-property getters, so shadow the prototype instead
      Object.defineProperty(proto, "getAttribute", { value: shadow, configurable: true });
      try {
        const form = render('<form action="https://example.com/f" target="_blank"></form>')
          .firstElementChild as Element;
        expect(Element.prototype.getAttribute.call(form, "rel")).toBe("noopener noreferrer");
      } finally {
        delete proto.getAttribute;
      }
    });

    it("registers its iframe hook once, on a private DOMPurify instance", () => {
      const addHookSpy = vi.spyOn(htmlPanelPurifier, "addHook");

      render('<iframe src="https://example.com"></iframe>');
      render('<iframe src="https://example.com"></iframe>');

      expect(addHookSpy).not.toHaveBeenCalled();
      expect(htmlPanelPurifier).not.toBe(DOMPurify);
      expect(render('<iframe src="https://example.com"></iframe>').innerHTML).toContain(
        'sandbox="allow-scripts allow-same-origin"',
      );
      addHookSpy.mockRestore();
    });

    it("drops the allow attribute and hands each refused embed to the caller as a slot", () => {
      const slots: HTMLElement[] = [];
      const container = document.createElement("div");
      container.appendChild(
        sanitizeHtmlPanel(
          `<p>a</p><iframe src="${window.location.origin}/web" allow="camera"></iframe><p>b</p>` +
            '<iframe src="https://example.com" allow="geolocation"></iframe>' +
            '<iframe srcdoc="<p>X</p>"></iframe>',
          "#o2-html-panel-p1",
          (slot) => slots.push(slot),
        ),
      );
      const iframes = Array.from(container.querySelectorAll("iframe"));

      expect(slots).toHaveLength(1);
      expect(slots[0].previousElementSibling?.textContent).toBe("a");
      expect(slots[0].nextElementSibling?.textContent).toBe("b");
      expect(iframes).toHaveLength(2);
      expect(iframes[0].getAttribute("src")).toBe("https://example.com");
      expect(iframes[0].hasAttribute("allow")).toBe(false);
      expect(iframes[1].hasAttribute("srcdoc")).toBe(false);
    });
  });
});
