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

import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";

import {
  markHintSeen,
  readHints,
  readVoiceOptIn,
  useAssistantCapability,
  useAssistantStore,
  watchPrefs,
  writeVoiceOptIn,
  type Sid,
} from "@/composables/assistant";
import { HOLD_MS } from "@/composables/assistant/shortcuts";
import { getIntlLocale } from "@/locales";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { isMacOS } from "@/utils/keyboardShortcuts";

import {
  createBrowserEngine,
  languageEndonym,
  serviceVendor,
  speechLang,
  type VoiceBrand,
  type VoiceEngine,
  type VoiceMeter,
  type VoiceResultItem,
  type VoiceSession,
} from "./voiceEngine";

export { HOLD_MS };

/** One dictation's limit (`40` §1.8.4). */
export const VOICE_LIMIT_MS = 120_000;

/** With zero results by then, the session is silent (B58). */
export const SILENCE_MS = 8_000;

/** Input above this level counts as speech for B58. */
export const SPEECH_LEVEL_DBFS = -50;

/** Total speech-level input that makes a silent session the browser's fault, not the room's (B58). */
export const SPEECH_TOTAL_MS = 1_000;

const TICK_MS = 100;

const ENTER_HINT_MS = 3_000;

const LEVEL_FLOOR_DBFS = -60;

const IDLE = { phase: "idle", owner: null, via: null, tail: "", elapsedMs: 0, level: 0 } as const;

// CJK script runs need no space between dictated phrases.
const UNSPACED_SCRIPT = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/;

const MIC_ERRORS: Record<string, VoiceErrorCode> = {
  NotAllowedError: "mic_denied",
  SecurityError: "mic_denied",
  NotFoundError: "no_mic",
};

const SENTENCE_KEYS: Record<NonNullable<VoiceBrand>, I18nKey> = {
  chrome: "assistant.voice.engine.google",
  edge: "assistant.voice.engine.microsoft",
  safari: "assistant.voice.engine.apple",
};

// One engine and one owner per tab: a second composer starting takes the microphone from the first.
let shared: VoiceController | null = null;
let engineOverride: VoiceEngine | null = null;

// Bumped on every opt-in write so a reader in this tab updates; `watchPrefs` only hears other tabs.
const optInWrites = ref(0);

/** Off, or the org's browser dictation; the server modes arrive with WP-49/50. */
export type VoiceMode = "off" | "browser";

/** What a text entry may offer: `silent` keeps a disabled mic rather than removing it mid-use (`40` §1.8.4). */
export type VoiceStatus = "off" | "unsupported" | "silent" | "ready";

/** `none` renders no mic; `crossed` is a reason a new press cannot help; `off` is an admin's Turn on. */
export type VoiceMic = "none" | "live" | "crossed" | "off";

export type VoicePhase = "idle" | "waiting" | "listening";

export type VoiceVia = "mic" | "hold";

export type VoiceStopReason = "mic" | "escape" | "enter" | "send" | "release" | "other";

export type VoiceErrorCode =
  | "mic_denied"
  | "no_mic"
  | "no_speech"
  | "stt_unavailable"
  | "service_unreachable"
  | "service_unreachable_generic"
  | "browser_silent"
  | "language_unsupported"
  | "time_limit";

export type VoiceEnd =
  | { kind: "stopped"; reason: VoiceStopReason; words: number }
  | { kind: "cancelled" }
  | { kind: "error"; code: VoiceErrorCode };

/** A text entry the controller can dictate into; `write` gets settled text only, so a tail never reaches a draft. */
export interface VoiceTarget {
  id: symbol;
  read(): { text: string; caret: number };
  write(text: string): void;
  ended(end: VoiceEnd): void;
  /** True while this entry is the one a hold should dictate into. */
  holdReady(): boolean;
  hold(): void;
  /** A press shorter than a hold. */
  tap(): void;
}

export interface VoiceState {
  phase: VoicePhase;
  owner: symbol | null;
  via: VoiceVia | null;
  /** The unsettled words, spaced for where they are shown; never in the draft. */
  tail: string;
  /** Where the next settled words land in the draft. */
  anchor: number;
  elapsedMs: number;
  /** 0–1, for the level bars only. */
  level: number;
  /** The last start was refused the microphone; the mic shows `dictateOff`. */
  denied: boolean;
  /** Tab memory: this browser exposes a recogniser that returns nothing (B58). */
  silent: boolean;
  /** Tab memory: this browser has no speech service for the UI language. */
  languageRefused: boolean;
  online: boolean;
  /** Runs on the device, so no vendor hears it and being offline is fine. */
  onDevice: boolean;
}

export interface VoiceController {
  state: VoiceState;
  engine: VoiceEngine;
  start(target: VoiceTarget, via: VoiceVia): Promise<void>;
  stop(reason: VoiceStopReason): void;
  /** The user typed: whatever the textbox showed is now theirs, and speech goes on from the caret. */
  noteEdit(caret: number): void;
  /** A caret moved inside the tail settles it as shown. */
  noteCaret(caret: number): void;
  setComposing(composing: boolean, caret: number): void;
  attach(target: VoiceTarget): () => void;
  /** Learns whether this language can run on the device; asked once per language. */
  probeOnDevice(lang: string): void;
}

export interface VoiceStatusReader {
  mode: ComputedRef<VoiceMode>;
  status: ComputedRef<VoiceStatus>;
  lang: ComputedRef<string>;
}

export interface VoiceAvailability extends VoiceStatusReader {
  /** The sentence that says where the audio goes, or null with no engine. */
  sentence: ComputedRef<I18nText | null>;
}

export interface VoiceComposerOptions {
  field(): HTMLTextAreaElement | null;
  /** The chat dictation writes to; it stays this chat for the whole dictation. */
  ensureSid(): Sid | null;
  draftOf(sid: Sid): string | null;
  writeDraft(sid: Sid, text: string): void;
  /** Hold is refused here: inert, not visible. */
  blocked(): boolean;
  /** A short press: takes focus to a pending request, if one waits. */
  tap(): void;
  /** True on a touch device below `md`, which uses the keyboard's own dictation key. */
  touch(): boolean;
  say(line: I18nText): void;
  focusField(): void;
}

export interface VoiceComposer {
  status: ComputedRef<VoiceStatus>;
  /** The mic renders. */
  show: ComputedRef<boolean>;
  mic: ComputedRef<VoiceMic>;
  /** Mic off for now, but still there. */
  offline: ComputedRef<boolean>;
  mine: ComputedRef<boolean>;
  listening: ComputedRef<boolean>;
  waiting: ComputedRef<boolean>;
  denied: ComputedRef<boolean>;
  helperLine: ComputedRef<I18nText | null>;
  /** The helper line reports a failure, not a state. */
  failure: ComputedRef<boolean>;
  action: ComputedRef<"retry" | "how" | null>;
  elapsedMs: ComputedRef<number>;
  level: ComputedRef<number>;
  rowLabel: ComputedRef<I18nText>;
  tail: ComputedRef<string>;
  anchor: ComputedRef<number>;
  /** The textbox's value: the draft with the tail shown in place. */
  shown(text: string): string;
  primerOpen: Ref<boolean>;
  sentence: ComputedRef<I18nText | null>;
  /** Saves the opt-in, which makes the mic live in place. */
  turnOn(): void;
  press(via: VoiceVia): void;
  acceptPrimer(): void;
  declinePrimer(): void;
  retry(): void;
  stop(reason: VoiceStopReason): void;
  noteEdit(caret: number): void;
  noteCaret(caret: number): void;
  setComposing(composing: boolean, caret: number): void;
  clearHint(): void;
}

interface VoiceRun {
  target: VoiceTarget;
  lang: string;
  meter: VoiceMeter | null;
  session: VoiceSession | null;
  timer: ReturnType<typeof setInterval> | null;
  /** Segments below this index are settled or dropped; their later revisions are ignored. */
  watermark: number;
  seen: number;
  results: number;
  speechMs: number;
  words: number;
  buffer: VoiceResultItem[];
}

/** The tab's one controller; a spec swaps its engine with `resetVoiceForTests`. */
export function voiceController(): VoiceController {
  shared ??= createVoiceController(engineOverride ?? createBrowserEngine());
  return shared;
}

/** Lets a spec start from no owner, with a fake engine; never called by app code. */
export function resetVoiceForTests(engine: VoiceEngine | null = null): void {
  shared?.stop("other");
  shared = null;
  engineOverride = engine;
}

export function createVoiceController(engine: VoiceEngine): VoiceController {
  const state = reactive<VoiceState>({
    phase: "idle",
    owner: null,
    via: null,
    tail: "",
    anchor: 0,
    elapsedMs: 0,
    level: 0,
    denied: false,
    silent: false,
    languageRefused: false,
    online: typeof navigator === "undefined" || navigator.onLine !== false,
    onDevice: false,
  });
  const targets = new Set<VoiceTarget>();
  const probed = new Set<string>();
  let run: VoiceRun | null = null;
  let composing = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holding = false;

  function insert(current: VoiceRun, piece: string): void {
    const clean = piece.trim();
    if (!clean) return;
    const { text } = current.target.read();
    const at = Math.min(state.anchor, text.length);
    const before = text.slice(0, at);
    const joined = before + separator(before, clean) + clean;
    state.anchor = joined.length;
    current.words += countWords(clean, current.lang);
    current.target.write(joined + text.slice(at));
  }

  function settleTail(current: VoiceRun): void {
    const tail = state.tail;
    state.tail = "";
    insert(current, tail);
  }

  function applyResults(current: VoiceRun, items: VoiceResultItem[]): void {
    let tail = "";
    for (const item of items) {
      if (item.index < current.watermark) continue;
      current.seen = Math.max(current.seen, item.index + 1);
      if (!item.final) {
        tail += item.text;
        continue;
      }
      insert(current, item.text);
      current.watermark = item.index + 1;
    }
    const text = current.target.read().text;
    const before = text.slice(0, Math.min(state.anchor, text.length));
    state.tail = tail.trim() ? separator(before, tail.trim()) + tail.trim() : "";
  }

  function finish(current: VoiceRun, end: VoiceEnd): void {
    run = null;
    composing = false;
    if (current.timer) clearInterval(current.timer);
    current.meter?.close();
    current.session?.abort();
    if (end.kind !== "cancelled") {
      for (const item of current.buffer) if (item.final) insert(current, item.text);
      settleTail(current);
    }
    Object.assign(state, IDLE);
    current.target.ended(end.kind === "stopped" ? { ...end, words: current.words } : end);
  }

  function fail(current: VoiceRun, code: VoiceErrorCode): void {
    if (code === "mic_denied") state.denied = true;
    if (code === "language_unsupported") state.languageRefused = true;
    finish(current, { kind: "error", code });
  }

  // A session with nothing heard: speech-level input means the browser's service is silent (B58).
  function failSilent(current: VoiceRun): void {
    if (current.speechMs < SPEECH_TOTAL_MS) return fail(current, "no_speech");
    state.silent = true;
    fail(current, "browser_silent");
  }

  function tick(current: VoiceRun): void {
    state.elapsedMs += TICK_MS;
    const db = current.meter?.read() ?? -Infinity;
    if (db > SPEECH_LEVEL_DBFS) current.speechMs += TICK_MS;
    state.level = Math.max(0, Math.min(1, (db - LEVEL_FLOOR_DBFS) / -LEVEL_FLOOR_DBFS));
    if (state.elapsedMs >= VOICE_LIMIT_MS) return fail(current, "time_limit");
    if (current.results === 0 && state.elapsedMs >= SILENCE_MS) failSilent(current);
  }

  function onError(current: VoiceRun, code: string): void {
    if (code === "aborted") return;
    if (current.results > 0) return fail(current, "stt_unavailable");
    if (code === "not-allowed") return fail(current, "mic_denied");
    if (code === "audio-capture") return fail(current, "no_mic");
    if (code === "language-not-supported") return fail(current, "language_unsupported");
    if (code === "network" || code === "service-not-allowed") {
      return fail(current, unreachableCode(engine));
    }
    failSilent(current);
  }

  function listen(current: VoiceRun): void {
    const live = () => run === current;
    current.session = engine.listen(
      { lang: current.lang, onDevice: state.onDevice },
      {
        onStart() {
          if (!live()) return;
          state.phase = "listening";
          state.denied = false;
          current.timer = setInterval(() => tick(current), TICK_MS);
        },
        onResults(items) {
          if (!live()) return;
          current.results += 1;
          if (composing) current.buffer.push(...items);
          else applyResults(current, items);
        },
        onError(code) {
          if (live()) onError(current, code);
        },
        onEnd() {
          if (!live()) return;
          if (current.results > 0) fail(current, "stt_unavailable");
          else failSilent(current);
        },
      },
    );
    try {
      current.session.start();
    } catch {
      fail(current, unreachableCode(engine));
    }
  }

  async function start(target: VoiceTarget, via: VoiceVia): Promise<void> {
    stop("other");
    const lang = speechLang(getIntlLocale());
    const current: VoiceRun = {
      target,
      lang,
      meter: null,
      session: null,
      timer: null,
      watermark: 0,
      seen: 0,
      results: 0,
      speechMs: 0,
      words: 0,
      buffer: [],
    };
    run = current;
    const anchor = target.read().caret;
    Object.assign(state, { phase: "waiting", owner: target.id, via, tail: "", anchor });
    try {
      const meter = await engine.openMeter();
      if (run !== current) return meter?.close();
      current.meter = meter;
    } catch (error) {
      if (run !== current) return;
      const code = MIC_ERRORS[(error as { name?: string })?.name ?? ""];
      if (code) return fail(current, code);
    }
    listen(current);
  }

  function stop(reason: VoiceStopReason): void {
    if (!run) return;
    const cancelled = state.phase === "waiting";
    finish(run, cancelled ? { kind: "cancelled" } : { kind: "stopped", reason, words: 0 });
  }

  function noteEdit(caret: number): void {
    if (!run) return;
    run.words += countWords(state.tail, run.lang);
    state.tail = "";
    run.watermark = run.seen;
    state.anchor = caret;
  }

  function noteCaret(caret: number): void {
    if (!run || !state.tail) return;
    if (caret <= state.anchor || caret >= state.anchor + state.tail.length) return;
    settleTail(run);
    run.watermark = run.seen;
    state.anchor = caret;
  }

  function setComposing(next: boolean, caret: number): void {
    composing = next;
    if (next) return noteEdit(caret);
    if (!run) return;
    state.anchor = caret;
    const buffered = run.buffer;
    run.buffer = [];
    if (buffered.length > 0) applyResults(run, buffered);
  }

  function clearHold(): void {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  }

  function fireHold(): void {
    holdTimer = null;
    const target = [...targets].find((candidate) => candidate.holdReady());
    if (!target) return;
    holding = true;
    target.hold();
  }

  function releaseHold(): void {
    const tapped = holdTimer !== null;
    clearHold();
    if (holding && state.via === "hold") stop("release");
    holding = false;
    if (tapped) for (const target of targets) target.tap();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key.toLowerCase() !== "i" || event.shiftKey || event.altKey) return;
    if (!(isMacOS() ? event.metaKey : event.ctrlKey)) return;
    if (event.repeat || event.isComposing || event.keyCode === 229) return;
    clearHold();
    holdTimer = setTimeout(fireHold, HOLD_MS);
  }

  function onKeyup(event: KeyboardEvent): void {
    if (["i", "control", "meta"].includes(event.key.toLowerCase())) releaseHold();
  }

  function onWindowLeft(): void {
    releaseHold();
    if (state.phase === "listening") stop("other");
  }

  function onVisibility(): void {
    if (document.visibilityState === "hidden") onWindowLeft();
  }

  function onConnectivity(): void {
    state.online = navigator.onLine !== false;
  }

  function listenWindow(on: boolean): void {
    const method = on ? "addEventListener" : "removeEventListener";
    document[method]("keydown", onKeydown as EventListener, true);
    document[method]("keyup", onKeyup as EventListener, true);
    document[method]("visibilitychange", onVisibility);
    window[method]("blur", onWindowLeft);
    window[method]("online", onConnectivity);
    window[method]("offline", onConnectivity);
  }

  function attach(target: VoiceTarget): () => void {
    if (targets.size === 0) listenWindow(true);
    targets.add(target);
    return () => {
      if (state.owner === target.id) stop("other");
      targets.delete(target);
      if (targets.size === 0) listenWindow(false);
    };
  }

  function probeOnDevice(lang: string): void {
    if (probed.has(lang)) return;
    probed.add(lang);
    void engine.canRunOnDevice(lang).then((onDevice) => (state.onDevice = onDevice));
  }

  return {
    state,
    engine,
    start,
    stop,
    noteEdit,
    noteCaret,
    setComposing,
    attach,
    probeOnDevice,
  };
}

/** Whether this user can dictate here; safe outside a component, unlike the sentence's translator. */
export function useVoiceStatus(): VoiceStatusReader {
  const store = useAssistantStore();
  const capability = useAssistantCapability();
  const controller = voiceController();
  const lang = computed(() => speechLang(getIntlLocale()));
  const mode = computed<VoiceMode>(() => {
    if (capability.value.edition === "cloud") return "browser";
    void optInWrites.value;
    const key = store.state.userOrgKey;
    return key && readVoiceOptIn(key) ? "browser" : "off";
  });
  const status = computed<VoiceStatus>(() => {
    if (mode.value === "off") return "off";
    if (controller.state.silent) return "silent";
    return controller.engine.available() ? "ready" : "unsupported";
  });

  watch(
    () => store.state.userOrgKey,
    (key, _, onCleanup) => {
      if (key) onCleanup(watchPrefs(key, (name) => name === "voice" && optInWrites.value++));
    },
    { immediate: true },
  );
  watch(
    [status, lang],
    ([current, tag]) => {
      if (current === "ready") controller.probeOnDevice(tag);
    },
    { immediate: true },
  );
  return { mode, status, lang };
}

/** `useVoiceStatus` plus the sentence that says where the audio goes. */
export function useVoiceAvailability(): VoiceAvailability {
  const { t } = useI18nTyped();
  const reader = useVoiceStatus();
  const controller = voiceController();
  const sentence = computed(() => {
    if (reader.status.value !== "ready" && reader.status.value !== "silent") return null;
    if (controller.state.onDevice) return t("assistant.voice.engine.device");
    const brand = controller.engine.brand();
    return t(brand ? SENTENCE_KEYS[brand] : "assistant.voice.engine.vendor");
  });
  return { ...reader, sentence };
}

/** Saves the self-hosted browser opt-in and updates every reader in this tab. */
export function setVoiceOptIn(userOrgKey: string, on: boolean): void {
  writeVoiceOptIn(userOrgKey, on);
  optInWrites.value++;
}

/** The hold keys as the row and the tooltip spell them. */
export function holdKeys(): string {
  return isMacOS() ? "⌘ I" : "Ctrl I";
}

/** One composer's view of the tab's dictation. */
export function useAssistantVoice(options: VoiceComposerOptions): VoiceComposer {
  const { t } = useI18nTyped();
  const store = useAssistantStore();
  const capability = useAssistantCapability();
  const availability = useVoiceAvailability();
  const controller = voiceController();
  const state = controller.state;
  const id = Symbol("assistantComposerVoice");
  const primerOpen = ref(false);
  const lastError = ref<VoiceErrorCode | null>(null);
  const enterHint = ref(false);
  let pendingVia: VoiceVia = "mic";
  let composingHere = false;
  let sid: Sid | null = null;
  let enterTimer: ReturnType<typeof setTimeout> | null = null;

  const mine = computed(() => state.owner === id);
  const listening = computed(() => mine.value && state.phase === "listening");
  const waiting = computed(() => mine.value && state.phase === "waiting");
  const status = availability.status;
  const offline = computed(() => !state.online && !state.onDevice);
  const mic = computed<VoiceMic>(() => {
    if (options.touch() || status.value === "unsupported") return "none";
    if (status.value === "off") return capability.value.isAdmin ? "off" : "none";
    const unavailable =
      status.value === "silent" || state.denied || state.languageRefused || offline.value;
    return unavailable && !mine.value ? "crossed" : "live";
  });
  const show = computed(() => mic.value !== "none");
  const brand = () => controller.engine.brand();

  const languageLine = computed(() =>
    t("assistant.voice.language", { language: raw(languageEndonym(getIntlLocale())) }),
  );

  const errorLine = computed<I18nText | null>(() => {
    const code = lastError.value;
    if (!code) return null;
    if (code === "service_unreachable")
      return t("assistant.voice.error.service_unreachable", {
        vendor: raw(serviceVendor(brand() ?? "chrome")),
      });
    if (code === "language_unsupported") return languageLine.value;
    if (code === "browser_silent") return t("assistant.voice.silent");
    return t(`assistant.voice.error.${code}`);
  });

  // A reason a new press cannot help outlives the edit that clears a one-off error.
  const stuckLine = computed<I18nText | null>(() => {
    if (status.value === "silent") return t("assistant.voice.silent");
    if (state.denied) return t("assistant.voice.error.mic_denied");
    return state.languageRefused ? languageLine.value : null;
  });

  const helperLine = computed<I18nText | null>(() => {
    if (enterHint.value) return t("assistant.voice.enterToSend");
    return stuckLine.value ?? errorLine.value;
  });

  const failure = computed(
    () =>
      helperLine.value !== null &&
      !enterHint.value &&
      (state.denied || !!lastError.value?.startsWith("service_unreachable")),
  );

  const action = computed(() => {
    if (enterHint.value) return null;
    if (state.denied) return "how";
    return lastError.value?.startsWith("service_unreachable") ? "retry" : null;
  });

  const rowLabel = computed(() =>
    state.via === "hold"
      ? t("assistant.voice.holdLine", { keys: raw(holdKeys()) })
      : t("assistant.voice.listening"),
  );

  function clearHint(): void {
    enterHint.value = false;
    if (enterTimer) clearTimeout(enterTimer);
    enterTimer = null;
  }

  function ended(end: VoiceEnd): void {
    sid = null;
    if (end.kind === "cancelled") return options.say(t("assistant.voice.cancelled"));
    if (end.kind === "error") {
      lastError.value = end.code;
      return options.say(errorLine.value!);
    }
    const count = end.words;
    if (end.reason !== "enter") return options.say(t("assistant.voice.stopped", { count }, count));
    enterHint.value = true;
    enterTimer = setTimeout(clearHint, ENTER_HINT_MS);
    options.say(t("assistant.voice.stoppedEnter", { count }, count));
  }

  const target: VoiceTarget = {
    id,
    read() {
      const field = options.field();
      const text = (sid && options.draftOf(sid)) ?? "";
      return { text, caret: field?.selectionStart ?? text.length };
    },
    write(text) {
      if (sid) options.writeDraft(sid, text);
    },
    ended,
    holdReady: () =>
      mic.value === "live" &&
      !options.blocked() &&
      !composingHere &&
      document.activeElement === options.field(),
    hold: () => press("hold"),
    tap: options.tap,
  };

  function begin(via: VoiceVia): void {
    sid = options.ensureSid();
    if (!sid) return;
    clearHint();
    lastError.value = null;
    void controller.start(target, via);
  }

  function press(via: VoiceVia): void {
    if (mine.value) return controller.stop("mic");
    if (mic.value !== "live" || composingHere) return;
    const key = store.state.userOrgKey;
    if (key && readHints(key).dictate) return begin(via);
    pendingVia = via;
    primerOpen.value = true;
  }

  function acceptPrimer(): void {
    const key = store.state.userOrgKey;
    if (key) markHintSeen(key, "dictate");
    primerOpen.value = false;
    begin(pendingVia);
  }

  function declinePrimer(): void {
    primerOpen.value = false;
    options.focusField();
  }

  function turnOn(): void {
    const key = store.state.userOrgKey;
    if (key) setVoiceOptIn(key, true);
  }

  function stopMine(reason: VoiceStopReason): void {
    if (mine.value) controller.stop(reason);
  }

  function noteEdit(caret: number): void {
    lastError.value = null;
    if (mine.value) controller.noteEdit(caret);
  }

  function noteCaret(caret: number): void {
    if (mine.value) controller.noteCaret(caret);
  }

  function setComposing(composing: boolean, caret: number): void {
    composingHere = composing;
    if (mine.value) controller.setComposing(composing, caret);
  }

  watch(waiting, (now) => now && options.say(t("assistant.voice.waitingPermission")));
  watch(listening, (now) => now && options.say(t("assistant.voice.started")));

  let detach: (() => void) | null = null;
  onMounted(() => (detach = controller.attach(target)));
  onBeforeUnmount(() => {
    detach?.();
    clearHint();
  });

  return {
    status,
    show,
    mic,
    offline,
    mine,
    listening,
    waiting,
    denied: computed(() => state.denied),
    helperLine,
    failure,
    action,
    elapsedMs: computed(() => state.elapsedMs),
    level: computed(() => state.level),
    rowLabel,
    tail: computed(() => (mine.value ? state.tail : "")),
    anchor: computed(() => state.anchor),
    shown(text) {
      if (!mine.value || !state.tail) return text;
      const at = Math.min(state.anchor, text.length);
      return text.slice(0, at) + state.tail + text.slice(at);
    },
    primerOpen,
    sentence: availability.sentence,
    turnOn,
    press,
    acceptPrimer,
    declinePrimer,
    retry: () => press("mic"),
    stop: stopMine,
    noteEdit,
    noteCaret,
    setComposing,
    clearHint,
  };
}

function unreachableCode(engine: VoiceEngine): VoiceErrorCode {
  return engine.brand() ? "service_unreachable" : "service_unreachable_generic";
}

function separator(before: string, piece: string): string {
  if (!before || /\s$/.test(before)) return "";
  return UNSPACED_SCRIPT.test(piece[0]) ? "" : " ";
}

function countWords(text: string, lang: string): number {
  if (!text.trim()) return 0;
  if (typeof Intl.Segmenter === "undefined") return text.trim().split(/\s+/).length;
  const words = new Intl.Segmenter(lang, { granularity: "word" }).segment(text);
  return Array.from(words).filter((segment) => segment.isWordLike).length;
}
