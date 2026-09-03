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

import { describe, it, expect } from "vitest";
import { extractGenAiPartText, isSuppressedGenAiPartType } from "./genAiParts";

describe("extractGenAiPartText", () => {
  it("reads a text part via the OTel v5 `content` field", () => {
    expect(extractGenAiPartText({ type: "text", content: "hi" })).toBe("hi");
  });

  it("reads a text part via the legacy OpenAI `text` field", () => {
    expect(extractGenAiPartText({ type: "text", text: "hi" })).toBe("hi");
  });

  it("reads a reasoning part", () => {
    expect(extractGenAiPartText({ type: "reasoning", content: "thinking about it" })).toBe(
      "thinking about it",
    );
  });

  it("reads a compaction part", () => {
    expect(extractGenAiPartText({ type: "compaction", content: "summary of prior turns" })).toBe(
      "summary of prior turns",
    );
  });

  it("formats a tool_call part with its name and arguments", () => {
    const result = extractGenAiPartText({
      type: "tool_call",
      name: "get_weather",
      arguments: { city: "Boston" },
    });
    expect(result).toContain("get_weather");
    expect(result).toContain("Boston");
  });

  it("formats a string tool_call_response part", () => {
    expect(extractGenAiPartText({ type: "tool_call_response", response: "rainy, 57F" })).toBe(
      "rainy, 57F",
    );
  });

  // pydantic-ai (the SDK from issue #14127) does not follow the OTel spec's
  // field names literally — verified against its own _otel_messages.py /
  // messages.py source, not the spec doc. It emits `type: "thinking"`
  // (spec calls it "reasoning") and a tool_call_response `result` field
  // (spec calls it "response"). Both must render, or the fix doesn't
  // actually work against the SDK that triggered the issue.
  it("reads a pydantic-ai `thinking` part (vendor spelling of reasoning)", () => {
    expect(extractGenAiPartText({ type: "thinking", content: "let me check" })).toBe(
      "let me check",
    );
  });

  it("reads a pydantic-ai tool_call_response `result` field", () => {
    expect(extractGenAiPartText({ type: "tool_call_response", result: "rainy, 57F" })).toBe(
      "rainy, 57F",
    );
  });

  it("formats an object tool_call_response part as JSON", () => {
    const result = extractGenAiPartText({
      type: "tool_call_response",
      response: { temp: 57 },
    });
    expect(result).toContain("57");
  });

  it("formats a server_tool_call part", () => {
    const result = extractGenAiPartText({
      type: "server_tool_call",
      name: "web_search",
      server_tool_call: { query: "weather" },
    });
    expect(result).toContain("web_search");
  });

  it("formats a server_tool_call_response part", () => {
    const result = extractGenAiPartText({
      type: "server_tool_call_response",
      server_tool_call_response: { result: "ok" },
    });
    expect(result).toContain("ok");
  });

  it("returns null for blob/file/uri parts (no text representation)", () => {
    expect(extractGenAiPartText({ type: "blob", modality: "image", content: "aGVsbG8=" })).toBe(
      null,
    );
    expect(extractGenAiPartText({ type: "file", modality: "image", file_id: "f1" })).toBe(null);
    expect(extractGenAiPartText({ type: "uri", modality: "image", uri: "https://x" })).toBe(null);
  });

  it("returns null for a future/unrecognised part type", () => {
    expect(extractGenAiPartText({ type: "some_new_part_type", data: 1 })).toBe(null);
  });

  it("returns null for a non-object or typeless input", () => {
    expect(extractGenAiPartText(null)).toBe(null);
    expect(extractGenAiPartText("plain string")).toBe(null);
    expect(extractGenAiPartText({ no_type: true })).toBe(null);
  });
});

describe("isSuppressedGenAiPartType", () => {
  it("is true for blob/file/uri — these have first-class rendering elsewhere", () => {
    expect(isSuppressedGenAiPartType("blob")).toBe(true);
    expect(isSuppressedGenAiPartType("file")).toBe(true);
    expect(isSuppressedGenAiPartType("uri")).toBe(true);
  });

  it("is false for every other known or unknown type", () => {
    expect(isSuppressedGenAiPartType("text")).toBe(false);
    expect(isSuppressedGenAiPartType("tool_call")).toBe(false);
    expect(isSuppressedGenAiPartType("some_new_part_type")).toBe(false);
  });
});
