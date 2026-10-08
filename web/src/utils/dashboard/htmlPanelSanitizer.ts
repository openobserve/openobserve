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

import DOMPurify from "dompurify";

// Whole-document selectors map onto the panel container so full-page snippets still render.
const DOCUMENT_SELECTOR = /^(html|body|:root)(?![\w-])/i;

const IFRAME_SANDBOX = "allow-scripts allow-same-origin";

const refusedIframes = new WeakSet<Element>();

type ScopableRule = CSSRule & { selectorText?: string; cssRules?: CSSRuleList };

// A private instance keeps the iframe hook out of every other sanitize call in the app.
export const htmlPanelPurifier = DOMPurify(window);

/** True only for an absolute https src on another origin, since allow-same-origin would hand a same-origin frame the parent. */
export const isAllowedIframeSrc = (src: string, pageOrigin: string): boolean => {
  if (!src.startsWith("https://")) return false;
  try {
    return new URL(src).origin !== pageOrigin;
  } catch {
    return false;
  }
};

/** Escape `</`, the only sequence that can end a `<style>` element, so a bare `<` in range media queries keeps working. */
export const escapeStyleText = (cssText: string): string => cssText.replace(/<\//g, "\\3c /");

/** Sanitize panel HTML and scope its CSS under `prefix`, turning each iframe whose src is refused into an empty slot for `onRefusedEmbed`; mount the fragment directly, never through innerHTML. */
export const sanitizeHtmlPanel = (
  html: string,
  prefix: string,
  onRefusedEmbed?: (slot: HTMLElement) => void,
): DocumentFragment => {
  const fragment = htmlPanelPurifier.sanitize(html, {
    ADD_TAGS: ["iframe", "style"],
    ADD_ATTR: ["allowfullscreen", "frameborder", "loading", "csp"],
    // without it the parser hoists a top-level style into <head>, which DOMPurify drops
    FORCE_BODY: true,
    RETURN_DOM_FRAGMENT: true,
  });

  fragment.querySelectorAll("style").forEach((styleEl) => {
    styleEl.textContent = escapeStyleText(scopeCss(styleEl.textContent || "", prefix));
  });

  fragment.querySelectorAll("iframe").forEach((frame) => {
    if (!refusedIframes.has(frame)) return;
    const slot = frame.ownerDocument.createElement("div");
    frame.replaceWith(slot);
    onRefusedEmbed?.(slot);
  });

  return fragment;
};

const prefixSelectors = (rules: CSSRuleList, prefix: string): void => {
  for (const rule of Array.from(rules ?? []) as ScopableRule[]) {
    if (rule?.type === CSSRule.STYLE_RULE && rule?.selectorText) {
      rule.selectorText = rule.selectorText
        .split(",")
        .map((sel: string) => {
          const trimmed = sel?.trim() ?? "";
          return DOCUMENT_SELECTOR.test(trimmed)
            ? trimmed.replace(DOCUMENT_SELECTOR, prefix)
            : `${prefix} ${trimmed}`;
        })
        .join(", ");
    } else if (
      (rule?.type === CSSRule.MEDIA_RULE || rule?.type === CSSRule.SUPPORTS_RULE) &&
      rule.cssRules
    ) {
      prefixSelectors(rule.cssRules, prefix);
    }
  }
};

const scopeCss = (cssText: string, prefix: string): string => {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    prefixSelectors(sheet.cssRules, prefix);
    return Array.from(sheet.cssRules ?? [])
      .map((rule) => rule?.cssText ?? "")
      .join("\n");
  } catch {
    // no constructable stylesheets: @scope still keeps the rules inside the panel
    return `@scope {\n${cssText}\n}`;
  }
};

htmlPanelPurifier.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName !== "IFRAME") return;
  node.removeAttribute("srcdoc");
  const src = node.getAttribute("src") || "";
  if (src && !isAllowedIframeSrc(src, window.location.origin)) {
    node.removeAttribute("src");
    refusedIframes.add(node);
  }
  node.setAttribute("sandbox", IFRAME_SANDBOX);
});
