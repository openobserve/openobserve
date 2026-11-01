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

import { vi } from "vitest";

import type {
  VoiceBrand,
  VoiceEngine,
  VoiceHandlers,
  VoiceListenOptions,
  VoiceMeter,
} from "@/components/ai-assistant/composer/voiceEngine";

export interface FakeVoiceEngine extends VoiceEngine {
  handlers: VoiceHandlers | null;
  options: VoiceListenOptions | null;
  meter: VoiceMeter & { db: number };
  abort: ReturnType<typeof vi.fn>;
  rejectMic: Error | null;
  /** Resolves the pending microphone prompt when `holdPrompt` was set. */
  grant: (() => void) | null;
  holdPrompt: boolean;
  isAvailable: boolean;
  fakeBrand: VoiceBrand;
  onDevice: boolean;
}

/** A scripted recogniser: a spec drives `handlers` by hand, as `99`'s `speech` knob does in a browser. */
export function fakeVoiceEngine(): FakeVoiceEngine {
  const fake: FakeVoiceEngine = {
    handlers: null,
    options: null,
    meter: { db: -90, read: () => fake.meter.db, close: vi.fn() },
    abort: vi.fn(),
    rejectMic: null,
    grant: null,
    holdPrompt: false,
    isAvailable: true,
    fakeBrand: "chrome",
    onDevice: false,
    available: () => fake.isAvailable,
    brand: () => fake.fakeBrand,
    canRunOnDevice: async () => fake.onDevice,
    openMeter: () =>
      new Promise((resolve, reject) => {
        if (fake.rejectMic) return reject(fake.rejectMic);
        if (fake.holdPrompt) fake.grant = () => resolve(fake.meter);
        else resolve(fake.meter);
      }),
    listen(options, handlers) {
      fake.options = options;
      fake.handlers = handlers;
      return { start: vi.fn(), abort: fake.abort };
    },
  };
  return fake;
}

/** Stands in for a textbox: the caret and draft a controller reads, and the ends it reports. */
export function fakeVoiceTarget(initial = "", id = Symbol("target")) {
  const target = {
    id,
    text: initial,
    caret: initial.length,
    writes: [] as string[],
    ends: [] as unknown[],
    ready: true,
    read: () => ({ text: target.text, caret: target.caret }),
    write(text: string) {
      target.text = text;
      target.writes.push(text);
    },
    ended(end: unknown) {
      target.ends.push(end);
    },
    holdReady: () => target.ready,
    hold: vi.fn(),
  };
  return target;
}
