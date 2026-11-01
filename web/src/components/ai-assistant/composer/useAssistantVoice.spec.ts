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

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeVoiceEngine, fakeVoiceTarget } from "../__tests__/fakeVoice";
import {
  HOLD_MS,
  SILENCE_MS,
  VOICE_LIMIT_MS,
  createVoiceController,
  type VoiceController,
} from "./useAssistantVoice";

const { mac } = vi.hoisted(() => ({ mac: { on: false } }));

vi.mock("@/utils/keyboardShortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/keyboardShortcuts")>()),
  isMacOS: () => mac.on,
}));

let engine: ReturnType<typeof fakeVoiceEngine>;
let controller: VoiceController;
let detach: (() => void)[] = [];

function chord(type: "keydown" | "keyup", init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent(type, { key: "i", ctrlKey: true, bubbles: true, ...init });
  document.dispatchEvent(event);
  return event;
}

async function listening(target = fakeVoiceTarget()) {
  await controller.start(target, "mic");
  engine.handlers!.onStart();
  return target;
}

beforeEach(() => {
  vi.useFakeTimers();
  mac.on = false;
  engine = fakeVoiceEngine();
  controller = createVoiceController(engine);
});

afterEach(() => {
  detach.forEach((off) => off());
  detach = [];
  vi.useRealTimers();
});

describe("dictating into a draft", () => {
  it("starts on the browser's microphone answer and inserts at the caret, never sending", async () => {
    const target = fakeVoiceTarget("why did  fail");
    target.caret = 8;
    await listening(target);

    expect(controller.state.phase).toBe("listening");
    engine.handlers!.onResults([{ index: 0, text: "cart", final: true }]);
    expect(target.text).toBe("why did cart fail");
  });

  it("keeps the unsettled tail out of the draft until it settles", async () => {
    const target = await listening(fakeVoiceTarget("hello"));

    engine.handlers!.onResults([{ index: 0, text: "wor", final: false }]);
    expect(controller.state.tail).toBe(" wor");
    expect(target.writes).toEqual([]);

    engine.handlers!.onResults([{ index: 0, text: "world", final: true }]);
    expect(target.text).toBe("hello world");
    expect(controller.state.tail).toBe("");
  });

  it("settles the tail as shown on stop and reports the words added", async () => {
    const target = await listening();
    engine.handlers!.onResults([{ index: 0, text: "one two", final: false }]);

    controller.stop("escape");

    expect(target.text).toBe("one two");
    expect(target.ends).toEqual([{ kind: "stopped", reason: "escape", words: 2 }]);
    expect(engine.abort).toHaveBeenCalled();
    expect(engine.meter.close).toHaveBeenCalled();
    expect(controller.state.phase).toBe("idle");
  });

  it("does not space CJK phrases apart", async () => {
    const target = await listening(fakeVoiceTarget("你好"));
    engine.handlers!.onResults([{ index: 0, text: "世界", final: true }]);
    expect(target.text).toBe("你好世界");
  });
});

describe("editing while listening", () => {
  it("drops later revisions of a tail the user typed over, and new speech lands at the caret", async () => {
    const target = await listening();
    engine.handlers!.onResults([{ index: 0, text: "cart fail", final: false }]);

    target.text = "cart fails";
    controller.noteEdit(10);
    engine.handlers!.onResults([{ index: 0, text: "cart failed", final: true }]);
    expect(target.text).toBe("cart fails");

    engine.handlers!.onResults([{ index: 1, text: "again", final: true }]);
    expect(target.text).toBe("cart fails again");
  });

  it("settles the tail when the caret moves inside it", async () => {
    const target = await listening();
    engine.handlers!.onResults([{ index: 0, text: "cart fail", final: false }]);

    controller.noteCaret(3);

    expect(target.text).toBe("cart fail");
    expect(controller.state.tail).toBe("");
    expect(controller.state.anchor).toBe(3);
  });

  it("leaves the tail alone for a caret at its edge", async () => {
    await listening();
    engine.handlers!.onResults([{ index: 0, text: "cart", final: false }]);
    controller.noteCaret(4);
    expect(controller.state.tail).toBe("cart");
  });

  it("buffers speech during an IME composition and lands it at compositionend", async () => {
    const target = await listening(fakeVoiceTarget("abc"));
    controller.setComposing(true, 3);

    engine.handlers!.onResults([{ index: 0, text: "later", final: true }]);
    expect(target.writes).toEqual([]);

    target.text = "abcd";
    controller.setComposing(false, 4);
    expect(target.text).toBe("abcd later");
  });
});

describe("one microphone", () => {
  it("stops and settles the first composer when a second one starts", async () => {
    const first = await listening();
    engine.handlers!.onResults([{ index: 0, text: "tail", final: false }]);
    const second = fakeVoiceTarget();

    await controller.start(second, "mic");

    expect(first.text).toBe("tail");
    expect(first.ends).toEqual([{ kind: "stopped", reason: "other", words: 1 }]);
    expect(controller.state.owner).toBe(second.id);
  });

  it("stops on window blur and tab hide while listening", async () => {
    const target = fakeVoiceTarget();
    detach.push(controller.attach(target));
    await listening(target);

    window.dispatchEvent(new Event("blur"));

    expect(target.ends).toHaveLength(1);
    expect(controller.state.phase).toBe("idle");
  });

  it("does not stop on blur while the permission prompt is up", async () => {
    engine.holdPrompt = true;
    const target = fakeVoiceTarget();
    detach.push(controller.attach(target));
    void controller.start(target, "mic");

    window.dispatchEvent(new Event("blur"));

    expect(controller.state.phase).toBe("waiting");
  });

  it("stops when the target detaches", async () => {
    const target = fakeVoiceTarget();
    const off = controller.attach(target);
    await listening(target);
    off();
    expect(target.ends).toHaveLength(1);
  });
});

describe("permission wait", () => {
  it("cancels without opening the recogniser and closes a late microphone", async () => {
    engine.holdPrompt = true;
    const target = fakeVoiceTarget();
    const started = controller.start(target, "mic");
    expect(controller.state.phase).toBe("waiting");

    controller.stop("mic");
    engine.grant!();
    await started;

    expect(target.ends).toEqual([{ kind: "cancelled" }]);
    expect(engine.handlers).toBeNull();
    expect(engine.meter.close).toHaveBeenCalled();
  });

  it.each([
    ["NotAllowedError", "mic_denied", true],
    ["NotFoundError", "no_mic", false],
  ])("maps a %s to %s", async (name, code, denied) => {
    engine.rejectMic = Object.assign(new Error("no"), { name });
    const target = fakeVoiceTarget("typed");

    await controller.start(target, "mic");

    expect(target.ends).toEqual([{ kind: "error", code }]);
    expect(controller.state.denied).toBe(denied);
    expect(target.text).toBe("typed");
  });

  it("still dictates when the level source fails for another reason", async () => {
    engine.rejectMic = Object.assign(new Error("busy"), { name: "NotReadableError" });
    await controller.start(fakeVoiceTarget(), "mic");
    expect(engine.handlers).not.toBeNull();
  });
});

describe("errors and limits", () => {
  it.each([
    ["not-allowed", "mic_denied"],
    ["audio-capture", "no_mic"],
    ["network", "service_unreachable"],
    ["service-not-allowed", "service_unreachable"],
    ["language-not-supported", "language_unsupported"],
    ["no-speech", "no_speech"],
  ])("maps recogniser error %s to %s", async (error, code) => {
    const target = await listening();
    engine.handlers!.onError(error);
    expect(target.ends).toEqual([{ kind: "error", code }]);
  });

  it("names no vendor for an unrecognised brand (B60)", async () => {
    engine.fakeBrand = null;
    const target = await listening();
    engine.handlers!.onError("network");
    expect(target.ends).toEqual([{ kind: "error", code: "service_unreachable_generic" }]);
  });

  it("ignores its own abort", async () => {
    const target = await listening();
    engine.handlers!.onError("aborted");
    expect(target.ends).toEqual([]);
  });

  it("reports stt_unavailable when the engine errors or ends after a result (B16)", async () => {
    const target = await listening();
    engine.handlers!.onResults([{ index: 0, text: "kept", final: false }]);
    engine.handlers!.onEnd();
    expect(target.text).toBe("kept");
    expect(target.ends).toEqual([{ kind: "error", code: "stt_unavailable" }]);
  });

  it("stops at the 2-minute limit with what was settled", async () => {
    const target = await listening();
    engine.handlers!.onResults([{ index: 0, text: "kept", final: true }]);

    vi.advanceTimersByTime(VOICE_LIMIT_MS);

    expect(target.text).toBe("kept");
    expect(target.ends).toEqual([{ kind: "error", code: "time_limit" }]);
  });

  it("calls 8 s of quiet nothing heard", async () => {
    const target = await listening();
    vi.advanceTimersByTime(SILENCE_MS);
    expect(target.ends).toEqual([{ kind: "error", code: "no_speech" }]);
    expect(controller.state.silent).toBe(false);
  });

  it("marks the engine silent for this tab when speech was input and nothing came back (B58)", async () => {
    const target = await listening();
    engine.meter.db = -30;
    vi.advanceTimersByTime(SILENCE_MS);
    expect(target.ends).toEqual([{ kind: "error", code: "browser_silent" }]);
    expect(controller.state.silent).toBe(true);
  });

  it("does not count input at or below -50 dBFS as speech", async () => {
    await listening();
    engine.meter.db = -50;
    vi.advanceTimersByTime(SILENCE_MS);
    expect(controller.state.silent).toBe(false);
  });

  it("applies B58 to a session that ends early with no results", async () => {
    const target = await listening();
    engine.meter.db = -30;
    vi.advanceTimersByTime(1_000);
    engine.handlers!.onEnd();
    expect(target.ends).toEqual([{ kind: "error", code: "browser_silent" }]);
  });

  it("ignores engine callbacks after it stopped", async () => {
    const target = await listening();
    const late = engine.handlers!;
    controller.stop("mic");
    late.onResults([{ index: 0, text: "late", final: true }]);
    late.onEnd();
    expect(target.writes).toEqual([]);
    expect(target.ends).toHaveLength(1);
  });

  it("only ever hands the level source to the meter, never to the target", async () => {
    const target = await listening();
    engine.meter.db = -20;
    vi.advanceTimersByTime(300);
    expect(controller.state.level).toBeCloseTo(2 / 3);
    expect(target.writes).toEqual([]);
  });
});

describe("push-to-talk", () => {
  async function held(target = fakeVoiceTarget()) {
    detach.push(controller.attach(target));
    target.hold.mockImplementation(() => controller.start(target, "hold"));
    chord("keydown");
    vi.advanceTimersByTime(HOLD_MS);
    await flushPromises();
    engine.handlers?.onStart();
    return target;
  }

  it("does nothing for a tap under 350 ms", () => {
    const target = fakeVoiceTarget();
    detach.push(controller.attach(target));
    chord("keydown");
    vi.advanceTimersByTime(HOLD_MS - 1);
    chord("keyup");
    vi.advanceTimersByTime(HOLD_MS);
    expect(target.hold).not.toHaveBeenCalled();
  });

  it("starts after 350 ms and stops on release of I", async () => {
    const target = await held();
    expect(controller.state.via).toBe("hold");
    chord("keyup");
    expect(target.ends).toEqual([{ kind: "stopped", reason: "release", words: 0 }]);
  });

  it("treats the modifier's keyup as release, which macOS sends instead of I's", async () => {
    mac.on = true;
    const target = fakeVoiceTarget();
    detach.push(controller.attach(target));
    target.hold.mockImplementation(() => controller.start(target, "hold"));
    chord("keydown", { ctrlKey: false, metaKey: true });
    vi.advanceTimersByTime(HOLD_MS);
    await flushPromises();
    engine.handlers!.onStart();

    chord("keyup", { key: "Meta" });

    expect(target.ends).toHaveLength(1);
  });

  it("ignores the chord while composing or on auto-repeat", () => {
    const target = fakeVoiceTarget();
    detach.push(controller.attach(target));
    chord("keydown", { isComposing: true });
    chord("keydown", { repeat: true });
    vi.advanceTimersByTime(HOLD_MS);
    expect(target.hold).not.toHaveBeenCalled();
  });

  it("does not start in a target that is not ready", () => {
    const target = fakeVoiceTarget();
    target.ready = false;
    detach.push(controller.attach(target));
    chord("keydown");
    vi.advanceTimersByTime(HOLD_MS);
    expect(target.hold).not.toHaveBeenCalled();
  });

  it("does not let a release stop a latched mic", async () => {
    const target = await listening();
    detach.push(controller.attach(target));
    chord("keyup");
    expect(target.ends).toEqual([]);
  });

  it("leaves no key listener behind after the last target detaches", () => {
    const target = fakeVoiceTarget();
    controller.attach(target)();
    chord("keydown");
    vi.advanceTimersByTime(HOLD_MS);
    expect(target.hold).not.toHaveBeenCalled();
  });
});
