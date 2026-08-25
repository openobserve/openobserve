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

import i18n from "@/locales";

import DbmOverlapValue from "./DbmOverlapValue.vue";

const mountValue = (props: Record<string, unknown>) =>
  mount(DbmOverlapValue, { props, global: { plugins: [i18n] } });

describe("DbmOverlapValue", () => {
  /**
   * THE rule this component exists to make unbreakable: a MySQL row's time is
   * WAIT time, and it may never reach the screen looking like execution time.
   * The list column's heading is the generic "Database time", so the per-row
   * marker is the only thing standing between a queueing figure and a DBA
   * optimising a query that was never slow.
   */
  it("marks a MySQL server value as wait — the reported defect", () => {
    const wrapper = mountValue({
      value: "18m 3s",
      source: "server",
      qualifierKey: "serverWait",
      engine: "mysql",
    });
    const qualifier = wrapper.get('[data-test="dbm-overlap-qualifier"]');
    expect(qualifier.text()).toBe("wait time");
    expect(wrapper.text()).toContain("18m 3s");
  });

  it("marks a Postgres server value as execution", () => {
    const wrapper = mountValue({
      value: "5m 57s",
      source: "server",
      qualifierKey: "serverExecution",
      engine: "postgresql",
    });
    expect(wrapper.get('[data-test="dbm-overlap-qualifier"]').text()).toBe("exec time");
  });

  it("says a fallback figure is client-observed rather than passing it off as the database's", () => {
    const wrapper = mountValue({
      value: "94.4s",
      source: "client",
      qualifierKey: "clientObserved",
    });
    expect(wrapper.get('[data-test="dbm-overlap-qualifier"]').text()).toBe("client-observed");
  });

  it("counts are marked as counted by the engine, across every client", () => {
    const wrapper = mountValue({
      value: "29,026",
      source: "server",
      qualifierKey: "serverCounted",
      engine: "mysql",
    });
    expect(wrapper.get('[data-test="dbm-overlap-qualifier"]').text()).toBe("server count");
  });

  /**
   * D6: absent renders as an em dash, never `0` — a zero here reads as "this
   * query used no database time", an all-clear nobody measured.
   */
  it("renders an absent measure as a dash and qualifies nothing", () => {
    const wrapper = mountValue({ value: null, source: null, qualifierKey: null });
    expect(wrapper.text()).toContain("—");
    expect(wrapper.text()).not.toContain("0");
    expect(wrapper.find('[data-test="dbm-overlap-qualifier"]').exists()).toBe(false);
  });

  /**
   * The invariant stated as an invariant: there is no prop combination that
   * yields a VALUE with no qualifier beside it. If a future caller forgets the
   * qualifier key, the value must not render bare.
   */
  it("never renders a value without a qualifier", () => {
    const wrapper = mountValue({ value: "1.2s", source: "server", qualifierKey: null });
    expect(wrapper.find('[data-test="dbm-overlap-qualifier"]').exists()).toBe(false);
    // No qualifier means no claim: the figure is withheld rather than shown
    // under a heading it cannot honestly sit beneath.
    expect(wrapper.text()).not.toContain("1.2s");
    expect(wrapper.text()).toContain("—");
  });
});
