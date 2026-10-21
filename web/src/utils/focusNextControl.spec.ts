// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { escapeEditor, focusControlAfter } from "./focusNextControl";

const page = (html: string) => {
  document.body.innerHTML = html;
  return document.getElementById("editor") as HTMLElement;
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("focusControlAfter", () => {
  it("focuses the next control after the container, skipping controls inside it", () => {
    const editor = page(
      '<button id="before"></button><div id="editor"><textarea id="inner"></textarea></div><button id="after"></button><button id="later"></button>',
    );
    focusControlAfter(editor);
    expect(document.activeElement?.id).toBe("after");
  });

  it("skips disabled controls and controls Tab would skip", () => {
    const editor = page(
      '<div id="editor"><textarea></textarea></div><button disabled id="off"></button><button tabindex="-1" id="skip"></button><input id="on" />',
    );
    focusControlAfter(editor);
    expect(document.activeElement?.id).toBe("on");
  });

  it("leaves focus where it is when nothing follows", () => {
    const editor = page(
      '<button id="before"></button><div id="editor"><textarea id="inner"></textarea></div>',
    );
    (document.getElementById("inner") as HTMLElement).focus();
    focusControlAfter(editor);
    expect(document.activeElement?.id).toBe("inner");
  });
});

describe("escapeEditor", () => {
  it("moves focus on when nothing owns Escape", () => {
    const editor = page('<div id="editor"><textarea></textarea></div><button id="after"></button>');
    escapeEditor(editor);
    expect(document.activeElement?.id).toBe("after");
  });

  it("hands Escape to a dialog that owns it and keeps focus put", () => {
    const editor = page(
      '<div role="dialog"><div id="editor"><textarea id="inner"></textarea></div></div><button id="after"></button>',
    );
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    (document.getElementById("inner") as HTMLElement).focus();
    escapeEditor(editor);
    document.removeEventListener("keydown", seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect((seen.mock.calls[0][0] as KeyboardEvent).key).toBe("Escape");
    expect(document.activeElement?.id).toBe("inner");
  });

  it("moves focus on when the owner declines Escape", () => {
    const editor = page(
      '<div role="dialog"><div id="editor"><textarea></textarea></div></div><button id="after"></button>',
    );
    const decline = (event: Event) => event.preventDefault();
    document.addEventListener("keydown", decline);
    escapeEditor(editor);
    document.removeEventListener("keydown", decline);
    expect(document.activeElement?.id).toBe("after");
  });
});
