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

/** The browser brands whose speech service may be named; every other brand stays unnamed (`40` §1.8.5). */
export type VoiceBrand = "chrome" | "edge" | "safari" | null;

/** One recogniser segment; a later result with the same `index` revises it until it is `final`. */
export interface VoiceResultItem {
  index: number;
  text: string;
  final: boolean;
}

export interface VoiceHandlers {
  onStart(): void;
  onResults(items: VoiceResultItem[]): void;
  onError(code: string): void;
  onEnd(): void;
}

export interface VoiceSession {
  start(): void;
  abort(): void;
}

/** The level source; it never records, and closing it releases the microphone. */
export interface VoiceMeter {
  /** RMS of the current frame in dBFS. */
  read(): number;
  close(): void;
}

export interface VoiceListenOptions {
  lang: string;
  onDevice: boolean;
}

/** The speech source the voice controller runs on; specs inject a fake (`99` knob `speech`). */
export interface VoiceEngine {
  available(): boolean;
  brand(): VoiceBrand;
  canRunOnDevice(lang: string): Promise<boolean>;
  /** Opens the microphone; a rejection carries the `getUserMedia` error, `null` means no level source. */
  openMeter(): Promise<VoiceMeter | null>;
  listen(options: VoiceListenOptions, handlers: VoiceHandlers): VoiceSession;
}

interface BrowserResult {
  isFinal: boolean;
  0?: { transcript: string };
}

interface BrowserResultEvent {
  resultIndex: number;
  results: ArrayLike<BrowserResult>;
}

interface BrowserRecogniser {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  processLocally?: boolean;
  onstart: (() => void) | null;
  onresult: ((event: BrowserResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

interface BrowserRecogniserClass {
  new (): BrowserRecogniser;
  available?(options: { langs: string[]; processLocally: boolean }): Promise<string>;
}

interface SpeechWindow {
  SpeechRecognition?: BrowserRecogniserClass;
  webkitSpeechRecognition?: BrowserRecogniserClass;
}

interface BrandNavigator {
  brave?: unknown;
  userAgentData?: { brands?: { brand: string }[] };
  userAgent: string;
}

const CLOUD_BRAND_OUTLIERS = /OPR\/|Vivaldi|SamsungBrowser|YaBrowser|Brave/;

const SPEECH_TAGS: Record<string, string> = {
  "zh-CN": "cmn-Hans-CN",
  "zh-TW": "cmn-Hant-TW",
};

const SERVICE_VENDORS: Record<NonNullable<VoiceBrand>, string> = {
  chrome: "Google",
  edge: "Microsoft",
  safari: "Apple",
};

/** The `lang` a browser recogniser takes for a UI locale (`40` §1.8.5). */
export function speechLang(localeTag: string): string {
  return SPEECH_TAGS[localeTag] ?? localeTag;
}

/** The company whose speech service a brand uses, for `service_unreachable`. */
export function serviceVendor(brand: NonNullable<VoiceBrand>): string {
  return SERVICE_VENDORS[brand];
}

/** The locale's name in its own language ("Tiếng Việt"). */
export function languageEndonym(localeTag: string): string {
  try {
    return new Intl.DisplayNames([localeTag], { type: "language" }).of(localeTag) ?? localeTag;
  } catch {
    return localeTag;
  }
}

/** A best guess at the vendor's service from the exact brand, never an attestation. */
export function detectBrand(nav: BrandNavigator): VoiceBrand {
  const brands = nav.userAgentData?.brands?.map((entry) => entry.brand);
  if (brands?.length) {
    if (brands.includes("Microsoft Edge")) return "edge";
    return brands.includes("Google Chrome") ? "chrome" : null;
  }
  const agent = nav.userAgent;
  if (/Edg(e|A|iOS)?\//.test(agent)) return "edge";
  if (CLOUD_BRAND_OUTLIERS.test(agent)) return null;
  if (/Chrome\/|CriOS\//.test(agent)) return "chrome";
  return /Version\/.*Safari\//.test(agent) ? "safari" : null;
}

/** The one engine this build ships: the browser's own Web Speech recogniser. */
export function createBrowserEngine(): VoiceEngine {
  return {
    available: () => !!recogniserClass() && !(navigator as BrandNavigator).brave,
    brand: () => detectBrand(navigator as BrandNavigator),
    canRunOnDevice,
    openMeter,
    listen(options, handlers) {
      const Recogniser = recogniserClass();
      if (!Recogniser) throw new Error("SpeechRecognition is not available");
      return wire(new Recogniser(), options, handlers);
    },
  };
}

function recogniserClass(): BrowserRecogniserClass | null {
  if (typeof window === "undefined") return null;
  const speech = window as unknown as SpeechWindow;
  return speech.SpeechRecognition ?? speech.webkitSpeechRecognition ?? null;
}

async function canRunOnDevice(lang: string): Promise<boolean> {
  try {
    const status = await recogniserClass()?.available?.({ langs: [lang], processLocally: true });
    return status === "available";
  } catch {
    return false;
  }
}

function wire(
  recogniser: BrowserRecogniser,
  options: VoiceListenOptions,
  handlers: VoiceHandlers,
): VoiceSession {
  recogniser.continuous = true;
  recogniser.interimResults = true;
  recogniser.lang = options.lang;
  recogniser.maxAlternatives = 1;
  if (options.onDevice) recogniser.processLocally = true;
  recogniser.onstart = handlers.onStart;
  recogniser.onresult = (event) => handlers.onResults(resultItems(event));
  recogniser.onerror = (event) => handlers.onError(event.error);
  recogniser.onend = handlers.onEnd;
  return { start: () => recogniser.start(), abort: () => recogniser.abort() };
}

function resultItems(event: BrowserResultEvent): VoiceResultItem[] {
  const items: VoiceResultItem[] = [];
  for (let index = event.resultIndex; index < event.results.length; index++) {
    const result = event.results[index];
    const text = result[0]?.transcript ?? "";
    if (text) items.push({ index, text, final: result.isFinal });
  }
  return items;
}

async function openMeter(): Promise<VoiceMeter | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  if (typeof AudioContext === "undefined") {
    release();
    return null;
  }
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  context.createMediaStreamSource(stream).connect(analyser);
  const frame = new Float32Array(analyser.fftSize);
  return {
    read() {
      analyser.getFloatTimeDomainData(frame);
      const power = frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length;
      return 10 * Math.log10(power);
    },
    close() {
      release();
      void context.close();
    },
  };
}
