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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent } from "vue";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import OrgDomainDetailsDialog from "./OrgDomainDetailsDialog.vue";

const DialogStub = defineComponent({
  name: "ODialog",
  props: ["open", "title", "primaryButtonLabel", "secondaryButtonLabel", "primaryButtonLoading"],
  template: "<div><slot /></div>",
});

const link = (state: 0 | 1 | 2, metaMapped = false) => ({
  id: "l1",
  org_id: "acme",
  domain: "acme.com",
  verification_token: "o2v_token",
  verification_state: state,
  verification_failure_reason: state === 2 ? (2 as const) : null,
  verified_at: null,
  last_checked_at: null,
  created_at: 0,
  updated_at: 0,
  meta_mapped: metaMapped,
});

const request = (status: 0 | 1 | 2) => ({
  id: "r1",
  org_id: "acme",
  domain: "acme.com",
  created_at: 1_700_000_000_000_000,
  updated_at: 1_700_000_100_000_000,
  requested_by: "owner@acme.com",
  answered_by: status === 0 ? null : "staff@o2.test",
  status,
  reason: status === 0 ? null : "checked by email",
});

const mountDialog = (props: Record<string, unknown>) =>
  mount(OrgDomainDetailsDialog, {
    props: { open: true, domain: "acme.com", failureReason: null, verifying: false, ...props },
    global: {
      plugins: [i18n],
      stubs: { ODialog: DialogStub, OrgDomainVerification: true, OTimeCell: true },
    },
  });

const dialogProp = (wrapper: ReturnType<typeof mountDialog>, name: string) =>
  wrapper.findComponent(DialogStub).props(name);

describe("OrgDomainDetailsDialog", () => {
  it("shows the record and Verify now for a DNS link that failed", () => {
    const wrapper = mountDialog({
      link: link(2),
      request: null,
      failureReason: raw("DNS resolution failed"),
    });

    expect(dialogProp(wrapper, "title")).toBe("Verify acme.com");
    expect(dialogProp(wrapper, "primaryButtonLabel")).toBe("Verify now");
    expect(wrapper.text()).toContain("Last check failed: DNS resolution failed");
    expect(wrapper.findComponent({ name: "OrgDomainVerification" }).exists()).toBe(true);
  });

  it("shows the record without Verify now for a verified DNS link", () => {
    const wrapper = mountDialog({ link: link(1), request: null });

    expect(dialogProp(wrapper, "title")).toBe("DNS record for acme.com");
    expect(dialogProp(wrapper, "primaryButtonLabel")).toBeUndefined();
  });

  it("explains an approved link and who approved it, without a DNS record", () => {
    const wrapper = mountDialog({ link: link(1, true), request: request(1) });

    expect(dialogProp(wrapper, "title")).toBe("Link details for acme.com");
    expect(dialogProp(wrapper, "primaryButtonLabel")).toBeUndefined();
    expect(wrapper.text()).toContain("No DNS record is needed");
    expect(wrapper.text()).toContain("owner@acme.com");
    expect(wrapper.text()).toContain("staff@o2.test");
    expect(wrapper.text()).toContain("checked by email");
    expect(wrapper.findComponent({ name: "OrgDomainVerification" }).exists()).toBe(false);
  });

  it("says a pending request is under review and hides the answer fields", () => {
    const wrapper = mountDialog({ link: null, request: request(0) });

    expect(wrapper.text()).toContain("OpenObserve is reviewing this request");
    expect(wrapper.text()).not.toContain("Answered by");
  });

  it("shows why a request was rejected", () => {
    const wrapper = mountDialog({ link: null, request: request(2) });

    expect(wrapper.text()).toContain("OpenObserve rejected this request");
    expect(wrapper.text()).toContain("checked by email");
  });
});
