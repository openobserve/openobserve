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

beforeAll(() => server.listen())

// Reset any request handlers after each test (for test isolation)
afterEach(() => server.resetHandlers())

// Stop the server when tests are done
afterAll(() => {
  server.close(); 
})
