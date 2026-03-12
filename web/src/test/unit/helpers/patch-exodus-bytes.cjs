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

// Node.js require-hook: intercepts require('@exodus/bytes/encoding-lite.js')
// before html-encoding-sniffer (a jsdom dependency) fails with ERR_REQUIRE_ESM.
// Injected via pool.forks.execArgv: ['--require', '...'] in vitest.config.ts.

/* global require, __dirname */
"use strict";

const Module = require("module");
const path = require("path");

const SHIM_ENCODING_LITE = path.resolve(
  __dirname,
  "exodus-bytes-encoding-lite.cjs",
);
const SHIM_ENCODING = path.resolve(__dirname, "exodus-bytes-encoding.cjs");

const TARGET_ENCODING_LITE = path.join("@exodus", "bytes", "encoding-lite.js");
const TARGET_ENCODING = path.join("@exodus", "bytes", "encoding.js");

const _resolveFilename = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, options) {
  if (typeof request === "string") {
    if (
      request === "@exodus/bytes/encoding-lite.js" ||
      (request.endsWith(TARGET_ENCODING_LITE) && request.includes(path.sep))
    ) {
      return SHIM_ENCODING_LITE;
    }
    if (
      request === "@exodus/bytes/encoding.js" ||
      (request.endsWith(TARGET_ENCODING) && request.includes(path.sep))
    ) {
      return SHIM_ENCODING;
    }
  }
  return _resolveFilename(request, parent, isMain, options);
};
