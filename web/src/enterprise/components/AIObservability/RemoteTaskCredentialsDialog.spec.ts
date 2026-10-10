// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import type { RemoteTaskAuthView } from "@/services/remote-tasks.service";

const replaceAuth = vi.fn();
vi.mock("@/services/remote-tasks.service", () => ({
  default: { replaceAuth: (...a: any[]) => replaceAuth(...a) },
}));
const toast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: (...a: any[]) => toast(...a) }));

import RemoteTaskCredentialsDialog from "./RemoteTaskCredentialsDialog.vue";

function mountDialog(auth: RemoteTaskAuthView) {
  return mount(RemoteTaskCredentialsDialog, {
    props: { open: true, orgId: "acme", entityId: "head-1", auth },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
}

async function fill(wrapper: any, values: Record<string, string>) {
  await flushPromises(); // the dialog body renders after mount
  const form = wrapper.findComponent({ name: "OForm" }).vm.form;
  for (const [key, value] of Object.entries(values)) form.setFieldValue(key, value);
  await form.handleSubmit();
  await flushPromises();
}

function field(name: string) {
  return document.body.querySelector(`[data-test="ai-remote-task-credentials-${name}"]`);
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  replaceAuth.mockResolvedValue({ purpose: "auth", state: "current", createdAt: 1, updatedAt: 2 });
});

describe("RemoteTaskCredentialsDialog", () => {
  it("replaces Basic auth with a username and password", async () => {
    const wrapper = mountDialog({ type: "basic", usesSecret: true });
    await flushPromises();
    expect(field("username")).not.toBeNull();
    expect(field("token")).toBeNull();

    await fill(wrapper, { username: "svc", password: "s3cret" });

    expect(replaceAuth).toHaveBeenCalledWith("acme", "head-1", {
      type: "basic",
      username: "svc",
      password: "s3cret",
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });

  it("replaces a bearer token", async () => {
    const wrapper = mountDialog({ type: "bearer", usesSecret: true });
    await fill(wrapper, { token: "tok-2" });
    expect(replaceAuth).toHaveBeenCalledWith("acme", "head-1", { type: "token", value: "tok-2" });
    wrapper.unmount();
  });

  // The header name is on the published version; only the value behind it rotates.
  it("replaces an API key and shows its fixed header name", async () => {
    const wrapper = mountDialog({
      type: "api_key_header",
      usesSecret: true,
      headerName: "x-api-key",
    });
    await flushPromises();
    expect(field("header-name")?.textContent).toContain("x-api-key");

    await fill(wrapper, { token: "key-2" });
    expect(replaceAuth).toHaveBeenCalledWith("acme", "head-1", { type: "token", value: "key-2" });
    wrapper.unmount();
  });

  it("does not send an empty secret", async () => {
    const wrapper = mountDialog({ type: "basic", usesSecret: true });
    await fill(wrapper, { username: "svc", password: "   " });
    expect(replaceAuth).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("starts empty: the stored secret is never shown", async () => {
    const wrapper = mountDialog({ type: "bearer", usesSecret: true });
    await flushPromises();
    expect(wrapper.findComponent({ name: "OForm" }).vm.form.state.values).toEqual({
      token: "",
      username: "",
      password: "",
    });
    wrapper.unmount();
  });

  it("stays open and reports the server's reason on failure", async () => {
    replaceAuth.mockRejectedValue({ response: { data: { message: "secret not found" } } });
    const wrapper = mountDialog({ type: "bearer", usesSecret: true });
    await fill(wrapper, { token: "tok-2" });
    expect(toast).toHaveBeenCalledWith({ variant: "error", message: "secret not found" });
    expect(wrapper.emitted("update:open")).toBeUndefined();
    wrapper.unmount();
  });
});
