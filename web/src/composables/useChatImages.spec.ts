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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import { raw, type TranslateFn } from "@/types/i18n";

const toastSpy = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (o: any) => toastSpy(o) }));
vi.mock("@/utils/chartTheme", () => ({ chartColor: (name: string) => `var(${name})` }));

const { useChatImages } = await import("@/composables/useChatImages");

const t = ((key: string, params?: Record<string, any>) =>
  raw(params ? `${key}[${Object.values(params).join("|")}]` : key)) as unknown as TranslateFn;

const png = (name = "a.png", size = 10) => {
  const file = new File(["x"], name, { type: "image/png" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

// A RichTextInput stand-in: $el hosting a contenteditable, or nothing at all.
const setup = (mode: "rich" | "textarea" | "none") => {
  const host = document.createElement("div");
  if (mode === "rich") {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    host.appendChild(editable);
  } else if (mode === "textarea") {
    host.appendChild(document.createElement("textarea"));
  }
  document.body.appendChild(host);

  const chatInput = ref<any>(mode === "none" ? null : { $el: host });
  const inputMessage = ref("");
  const focusInput = vi.fn();
  const api = useChatImages(chatInput, inputMessage, focusInput, t);
  return { api, host, inputMessage, focusInput };
};

beforeEach(() => {
  toastSpy.mockClear();
  document.body.innerHTML = "";
});

describe("addImage validation", () => {
  it("rejects a file over the 2MB limit and toasts the size", async () => {
    const { api } = setup("none");
    await expect(api.addImage(png("big.png", 3 * 1024 * 1024))).resolves.toBe(false);
    expect(api.pendingImages.value).toHaveLength(0);
    expect(toastSpy).toHaveBeenCalledWith({
      variant: "error",
      message: "toastMessages.components.imageExceeds2mbLimitMb[3.0]",
    });
  });

  it("rejects a non png/jpeg type", async () => {
    const { api } = setup("none");
    const gif = new File(["x"], "a.gif", { type: "image/gif" });
    await expect(api.addImage(gif)).resolves.toBe(false);
    expect(toastSpy).toHaveBeenCalledWith({
      variant: "error",
      message: "toastMessages.components.onlyPngAndJpegImagesAre",
    });
  });

  it("accepts a jpeg at exactly the limit", async () => {
    const { api } = setup("none");
    const jpg = new File(["x"], "a.jpg", { type: "image/jpeg" });
    Object.defineProperty(jpg, "size", { value: 2 * 1024 * 1024 });
    await expect(api.addImage(jpg)).resolves.toBe(true);
    expect(api.pendingImages.value[0].mimeType).toBe("image/jpeg");
  });
});

describe("addImage storage", () => {
  it("stores the base64 payload without the data-url prefix", async () => {
    const { api } = setup("none");
    await api.addImage(png("a.png", 1));
    expect(api.pendingImages.value).toEqual([
      { data: btoa("x"), mimeType: "image/png", filename: "a.png", size: 1 },
    ]);
  });

  it("toasts and resolves false when the read fails", async () => {
    const { api } = setup("none");
    const RealReader = globalThis.FileReader;
    class FailingReader {
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.onerror?.();
      }
    }
    (globalThis as any).FileReader = FailingReader;
    await expect(api.addImage(png())).resolves.toBe(false);
    (globalThis as any).FileReader = RealReader;
    expect(toastSpy).toHaveBeenCalledWith({
      variant: "error",
      message: "toastMessages.components.failedToReadImage[a.png]",
    });
  });
});

describe("addImage reference insertion", () => {
  it("appends a removable chip into the contenteditable and refocuses", async () => {
    const { api, host, focusInput } = setup("rich");
    await api.addImage(png("shot.png"));

    const span = host.querySelector(".image-reference")!;
    expect(span).toBeTruthy();
    expect((span as HTMLElement).contentEditable).toBe("false");
    expect(span.textContent).toContain("shot.png");
    expect(focusInput).toHaveBeenCalled();
  });

  it("drops the pending image when the chip's own remove button is clicked", async () => {
    const { api, host } = setup("rich");
    await api.addImage(png("shot.png"));
    const btn = host.querySelector(".image-reference button") as HTMLButtonElement;
    btn.click();
    expect(api.pendingImages.value).toHaveLength(0);
    expect(host.querySelector(".image-reference")).toBeNull();
  });

  it("inserts the @[file] token into the textarea fallback", async () => {
    const { api, inputMessage } = setup("textarea");
    inputMessage.value = "look";
    await api.addImage(png("shot.png"));
    // An unfocused textarea reports a zero caret, so the token lands at the front.
    expect(inputMessage.value).toBe("@[shot.png] look");
  });

  it("appends the token when there is no input element at all", async () => {
    const { api, inputMessage } = setup("none");
    inputMessage.value = "look";
    await api.addImage(png("shot.png"));
    expect(inputMessage.value).toBe("look @[shot.png] ");
  });
});

describe("removeImage", () => {
  it("removes the chip whose text matches and splices the image", async () => {
    const { api, host } = setup("rich");
    await api.addImage(png("a.png"));
    await api.addImage(png("b.png"));
    expect(host.querySelectorAll(".image-reference")).toHaveLength(2);

    api.removeImage(0);
    expect(api.pendingImages.value.map((i) => i.filename)).toEqual(["b.png"]);
  });

  it("strips the token from the textarea fallback text", async () => {
    const { api, inputMessage } = setup("textarea");
    inputMessage.value = "before @[a.png] after";
    api.pendingImages.value.push({
      data: "d",
      mimeType: "image/png",
      filename: "a.png",
      size: 1,
    });
    api.removeImage(0);
    expect(inputMessage.value).toBe("before after");
    expect(api.pendingImages.value).toHaveLength(0);
  });

  it("splices even when the index holds nothing", () => {
    const { api } = setup("none");
    expect(() => api.removeImage(3)).not.toThrow();
  });
});

describe("clearPendingImages", () => {
  it("empties the list", async () => {
    const { api } = setup("none");
    await api.addImage(png());
    api.clearPendingImages();
    expect(api.pendingImages.value).toHaveLength(0);
  });
});

describe("drag, drop and paste", () => {
  it("swallows dragover", () => {
    const { api } = setup("none");
    const ev = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as any;
    api.handleDragOver(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ev.stopPropagation).toHaveBeenCalled();
  });

  it("adds only the image files from a drop", async () => {
    const { api } = setup("none");
    const text = new File(["t"], "n.txt", { type: "text/plain" });
    await api.handleDrop({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: [png("a.png"), text] },
    } as any);
    expect(api.pendingImages.value.map((i) => i.filename)).toEqual(["a.png"]);
  });

  it("ignores a drop with no files", async () => {
    const { api } = setup("none");
    await api.handleDrop({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: undefined,
    } as any);
    expect(api.pendingImages.value).toHaveLength(0);
  });

  it("adds a pasted image and blocks the default paste", async () => {
    const { api } = setup("none");
    const preventDefault = vi.fn();
    await api.handlePaste({
      preventDefault,
      clipboardData: {
        items: [
          { type: "text/plain", getAsFile: () => null },
          { type: "image/png", getAsFile: () => png("p.png") },
        ],
      },
    } as any);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(api.pendingImages.value.map((i) => i.filename)).toEqual(["p.png"]);
  });
});

describe("handleImageSelect", () => {
  it("adds every selected file and resets the input", async () => {
    const { api } = setup("none");
    const input = { files: [png("a.png"), png("b.png")], value: "C:/fake" } as any;
    await api.handleImageSelect({ target: input } as any);
    expect(api.pendingImages.value).toHaveLength(2);
    expect(input.value).toBe("");
  });
});

describe("triggerImageUpload", () => {
  it("clicks the hidden file input", () => {
    const { api } = setup("none");
    const el = document.createElement("input");
    const click = vi.spyOn(el, "click");
    api.imageInputRef.value = el;
    api.triggerImageUpload();
    expect(click).toHaveBeenCalled();
  });
});

describe("handleImageReferenceBackspace", () => {
  const backspace = (target: EventTarget) => {
    const e = new KeyboardEvent("keydown", { key: "Backspace", cancelable: true });
    Object.defineProperty(e, "target", { value: target });
    return e;
  };

  it("removes a chip that addImage inserted, but its text never matches @[name] so the image stays pending", async () => {
    const { api, host } = setup("rich");
    await api.addImage(png("a.png"));
    const editable = host.querySelector('[contenteditable="true"]')!;
    const chipEl = editable.querySelector(".image-reference")!;
    const range = document.createRange();
    range.setStartAfter(chipEl);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    const e = backspace(editable);
    expect(api.handleImageReferenceBackspace(e)).toBeUndefined();
    expect(e.defaultPrevented).toBe(true);
    expect(editable.querySelector(".image-reference")).toBeNull();
    expect(api.pendingImages.value).toHaveLength(1);
  });

  it("edits the shared input ref on the textarea path and defers the caret to the next tick", async () => {
    const { api, inputMessage } = setup("none");
    api.pendingImages.value.push({ data: "d", mimeType: "image/png", filename: "a.png", size: 1 });
    inputMessage.value = "x @[a.png]";
    const ta = document.createElement("textarea");
    ta.value = "x @[a.png]";
    document.body.appendChild(ta);
    ta.selectionStart = ta.selectionEnd = 10;

    const e = backspace(ta);
    api.handleImageReferenceBackspace(e);
    expect(inputMessage.value).toBe("x ");
    expect(api.pendingImages.value).toHaveLength(0);
    expect(ta.selectionStart).toBe(10);
    await nextTick();
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([2, 2]);
  });
});

describe("preview dialog", () => {
  it("opens and closes", () => {
    const { api } = setup("none");
    const img = { data: "d", mimeType: "image/png" as const, filename: "a.png", size: 1 };
    api.openImagePreview(img);
    expect(api.showImagePreview.value).toBe(true);
    expect(api.previewImage.value).toEqual(img);

    api.closeImagePreview();
    expect(api.showImagePreview.value).toBe(false);
    expect(api.previewImage.value).toBeNull();
  });
});
