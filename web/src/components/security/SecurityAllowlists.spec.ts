// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import securitySigma from "@/services/securitySigma";
import { okResponse } from "@/views/Security/__fixtures__/securityFixtures";

const toastMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/securitySigma", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securitySigma")>());
});
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: (...args: unknown[]) => toastMock(...args),
}));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

import SecurityAllowlists from "./SecurityAllowlists.vue";

let wrapper: VueWrapper | null = null;

const SCANNERS = {
  id: "scanners",
  name: "Vuln scanners",
  purpose: "scanner" as const,
  values: ["10.0.0.0/8", "192.0.2.10"],
  description: "Weekly Nessus sweep",
  updated_by: "eng@acme.io",
  updated_at: 1_700_000_000_000_000,
};

const mountLists = async (access = { canAuthor: true, canAdmin: true }) => {
  wrapper = mount(SecurityAllowlists, {
    props: { orgId: "acme", ...access },
    global: { provide: { store }, plugins: [store, withQueryClient()] },
  });
  await flushPromises();
  return wrapper;
};

const byTest = (w: VueWrapper, test: string) => w.find(`[data-test="${test}"]`);
const fill = (w: VueWrapper, test: string, value: string) =>
  w
    .find(
      `[data-test="${test}"] input, textarea[data-test="${test}"], [data-test="${test}"] textarea`,
    )
    .setValue(value);
const submit = async (w: VueWrapper) => {
  await w.find("form").trigger("submit");
  await flushPromises();
};
const conflict = (message: string) =>
  Object.assign(new Error(message), { response: { status: 409, data: { message } } });

beforeEach(() => {
  vi.mocked(securitySigma.listAllowlists).mockResolvedValue(
    okResponse({ lists: [SCANNERS] }) as never,
  );
  vi.mocked(securitySigma.putAllowlist).mockImplementation(
    async (_org, id, body) => okResponse({ ...SCANNERS, ...body, id }) as never,
  );
  vi.mocked(securitySigma.deleteAllowlist).mockResolvedValue(okResponse({}) as never);
  confirmMock.mockResolvedValue(true);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityAllowlists", () => {
  it("lists each allowlist with its purpose, values and author", async () => {
    const w = await mountLists();
    const row = byTest(w, "security-allowlist-scanners").text();
    expect(row).toContain("Vuln scanners");
    expect(row).toContain("Scanner");
    expect(row).toContain("2 values");
    expect(row).toContain("192.0.2.10");
    expect(row).toContain("eng@acme.io");
  });

  it("creates a list with an id and one value per line", async () => {
    const w = await mountLists();
    await byTest(w, "security-allowlists-add").trigger("click");
    await fill(w, "security-allowlist-form-name", "Service accounts");
    await fill(w, "security-allowlist-form-id", "svc");
    w.findComponent('[data-test="security-allowlist-form-purpose"]').vm.$emit(
      "update:modelValue",
      "service_account",
    );
    await fill(w, "security-allowlist-form-values", "svc-backup\n\nsvc-deploy\n");
    await submit(w);
    await vi.waitFor(() => expect(securitySigma.putAllowlist).toHaveBeenCalled());
    expect(securitySigma.putAllowlist).toHaveBeenCalledWith("acme", "svc", {
      name: "Service accounts",
      purpose: "service_account",
      values: ["svc-backup", "svc-deploy"],
      description: "",
    });
    await vi.waitFor(() => expect(byTest(w, "security-allowlist-form").exists()).toBe(false));
  });

  it("hints at a value that is not an address on a scanner list, before sending it", async () => {
    const w = await mountLists();
    await byTest(w, "security-allowlists-add").trigger("click");
    await fill(w, "security-allowlist-form-name", "Scanners 2");
    await fill(w, "security-allowlist-form-id", "scanners2");
    w.findComponent('[data-test="security-allowlist-form-purpose"]').vm.$emit(
      "update:modelValue",
      "scanner",
    );
    await fill(w, "security-allowlist-form-values", "10.0.0.5\nnessus-01");
    await submit(w);
    await vi.waitFor(() => expect(w.text()).toContain("nessus-01 is not an IP address or CIDR"));
    expect(securitySigma.putAllowlist).not.toHaveBeenCalled();
  });

  it("edits a list under its fixed id", async () => {
    const w = await mountLists();
    await byTest(w, "security-allowlist-edit-scanners").trigger("click");
    const id = w.find('[data-test="security-allowlist-form-id"] input');
    expect((id.element as HTMLInputElement).value).toBe("scanners");
    expect((id.element as HTMLInputElement).disabled).toBe(true);
    await fill(w, "security-allowlist-form-values", "10.0.0.0/8");
    await submit(w);
    await vi.waitFor(() => expect(securitySigma.putAllowlist).toHaveBeenCalled());
    expect(vi.mocked(securitySigma.putAllowlist).mock.calls[0].slice(1)).toEqual([
      "scanners",
      {
        name: "Vuln scanners",
        purpose: "scanner",
        values: ["10.0.0.0/8"],
        description: "Weekly Nessus sweep",
      },
    ]);
  });

  it("shows the server's reason when a list is still in use", async () => {
    vi.mocked(securitySigma.deleteAllowlist).mockRejectedValue(
      conflict("An exception reads the list 'scanners'; remove it first"),
    );
    const w = await mountLists();
    await byTest(w, "security-allowlist-delete-scanners").trigger("click");
    await vi.waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(securitySigma.deleteAllowlist).toHaveBeenCalledWith("acme", "scanners");
    expect(toastMock).toHaveBeenCalledWith({
      variant: "error",
      message: "An exception reads the list 'scanners'; remove it first",
    });
  });

  it("disables adding without the author grant and hides delete without admin", async () => {
    const w = await mountLists({ canAuthor: false, canAdmin: false });
    expect(byTest(w, "security-allowlists-add").attributes("disabled")).toBeDefined();
    expect(byTest(w, "security-allowlist-edit-scanners").exists()).toBe(false);
    expect(byTest(w, "security-allowlist-delete-scanners").exists()).toBe(false);
  });

  it("lets an author edit but not delete", async () => {
    const w = await mountLists({ canAuthor: true, canAdmin: false });
    expect(byTest(w, "security-allowlist-edit-scanners").exists()).toBe(true);
    expect(byTest(w, "security-allowlist-delete-scanners").exists()).toBe(false);
  });
});
