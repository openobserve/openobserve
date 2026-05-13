// Copyright 2026 OpenObserve Inc.
import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

vi.mock("@/components/CodeQueryEditor.vue", () => ({
  default: {
    name: "CodeQueryEditor",
    template: '<div data-test="mock-code-editor" />',
    props: [
      "query",
      "language",
      "readOnly",
      "showAutoComplete",
      "showAiIcon",
      "editorId",
    ],
  },
}));

import DbSpanDetails from "./DbSpanDetails.vue";
 
import CodeQueryEditor from "@/components/CodeQueryEditor.vue";

installQuasar();

function mountDbSpanDetails(span: Record<string, unknown> = {}) {
  return mount(DbSpanDetails, { props: { span } });
}

describe("DbSpanDetails", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("editorLanguage", () => {
    it("should return sql by default when db_system is absent", () => {
      wrapper = mountDbSpanDetails({});
      expect(wrapper.vm.editorLanguage).toBe("sql");
    });

    it("should return plaintext when db_system is redis", () => {
      wrapper = mountDbSpanDetails({ db_system: "redis" });
      expect(wrapper.vm.editorLanguage).toBe("plaintext");
    });

    it("should return javascript when db_system is mongodb", () => {
      wrapper = mountDbSpanDetails({ db_system: "mongodb" });
      expect(wrapper.vm.editorLanguage).toBe("javascript");
    });

    it("should return json when db_system is elasticsearch", () => {
      wrapper = mountDbSpanDetails({ db_system: "elasticsearch" });
      expect(wrapper.vm.editorLanguage).toBe("json");
    });

    it("should return sql for any other db_system value", () => {
      wrapper = mountDbSpanDetails({ db_system: "postgresql" });
      expect(wrapper.vm.editorLanguage).toBe("sql");
    });
  });

  describe("queryText", () => {
    it("should return db_query_text when present", () => {
      wrapper = mountDbSpanDetails({ db_query_text: "SELECT 1" });
      expect(wrapper.vm.queryText).toBe("SELECT 1");
    });

    it("should fall back to db_statement when db_query_text is absent", () => {
      wrapper = mountDbSpanDetails({ db_statement: "INSERT INTO t VALUES (1)" });
      expect(wrapper.vm.queryText).toBe("INSERT INTO t VALUES (1)");
    });

    it("should return empty string when neither is present", () => {
      wrapper = mountDbSpanDetails({});
      expect(wrapper.vm.queryText).toBe("");
    });

    it("should prefer db_query_text over db_statement when both present", () => {
      wrapper = mountDbSpanDetails({
        db_query_text: "SELECT 1",
        db_statement: "old statement",
      });
      expect(wrapper.vm.queryText).toBe("SELECT 1");
    });
  });

  describe("hostDisplay", () => {
    it("should return address:port when both server_address and server_port present", () => {
      wrapper = mountDbSpanDetails({
        server_address: "db.example.com",
        server_port: 5432,
      });
      expect(wrapper.vm.hostDisplay).toBe("db.example.com:5432");
    });

    it("should return address only when server_port is absent", () => {
      wrapper = mountDbSpanDetails({ server_address: "db.example.com" });
      expect(wrapper.vm.hostDisplay).toBe("db.example.com");
    });

    it("should fall back to network_peer_address:network_peer_port", () => {
      wrapper = mountDbSpanDetails({
        network_peer_address: "10.0.0.1",
        network_peer_port: 3306,
      });
      expect(wrapper.vm.hostDisplay).toBe("10.0.0.1:3306");
    });

    it("should fall back to network_peer_address alone when no port", () => {
      wrapper = mountDbSpanDetails({ network_peer_address: "10.0.0.1" });
      expect(wrapper.vm.hostDisplay).toBe("10.0.0.1");
    });

    it("should return empty string when no address is present", () => {
      wrapper = mountDbSpanDetails({});
      expect(wrapper.vm.hostDisplay).toBe("");
    });
  });

  describe("tableDisplay", () => {
    it("should return db_collection_name when present", () => {
      wrapper = mountDbSpanDetails({ db_collection_name: "users" });
      expect(wrapper.vm.tableDisplay).toBe("users");
    });

    it("should fall back to db_sql_table when db_collection_name is absent", () => {
      wrapper = mountDbSpanDetails({ db_sql_table: "orders" });
      expect(wrapper.vm.tableDisplay).toBe("orders");
    });

    it("should return empty string when neither present", () => {
      wrapper = mountDbSpanDetails({});
      expect(wrapper.vm.tableDisplay).toBe("");
    });
  });

  describe("metadataRows", () => {
    it("should filter out rows where value is empty", () => {
      wrapper = mountDbSpanDetails({ db_system: "postgresql", db_user: "" });
      const keys = wrapper.vm.metadataRows.map(
        (r: { label: string; value: string; key: string }) => r.key,
      );
      expect(keys).toContain("db-system");
      expect(keys).not.toContain("user");
    });

    it("should include all non-empty fields", () => {
      wrapper = mountDbSpanDetails({
        db_system: "mysql",
        db_operation_name: "SELECT",
        db_namespace: "mydb",
        db_collection_name: "users",
        server_address: "localhost",
        server_port: 3306,
        db_user: "root",
        db_stored_procedure_name: "GetUser",
      });
      const keys = wrapper.vm.metadataRows.map(
        (r: { label: string; value: string; key: string }) => r.key,
      );
      expect(keys).toEqual([
        "db-system",
        "operation",
        "namespace",
        "table",
        "host",
        "user",
        "stored-proc",
      ]);
    });
  });

  describe("hasPerformanceData", () => {
    it("should return false when no performance attributes present", () => {
      wrapper = mountDbSpanDetails({ db_system: "postgresql" });
      expect(wrapper.vm.hasPerformanceData).toBe(false);
    });

    it("should return true when db_response_returned_rows present", () => {
      wrapper = mountDbSpanDetails({ db_response_returned_rows: 42 });
      expect(wrapper.vm.hasPerformanceData).toBe(true);
    });

    it("should return true when db_operation_batch_size present", () => {
      wrapper = mountDbSpanDetails({ db_operation_batch_size: 3 });
      expect(wrapper.vm.hasPerformanceData).toBe(true);
    });

    it("should return true when db_response_status_code present", () => {
      wrapper = mountDbSpanDetails({ db_response_status_code: "08P01" });
      expect(wrapper.vm.hasPerformanceData).toBe(true);
    });

    it("should return true when db_query_summary present", () => {
      wrapper = mountDbSpanDetails({ db_query_summary: "SELECT users" });
      expect(wrapper.vm.hasPerformanceData).toBe(true);
    });
  });

  describe("metadata grid rendering", () => {
    it("should render the metadata grid", () => {
      wrapper = mountDbSpanDetails({ db_system: "postgresql" });
      expect(
        wrapper.find('[data-test="traces-db-span-details-metadata-grid"]').exists(),
      ).toBe(true);
    });

    it("should show a row for each non-empty metadata field", () => {
      wrapper = mountDbSpanDetails({
        db_system: "mysql",
        db_operation_name: "SELECT",
      });
      const grid = wrapper.find('[data-test="traces-db-span-details-metadata-grid"]');
      expect(grid.text()).toContain("DB System");
      expect(grid.text()).toContain("mysql");
      expect(grid.text()).toContain("Operation");
      expect(grid.text()).toContain("SELECT");
    });

    it("should not render a row when the attribute value is empty", () => {
      wrapper = mountDbSpanDetails({ db_system: "postgresql" });
      const grid = wrapper.find('[data-test="traces-db-span-details-metadata-grid"]');
      expect(grid.text()).not.toContain("User");
      expect(grid.text()).not.toContain("Stored Procedure");
    });

    it("should display host as address:port combination", () => {
      wrapper = mountDbSpanDetails({
        server_address: "db.internal",
        server_port: 5432,
      });
      const grid = wrapper.find('[data-test="traces-db-span-details-metadata-grid"]');
      expect(grid.text()).toContain("db.internal:5432");
    });
  });

  describe("query code block", () => {
    it("should render the query editor wrapper", () => {
      wrapper = mountDbSpanDetails({ db_query_text: "SELECT 1" });
      expect(
        wrapper.find('[data-test="traces-db-span-details-query-editor"]').exists(),
      ).toBe(true);
    });

    it("should render CodeQueryEditor when query text is present", () => {
      wrapper = mountDbSpanDetails({ db_query_text: "SELECT 1" });
      expect(wrapper.find('[data-test="mock-code-editor"]').exists()).toBe(true);
    });

    it("should not render CodeQueryEditor when query text is absent", () => {
      wrapper = mountDbSpanDetails({});
      expect(wrapper.find('[data-test="mock-code-editor"]').exists()).toBe(false);
    });

    it("should render no-query placeholder when query text is absent", () => {
      wrapper = mountDbSpanDetails({});
      expect(
        wrapper.find('[data-test="traces-db-span-details-no-query"]').exists(),
      ).toBe(true);
    });

    it("should not render no-query placeholder when query text is present", () => {
      wrapper = mountDbSpanDetails({ db_query_text: "SELECT 1" });
      expect(
        wrapper.find('[data-test="traces-db-span-details-no-query"]').exists(),
      ).toBe(false);
    });

    it("should pass the correct language to the editor", () => {
      wrapper = mountDbSpanDetails({
        db_system: "mongodb",
        db_query_text: "db.users.find({})",
      });
      const editor = wrapper.findComponent(CodeQueryEditor);
      expect(editor.props("language")).toBe("javascript");
    });

    it("should render editor as readOnly", () => {
      wrapper = mountDbSpanDetails({ db_query_text: "SELECT 1" });
      const editor = wrapper.findComponent(CodeQueryEditor);
      expect(editor.props("readOnly")).toBe(true);
    });
  });

  describe("performance section", () => {
    it("should not render performance section when no performance data present", () => {
      wrapper = mountDbSpanDetails({ db_system: "postgresql" });
      expect(
        wrapper.find('[data-test="traces-db-span-details-performance"]').exists(),
      ).toBe(false);
    });

    it("should render performance section when db_response_returned_rows present", () => {
      wrapper = mountDbSpanDetails({ db_response_returned_rows: 10 });
      expect(
        wrapper.find('[data-test="traces-db-span-details-performance"]').exists(),
      ).toBe(true);
    });

    it("should show rows returned value", () => {
      wrapper = mountDbSpanDetails({ db_response_returned_rows: 42 });
      expect(
        wrapper.find('[data-test="traces-db-span-details-performance"]').text(),
      ).toContain("42");
    });

    it("should show batch size value", () => {
      wrapper = mountDbSpanDetails({ db_operation_batch_size: 5 });
      expect(
        wrapper.find('[data-test="traces-db-span-details-performance"]').text(),
      ).toContain("5");
    });

    it("should show query summary value", () => {
      wrapper = mountDbSpanDetails({ db_query_summary: "SELECT users" });
      expect(
        wrapper.find('[data-test="traces-db-span-details-performance"]').text(),
      ).toContain("SELECT users");
    });

    it("should show response status code value", () => {
      wrapper = mountDbSpanDetails({ db_response_status_code: "08P01" });
      expect(
        wrapper.find('[data-test="traces-db-span-details-performance"]').text(),
      ).toContain("08P01");
    });
  });
});
