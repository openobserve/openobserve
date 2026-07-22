<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="scroll w-full h-full overflow-auto" data-test="html-renderer-scroll-container">
    <div
      class="min-h-full shrink-0"
      :id="scopeId"
      :class="['prose prose-sm max-w-none px-2 py-1', isDark && 'prose-invert']"
      v-html="sanitizedContent"
      data-test="html-renderer"
    ></div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useTheme } from "@/composables/useTheme";
import { processVariableContent } from "@/utils/dashboard/variables/variablesUtils";
import DOMPurify from "dompurify";

// fallback scope suffix for panels rendered without a panelId
let htmlPanelSeq = 0;

// Selectors that target the whole document are remapped to the panel
// container itself so full-page HTML snippets render as intended
const DOCUMENT_SELECTOR = /^(html|body|:root)(?![\w-])/i;

const prefixSelectors = (rules: CSSRuleList, prefix: string): void => {
  for (const rule of Array.from(rules ?? []) as any[]) {
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
    } else if (rule?.type === CSSRule.MEDIA_RULE || rule?.type === CSSRule.SUPPORTS_RULE) {
      prefixSelectors(rule?.cssRules, prefix);
    }
    // @keyframes and @font-face have no element selectors — leave as-is
  }
};

// Scope author CSS to the panel by prefixing every selector with the
// panel's container id, using the browser's own CSS parser
const scopeCss = (cssText: string, prefix: string): string => {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    prefixSelectors(sheet.cssRules, prefix);
    return Array.from(sheet.cssRules ?? [])
      .map((rule) => rule?.cssText ?? "")
      .join("\n");
  } catch {
    // constructable stylesheets unavailable — fall back to @scope so the
    // rules still stay inside the panel on browsers that support it
    return `@scope {\n${cssText}\n}`;
  }
};

export default defineComponent({
  name: "HTMLRenderer",
  props: {
    htmlContent: {
      type: String,
      default: "",
    },
    variablesData: {
      type: Object,
      default: () => ({}),
    },
    tabId: {
      type: String,
      default: undefined,
    },
    panelId: {
      type: String,
      default: undefined,
    },
  },
  setup(props): any {
    const { isDark } = useTheme();

    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.nodeName === "IFRAME") {
        // Remove srcdoc to prevent inline HTML/script injection
        node.removeAttribute("srcdoc");

        // Only allow https:// sources to block javascript: and data: URIs
        const src = node.getAttribute("src") || "";
        if (src && !src.startsWith("https://")) {
          node.removeAttribute("src");
        }

        // Sandbox restricts iframe capabilities. Key blocked capability:
        // - top-navigation: prevents iframe from redirecting the parent page
        node.setAttribute("sandbox", "allow-scripts allow-same-origin");
      }
    });

    const instanceSeq = ++htmlPanelSeq;
    const scopeId = computed(() => {
      const raw = props.panelId ? String(props.panelId) : `i${instanceSeq}`;
      return `o2-html-panel-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    });

    const processedContent = computed(() => {
      const context = {
        tabId: props.tabId,
        panelId: props.panelId,
      };
      return processVariableContent(props.htmlContent, props.variablesData, context);
    });

    const sanitizedContent = computed(() => {
      const fragment = DOMPurify.sanitize(processedContent.value, {
        ADD_TAGS: ["iframe", "style"],
        ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "loading", "csp"],
        // without this the parser hoists top-level <style> into <head>,
        // which DOMPurify discards when returning body content
        FORCE_BODY: true,
        // work on the sanitized DOM directly so style rewriting doesn't
        // need a second parse (which would re-hoist top-level <style>)
        RETURN_DOM_FRAGMENT: true,
      });

      fragment.querySelectorAll("style").forEach((styleEl) => {
        styleEl.textContent = scopeCss(styleEl.textContent || "", `#${scopeId.value}`);
      });

      const container = document.createElement("div");
      container.appendChild(fragment);
      return container.innerHTML;
    });

    return {
      DOMPurify,
      isDark,
      scopeId,
      processedContent,
      sanitizedContent,
    };
  },
});
</script>
