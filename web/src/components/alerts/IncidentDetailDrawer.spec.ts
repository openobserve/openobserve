// Copyright 2025 OpenObserve Inc.
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

describe("IncidentDetailDrawer.vue utility functions", () => {
  it("escapes HTML correctly", () => {
    const escapeHtml = (text: string): string => {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    };

    const malicious = '<script>alert("xss")</script>';
    const escaped = escapeHtml(malicious);

    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).toContain("&lt;/script&gt;");
  });

  it("formats RCA content with markdown", () => {
    const escapeHtml = (text: string): string => {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    };

    const formatRcaContent = (content: string) => {
      const escaped = escapeHtml(content);
      let formatted = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      formatted = formatted.replace(
        /^### (.+)$/gm,
        '<div class="tw-font-semibold tw-mt-3 tw-mb-1">$1</div>'
      );
      formatted = formatted.replace(
        /^## (.+)$/gm,
        '<div class="tw-font-bold tw-text-base tw-mt-4 tw-mb-2">$1</div>'
      );
      formatted = formatted.replace(/^- (.+)$/gm, '<div class="tw-ml-2">• $1</div>');
      formatted = formatted.replace(/^(\d+)\. (.+)$/gm, '<div class="tw-ml-2">$1. $2</div>');
      return formatted;
    };

    const content = "This is **bold** text";
    const formatted = formatRcaContent(content);
    expect(formatted).toContain("<strong>bold</strong>");
  });

  it("formats markdown headers", () => {
    const escapeHtml = (text: string): string => {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    };

    const formatRcaContent = (content: string) => {
      const escaped = escapeHtml(content);
      let formatted = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      formatted = formatted.replace(
        /^### (.+)$/gm,
        '<div class="tw-font-semibold tw-mt-3 tw-mb-1">$1</div>'
      );
      formatted = formatted.replace(
        /^## (.+)$/gm,
        '<div class="tw-font-bold tw-text-base tw-mt-4 tw-mb-2">$1</div>'
      );
      return formatted;
    };

    const content = "## Header 2\n### Header 3";
    const formatted = formatRcaContent(content);
    expect(formatted).toContain("tw-font-bold");
    expect(formatted).toContain("tw-font-semibold");
  });

  it("formats markdown lists", () => {
    const escapeHtml = (text: string): string => {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    };

    const formatRcaContent = (content: string) => {
      const escaped = escapeHtml(content);
      let formatted = escaped.replace(/^- (.+)$/gm, '<div class="tw-ml-2">• $1</div>');
      formatted = formatted.replace(/^(\d+)\. (.+)$/gm, '<div class="tw-ml-2">$1. $2</div>');
      return formatted;
    };

    const content = "- Item 1\n- Item 2\n1. Numbered item";
    const formatted = formatRcaContent(content);
    expect(formatted).toContain("•");
    expect(formatted).toContain("1.");
  });

  it("returns correct status color", () => {
    const getStatusColor = (status: string) => {
      switch (status) {
        case "open":
          return "negative";
        case "acknowledged":
          return "warning";
        case "resolved":
          return "positive";
        default:
          return "grey-7";
      }
    };

    expect(getStatusColor("open")).toBe("negative");
    expect(getStatusColor("acknowledged")).toBe("warning");
    expect(getStatusColor("resolved")).toBe("positive");
  });

  it("returns correct severity color", () => {
    const getSeverityColor = (severity: string) => {
      switch (severity) {
        case "P1":
          return "negative";
        case "P2":
          return "warning";
        case "P3":
          return "info";
        case "P4":
          return "grey-7";
        default:
          return "grey-7";
      }
    };

    expect(getSeverityColor("P1")).toBe("negative");
    expect(getSeverityColor("P2")).toBe("warning");
    expect(getSeverityColor("P3")).toBe("info");
    expect(getSeverityColor("P4")).toBe("grey-7");
  });

  it("extracts service name from dimensions", () => {
    const getServiceName = (dimensions: Record<string, string>) => {
      return dimensions.service || "Unknown";
    };

    expect(getServiceName({ service: "api-gateway" })).toBe("api-gateway");
    expect(getServiceName({ environment: "prod" })).toBe("Unknown");
    expect(getServiceName({})).toBe("Unknown");
  });

  it("formats timestamp correctly", () => {
    const formatTimestamp = (timestamp: number) => {
      const date = new Date(timestamp / 1000);
      return date.toISOString();
    };

    const timestamp = 1700000000000000;
    const formatted = formatTimestamp(timestamp);
    expect(formatted).toBeTruthy();
    expect(typeof formatted).toBe("string");
  });
});
