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

import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import { z } from "zod";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import JiraDestinationFields from "@/components/alerts/JiraDestinationFields.vue";
import { prebuiltDestinationDefaults } from "@/components/alerts/PrebuiltDestinationForm.schema";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";

const { jiraSetup } = vi.hoisted(() => ({ jiraSetup: vi.fn() }));

vi.mock("@/services/alert_destination", () => ({ default: { jiraSetup } }));

const CONNECT = {
  display_name: "Alerts Bot",
  projects: [
    { key: "OPS", name: "Operations" },
    { key: "WEB", name: "Website" },
  ],
};
const ISSUE_TYPES = {
  issue_types: [
    { id: "10004", name: "Bug" },
    { id: "10005", name: "Task" },
  ],
};
const FIELDS = {
  has_labels: true,
  priorities: [
    { id: "1", name: "Highest" },
    { id: "3", name: "Medium" },
  ],
  required_fields: [
    { id: "customfield_1", name: "Area", kind: "text" },
    { id: "customfield_2", name: "Points", kind: "number" },
    {
      id: "customfield_3",
      name: "Team",
      kind: "option",
      options: [{ id: "10101", name: "SRE" }],
    },
    {
      id: "components",
      name: "Components",
      kind: "options",
      options: [
        { id: "1", name: "API" },
        { id: "2", name: "UI" },
      ],
    },
    { id: "versions", name: "Affects Version", kind: "unsupported" },
  ],
};

const respond = (fields: object = FIELDS) =>
  jiraSetup.mockImplementation((_org: string, body: { action: string }) =>
    Promise.resolve({
      data: { connect: CONNECT, issue_types: ISSUE_TYPES, fields }[body.action],
    }),
  );

const Host = defineComponent({
  name: "Host",
  props: { credentials: { type: Object, default: () => ({}) } },
  setup(props) {
    const form = useOForm<any>({
      defaultValues: {
        credentials: {
          ...prebuiltDestinationDefaults("jira", props.credentials),
          savedDestination: props.credentials.savedDestination,
        },
      },
      schema: z.object({ credentials: z.record(z.string(), z.unknown()) }),
      onSubmit: () => {},
    });
    return { form };
  },
  render() {
    return h(OForm, { form: this.form, id: "host" }, () => [h(JiraDestinationFields)]);
  },
});

let wrapper: any = null;

const mountFields = async (credentials: Record<string, unknown> = {}) => {
  wrapper = mount(Host, {
    props: { credentials },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
};

const form = () => wrapper.findComponent({ name: "OForm" }).vm.form;
const creds = () => form().state.values.credentials;
const setCred = async (key: string, value: unknown) => {
  form().setFieldValue(`credentials.${key}`, value);
  await flushPromises();
};
const select = (name: string) =>
  wrapper.findAllComponents(OFormSelect).find((c: any) => c.props("name") === name);
const input = (name: string) =>
  wrapper.findAllComponents(OFormInput).find((c: any) => c.props("name") === name);
const actions = () => jiraSetup.mock.calls.map((call) => call[1].action);

const connectNew = async () => {
  await mountFields();
  await setCred("url", "https://acme.atlassian.net/");
  await setCred("email", "alerts-bot@example.com");
  await setCred("token", "secret-token");
  await wrapper.find('[data-test="jira-connect-button"]').trigger("click");
  await flushPromises();
};

beforeEach(() => {
  jiraSetup.mockReset();
  respond();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("JiraDestinationFields - connect", () => {
  it("defaults to Jira Cloud and shows the email field", async () => {
    await mountFields();
    expect(creds().deployment).toBe("cloud");
    expect(input("credentials.email")).toBeTruthy();
  });

  it("hides the email field for Data Center", async () => {
    await mountFields({ deployment: "data_center" });
    expect(input("credentials.email")).toBeUndefined();
  });

  it("asks for the connection fields instead of calling Jira when they are empty", async () => {
    await mountFields();
    await wrapper.find('[data-test="jira-connect-button"]').trigger("click");
    await flushPromises();
    expect(jiraSetup).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="jira-setup-error"]').exists()).toBe(true);
  });

  it("sends the connect request and shows the account and projects", async () => {
    await connectNew();
    expect(jiraSetup).toHaveBeenCalledWith("default", {
      url: "https://acme.atlassian.net",
      deployment: "cloud",
      email: "alerts-bot@example.com",
      token: "secret-token",
      action: "connect",
      project_key: "",
      issue_type_id: "",
      priority_id: "",
      fields: {},
    });
    expect(wrapper.find('[data-test="jira-connected-as"]').text()).toContain("Alerts Bot");
    expect(select("credentials.projectKey").props("options")).toEqual([
      { label: "Operations (OPS)", value: "OPS" },
      { label: "Website (WEB)", value: "WEB" },
    ]);
  });

  it("shows the route's error message when Jira refuses", async () => {
    const message =
      "Jira rejected the token. Make sure that the email and token belong to the same account.";
    jiraSetup.mockRejectedValue({ response: { status: 400, data: { message } } });
    await connectNew();
    expect(wrapper.find('[data-test="jira-setup-error"]').text()).toBe(message);
    expect(wrapper.find('[data-test="jira-project-select"]').exists()).toBe(false);
  });

  it("asks to connect again after the login changes", async () => {
    await connectNew();
    await setCred("token", "other-token");
    expect(creds().connectedAs).toBe("");
    expect(wrapper.find('[data-test="jira-project-select"]').exists()).toBe(false);
  });
});

describe("JiraDestinationFields - dropdowns", () => {
  it("loads issue types for the project, then the fields for the issue type", async () => {
    await connectNew();
    await setCred("projectKey", "OPS");
    expect(actions()).toEqual(["connect", "issue_types"]);
    expect(select("credentials.issueTypeId").props("options")).toEqual([
      { label: "Bug", value: "10004" },
      { label: "Task", value: "10005" },
    ]);

    await setCred("issueTypeId", "10004");
    expect(actions()).toEqual(["connect", "issue_types", "fields"]);
    expect(jiraSetup.mock.calls[2][1]).toMatchObject({
      project_key: "OPS",
      issue_type_id: "10004",
    });
    expect(select("credentials.priorityId").props("options")).toEqual([
      { label: "Highest", value: "1" },
      { label: "Medium", value: "3" },
    ]);
  });

  it("shows a disabled Priority while its options load", async () => {
    await connectNew();
    await setCred("projectKey", "OPS");
    let finish: (value: unknown) => void = () => {};
    jiraSetup.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await setCred("issueTypeId", "10004");

    const pending = wrapper.find('[data-test="jira-priority-loading"]');
    expect(pending.exists()).toBe(true);
    expect(wrapper.find('[data-test="jira-priority-select"]').exists()).toBe(false);

    finish({ data: FIELDS });
    await flushPromises();
    expect(wrapper.find('[data-test="jira-priority-loading"]').exists()).toBe(false);
    expect(select("credentials.priorityId").props("options")).toHaveLength(2);
  });

  it("clears the issue type when the project changes", async () => {
    await connectNew();
    await setCred("projectKey", "OPS");
    await setCred("issueTypeId", "10004");
    await setCred("projectKey", "WEB");
    expect(creds().issueTypeId).toBe("");
    expect(creds().createMeta).toBeUndefined();
    expect(wrapper.find('[data-test="jira-priority-select"]').exists()).toBe(false);
  });
});

describe("JiraDestinationFields - required fields", () => {
  const pickBug = async (fields: object = FIELDS) => {
    respond(fields);
    await connectNew();
    await setCred("projectKey", "OPS");
    await setCred("issueTypeId", "10004");
  };

  it("renders an input for each kind and a notice for an unsupported one", async () => {
    await pickBug();
    expect(input("credentials.fieldValues.customfield_1").props("type")).toBe("text");
    expect(input("credentials.fieldValues.customfield_2").props("type")).toBe("number");
    expect(select("credentials.fieldValues.customfield_3").props("multiple")).toBe(false);
    expect(select("credentials.fieldValues.customfield_3").props("options")).toEqual([
      { label: "SRE", value: "10101" },
    ]);
    expect(select("credentials.fieldValues.components").props("multiple")).toBe(true);
    const notice = wrapper.find('[data-test="jira-unsupported-field-versions"]');
    expect(notice.text()).toContain("Jira requires 'Affects Version' for Bug.");
    expect(wrapper.find('[data-test="jira-labels-missing"]').exists()).toBe(false);
  });

  it("writes the values in the shape Jira expects to the saved fields", async () => {
    await pickBug();
    await setCred("fieldValues.customfield_1", "checkout");
    await setCred("fieldValues.customfield_2", "5");
    await setCred("fieldValues.customfield_3", "10101");
    await setCred("fieldValues.components", ["1", "2"]);
    expect(JSON.parse(creds().fields)).toEqual({
      customfield_1: "checkout",
      customfield_2: 5,
      customfield_3: { id: "10101" },
      components: [{ id: "1" }, { id: "2" }],
    });
  });

  it("shows the labels notice when Labels is not on the create screen", async () => {
    await pickBug({ ...FIELDS, has_labels: false, required_fields: [] });
    expect(wrapper.find('[data-test="jira-labels-missing"]').text()).toContain(
      "The Labels field is not on the create screen for Bug in Operations.",
    );
  });
});

describe("JiraDestinationFields - connected summary", () => {
  it("replaces the inputs with a summary row after Connect", async () => {
    await connectNew();
    expect(wrapper.find('[data-test="jira-connected-as"]').text()).toBe(
      "Connected to acme.atlassian.net as Alerts Bot",
    );
    expect(wrapper.find('[data-test="jira-url-input"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="jira-token-input"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="jira-connect-button"]').exists()).toBe(false);
    expect(creds().token).toBe("secret-token");
  });

  it("clears the project, issue type, priority, fields and token on Change", async () => {
    await connectNew();
    await setCred("projectKey", "OPS");
    await setCred("issueTypeId", "10004");
    await setCred("priorityId", "3");
    await wrapper.find('[data-test="jira-change-button"]').trigger("click");
    await flushPromises();
    expect(creds()).toMatchObject({
      token: "",
      connectedAs: "",
      projectKey: "",
      issueTypeId: "",
      priorityId: "",
      fields: "",
      changing: true,
    });
    expect(creds().createMeta).toBeUndefined();
    expect(wrapper.find('[data-test="jira-token-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="jira-connect-button"]').exists()).toBe(true);
  });

  it("shows the recovery hint and no behavior banner", async () => {
    await connectNew();
    expect(wrapper.find('[data-test="jira-behavior-note"]').exists()).toBe(false);
    expect(input("credentials.token")).toBeUndefined();
    expect(select("credentials.issueTypeId").props("helpText")).toBe(
      "Recovery adds a comment and does not close the ticket.",
    );
  });
});

describe("JiraDestinationFields - edit", () => {
  const saved = {
    deployment: "cloud",
    url: "https://acme.atlassian.net",
    email: "alerts-bot@example.com",
    savedDestination: "jira-ops",
    projectKey: "OPS",
    issueTypeId: "10004",
    priorityId: "3",
    fields: '{"customfield_3":{"id":"10101"},"components":[{"id":"2"}]}',
  };

  it("connects with the saved destination name and an empty token, then loads every list", async () => {
    await mountFields(saved);
    expect(actions()).toEqual(["connect", "issue_types", "fields"]);
    expect(jiraSetup.mock.calls[0][1]).toMatchObject({
      token: "",
      destination: "jira-ops",
      email: "alerts-bot@example.com",
    });
    expect(creds().projectKey).toBe("OPS");
    expect(creds().issueTypeId).toBe("10004");
    expect(creds().priorityId).toBe("3");
    expect(creds().fieldValues).toEqual({ customfield_3: "10101", components: ["2"] });
    expect(JSON.parse(creds().fields)).toEqual({
      customfield_3: { id: "10101" },
      components: [{ id: "2" }],
    });
    expect(wrapper.find('[data-test="jira-connected-summary"]').exists()).toBe(true);
  });

  it("opens the inputs with an error and requires the token when the connect fails", async () => {
    jiraSetup.mockRejectedValue({ response: { status: 400, data: { message: "Token expired" } } });
    await mountFields(saved);
    expect(wrapper.find('[data-test="jira-setup-error"]').text()).toBe("Token expired");
    expect(creds().changing).toBe(true);
    expect(creds().token).toBe("");
    expect(wrapper.find('[data-test="jira-token-input"]').exists()).toBe(true);
  });
});
