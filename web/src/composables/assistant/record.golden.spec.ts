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

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { TranslateFn } from "@/types/i18n";

import { generateNavigationFromToolResult } from "./navigationRoutes";
import { projectRecord, type ProjectRecordOptions, type StoredTurn } from "./record";
import { reduce, type ReducerCtx, type StreamState } from "./reducer";

const ROOT = join(__dirname, "__fixtures__", "record");
const LOCALE = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "locales", "languages", "en-US.json"), "utf8"),
);
// `O2_UPDATE_GOLDEN=1` rewrites the expected files from the current projection.
const UPDATE = process.env.O2_UPDATE_GOLDEN === "1";

const AUDIENCES = [
  { file: "owner.json", audience: "owner", redacted: false, scrubModels: false },
  { file: "viewer.json", audience: "viewer", redacted: false, scrubModels: true },
  { file: "viewer-redacted.json", audience: "viewer", redacted: true, scrubModels: true },
  { file: "export.json", audience: "export", redacted: false, scrubModels: true },
] as const;

interface RecordCase {
  schema: string;
  timezone: string;
  hidden?: ProjectRecordOptions["hidden"];
  turns: StoredTurn[];
}

const cases = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const rustSnapshot = JSON.parse(readFileSync(join(ROOT, "rust-snapshot.json"), "utf8")) as {
  cases: Record<string, unknown>;
};

const t = ((key: string, params?: Record<string, unknown>) => {
  const value = key.split(".").reduce<any>((node, part) => node?.[part], LOCALE);
  const text = typeof value === "string" ? value.split(" | ").at(-1)! : key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
}) as unknown as TranslateFn;

// Who spoke and which block kinds, in order; a turn's closing line comes from the engine live, not the reducer.
const shapeOf = (messages: any[]) =>
  messages.map((message) => ({
    role: message.role,
    blocks: (message.contentBlocks ?? [])
      .map((block: any) => block.type)
      .filter((type: string) => type !== "status" && type !== "error"),
  }));

// The frames as the live reducer folds them while they stream, one turn at a time.
const liveFold = (turns: StoredTurn[]) => {
  const ctx: ReducerCtx = {
    isActive: true,
    autoNavigationEnabled: true,
    phase: "live",
    t,
    generateNavigation: (tool, args, body) => generateNavigationFromToolResult(tool, args, body, t),
  };
  return turns.flatMap((turn) => {
    const state: StreamState = {
      messages: turn.user ? [{ role: "user", content: turn.user.text } as any] : [],
      activeToolCall: null,
      textSegment: "",
      streamingMsg: "",
      title: undefined,
      lastTraceId: null,
      ownerUnavailable: false,
      pendingConfirmation: null,
      messageComplete: false,
      halted: false,
    };
    for (const frame of turn.frames) if (!state.halted) reduce(state, frame, ctx);
    return state.messages;
  });
};

const read = (name: string, file: string) =>
  JSON.parse(readFileSync(join(ROOT, name, file), "utf8"));

const project = (input: RecordCase, entry: (typeof AUDIENCES)[number]) =>
  JSON.parse(
    JSON.stringify(
      projectRecord(structuredClone(input.turns), entry.audience, {
        timezone: input.timezone,
        scrubModels: entry.scrubModels,
        redacted: entry.redacted,
        ...(input.hidden && entry.audience === "viewer" && { hidden: input.hidden }),
        t,
      }),
    ),
  );

describe("record goldens", () => {
  it("has every case the server tests read", () => {
    expect(cases).toEqual(
      expect.arrayContaining([
        "approved-delete",
        "denied-update",
        "stopped",
        "navigation",
        "pending-confirmation",
        "unknown-frame",
        "model-scrub",
        "compacted",
        "tool-redaction",
      ]),
    );
  });

  describe.each(cases)("%s", (name) => {
    const input = read(name, "frames.json") as RecordCase;

    it.each(AUDIENCES.map((entry) => [entry.file, entry] as const))(
      "projects %s",
      (file, entry) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const output = project(input, entry);
        warn.mockRestore();
        const path = join(ROOT, name, file);
        if (UPDATE) writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
        expect(existsSync(path), `${name}/${file} is missing; O2_UPDATE_GOLDEN=1 writes it`).toBe(
          true,
        );
        expect(output).toEqual(read(name, file));
      },
    );

    it("shows the same blocks in the same places live, on reload and in the export", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const live = shapeOf(liveFold(structuredClone(input.turns)));
      const reload = shapeOf(project(input, AUDIENCES[0]));
      const exported = shapeOf(project(input, AUDIENCES[3]));
      warn.mockRestore();
      expect(reload).toEqual(live);
      expect(exported).toEqual(reload);
    });

    it("matches the server projection once it is captured", () => {
      const server = rustSnapshot.cases[name];
      if (server === undefined) return;
      const viewer = project(input, AUDIENCES[1]);
      expect(viewer, "projection drift: see B-10").toEqual(server);
    });
  });

  it("never leaves a replayed card pending in any audience", () => {
    for (const name of cases) {
      const input = read(name, "frames.json") as RecordCase;
      for (const entry of AUDIENCES) {
        const blocks = project(input, entry).flatMap((m: any) => m.contentBlocks ?? []);
        for (const block of blocks.filter((b: any) => b.type === "approval"))
          expect(
            block.approval.noDecision === true ||
              blocks.some((b: any) => b.resolved?.id === block.approval.id),
          ).toBe(true);
        expect(blocks.some((b: any) => b.pendingConfirmation)).toBe(false);
      }
    }
  });

  it("keeps model names out of every scrubbed audience", () => {
    const input = read("model-scrub", "frames.json") as RecordCase;
    for (const entry of AUDIENCES.filter((a) => a.scrubModels)) {
      const text = JSON.stringify(project(input, entry));
      expect(text).not.toMatch(/gpt-4o|claude-3|gemini-1/i);
      expect(text).toContain("the model");
    }
  });

  it("warns once per unknown kind and drops it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const output = project(read("unknown-frame", "frames.json"), AUDIENCES[0]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("hologram");
    expect(JSON.stringify(output)).not.toContain("hologram");
    warn.mockRestore();
  });

  it("drops tool inputs and outputs when redacted but keeps names and counts", () => {
    const input = read("tool-redaction", "frames.json") as RecordCase;
    const text = JSON.stringify(project(input, AUDIENCES[2]));
    expect(text).not.toContain("SELECT count(*)");
    expect(text).not.toContain("card 4111");
    expect(text).toContain("SearchSQL");
    expect(text).toContain("1287");
  });
});
