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

// @ts-ignore
import { beforeAll, afterEach, afterAll, vi } from "vitest";

import { setupServer } from "msw/node";

import "../../__mocks__/index";

import { restHandlers } from "./handlers";


const server = setupServer(...restHandlers);

// This is added to support multiple responses on same end point.
// example: suppose for '/posts' we need to need to test sending response as error, [] and [post1, post2].
// For this we need instance of server while testing
// So have added server instance on global so that it can be accessed while testing
declare global {
  // eslint-disable-next-line no-var
  var server: any;
  // eslint-disable-next-line no-var
  var IntersectionObserver: {
    new (callback: IntersectionObserverCallback, options?: IntersectionObserverInit): IntersectionObserver;
    prototype: IntersectionObserver;
  };
}

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(
    private callback: IntersectionObserverCallback,
    private options?: IntersectionObserverInit
  ) {}

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
}

// Assign the mock to the global object
global.IntersectionObserver = MockIntersectionObserver;

vi.stubGlobal("server", server);

global.document.queryCommandSupported = vi.fn().mockReturnValue(true);

// Mock URL.createObjectURL and URL.revokeObjectURL for file download tests
global.URL.createObjectURL = vi.fn().mockReturnValue('mock-object-url');
global.URL.revokeObjectURL = vi.fn();
// Mock Quasar's portal functionality to prevent DOM access issues
if (typeof global !== 'undefined' && global.document) {
  // Mock document.body if it doesn't exist
  if (!global.document.body) {
    global.document.body = global.document.createElement('body');
  }
  
  // Mock any Quasar-specific DOM methods
  global.document.addEventListener = vi.fn();
  global.document.removeEventListener = vi.fn();
}

// Additional window.location mock for tests that might not use the global mock
const mockLocation = {
  href: 'http://localhost:3000/web/',
  origin: 'http://localhost:3000',
  protocol: 'http:',
  host: 'localhost:3000',
  hostname: 'localhost',
  port: '3000',
  pathname: '/web/',
  search: '',
  hash: '',
  assign: vi.fn(),
  replace: vi.fn(),
  reload: vi.fn(),
};

// Ensure window.location is available in all test contexts
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'location', {
    value: mockLocation,
    writable: true,
  });
}

// Also set it globally for Node.js environment
Object.defineProperty(globalThis, 'location', {
  value: mockLocation,
  writable: true,
});

beforeAll(() => server.listen())

// Reset any request handlers after each test (for test isolation)
afterEach(() => {
  server.resetHandlers();
  
  // Clear any pending timers that might be left by Quasar components
  vi.clearAllTimers();
  
  // Clear any pending timeouts/intervals
  if (typeof global !== 'undefined' && global.document) {
    // This helps prevent the "document is not defined" error
    const timeoutId = setTimeout(() => {}, 0);
    clearTimeout(timeoutId);
  }
})

// Stop the server when tests are done
afterAll(async () => {
  // Close MSW server properly
  server.close();
  
  // Final cleanup of any remaining timers
  vi.clearAllTimers();
  vi.clearAllMocks();
  
  // Clear any remaining timeouts/intervals that Quasar might have set
  if (typeof global !== 'undefined' && global.document) {
    const highestTimeoutId = setTimeout(() => {}, 0);
    for (let i = 0; i < highestTimeoutId; i++) {
      clearTimeout(i);
      clearInterval(i);
    }
  }
  
  // Force cleanup of any hanging promises
  await Promise.resolve();
  
  // Note: Removed forced process.exit as it causes Vitest to exit unexpectedly
  // The test runner will handle cleanup automatically
})
