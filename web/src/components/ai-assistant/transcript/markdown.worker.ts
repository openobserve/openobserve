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

// Off the main thread so no input can stall the tab; no DOM, no network, no eval, and `markdown.ts` sanitises the result.
import "./workerGlobal";

import { parseBlock, type ParseRequest } from "./markdownCore";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ requests: ParseRequest[] }>) => void) | null;
  postMessage(message: unknown): void;
};

// Each job says when it starts, so the main thread times the job itself, never this worker's start-up or queue.
scope.onmessage = (event) => {
  event.data.requests.forEach((request, index) => {
    scope.postMessage({ type: "start", index });
    scope.postMessage({ type: "done", index, result: parseBlock(request) });
  });
};

scope.postMessage({ type: "ready" });
