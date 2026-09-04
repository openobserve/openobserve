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

// CJS shim for @exodus/bytes/encoding-lite.js
// html-encoding-sniffer (a jsdom dependency) require()s this pure-ESM package,
// which fails in Node's CJS loader. This shim re-implements the two functions
// that html-encoding-sniffer actually calls: getBOMEncoding and labelToName.

/* global module */
"use strict";

/**
 * Detect a byte-order mark and return the encoding name, or null if absent.
 * @param {Uint8Array|ArrayBuffer|Buffer} input
 * @returns {string|null}
 */
function getBOMEncoding(input) {
  const u8 =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return "utf-8";
  }
  if (u8.length < 2) return null;
  if (u8[0] === 0xff && u8[1] === 0xfe) return "utf-16le";
  if (u8[0] === 0xfe && u8[1] === 0xff) return "utf-16be";
  return null;
}

// Minimal label-to-encoding-name table extracted from the WHATWG Encoding spec.
// Only the entries html-encoding-sniffer can encounter are included.
const LABEL_MAP = {
  "utf-8": "UTF-8",
  utf8: "UTF-8",
  "unicode-1-1-utf-8": "UTF-8",
  "utf-16be": "UTF-16BE",
  "utf-16": "UTF-16LE",
  "utf-16le": "UTF-16LE",
  "us-ascii": "windows-1252",
  ascii: "windows-1252",
  "ansi_x3.4-1968": "windows-1252",
  "iso-8859-1": "windows-1252",
  "iso8859-1": "windows-1252",
  latin1: "windows-1252",
  "windows-1252": "windows-1252",
  "x-user-defined": "x-user-defined",
  gbk: "GBK",
  gb2312: "GBK",
  gb18030: "gb18030",
  big5: "Big5",
  "big5-hkscs": "Big5",
  "x-x-big5": "Big5",
  "euc-jp": "EUC-JP",
  "x-euc-jp": "EUC-JP",
  "iso-2022-jp": "ISO-2022-JP",
  shift_jis: "Shift_JIS",
  "shift-jis": "Shift_JIS",
  ms932: "Shift_JIS",
  "euc-kr": "EUC-KR",
  "ks_c_5601-1987": "EUC-KR",
  "iso-2022-kr": "EUC-KR",
  replacement: "replacement",
};

/**
 * Convert a charset label to the WHATWG canonical encoding name.
 * @param {string|null|undefined} label
 * @returns {string|null}
 */
function labelToName(label) {
  if (label == null) return null;
  const normalised = String(label).trim().toLowerCase();
  return LABEL_MAP[normalised] ?? null;
}

// Re-export Node built-ins so any import of TextEncoder/TextDecoder still works.
module.exports = {
  getBOMEncoding,
  labelToName,
  TextDecoder: globalThis.TextDecoder,
  TextEncoder: globalThis.TextEncoder,
  TextDecoderStream: globalThis.TextDecoderStream,
  TextEncoderStream: globalThis.TextEncoderStream,
  normalizeEncoding: (label) =>
    label ? String(label).trim().toLowerCase() : null,
  legacyHookDecode: () => "",
};
