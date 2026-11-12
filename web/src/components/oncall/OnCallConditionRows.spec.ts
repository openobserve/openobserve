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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import OnCallConditionRows from "@/components/oncall/OnCallConditionRows.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import i18n from "@/locales";

const PREFIX = "rows";

function render() {
  return mount(OnCallConditionRows, {
    attachTo: document.body,
    props: {
      testPrefix: PREFIX,
      modelValue: { service: "checkout" },
      catalogue: { present: ["service"], values: { service: { checkout: 2, "risk-api": 1 } } },
    },
    global: { plugins: [i18n] },
  });
}

let wrapper: ReturnType<typeof render> | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

const searchInput = () =>
  document.body.querySelector<HTMLInputElement>(`[data-test="${PREFIX}-value-0-search"] input`) ??
  document.body.querySelector<HTMLInputElement>(`input[data-test="${PREFIX}-value-0-search"]`);

async function typeAndEnter(w: NonNullable<typeof wrapper>, term: string) {
  await w.find(`[data-test="${PREFIX}-value-0-trigger"]`).trigger("click");
  await flushPromises();
  const input = searchInput()!;
  input.value = term;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flushPromises();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flushPromises();
}

const lastEmitted = (w: NonNullable<typeof wrapper>) =>
  w.emitted("update:modelValue")?.at(-1)?.[0] as Record<string, string> | undefined;

describe("OnCallConditionRows value picker", () => {
  it("creates a typed value once, then closes the list and clears the search", async () => {
    wrapper = render();
    await typeAndEnter(wrapper, "pt-new");

    expect(lastEmitted(wrapper)).toEqual({ service: "pt-new" });
    expect(searchInput()).toBeNull();

    await wrapper.find(`[data-test="${PREFIX}-value-0-trigger"]`).trigger("click");
    await flushPromises();
    expect(searchInput()!.value).toBe("");
    const select = wrapper
      .findAllComponents(OSelect)
      .find((c) => c.attributes("data-test") === `${PREFIX}-value-0`)!;
    const values = (select.props("options") as { value: string }[]).map((o) => o.value);
    expect(values.filter((value) => value === "pt-new")).toHaveLength(1);
  });

  it("selects the existing option on an exact typed match instead of creating it", async () => {
    wrapper = render();
    await typeAndEnter(wrapper, "risk-api");

    expect(lastEmitted(wrapper)).toEqual({ service: "risk-api" });
    expect(searchInput()).toBeNull();
  });
});

describe("OnCallConditionRows vocabulary", () => {
  function mountWith(props: Record<string, unknown>) {
    return mount(OnCallConditionRows, {
      props: { testPrefix: PREFIX, ...props },
      global: { plugins: [i18n] },
    });
  }
  const optionsOf = (w: ReturnType<typeof mountWith>, test: string) =>
    (
      w
        .findAllComponents(OSelect)
        .find((c) => c.attributes("data-test") === test)!
        .props("options") as { value: string }[]
    ).map((option) => option.value);

  // A value an existing rule routes on is real even when discovery never reported it.
  it("offers the values existing rules already route on", () => {
    const w = mountWith({
      catalogue: { present: ["service"], values: { service: { checkout: 1 } } },
      rules: [{ dimensions: { service: "cart-service" } }, { dimensions: { service: "pay-*" } }],
    });
    const values = optionsOf(w, `${PREFIX}-value-0`);
    expect(values).toContain("cart-service");
    expect(values).not.toContain("pay-*");
  });

  // The engine's own bookkeeping columns are never an alert's identity, so they are not offered.
  it("leaves internal fields and values out of the pickers", () => {
    const w = mountWith({
      catalogue: {
        present: ["service", "traces_service_graph_processed_timestamp", "_timestamp"],
        values: { service: { checkout: 1, traces_service_graph_processed_timestamp: 3 } },
      },
    });
    expect(optionsOf(w, `${PREFIX}-field-0`)).toEqual(["service"]);
    expect(optionsOf(w, `${PREFIX}-value-0`)).toEqual(["checkout"]);
  });
});

describe("OnCallConditionRows field catalogue", () => {
  const ALIASES = [
    { id: "service", display: "Service" },
    { id: "host", display: "Host" },
    { id: "k8s-namespace", display: "K8s Namespace" },
  ];
  function fieldsOf(props: Record<string, unknown>) {
    const w = mount(OnCallConditionRows, {
      props: { testPrefix: PREFIX, aliases: ALIASES, ...props },
      global: { plugins: [i18n] },
    });
    const select = w
      .findAllComponents(OSelect)
      .find((c) => c.attributes("data-test") === `${PREFIX}-field-0`)!;
    return (select.props("options") as { value: string }[]).map((option) => option.value);
  }

  it("offers the full vocabulary when discovery saw nothing, even once a rule exists", () => {
    expect(fieldsOf({ rules: [{ dimensions: { service: "payments" } }] })).toEqual([
      "service",
      "host",
      "k8s-namespace",
    ]);
  });

  it("adds the fields rules and unrouted signals carry on top of the full vocabulary", () => {
    expect(
      fieldsOf({
        rules: [{ dimensions: { region: "eu" } }],
        signals: [{ id: "s", path: "", occurrences: 1, dimensions: { environment: "prod" } }],
      }),
    ).toEqual(["service", "host", "k8s-namespace", "environment", "region"]);
  });

  it("narrows to what discovery saw, plus the rules' fields, once discovery has something", () => {
    expect(
      fieldsOf({
        catalogue: { present: ["service"], values: {} },
        rules: [{ dimensions: { region: "eu" } }],
      }),
    ).toEqual(["service", "region"]);
  });

  it("captions each field with the telemetry fields its group is made of", () => {
    const w = mount(OnCallConditionRows, {
      props: {
        testPrefix: PREFIX,
        aliases: [
          { id: "service", display: "Service", fields: ["service", "service_name"] },
          {
            id: "k8s-cluster",
            display: "K8s cluster",
            fields: ["k8s_cluster", "k8s_cluster_name", "cluster", "a", "b", "c"],
          },
          { id: "host", display: "Host", fields: [] },
        ],
      },
      global: { plugins: [i18n] },
    });
    const options = w
      .findAllComponents(OSelect)
      .find((c) => c.attributes("data-test") === `${PREFIX}-field-0`)!
      .props("options") as { value: string; subLabel?: string }[];
    expect(options.map((option) => [option.value, option.subLabel])).toEqual([
      ["service", "service, service_name"],
      ["k8s-cluster", "k8s_cluster, k8s_cluster_name, cluster +3 more"],
      ["host", undefined],
    ]);
  });
});

describe("OnCallConditionRows half-filled rows", () => {
  function mountRows(props: Record<string, unknown>) {
    return mount(OnCallConditionRows, {
      props: { testPrefix: PREFIX, ...props },
      global: { plugins: [i18n] },
    });
  }
  const selectOf = (w: ReturnType<typeof mountRows>, test: string) =>
    w.findAllComponents(OSelect).find((c) => c.attributes("data-test") === test)!;
  const incomplete = (w: ReturnType<typeof mountRows>) =>
    w.emitted("update:incomplete")?.at(-1)?.[0];

  it("reports a row whose field changed as incomplete and drops it from the conditions", async () => {
    const w = mountRows({ modelValue: { namespace: "prod", service: "payments" } });
    expect(incomplete(w)).toBe(false);
    selectOf(w, `${PREFIX}-field-0`).vm.$emit("update:modelValue", "host");
    await flushPromises();
    expect(incomplete(w)).toBe(true);
    expect(w.emitted("update:modelValue")?.at(-1)?.[0]).toEqual({ service: "payments" });
    expect(w.find(`[data-test="${PREFIX}-pick-value-0"]`).exists()).toBe(true);
  });

  it("does not count a fully empty row as incomplete", async () => {
    const w = mountRows({ modelValue: { service: "payments" } });
    await w.find(`[data-test="${PREFIX}-add-condition"]`).trigger("click");
    await flushPromises();
    expect(selectOf(w, `${PREFIX}-field-1`).props("modelValue")).toBe("");
    expect(incomplete(w)).toBe(false);
  });
});

describe("OnCallConditionRows without starts with", () => {
  it("offers only is and reads a seeded prefix as the literal value", () => {
    const w = mount(OnCallConditionRows, {
      props: { testPrefix: PREFIX, prefix: false, modelValue: { service: "pay*" } },
      global: { plugins: [i18n] },
    });
    expect(
      w.findAllComponents(OSelect).some((c) => c.attributes("data-test") === `${PREFIX}-op-0`),
    ).toBe(false);
    expect(w.find(`[data-test="${PREFIX}-op-0"]`).text()).toBe("is");
    expect(w.emitted("update:modelValue")?.at(-1)?.[0]).toEqual({ service: "pay" });
  });
});
