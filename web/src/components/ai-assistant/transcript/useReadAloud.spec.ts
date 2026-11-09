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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";

import { speechChunks, useReadAloud } from "./useReadAloud";

class FakeUtterance {
  lang = "";
  onboundary: ((event: { charIndex: number }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function fakeSynth() {
  const spoken: FakeUtterance[] = [];
  return {
    spoken,
    speak: vi.fn((u: FakeUtterance) => spoken.push(u)),
    cancel: vi.fn(() => spoken.splice(0)),
    pause: vi.fn(),
    resume: vi.fn(),
  };
}

let synth: ReturnType<typeof fakeSynth>;

beforeEach(() => {
  synth = fakeSynth();
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speechChunks", () => {
  it("keeps sentences whole and records where each chunk starts", () => {
    const text = `${"a".repeat(150)}. ${"b".repeat(150)}. Short.`;
    const chunks = speechChunks(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].start).toBe(0);
    expect(text.slice(chunks[1].start)).toBe(chunks[1].text);
  });

  it("returns nothing for blank text", () => {
    expect(speechChunks("  \n ")).toEqual([]);
  });
});

describe("useReadAloud", () => {
  it("is unsupported without speech synthesis and does nothing", async () => {
    vi.stubGlobal("speechSynthesis", undefined);
    const reader = useReadAloud(() => "Hello.");
    expect(reader.supported).toBe(false);
    await reader.toggle();
    expect(reader.state.value).toBe("idle");
  });

  it("plays, pauses, resumes and reports progress", async () => {
    const reader = useReadAloud(() => "Checkout fails. Inventory resets.");
    expect(reader.supported).toBe(true);
    await reader.toggle();
    expect(reader.state.value).toBe("playing");
    expect(synth.speak).toHaveBeenCalled();
    synth.spoken[0].onboundary?.({ charIndex: 9 });
    expect(reader.progress.value).toBeGreaterThan(0);
    await reader.toggle();
    expect(synth.pause).toHaveBeenCalled();
    expect(reader.state.value).toBe("paused");
    await reader.toggle();
    expect(synth.resume).toHaveBeenCalled();
    expect(reader.state.value).toBe("playing");
  });

  it("returns to idle when the last chunk ends", async () => {
    const reader = useReadAloud(async () => "One sentence.");
    await reader.toggle();
    synth.spoken.at(-1)?.onend?.();
    expect(reader.state.value).toBe("idle");
    expect(reader.progress.value).toBe(0);
  });

  it("stops the answer already reading when another starts", async () => {
    const first = useReadAloud(() => "First answer.");
    const second = useReadAloud(() => "Second answer.");
    await first.toggle();
    await second.toggle();
    expect(first.state.value).toBe("idle");
    expect(second.state.value).toBe("playing");
  });

  it("stops when its scope is disposed", async () => {
    const scope = effectScope();
    const reader = scope.run(() => useReadAloud(() => "Leaving."))!;
    await reader.toggle();
    scope.stop();
    expect(synth.cancel).toHaveBeenCalled();
    expect(reader.state.value).toBe("idle");
  });
});
