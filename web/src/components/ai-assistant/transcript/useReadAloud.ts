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

import { getCurrentScope, onScopeDispose, ref, type Ref } from "vue";

export type ReadAloudState = "idle" | "playing" | "paused";

export interface ReadAloud {
  /** False where the browser has no speech synthesis; the button is not rendered. */
  supported: boolean;
  state: Ref<ReadAloudState>;
  /** Share of the text spoken so far, 0 to 100. */
  progress: Ref<number>;
  /** Idle starts, playing pauses, paused resumes. */
  toggle(): Promise<void>;
  stop(): void;
}

// Some engines stop a long utterance after about 15 s, so the text is spoken in sentence-sized chunks.
const MAX_CHUNK_CHARS = 220;

// One voice at a time across the page: starting an answer stops the one already reading.
let stopActive: (() => void) | null = null;

/** Sentence-sized chunks of `text`, each with the offset it starts at. */
export function speechChunks(text: string): { text: string; start: number }[] {
  const chunks: { text: string; start: number }[] = [];
  const pattern = /[^.!?\n]+[.!?]*\s*|\n+/g;
  let current = "";
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const piece = match[0];
    if (current && current.length + piece.length > MAX_CHUNK_CHARS) {
      if (current.trim()) chunks.push({ text: current, start });
      current = "";
    }
    if (!current) start = match.index ?? 0;
    current += piece;
  }
  if (current.trim()) chunks.push({ text: current, start });
  return chunks;
}

/** Reads an answer aloud with the browser's speech synthesis; `getText` is read on each start. */
export function useReadAloud(getText: () => string | Promise<string>): ReadAloud {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  const supported = !!synth && typeof window.SpeechSynthesisUtterance === "function";
  const state = ref<ReadAloudState>("idle");
  const progress = ref(0);
  let run = 0;

  const reset = () => {
    run += 1;
    state.value = "idle";
    progress.value = 0;
    if (stopActive === stop) stopActive = null;
  };

  function stop(): void {
    if (state.value === "idle") return;
    reset();
    synth?.cancel();
  }

  async function start(): Promise<void> {
    const text = (await getText()).trim();
    const chunks = speechChunks(text);
    if (!synth || !chunks.length) return;
    stopActive?.();
    synth.cancel();
    const mine = ++run;
    stopActive = stop;
    state.value = "playing";
    chunks.forEach((chunk, index) => {
      const utterance = new window.SpeechSynthesisUtterance(chunk.text);
      if (typeof document !== "undefined" && document.documentElement.lang)
        utterance.lang = document.documentElement.lang;
      utterance.onboundary = (event) => {
        if (run !== mine) return;
        progress.value = Math.min(100, ((chunk.start + event.charIndex) / text.length) * 100);
      };
      utterance.onend = () => {
        if (run !== mine) return;
        progress.value = Math.min(100, ((chunk.start + chunk.text.length) / text.length) * 100);
        if (index === chunks.length - 1) reset();
      };
      utterance.onerror = () => {
        if (run === mine) reset();
      };
      synth.speak(utterance);
    });
  }

  async function toggle(): Promise<void> {
    if (!supported || !synth) return;
    if (state.value === "playing") {
      synth.pause();
      state.value = "paused";
      return;
    }
    if (state.value === "paused") {
      synth.resume();
      state.value = "playing";
      return;
    }
    await start();
  }

  if (getCurrentScope()) onScopeDispose(stop);

  return { supported, state, progress, toggle, stop };
}
