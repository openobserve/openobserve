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

import { describe, expect, it } from "vitest";
import { urlCarriesCredential } from "./urlCredentials";

describe("urlCarriesCredential", () => {
  it.each([
    "https://user:token@mcp.example.com/sse",
    "https://token@mcp.example.com/sse",
    "https://mcp.example.com/sse?api_key=abc",
    "mcp.example.com/sse?token=abc",
    "https://hooks.slack.com/services/T000/B000/XXXX",
    "https://hooks.slack-gov.com/services/T000/B000/XXXX",
    "https://outlook.office.com/webhook/abc@def/IncomingWebhook/ghi/jkl",
    "https://maker.ifttt.com/trigger/alert/with/key/abcdefg",
    "https://eoabcdefgh.m.pipedream.net",
    "https://hook.eu1.make.com/abcdefghijklmnop",
    "https://chat.example.com/hooks/abcdefghij1234567890xyz",
    "https://api.telegram.org/bot123:abc/sendMessage",
    "not a url @ all",
  ])("flags %s", (url) => {
    expect(urlCarriesCredential(url)).toBe(true);
  });

  it.each([
    "",
    "   ",
    "https://mcp.example.com/sse",
    "https://api.example.com/mcp/",
    "http://localhost:5080/api/default/mcp",
    "mcp.example.com/v1/tools",
    "https://slack-gov.com/help",
  ])("does not flag %j", (url) => {
    expect(urlCarriesCredential(url)).toBe(false);
  });
});
