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
import { ref } from "vue";

import { useTypewriter } from "./useTypewriter";

import type { TranslateFn } from "@/types/i18n";

const t = ((key: string) => key) as unknown as TranslateFn;

// rAF + setTimeout are both faked, so one typewriter tick is two timers deep.
const tick = () => {
  vi.advanceTimersToNextTimer();
  vi.advanceTimersToNextTimer();
};

const make = (segment = "") => {
  const currentTextSegment = ref(segment);
  return { currentTextSegment, tw: useTypewriter(currentTextSegment, t) };
};

describe("useTypewriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("analyzing rotation", () => {
    it("starts on one of the twenty analyzing messages", () => {
      const { tw } = make();
      expect(tw.currentAnalyzingMessage.value).toBe(
        "aiAssistant.aiChat.analyzingMessages.analyzing",
      );
      tw.startAnalyzingRotation();
      expect(String(tw.currentAnalyzingMessage.value)).toMatch(
        /^aiAssistant\.aiChat\.analyzingMessages\./,
      );
      tw.stopAnalyzingRotation();
    });

    it("rotates every 5000ms and stops on demand", () => {
      const { tw } = make();
      const random = vi.spyOn(Math, "random");
      random.mockReturnValue(0);
      tw.startAnalyzingRotation();
      expect(tw.currentAnalyzingMessage.value).toBe(
        "aiAssistant.aiChat.analyzingMessages.analyzing",
      );

      random.mockReturnValue(0.5);
      vi.advanceTimersByTime(5000);
      expect(tw.currentAnalyzingMessage.value).toBe(
        "aiAssistant.aiChat.analyzingMessages.workingOnIt",
      );

      tw.stopAnalyzingRotation();
      random.mockReturnValue(0);
      vi.advanceTimersByTime(20000);
      expect(tw.currentAnalyzingMessage.value).toBe(
        "aiAssistant.aiChat.analyzingMessages.workingOnIt",
      );
    });

    it("does not throw when stopped without being started", () => {
      const { tw } = make();
      expect(() => tw.stopAnalyzingRotation()).not.toThrow();
    });
  });

  describe("animateTitle", () => {
    it("reveals one character every 30ms and clears isTypingTitle at the end", () => {
      const { tw } = make();
      tw.animateTitle("abc");
      expect(tw.isTypingTitle.value).toBe(true);
      expect(tw.displayedTitle.value).toBe("");

      vi.advanceTimersByTime(30);
      expect(tw.displayedTitle.value).toBe("a");
      vi.advanceTimersByTime(60);
      expect(tw.displayedTitle.value).toBe("abc");
      expect(tw.isTypingTitle.value).toBe(true);

      vi.advanceTimersByTime(30);
      expect(tw.isTypingTitle.value).toBe(false);
      expect(tw.displayedTitle.value).toBe("abc");
    });

    it("supersedes an in-flight animation rather than interleaving it", () => {
      const { tw } = make();
      tw.animateTitle("aaaaa");
      vi.advanceTimersByTime(60);
      expect(tw.displayedTitle.value).toBe("aa");

      tw.animateTitle("zz");
      expect(tw.displayedTitle.value).toBe("");
      vi.advanceTimersByTime(60);
      expect(tw.displayedTitle.value).toBe("zz");
      vi.advanceTimersByTime(300);
      expect(tw.displayedTitle.value).toBe("zz");
    });

    it("handles an empty title by finishing on the first tick", () => {
      const { tw } = make();
      tw.animateTitle("");
      vi.advanceTimersByTime(30);
      expect(tw.displayedTitle.value).toBe("");
      expect(tw.isTypingTitle.value).toBe(false);
    });
  });

  describe("resetTitleState", () => {
    it("clears the title and cancels an in-flight animation", () => {
      const { tw } = make();
      tw.aiGeneratedTitle.value = "generated";
      tw.animateTitle("hello world");
      vi.advanceTimersByTime(90);
      expect(tw.displayedTitle.value).toBe("hel");

      tw.resetTitleState();
      expect(tw.aiGeneratedTitle.value).toBeNull();
      expect(tw.displayedTitle.value).toBe("");
      expect(tw.isTypingTitle.value).toBe(false);

      vi.advanceTimersByTime(600);
      expect(tw.displayedTitle.value).toBe("");
    });
  });

  describe("clearTitleInterval", () => {
    it("stops the interval but leaves the already-revealed title alone", () => {
      const { tw } = make();
      tw.animateTitle("hello");
      vi.advanceTimersByTime(60);
      expect(tw.displayedTitle.value).toBe("he");

      tw.clearTitleInterval();
      vi.advanceTimersByTime(300);
      expect(tw.displayedTitle.value).toBe("he");
      expect(tw.isTypingTitle.value).toBe(true);
    });
  });

  describe("resetTypewriterState", () => {
    it("empties the displayed content and cancels the scheduled frame", () => {
      const { currentTextSegment, tw } = make("abcdef");
      const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
      tw.animateStreamingText();
      expect(tw.displayedStreamingContent.value).toBe("a");
      expect(tw.typewriterAnimationId.value).not.toBeNull();

      tw.resetTypewriterState();
      expect(tw.displayedStreamingContent.value).toBe("");
      expect(tw.typewriterAnimationId.value).toBeNull();
      expect(cancel).toHaveBeenCalled();
      currentTextSegment.value = "";
      vi.runOnlyPendingTimers();
    });
  });

  describe("animateStreamingText", () => {
    it("reveals one character per tick while caught up", () => {
      const { tw } = make("hello");
      tw.animateStreamingText();
      expect(tw.displayedStreamingContent.value).toBe("h");
      tick();
      expect(tw.displayedStreamingContent.value).toBe("he");
      tick();
      expect(tw.displayedStreamingContent.value).toBe("hel");
    });

    it("stops and nulls the id once it has caught up", () => {
      const { tw } = make("ab");
      tw.animateStreamingText();
      tick();
      expect(tw.displayedStreamingContent.value).toBe("ab");
      tick();
      expect(tw.typewriterAnimationId.value).toBeNull();
    });

    it("reveals a closed code block in one tick", () => {
      const { tw } = make("```sql\nSELECT 1\n```tail");
      tw.animateStreamingText();
      expect(tw.displayedStreamingContent.value).toBe("```sql\nSELECT 1\n```");
    });

    it("reveals only the opening fence while the code block is still open", () => {
      const { tw } = make("```sql\nSELECT 1");
      tw.animateStreamingText();
      expect(tw.displayedStreamingContent.value).toBe("```sql");
    });

    it("accelerates once the backlog exceeds 200 characters", () => {
      const { tw } = make("x".repeat(400));
      tw.animateStreamingText();
      expect(tw.displayedStreamingContent.value.length).toBe(20);
      tick();
      expect(tw.displayedStreamingContent.value.length).toBe(39);
    });

    it("stays at one character per tick at exactly a 200 character backlog", () => {
      const { tw } = make("x".repeat(200));
      tw.animateStreamingText();
      expect(tw.displayedStreamingContent.value.length).toBe(1);
    });

    it("lands one extra tick after a reset because the timeout is inside the frame", () => {
      const { currentTextSegment, tw } = make("abcdef");
      tw.animateStreamingText();
      expect(tw.displayedStreamingContent.value).toBe("a");

      // cancelAnimationFrame cannot cancel the setTimeout the frame already queued
      vi.advanceTimersToNextTimer();
      tw.resetTypewriterState();
      expect(tw.displayedStreamingContent.value).toBe("");

      vi.advanceTimersToNextTimer();
      expect(tw.displayedStreamingContent.value).toBe("a");
      expect(currentTextSegment.value).toBe("abcdef");
    });

    it("reads the segment ref by identity, so later writes are picked up", () => {
      const { currentTextSegment, tw } = make("ab");
      tw.animateStreamingText();
      tick();
      expect(tw.displayedStreamingContent.value).toBe("ab");

      currentTextSegment.value = "abcd";
      tick();
      expect(tw.displayedStreamingContent.value).toBe("abc");
    });
  });
});
