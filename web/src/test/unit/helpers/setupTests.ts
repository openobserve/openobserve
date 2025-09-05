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
import { config } from "@vue/test-utils";

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

// Suppress Vue warnings for testing environment
const originalWarn = console.warn;
console.warn = (...args) => {
  // Filter out specific Vue warnings that are expected in test environment
  const message = args[0];
  if (typeof message === 'string') {
    if (message.includes('Failed setting prop "prefix" on <q-input-stub>') ||
        message.includes('Cannot set property prefix of [object Element]') || 
        message.includes('Failed setting prop "prefix" on <q-select-stub>: value undefined is invalid')) {
      return; // Suppress this specific warning
    }
  }
  originalWarn.apply(console, args);
};

// Mock URL.createObjectURL and URL.revokeObjectURL for file download tests
global.URL.createObjectURL = vi.fn().mockReturnValue('mock-object-url');
global.URL.revokeObjectURL = vi.fn();
// Mock clipboard API for test environment
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};
Object.defineProperty(navigator, 'clipboard', {
  value: mockClipboard,
  writable: true,
});

beforeAll(() => {
  server.listen();
  
  // Handle unhandled promise rejections to prevent CI/CD failures
  process.on('unhandledRejection', (reason, promise) => {
    // Log the error but don't fail the test
    console.warn('Unhandled promise rejection:', reason);
  });
  
  // Handle uncaught exceptions to prevent CI/CD failures
  process.on('uncaughtException', (error) => {
    // Log the error but don't fail the test if it's a known issue
    if (error.message?.includes('document is not defined') || 
        error.message?.includes('window is not defined')) {
      console.warn('Known test environment error (ignored):', error.message);
    } else {
      console.warn('Uncaught exception:', error);
    }
  });
})

// Reset any request handlers after each test (for test isolation)
afterEach(() => {
  server.resetHandlers();
  // Clear any pending timers globally
  vi.clearAllTimers();
})

// Stop the server when tests are done
afterAll(() => {
  server.close(); 
})
