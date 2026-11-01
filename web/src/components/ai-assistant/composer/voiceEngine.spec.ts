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

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBrowserEngine,
  detectBrand,
  languageEndonym,
  serviceVendor,
  speechLang,
} from "./voiceEngine";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

class FakeRecogniser {
  static latest: FakeRecogniser;
  static available = vi.fn(async () => "available");
  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 0;
  processLocally = false;
  onstart: (() => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecogniser.latest = this;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as any).SpeechRecognition;
  delete (window as any).webkitSpeechRecognition;
  delete (navigator as any).brave;
});

describe("speechLang", () => {
  it.each([
    ["en-US", "en-US"],
    ["ar-SA", "ar-SA"],
    ["zh-CN", "cmn-Hans-CN"],
    ["zh-TW", "cmn-Hant-TW"],
  ])("maps %s to %s", (locale, lang) => {
    expect(speechLang(locale)).toBe(lang);
  });
});

describe("detectBrand", () => {
  it.each([
    [{ userAgent: CHROME_UA }, "chrome"],
    [{ userAgent: `${CHROME_UA} Edg/130.0` }, "edge"],
    [{ userAgent: `${CHROME_UA} OPR/110.0` }, null],
    [{ userAgent: `${CHROME_UA} Vivaldi/6.0` }, null],
    [{ userAgent: "Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15" }, "safari"],
    [{ userAgent: "Mozilla/5.0 Firefox/130.0" }, null],
  ])("reads %j", (nav, brand) => {
    expect(detectBrand(nav)).toBe(brand);
  });

  it("prefers client hints and names only the exact brands", () => {
    const hints = (brand: string) => ({
      userAgent: CHROME_UA,
      userAgentData: { brands: [{ brand: "Chromium" }, { brand }] },
    });
    expect(detectBrand(hints("Google Chrome"))).toBe("chrome");
    expect(detectBrand(hints("Microsoft Edge"))).toBe("edge");
    expect(detectBrand(hints("Opera"))).toBeNull();
  });
});

describe("vendor copy helpers", () => {
  it("names the company behind a brand", () => {
    expect(serviceVendor("safari")).toBe("Apple");
  });

  it("writes a language in itself", () => {
    expect(languageEndonym("vi-VN")).toMatch(/Tiếng Việt/i);
  });
});

describe("createBrowserEngine", () => {
  it("is unavailable without a recogniser", () => {
    expect(createBrowserEngine().available()).toBe(false);
  });

  it("accepts the prefixed class and skips Brave", () => {
    (window as any).webkitSpeechRecognition = FakeRecogniser;
    expect(createBrowserEngine().available()).toBe(true);
    (navigator as any).brave = {};
    expect(createBrowserEngine().available()).toBe(false);
  });

  it("configures the recogniser for continuous interim results", () => {
    (window as any).SpeechRecognition = FakeRecogniser;
    const session = createBrowserEngine().listen(
      { lang: "de-DE", onDevice: true },
      { onStart: vi.fn(), onResults: vi.fn(), onError: vi.fn(), onEnd: vi.fn() },
    );
    const recogniser = FakeRecogniser.latest;
    expect(recogniser).toMatchObject({
      continuous: true,
      interimResults: true,
      lang: "de-DE",
      maxAlternatives: 1,
      processLocally: true,
    });
    session.start();
    expect(recogniser.start).toHaveBeenCalled();
    session.abort();
    expect(recogniser.abort).toHaveBeenCalled();
  });

  it("reads results from resultIndex on and skips empty transcripts", () => {
    (window as any).SpeechRecognition = FakeRecogniser;
    const onResults = vi.fn();
    createBrowserEngine().listen(
      { lang: "en-US", onDevice: false },
      { onStart: vi.fn(), onResults, onError: vi.fn(), onEnd: vi.fn() },
    );
    FakeRecogniser.latest.onresult!({
      resultIndex: 1,
      results: [
        { isFinal: true, 0: { transcript: "old" } },
        { isFinal: true, 0: { transcript: "new" } },
        { isFinal: false, 0: { transcript: "" } },
        { isFinal: false, 0: { transcript: "tail" } },
      ],
    });
    expect(onResults).toHaveBeenCalledWith([
      { index: 1, text: "new", final: true },
      { index: 3, text: "tail", final: false },
    ]);
  });

  it("asks the browser whether a language runs on the device, and takes a throw as no", async () => {
    (window as any).SpeechRecognition = FakeRecogniser;
    await expect(createBrowserEngine().canRunOnDevice("en-US")).resolves.toBe(true);
    FakeRecogniser.available.mockRejectedValueOnce(new Error("nope"));
    await expect(createBrowserEngine().canRunOnDevice("en-US")).resolves.toBe(false);
  });

  it("releases the microphone when it closes the meter", async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] };
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: CHROME_UA,
      mediaDevices: { getUserMedia: vi.fn(async () => stream) },
    });
    const close = vi.fn(async () => undefined);
    vi.stubGlobal(
      "AudioContext",
      class {
        createAnalyser = () => ({
          fftSize: 2,
          getFloatTimeDomainData: (frame: Float32Array) => frame.fill(0.1),
        });
        createMediaStreamSource = () => ({ connect: vi.fn() });
        close = close;
      },
    );
    const meter = await createBrowserEngine().openMeter();
    expect(meter!.read()).toBeCloseTo(-20, 0);
    meter!.close();
    expect(stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("has no level source without getUserMedia", async () => {
    vi.stubGlobal("navigator", { userAgent: CHROME_UA });
    await expect(createBrowserEngine().openMeter()).resolves.toBeNull();
  });
});
