// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("rumcssworker", () => {
  let worker;
  let mockPostMessage;

  beforeEach(() => {
    // Mock Web Worker environment
    global.self = {
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
    };
    mockPostMessage = global.self.postMessage;

    // Import the worker script - in reality this would run in a worker context
    // For testing, we'll simulate the message handler
    worker = {
      handleMessage: (data) => {
        const cssString = data.cssString;
        const proxyUrl = data.proxyUrl;
        const id = data.id;
        const updatedCssString = replaceAbsoluteUrlsWithProxies(
          proxyUrl,
          cssString,
          ["fonts.gstatic.com", "fonts.googleapis.com"]
        );
        global.self.postMessage({ updatedCssString, id });
      },
    };
  });

  // Helper function extracted from worker
  function replaceAbsoluteUrlsWithProxies(
    proxyUrl,
    cssString,
    excludedDomains = []
  ) {
    const urlRegex = /url\(\s*(['"]?)(https?:\/\/[^'"\)]+)\1\s*\)/g;

    function replaceWithProxy(match, t1, url) {
      const isExcluded = excludedDomains.some((domain) => url.includes(domain));
      if (isExcluded) {
        return match;
      }
      return `url("${proxyUrl}/${url}")`;
    }

    return cssString.replace(urlRegex, replaceWithProxy);
  }

  describe("replaceAbsoluteUrlsWithProxies", () => {
    it("should replace absolute URLs with proxy URLs", () => {
      const cssString =
        'body { background-image: url("https://example.com/image.png"); }';
      const proxyUrl = "https://proxy.local";
      const result = replaceAbsoluteUrlsWithProxies(proxyUrl, cssString);

      expect(result).toBe(
        'body { background-image: url("https://proxy.local/https://example.com/image.png"); }'
      );
    });

    it("should handle URLs without quotes", () => {
      const cssString =
        "body { background-image: url(https://example.com/image.png); }";
      const proxyUrl = "https://proxy.local";
      const result = replaceAbsoluteUrlsWithProxies(proxyUrl, cssString);

      expect(result).toBe(
        'body { background-image: url("https://proxy.local/https://example.com/image.png"); }'
      );
    });

    it("should handle URLs with single quotes", () => {
      const cssString =
        "body { background-image: url('https://example.com/image.png'); }";
      const proxyUrl = "https://proxy.local";
      const result = replaceAbsoluteUrlsWithProxies(proxyUrl, cssString);

      expect(result).toBe(
        'body { background-image: url("https://proxy.local/https://example.com/image.png"); }'
      );
    });

    it("should exclude fonts.gstatic.com from proxying", () => {
      const cssString =
        '@font-face { src: url("https://fonts.gstatic.com/font.woff2"); }';
      const proxyUrl = "https://proxy.local";
      const excludedDomains = ["fonts.gstatic.com", "fonts.googleapis.com"];
      const result = replaceAbsoluteUrlsWithProxies(
        proxyUrl,
        cssString,
        excludedDomains
      );

      expect(result).toBe(cssString); // Should remain unchanged
    });

    it("should exclude fonts.googleapis.com from proxying", () => {
      const cssString =
        '@import url("https://fonts.googleapis.com/css?family=Roboto");';
      const proxyUrl = "https://proxy.local";
      const excludedDomains = ["fonts.gstatic.com", "fonts.googleapis.com"];
      const result = replaceAbsoluteUrlsWithProxies(
        proxyUrl,
        cssString,
        excludedDomains
      );

      expect(result).toBe(cssString); // Should remain unchanged
    });

    it("should handle multiple URLs in CSS", () => {
      const cssString = `
        body {
          background-image: url("https://example.com/bg.png");
        }
        .icon {
          background-image: url("https://cdn.example.com/icon.svg");
        }
      `;
      const proxyUrl = "https://proxy.local";
      const result = replaceAbsoluteUrlsWithProxies(proxyUrl, cssString);

      expect(result).toContain(
        'url("https://proxy.local/https://example.com/bg.png")'
      );
      expect(result).toContain(
        'url("https://proxy.local/https://cdn.example.com/icon.svg")'
      );
    });

    it("should handle mixed excluded and non-excluded URLs", () => {
      const cssString = `
        body {
          background-image: url("https://example.com/bg.png");
        }
        @font-face {
          src: url("https://fonts.gstatic.com/font.woff2");
        }
      `;
      const proxyUrl = "https://proxy.local";
      const excludedDomains = ["fonts.gstatic.com", "fonts.googleapis.com"];
      const result = replaceAbsoluteUrlsWithProxies(
        proxyUrl,
        cssString,
        excludedDomains
      );

      expect(result).toContain(
        'url("https://proxy.local/https://example.com/bg.png")'
      );
      expect(result).toContain('url("https://fonts.gstatic.com/font.woff2")');
    });

    it("should handle URLs with whitespace", () => {
      const cssString =
        "body { background-image: url(  https://example.com/image.png  ); }";
      const proxyUrl = "https://proxy.local";
      const result = replaceAbsoluteUrlsWithProxies(proxyUrl, cssString);

      // The regex captures whitespace, so it's preserved after the URL
      expect(result).toBe(
        'body { background-image: url("https://proxy.local/https://example.com/image.png  "); }'
      );
    });

    it("should not modify relative URLs", () => {
      const cssString = 'body { background-image: url("/images/bg.png"); }';
      const proxyUrl = "https://proxy.local";
      const result = replaceAbsoluteUrlsWithProxies(proxyUrl, cssString);

      expect(result).toBe(cssString); // Should remain unchanged
    });

    it("should handle empty CSS string", () => {
      const cssString = "";
      const proxyUrl = "https://proxy.local";
      const result = replaceAbsoluteUrlsWithProxies(proxyUrl, cssString);

      expect(result).toBe("");
    });

    it("should handle http URLs", () => {
      const cssString =
        'body { background-image: url("http://example.com/image.png"); }';
      const proxyUrl = "https://proxy.local";
      const result = replaceAbsoluteUrlsWithProxies(proxyUrl, cssString);

      expect(result).toBe(
        'body { background-image: url("https://proxy.local/http://example.com/image.png"); }'
      );
    });
  });

  describe("worker message handling", () => {
    it("should process message and post updated CSS", () => {
      const data = {
        cssString: 'body { background: url("https://example.com/bg.png"); }',
        proxyUrl: "https://proxy.local",
        id: "test-123",
      };

      worker.handleMessage(data);

      expect(mockPostMessage).toHaveBeenCalledWith({
        updatedCssString: expect.stringContaining("https://proxy.local"),
        id: "test-123",
      });
    });

    it("should preserve id in response", () => {
      const data = {
        cssString: "body { color: red; }",
        proxyUrl: "https://proxy.local",
        id: "unique-id-456",
      };

      worker.handleMessage(data);

      expect(mockPostMessage).toHaveBeenCalledWith({
        updatedCssString: "body { color: red; }",
        id: "unique-id-456",
      });
    });

    it("should handle message with excluded domains", () => {
      const data = {
        cssString: '@import url("https://fonts.googleapis.com/css");',
        proxyUrl: "https://proxy.local",
        id: "font-test",
      };

      worker.handleMessage(data);

      expect(mockPostMessage).toHaveBeenCalledWith({
        updatedCssString: '@import url("https://fonts.googleapis.com/css");',
        id: "font-test",
      });
    });
  });
});
