// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runJavaScriptCode, panelIdToBeRefreshed } from "./convertCustomChartData";

// Mock router
vi.mock("src/router", () => ({
  default: {}
}));

// Mock acorn modules
vi.mock("acorn", () => ({
  parse: vi.fn()
}));

vi.mock("acorn-walk", () => ({
  simple: vi.fn()
}));

describe("convertCustomChartData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    panelIdToBeRefreshed.value = null;
    
    // Mock DOM methods
    Object.defineProperty(document, 'createElement', {
      value: vi.fn(() => ({
        style: {},
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: '',
        contentWindow: {
          postMessage: vi.fn()
        }
      })),
      writable: true
    });
    
    Object.defineProperty(document.body, 'appendChild', {
      value: vi.fn(),
      writable: true
    });
    
    Object.defineProperty(document.body, 'removeChild', {
      value: vi.fn(),
      writable: true
    });
    
    Object.defineProperty(window, 'addEventListener', {
      value: vi.fn(),
      writable: true
    });
    
    Object.defineProperty(window, 'removeEventListener', {
      value: vi.fn(),
      writable: true
    });
    
    // Mock location.pathname
    delete window.location;
    window.location = { pathname: '/test' } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic functionality", () => {
    it("should skip execution when panel is not the one to be refreshed", () => {
      panelIdToBeRefreshed.value = "panel1";
      
      const panelSchema = {
        id: "panel2",
        customChartContent: "var option = {};"
      };
      const searchQueryData = [];

      const promise = runJavaScriptCode(panelSchema, searchQueryData);
      
      // Should return a promise that never resolves/rejects (hanging promise)
      expect(promise).toBeInstanceOf(Promise);
      
      // Since the function returns without resolving, we can't await it
      // This covers the early return path in the code
    });

    it("should reject with validation error for unsafe code", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      // Mock acorn to parse the code successfully
      vi.mocked(acorn.parse).mockReturnValue({
        type: "Program",
        body: []
      } as any);
      
      // Mock walk to detect forbidden function
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        // Simulate finding a forbidden function call
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: {
              type: "Identifier",
              name: "eval"
            },
            arguments: []
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "eval('malicious code');"
      };
      const searchQueryData = [];

      await expect(runJavaScriptCode(panelSchema, searchQueryData)).rejects.toThrow(
        "Unsafe code detected: Use of 'eval()' is not allowed."
      );
    });
  });

  describe("Successful execution flow", () => {
    it("should create iframe and execute valid code successfully", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      // Mock acorn to parse valid code
      vi.mocked(acorn.parse).mockReturnValue({
        type: "Program",
        body: []
      } as any);
      
      // Mock walk to not find any violations
      vi.mocked(walk.simple).mockImplementation(() => {
        // No violations found
      });

      const mockIframe = {
        style: { display: '' },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: '',
        contentWindow: {
          postMessage: vi.fn()
        }
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);
      
      const panelSchema = {
        id: "panel1",
        customChartContent: "var option = { title: { text: 'Test' } };"
      };
      const searchQueryData = [{ field: "value" }];

      const promise = runJavaScriptCode(panelSchema, searchQueryData);
      
      // Verify iframe creation and setup
      expect(document.createElement).toHaveBeenCalledWith("iframe");
      expect(mockIframe.style.display).toBe("none");
      expect(mockIframe.setAttribute).toHaveBeenCalledWith("sandbox", "allow-scripts");
      expect(document.body.appendChild).toHaveBeenCalledWith(mockIframe);
      
      // Verify script content is set
      expect(mockIframe.srcdoc).toContain('<meta http-equiv="Content-Security-Policy"');
      expect(mockIframe.srcdoc).toContain('script-src \'self\' \'nonce-');
      expect(mockIframe.srcdoc).toContain('/src/assets/dashboard/echarts.min.js');
      expect(mockIframe.srcdoc).toContain('/src/assets/dashboard/purify.min.js');
      
      // Simulate iframe onload and message handling
      expect(mockIframe.onload).toBeDefined();
      
      // Trigger onload
      if (mockIframe.onload) {
        mockIframe.onload();
      }
      
      // Verify postMessage was called
      expect(mockIframe.contentWindow?.postMessage).toHaveBeenCalledWith({
        type: "execute",
        code: panelSchema.customChartContent,
        data: JSON.stringify(searchQueryData)
      }, "*");

      // Simulate successful response
      const mockEvent = {
        source: mockIframe.contentWindow,
        data: {
          type: "success",
          result: JSON.stringify({ title: { text: "Test" } })
        }
      };

      // Get the message handler
      const addEventListenerCalls = vi.mocked(window.addEventListener).mock.calls;
      const messageHandler = addEventListenerCalls.find(call => call[0] === "message")?.[1];
      
      if (messageHandler && typeof messageHandler === 'function') {
        messageHandler(mockEvent as any);
      }

      const result = await promise;
      expect(result).toEqual({ title: { text: "Test" } });
    });

    it("should use /web/ prefix for assets when pathname contains 'web'", async () => {
      // Set pathname to contain 'web'
      window.location.pathname = '/web/dashboard';
      
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation(() => {});

      const mockIframe = {
        style: { display: '' },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: '',
        contentWindow: { postMessage: vi.fn() }
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);
      
      const panelSchema = {
        id: "panel1",
        customChartContent: "var option = {};"
      };

      runJavaScriptCode(panelSchema, []);
      
      // Verify the script uses /web/ prefix for assets
      expect(mockIframe.srcdoc).toContain('/web/src/assets/dashboard/echarts.min.js');
      expect(mockIframe.srcdoc).toContain('/web/src/assets/dashboard/purify.min.js');
    });

    it("should handle execution errors from iframe", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation(() => {});

      const mockIframe = {
        style: { display: '' },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: '',
        contentWindow: { postMessage: vi.fn() }
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);
      
      const panelSchema = {
        id: "panel1",
        customChartContent: "throw new Error('test error');"
      };

      const promise = runJavaScriptCode(panelSchema, []);
      
      // Trigger onload
      if (mockIframe.onload) {
        mockIframe.onload();
      }

      // Simulate error response
      const mockEvent = {
        source: mockIframe.contentWindow,
        data: {
          type: "error",
          message: "Execution Error: test error"
        }
      };

      // Get and trigger message handler
      const addEventListenerCalls = vi.mocked(window.addEventListener).mock.calls;
      const messageHandler = addEventListenerCalls.find(call => call[0] === "message")?.[1];
      
      if (messageHandler && typeof messageHandler === 'function') {
        messageHandler(mockEvent as any);
      }

      await expect(promise).rejects.toThrow("Execution Error: test error");
    });

    it("should ignore messages from different sources", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation(() => {});

      const mockIframe = {
        style: { display: '' },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: '',
        contentWindow: { postMessage: vi.fn() }
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);
      
      const panelSchema = {
        id: "panel1",
        customChartContent: "var option = {};"
      };

      const promise = runJavaScriptCode(panelSchema, []);
      
      // Simulate message from different source
      const mockEvent = {
        source: { postMessage: vi.fn() }, // Different source
        data: {
          type: "success",
          result: JSON.stringify({ fake: "data" })
        }
      };

      // Get and trigger message handler
      const addEventListenerCalls = vi.mocked(window.addEventListener).mock.calls;
      const messageHandler = addEventListenerCalls.find(call => call[0] === "message")?.[1];
      
      if (messageHandler && typeof messageHandler === 'function') {
        messageHandler(mockEvent as any);
      }

      // The promise should still be pending since the message was ignored
      // Let's trigger a real message after to complete the test
      const realEvent = {
        source: mockIframe.contentWindow,
        data: {
          type: "success", 
          result: JSON.stringify({ real: "data" })
        }
      };

      if (messageHandler && typeof messageHandler === 'function') {
        messageHandler(realEvent as any);
      }

      const result = await promise;
      expect(result).toEqual({ real: "data" });
    });

    it("should handle panel ID change during message handling", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation(() => {});

      const mockIframe = {
        style: { display: '' },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: '',
        contentWindow: { postMessage: vi.fn() }
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);
      
      const panelSchema = {
        id: "panel1",
        customChartContent: "var option = {};"
      };

      const promise = runJavaScriptCode(panelSchema, []);
      
      // Change the panel ID to be refreshed before message handling
      panelIdToBeRefreshed.value = "panel2";
      
      // Simulate message from iframe
      const mockEvent = {
        source: mockIframe.contentWindow,
        data: {
          type: "success",
          result: JSON.stringify({ data: "test" })
        }
      };

      // Get and trigger message handler
      const addEventListenerCalls = vi.mocked(window.addEventListener).mock.calls;
      const messageHandler = addEventListenerCalls.find(call => call[0] === "message")?.[1];
      
      if (messageHandler && typeof messageHandler === 'function') {
        messageHandler(mockEvent as any);
      }

      // Verify event listener and iframe cleanup happened
      expect(window.removeEventListener).toHaveBeenCalledWith("message", messageHandler);
      expect(document.body.removeChild).toHaveBeenCalledWith(mockIframe);
      
      // The promise should remain pending as the message was ignored
      // Reset panel ID and send valid message to complete
      panelIdToBeRefreshed.value = null;
      
      const validEvent = {
        source: mockIframe.contentWindow,
        data: {
          type: "success",
          result: JSON.stringify({ valid: "data" })
        }
      };

      // Need to simulate a new message handler since the old one was removed
      // This simulates the behavior but the original promise will remain hanging
      // which is expected behavior in this edge case
    });

    it("should clear panelIdToBeRefreshed on successful completion", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation(() => {});

      const mockIframe = {
        style: { display: '' },
        setAttribute: vi.fn(),
        onload: null,
        srcdoc: '',
        contentWindow: { postMessage: vi.fn() }
      };

      vi.mocked(document.createElement).mockReturnValue(mockIframe as any);
      
      const panelSchema = {
        id: "panel1",
        customChartContent: "var option = {};"
      };

      // Set the panel ID to be refreshed
      panelIdToBeRefreshed.value = "panel1";

      const promise = runJavaScriptCode(panelSchema, []);
      
      // Trigger onload
      if (mockIframe.onload) {
        mockIframe.onload();
      }

      // Simulate successful response
      const mockEvent = {
        source: mockIframe.contentWindow,
        data: {
          type: "success",
          result: JSON.stringify({ data: "test" })
        }
      };

      // Get and trigger message handler
      const addEventListenerCalls = vi.mocked(window.addEventListener).mock.calls;
      const messageHandler = addEventListenerCalls.find(call => call[0] === "message")?.[1];
      
      if (messageHandler && typeof messageHandler === 'function') {
        messageHandler(mockEvent as any);
      }

      const result = await promise;
      expect(result).toEqual({ data: "test" });
      
      // Verify panelIdToBeRefreshed was cleared after success
      expect(panelIdToBeRefreshed.value).toBe(null);
    });
  });

  describe("Validation function tests", () => {
    it("should reject code with forbidden functions", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: { type: "Identifier", name: "fetch" },
            arguments: []
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "fetch('http://evil.com');"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Use of 'fetch()' is not allowed."
      );
    });

    it("should reject setTimeout with delay less than 100ms", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: { type: "Identifier", name: "setTimeout" },
            arguments: [
              { type: "FunctionExpression" },
              { type: "Literal", value: 50 }
            ]
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "setTimeout(function(){}, 50);"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Use of 'setTimeout()' with delay < 100ms is not allowed."
      );
    });

    it("should reject setTimeout with invalid usage", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: { type: "Identifier", name: "setTimeout" },
            arguments: [
              { type: "FunctionExpression" },
              { type: "Identifier", name: "variable" } // Not a literal
            ]
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "setTimeout(function(){}, variable);"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Invalid usage of 'setTimeout()'."
      );
    });

    it("should reject setTimeout with eval inside", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: { type: "Identifier", name: "setTimeout" },
            arguments: [
              {
                type: "CallExpression",
                callee: { type: "Identifier", name: "eval" }
              },
              { type: "Literal", value: 1000 }
            ]
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "setTimeout(eval('code'), 1000);"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Use of eval inside 'setTimeout()' is not allowed."
      );
    });

    it("should reject obfuscated function calls", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.CallExpression) {
          visitors.CallExpression({
            type: "CallExpression",
            callee: {
              type: "MemberExpression",
              property: { type: "Identifier", name: "join" }
            },
            arguments: [{ type: "Literal", value: "" }]
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "['f','e','t','c','h'].join('');"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Obfuscated function call detected."
      );
    });

    it("should reject access to forbidden objects", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.MemberExpression) {
          visitors.MemberExpression({
            type: "MemberExpression",
            object: { type: "Identifier", name: "window" },
            property: { type: "Identifier", name: "location" }
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "window.location.href;"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Access to 'window' is not allowed."
      );
    });

    it("should reject infinite while loops", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.WhileStatement) {
          visitors.WhileStatement({
            type: "WhileStatement",
            test: { type: "Literal", value: true }
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "while(true) { console.log('infinite'); }"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Infinite loop using 'while(true)' is not allowed."
      );
    });

    it("should reject infinite for loops", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.ForStatement) {
          visitors.ForStatement({
            type: "ForStatement",
            init: null,
            test: null, // No test condition = infinite loop
            update: null
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "for(;;) { console.log('infinite'); }"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Infinite loop using 'for(;;)' is not allowed."
      );
    });

    it("should reject new Function constructor", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.NewExpression) {
          visitors.NewExpression({
            type: "NewExpression",
            callee: { type: "Identifier", name: "Function" }
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "new Function('return 1');"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Use of 'new Function()' is not allowed."
      );
    });

    it("should reject invalid syntax", async () => {
      const acorn = await import("acorn");
      
      vi.mocked(acorn.parse).mockImplementation(() => {
        throw new Error("Invalid syntax");
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "invalid javascript syntax {"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Invalid JavaScript syntax."
      );
    });

    it("should reject obfuscated method/property access", async () => {
      const acorn = await import("acorn");
      const walk = await import("acorn-walk");
      
      vi.mocked(acorn.parse).mockReturnValue({ type: "Program", body: [] } as any);
      vi.mocked(walk.simple).mockImplementation((ast, visitors) => {
        if (visitors.MemberExpression) {
          visitors.MemberExpression({
            type: "MemberExpression",
            object: { type: "ThisExpression" },
            property: {
              type: "CallExpression",
              callee: {
                type: "MemberExpression",
                property: { type: "Identifier", name: "join" }
              }
            }
          } as any);
        }
      });

      const panelSchema = {
        id: "panel1",
        customChartContent: "this[['e','v','a','l'].join('')]('code');"
      };

      await expect(runJavaScriptCode(panelSchema, [])).rejects.toThrow(
        "Unsafe code detected: Obfuscated method/property access detected."
      );
    });
  });
});