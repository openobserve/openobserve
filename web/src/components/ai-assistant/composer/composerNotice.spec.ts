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

import { describe, expect, it } from "vitest";

import { raw } from "@/types/i18n";

import {
  NOTICE_PRIORITY,
  STRIP_MAX_CHARS,
  fitNotice,
  fitWords,
  lineCount,
  micHelpUrl,
  pickNotice,
  sentenceNotice,
  stripText,
  type ComposerNotice,
} from "./composerNotice";

// The shipped short titles of K5, each with its link, as the strip shows them.
const KIT_NOTICES: ComposerNotice[] = [
  {
    id: "runLimit",
    tone: "warning",
    title: raw("Run limit reached"),
    sentence: raw(
      "Your organisation has reached its limit of running assistant chats. Stop or finish one to start another.",
    ),
    links: [{ action: "showRunning", label: raw("Show running chats") }],
  },
  {
    id: "credits",
    tone: "warning",
    title: raw("AI credits used up"),
    sentence: raw("This organisation has used all of its included AI credits for the month."),
    links: [{ action: "manageUsage", label: raw("Manage paid usage") }],
  },
  {
    id: "orgBusy",
    tone: "warning",
    title: raw("Assistant busy for your org"),
    sentence: raw("The assistant is handling another request for your organisation."),
    links: [{ action: "retry", label: raw("Retry") }],
  },
  {
    id: "voice",
    tone: "warning",
    title: raw("Microphone blocked"),
    sentence: raw("Microphone access is blocked for this site in your browser."),
    links: [{ action: "micHelp", label: raw("How to allow") }],
  },
  {
    id: "inert",
    tone: "paused",
    title: raw("Decide above to continue"),
    sentence: raw("This chat is waiting for your decision on the approval above."),
    links: [],
  },
];

describe("composerNotice: the strip's one line (K5)", () => {
  it("leaves every kit title and link whole, inside 44 characters", () => {
    for (const notice of KIT_NOTICES) {
      expect(stripText(notice).length).toBeLessThanOrEqual(STRIP_MAX_CHARS);
      expect(fitNotice(notice)).toEqual(notice);
    }
    expect(stripText(KIT_NOTICES[0])).toBe("Run limit reached · Show running chats");
  });

  it("shortens a long title by whole words, keeps the link, and leaves the sentence for title=", () => {
    const sentence = raw("Your role can no longer use O2 Assistant. Your message wasn't sent.");
    const fitted = fitNotice(
      sentenceNotice("access", sentence, "warning", [
        { action: "askAdmin", label: raw("Ask an admin") },
      ]),
    );
    expect(stripText(fitted).length).toBeLessThanOrEqual(STRIP_MAX_CHARS);
    expect(fitted.title).toBe("Your role can no longer use");
    expect(sentence.startsWith(fitted.title)).toBe(true);
    expect(sentence.split(/\s+/)).toEqual(expect.arrayContaining(fitted.title.split(" ")));
    expect(fitted.links).toEqual([{ action: "askAdmin", label: "Ask an admin" }]);
    expect(fitted.sentence).toBe(sentence);
  });

  it("never cuts a word and drops dangling punctuation", () => {
    expect(fitWords("Couldn't reach OpenObserve. Your message wasn't sent.", 30)).toBe(
      "Couldn't reach OpenObserve",
    );
    expect(fitWords("Short line.", 44)).toBe("Short line.");
    expect(fitWords("Supercalifragilistic word", 5)).toBe("Supercalifragilistic");
  });

  it("shows the most urgent notice, whatever order the candidates come in", () => {
    const cap = sentenceNotice("cap", raw("Up to 4 images, 2 MB each"));
    const inert = KIT_NOTICES[4];
    const credits = KIT_NOTICES[1];
    expect(pickNotice([cap, null, false, credits, inert])?.id).toBe("inert");
    expect(pickNotice([cap, credits])?.id).toBe("credits");
    expect(pickNotice([undefined, null, false])).toBeNull();
  });

  it("ranks a held composer above refusals and refusals above draft notices", () => {
    const rank = (id: (typeof NOTICE_PRIORITY)[number]) => NOTICE_PRIORITY.indexOf(id);
    expect(rank("prefill")).toBeLessThan(rank("inert"));
    expect(rank("inert")).toBeLessThan(rank("access"));
    expect(rank("access")).toBeLessThan(rank("runLimit"));
    expect(rank("runLimit")).toBeLessThan(rank("credits"));
    expect(rank("credits")).toBeLessThan(rank("cap"));
    expect(rank("cap")).toBeLessThan(rank("queued"));
    expect(rank("queued")).toBeLessThan(rank("thread"));
  });

  it("links a blocked mic to the browser's own help, and nothing for an unknown browser", () => {
    expect(micHelpUrl("chrome")).toMatch(/^https:\/\/support\.google\.com\//);
    expect(micHelpUrl("safari")).toMatch(/^https:\/\/support\.apple\.com\//);
    expect(micHelpUrl("edge")).toMatch(/^https:\/\/support\.microsoft\.com\//);
    expect(micHelpUrl(null)).toBeNull();
  });

  it("counts pasted lines for the Pasted N lines title", () => {
    expect(lineCount("a\nb\r\nc")).toBe(3);
    expect(lineCount("")).toBe(0);
  });
});
