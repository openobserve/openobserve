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

import { describe, expect, it, vi } from "vitest";

import { gt, raw } from "@/types/i18n";

import approvedDelete from "./__fixtures__/record/approved-delete/frames.json";
import modelScrub from "./__fixtures__/record/model-scrub/frames.json";
import stopped from "./__fixtures__/record/stopped/frames.json";
import toolRedaction from "./__fixtures__/record/tool-redaction/frames.json";
import unknownFrame from "./__fixtures__/record/unknown-frame/frames.json";
import { prepareTurns, type StoredTurn } from "./record";
import {
  CHAT_SCHEMA,
  chatJson,
  chatMarkdown,
  fileStem,
  type ExportContext,
  type ExportSource,
} from "./useChatExport";

const NOW = Date.UTC(2026, 9, 21, 9, 5);

const ctx: ExportContext = {
  org: "default",
  timezone: "UTC",
  now: NOW,
  product: "O2 Assistant",
  t: gt,
};

const source = (turns: unknown, over: Partial<ExportSource> = {}): ExportSource => ({
  title: "Checkout 5xx spike",
  created: NOW - 60_000,
  origin: "alert",
  turns: turns as StoredTurn[],
  messages: [],
  ...over,
});

describe("chatMarkdown", () => {
  it("writes the heading, the export line and each turn as You and the assistant", () => {
    const md = chatMarkdown(source(approvedDelete.turns), ctx);
    const lines = md.split("\n\n");
    expect(lines[0]).toBe("# Checkout 5xx spike");
    expect(lines[1]).toBe("Exported 09:05 UTC · default");
    expect(md).toContain("**You**\n\nDelete the stale alert");
    expect(md).toContain("**O2 Assistant**");
    expect(md).toMatch(/Worked through 2 steps \(SearchAlerts, o2_delete\)/);
    expect(md).toMatch(/Approved by you at \d\d:\d\d · Deleted 1 of 1/);
    expect(md.endsWith("\n")).toBe(true);
  });

  it("scrubs model names to the model", () => {
    const md = chatMarkdown(source(modelScrub.turns), ctx);
    expect(md).not.toMatch(/claude|gemini|sonnet/i);
    expect(md).toContain("the model");
  });

  it("says where an answer was stopped", () => {
    expect(chatMarkdown(source(stopped.turns), ctx)).toMatch(
      /Stopped at \d\d:\d\d · findings kept/,
    );
  });

  it("falls back to the saved transcript for a chat stored without turns", () => {
    const md = chatMarkdown(
      source([], {
        messages: [
          { role: "user", content: raw("legacy question") },
          { role: "assistant", content: raw("legacy answer") },
        ],
      }),
      ctx,
    );
    expect(md).toContain("legacy question");
    expect(md).toContain("legacy answer");
  });

  it("keeps tool names but never tool inputs or outputs", () => {
    const md = chatMarkdown(source(toolRedaction.turns), ctx);
    const raw = JSON.stringify(toolRedaction.turns);
    expect(raw).toContain("context");
    expect(md).not.toContain('"context"');
  });
});

describe("chatJson", () => {
  it("writes the stored turns under the chat schema", () => {
    const json = chatJson(source(approvedDelete.turns), ctx);
    expect(json).toMatchObject({
      schema: CHAT_SCHEMA,
      exported_at: NOW,
      org: "default",
      title: "Checkout 5xx spike",
      origin: "alert",
    });
    expect(json.turns).toHaveLength(approvedDelete.turns.length);
  });

  it("writes the export audience's turns: model names and keys scrubbed, unknown frames gone", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const scrubbed = JSON.stringify(chatJson(source(modelScrub.turns), ctx));
    expect(scrubbed).not.toMatch(/gpt-4o|claude-3|gemini-1|"model"|"model_provider"/i);
    expect(scrubbed).toContain("the model");
    const known = chatJson(source(unknownFrame.turns), ctx);
    expect(JSON.stringify(known)).not.toContain("hologram");
    expect(known.turns).toEqual(
      prepareTurns(unknownFrame.turns as StoredTurn[], "export", {
        timezone: "UTC",
        scrubModels: true,
        t: gt,
      }),
    );
    warn.mockRestore();
  });

  it("builds turns from the saved transcript of a chat a legacy tab wrote", () => {
    const json = chatJson(
      source([], {
        messages: [
          { role: "user", content: raw("why 5xx?") },
          { role: "assistant", content: raw("The gateway timed out.") },
        ],
      }),
      ctx,
    );
    expect(json.turns).toHaveLength(1);
    expect(json.turns[0].user?.text).toBe("why 5xx?");
  });
});

describe("fileStem", () => {
  it("slugs the title and stamps the minute in the org zone", () => {
    expect(fileStem("Checkout 5xx spike in prod!", ctx)).toBe(
      "o2-assistant-checkout-5xx-spike-in-prod-20261021-0905",
    );
    expect(fileStem("   ", ctx)).toBe("o2-assistant-chat-20261021-0905");
    expect(fileStem("x", { now: NOW, timezone: "Asia/Kolkata" })).toBe(
      "o2-assistant-x-20261021-1435",
    );
  });
});
