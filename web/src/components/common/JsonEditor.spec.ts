import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import JsonEditor from "@/components/common/JsonEditor.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

// Mock the dependencies
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `/mocked/${path}`),
  useLocalOrganization: vi.fn(() => ({ identifier: "default", name: "Default Org" })),
  useLocalCurrentUser: vi.fn(() => ({ email: "test@example.com", name: "Test User" })),
  useLocalTimezone: vi.fn(() => "UTC")
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true"
  }
}));

vi.mock("@/plugins/pipelines/useDnD", () => ({
  default: () => ({
    pipelineObj: { value: {} }
  })
}));

vi.mock("@/types/chat", () => ({}));

describe("JsonEditor", () => {
  let wrapper: any = null;

  const defaultProps = {
    data: { name: "Test", id: "123" },
    title: "JSON Editor Test",
    type: "alerts"
  };

  beforeEach(() => {
    store.state.theme = "light";
    store.state.isAiChatEnabled = false;
    store.state.zoConfig = { 
      sql_mode: false,
      version: "test",
      sql_mode_manual_trigger: false,
      commit_hash: "test",
      build_date: "test",
      default_fts_keys: [],
      show_stream_stats_doc_num: true,
      data_retention_days: true,
      extended_data_retention_days: 30,
      user_defined_schemas_enabled: true,
      super_cluster_enabled: false,
      query_on_stream_selection: false,
      default_functions: [],
      timestamp_column: "_timestamp"
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(JsonEditor, {
      props: {
        ...defaultProps,
        ...props
      },
      global: {
        plugins: [i18n],
        provide: {
          store,
        },
        stubs: {
          'query-editor': {
            template: '<div class="monaco-editor" @update:query="$emit(\'update:query\', $event)"><slot /></div>'
          },
          'O2AIChat': {
            template: '<div class="o2-ai-chat"><slot /></div>'
          }
        }
      },
    });
  };

  it("should mount JsonEditor component", () => {
    wrapper = createWrapper();
    expect(wrapper).toBeTruthy();
  });

  it("should have correct props", () => {
    wrapper = createWrapper();
    expect(wrapper.props('data')).toEqual({ name: "Test", id: "123" });
    expect(wrapper.props('title')).toBe("JSON Editor Test");
    expect(wrapper.props('type')).toBe("alerts");
  });

  it("should render without errors", () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
  });
});