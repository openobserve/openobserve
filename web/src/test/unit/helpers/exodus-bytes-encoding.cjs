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

// CJS shim for @exodus/bytes/encoding.js
// jsdom/lib/api.js require()s this pure-ESM package which fails in Node's CJS
// loader. This shim exposes the one function jsdom actually calls: legacyHookDecode.

/* global module, require, Buffer, TextDecoder */
"use strict";

/**
 * Decode a Uint8Array to a string using the given encoding.
 * jsdom uses this as a fallback for HTTP body decoding.
 * @param {Uint8Array|ArrayBuffer|Buffer} input
 * @param {string} [fallbackEncoding='utf-8']
 * @returns {string}
 */
function legacyHookDecode(input, fallbackEncoding) {
  const encoding = fallbackEncoding || "utf-8";
  const u8 =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : Buffer.isBuffer(input)
          ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
          : new Uint8Array(0);

  try {
    return new TextDecoder(encoding).decode(u8);
  } catch {
    return new TextDecoder("utf-8").decode(u8);
  }
}

module.exports = {
  legacyHookDecode,
  getBOMEncoding: require("./exodus-bytes-encoding-lite.cjs").getBOMEncoding,
  labelToName: require("./exodus-bytes-encoding-lite.cjs").labelToName,
  TextDecoder: globalThis.TextDecoder,
  TextEncoder: globalThis.TextEncoder,
  TextDecoderStream: globalThis.TextDecoderStream,
  TextEncoderStream: globalThis.TextEncoderStream,
  normalizeEncoding: (label) =>
    label ? String(label).trim().toLowerCase() : null,
  setMultibyteDecoder: () => {},
};
