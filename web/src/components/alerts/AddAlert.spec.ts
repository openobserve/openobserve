// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AddAlert from "@/components/alerts/AddAlert.vue";
import alertsService from "@/services/alerts";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import { installQuasar } from "@/test/unit/helpers";
import router from "@/test/unit/helpers/router";

import PreviewAlert from "@/components/alerts/PreviewAlert.vue";

import i18n from "@/locales";
import cronParser from "cron-parser";

import { useLocalOrganization } from "@/utils/zincutils";

import searchService from "@/services/search";

installQuasar({
  plugins: [Dialog, Notify],
});
vi.mock('@/composables/useStreams', () => {
  return {
    default: () => ({
      getStream: vi.fn().mockResolvedValue({
        schema: [
          { name: 'field1', type: 'string' },
          { name: 'field2', type: 'int' },
        ]
      }),
      getStreams: vi.fn(),
    }),
  };
});

vi.mock('@/composables/useFunctions', () => {
  return {
    default: () => ({
      getAllFunctions: vi.fn().mockResolvedValue({
        functions: [
          { name: 'avg', description: 'Average' },
          { name: 'sum', description: 'Sum' },
        ]
      }),
    }),
  };
});
vi.mock('@/services/search', () => ({
  default: {
    search: vi.fn()
  }
}));



vi.mock('@/composables/useParser', () => {
  return {
    default: () => ({
      sqlParser: async () => ({
        astify: vi.fn((query) => {
          const lowerQuery = query.toLowerCase();
        
          if (lowerQuery.includes("select *")) {
            return {
              columns: [
                { expr: { column: "*" } }
              ]
            };
          }
          if (lowerQuery.includes("valid_column")) {
            return {
              columns: [
                { expr: { column: "valid_column" } }
              ]
            };
          }
          if (lowerQuery.includes("default")) {
            throw new Error("Syntax error near 'default'");
          }
          return { columns: [] };
        }),
        sqlify: vi.fn(),
        columnList: vi.fn(),
        tableList: vi.fn(),
        whiteListCheck: vi.fn(),
        exprToSQL: vi.fn(),
        parse: vi.fn(),
      })
    })
  };
});

vi.mock('cron-parser', () => {
  return {
    default: {
      parseExpression: vi.fn()
    }
  };
});
vi.mock('@/utils/zincutils', async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual, // include all actual exports
    getUUID: vi.fn(() => 'mock-uuid'), // override just getUUID
  };
});
vi.mock('@/services/alerts', () => {
  return {
    default: {
      create_by_alert_id: vi.fn(() =>
        Promise.resolve({
          data: {
            code: 200,
            message: "Alert saved",
            id: "2yis4t0dJCU7Vs4D3sEYHDsvDKF",
            name: "test_alert"
          }
        })
      ),
      update_by_alert_id: vi.fn(() =>
        Promise.resolve({
          data: { success: true }
        })
      )
    }
  };
});


describe("AddAlert Component", () => {
  let wrapper: any;

  // Ensure async operations are complete
  beforeEach(async () => {
    const updateStreamsMock = vi.fn().mockResolvedValue({ success: true });

    

    wrapper = mount(AddAlert, {
      global: {
        provide: { 
          store: store,
        },
        plugins: [i18n, router],
      },
      props: {
        title: "Add Alert",
      },
      mocks: {
        updateStreams: updateStreamsMock,
      },
    });

    wrapper.vm.formData = {
        name: "",
        stream_type: "",
        stream_name: "",
        is_real_time: "false",
        query_condition: {
          conditions: 
          {
            "or": [
                {
                    "column": "",
                    "operator": ">",
                    "value": "",
                    "ignore_case": false
                }
            ]
            },
          sql: "",
          promql: "",
          type: "custom",
          aggregation: {
            group_by: [""],
            function: "avg",
            having: {
              column: "",
              operator: ">=",
              value: 1,
            },
          },
          promql_condition: null,
          vrl_function: null,
          multi_time_range: [],
        },
        trigger_condition: {
          period: 10,
          operator: ">=",
          frequency: 1,
          cron: "",
          threshold: 3,
          silence: 10,
          frequency_type: "minutes",
          timezone: "UTC",
        },
        destinations: [],
        context_attributes: [],
        enabled: true,
        description: "",
        lastTriggeredAt: 0,
        createdAt: "",
        updatedAt: "",
        owner: "",
        lastEditedBy: "",
        folder_id : "",

    }
  });

  describe("Functions with input and output as expected", () => {
    describe('general functions', () => {
      it('filters streams via filterStreams', async () => {
        // Setup indexOptions in the component
        wrapper.vm.indexOptions = ['stream1', 'stream2', 'logstream', 'metrics'];
        wrapper.vm.filteredStreams = [];
      
        const mockUpdate = (cb: Function) => cb(); // immediately execute callback
      
        // Call the filterStreams method
        wrapper.vm.filterStreams('stream', mockUpdate);
        await wrapper.vm.$nextTick(); // wait for reactivity to apply
      
        // Verify the result
        expect(wrapper.vm.filteredStreams).toEqual(['stream1', 'stream2', 'logstream']);
      });
      it('returns all streams when filter input is empty', async () => {
        wrapper.vm.indexOptions = ['stream1', 'stream2', 'logstream', 'metrics'];
        wrapper.vm.filteredStreams = [];
      
        const mockUpdate = (cb: Function) => cb();
      
        wrapper.vm.filterStreams('', mockUpdate);
        await wrapper.vm.$nextTick();
      
        expect(wrapper.vm.filteredStreams).toEqual(['stream1', 'stream2', 'logstream', 'metrics']);
      });
      it('updates stream fields via updateStreamFields', async () => {
  
        await flushPromises();
    
        // 🧪 2. Mock onInputUpdate
        wrapper.vm.onInputUpdate = vi.fn();
    
        // 🧪 4. Call the function
        await wrapper.vm.updateStreamFields('testStream');
        await wrapper.vm.$nextTick();
    
        // 🧪 5. Expect originalStreamFields and filteredColumns to be updated
        const expected = [
          { label: 'field1', value: 'field1', type: 'string' },
          { label: 'field2', value: 'field2', type: 'int' }
        ];
    
        expect(wrapper.vm.originalStreamFields).toEqual(expected);
        expect(wrapper.vm.filteredColumns).toEqual(expected);
    
      });
    });

    describe('generateWhereClause function with all the possible combinations', () => {
      beforeEach(() => {
        wrapper.vm.streamFieldsMap = {
          age: { type: 'Int64' },
          city: { type: 'String' },
        };
        });
      it('generates a simple where clause', () => {
        const group = {
          label: 'AND',
          items: [
            { column: 'age', operator: '>', value: 30 }
          ]
        };
    
        const result = wrapper.vm.generateWhereClause(group, wrapper.vm.streamFieldsMap);
        expect(result).toBe("WHERE age > '30'");
      });
    
      it('handles string value with quotes', () => {
        const group = {
          label: 'AND',
          items: [
            { column: 'city', operator: '=', value: 'delhi' }
          ]
        };
    
        const result = wrapper.vm.generateWhereClause(group, wrapper.vm.streamFieldsMap);
        expect(result).toBe("WHERE city = 'delhi'");
      });
    
      it('handles contains operator without quotes', () => {
        const group = {
          label: 'AND',
          items: [
            { column: 'city', operator: 'contains', value: 'delhi' }
          ]
        };
    
        const result = wrapper.vm.generateWhereClause(group, wrapper.vm.streamFieldsMap);
        expect(result).toBe("WHERE city LIKE '%delhi%'");
      });
    
      it('handles nested groups with AND/OR', () => {
        const group = {
          label: 'AND',
          items: [
            { column: 'age', operator: '>', value: 30 },
            {
              label: 'OR',
              items: [
                { column: 'city', operator: '=', value: 'delhi' },
                { column: 'city', operator: '=', value: 'mumbai' }
              ]
            }
          ]
        };
    
        const result = wrapper.vm.generateWhereClause(group, wrapper.vm.streamFieldsMap);
        expect(result).toBe("WHERE age > '30' AND (city = 'delhi' OR city = 'mumbai')");
      });
    
      it('returns empty string if group is invalid', () => {
        const result = wrapper.vm.generateWhereClause(null, wrapper.vm.streamFieldsMap);
        expect(result).toBe("");
      });
    })
    describe('generateSqlQuery function with all the possible combinations', () => {
      beforeEach(() => {
        wrapper.vm.originalStreamFields = [
          { value: 'geo_info_country', type: 'string', label: 'geo_info_country' }
        ];
      
        wrapper.vm.formData.query_condition.conditions = {
          label: 'or',
          items: [
            {
              column: 'geo_info_country',
              operator: '=',
              value: 'india',
            },
          ],
        };
        wrapper.vm.formData.query_condition.aggregation.function = "";
        wrapper.vm.formData.query_condition.aggregation.having.column = "";
        wrapper.vm.formData.query_condition.aggregation.having.operator = ">=";
        wrapper.vm.formData.query_condition.aggregation.having.value = 1;
        wrapper.vm.formData.stream_name = "_rundata";
        wrapper.vm.formData.stream_type = "logs";

        wrapper.vm.generateWhereClause = vi.fn().mockReturnValue("WHERE geo_info_country = 'india'");

        wrapper.vm.isAggregationEnabled = false;

      });

      it('generates basic count query when aggregation is disabled', async () => {
        // Set aggregation disabled
        wrapper.vm.isAggregationEnabled = false;
        wrapper.vm.generateWhereClause = vi.fn().mockReturnValue("WHERE geo_info_country = 'india'");


        const result = wrapper.vm.generateSqlQuery();
        await flushPromises();
        expect(result).toBe(
          'SELECT histogram(_timestamp) AS zo_sql_key, COUNT(*) as zo_sql_val FROM "_rundata" WHERE geo_info_country = \'india\' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC'
        );
      });
      it('generates query with aggregation function and no groupBy', async () => {
        wrapper.vm.isAggregationEnabled = true;
        wrapper.vm.formData.query_condition.aggregation.function = 'avg';
        wrapper.vm.formData.query_condition.aggregation.having.column = 'action_error_count';
        wrapper.vm.formData.query_condition.aggregation.group_by = [];
      
        const result = wrapper.vm.generateSqlQuery();
        await flushPromises();
      
        expect(result).toBe(
          'SELECT histogram(_timestamp) AS zo_sql_key, avg(action_error_count) as zo_sql_val  FROM "_rundata" WHERE geo_info_country = \'india\' GROUP BY zo_sql_key  ORDER BY zo_sql_key ASC'
        );
      });
      it('generates query with groupBy and aggregation function', async () => {
        wrapper.vm.isAggregationEnabled = true;
        wrapper.vm.formData.query_condition.aggregation.function = 'avg';
        wrapper.vm.formData.query_condition.aggregation.having.column = 'action_error_count';
        wrapper.vm.formData.query_condition.aggregation.group_by = ['geo_info_city'];
      
        const result = wrapper.vm.generateSqlQuery();
        await flushPromises();
      
        expect(result).toBe(
          'SELECT histogram(_timestamp) AS zo_sql_key, avg(action_error_count) as zo_sql_val , concat(geo_info_city) as x_axis_2 FROM "_rundata" WHERE geo_info_country = \'india\' GROUP BY zo_sql_key , x_axis_2 ORDER BY zo_sql_key ASC'
        );
      });
      it('generates query with percentile aggregation function', async () => {
        wrapper.vm.isAggregationEnabled = true;
        wrapper.vm.formData.query_condition.aggregation.function = 'p95';
        wrapper.vm.formData.query_condition.aggregation.having.column = 'latency';
        wrapper.vm.formData.query_condition.aggregation.group_by = [];
      
        const result = wrapper.vm.generateSqlQuery();
        await flushPromises();
      
        expect(result).toBe(
          'SELECT histogram(_timestamp) AS zo_sql_key, approx_percentile_cont(latency, 0.95) as zo_sql_val  FROM "_rundata" WHERE geo_info_country = \'india\' GROUP BY zo_sql_key  ORDER BY zo_sql_key ASC'
        );
      });
      
      
      

      afterEach(() => {
        vi.restoreAllMocks();
      });
    });
    describe('getParser', () => {
      beforeEach(() => {
        wrapper.vm.sqlQueryErrorMsg = "";
      });
    

      it('returns false and sets error for query with *', async() => {
        const result = wrapper.vm.getParser("SELECT * FROM INDEX_NAME");
        await flushPromises();
        expect(result).toBe(false);
        expect(wrapper.vm.sqlQueryErrorMsg).toBe("Selecting all columns is not allowed");
      });
    
      it('returns true for valid query without *', () => {
        const result = wrapper.vm.getParser("SELECT valid_column FROM my_table");
        expect(result).toBe(true);
        expect(wrapper.vm.sqlQueryErrorMsg).toBe("");
      });
      it('returns true when parser throws an error (e.g. reserved keyword)', () => {
        const result = wrapper.vm.getParser("SELECT field FROM default");
        expect(result).toBe(true);
        expect(wrapper.vm.sqlQueryErrorMsg).toBe(""); // No change expected
      });
    });

    describe('getAlertPayload', () => {

      beforeEach(() => {
        wrapper.vm.formData = {
            uuid: 'abc-123',
            is_real_time: 'true',
            description: '  Sample Alert  ',
            query_condition: {
              type: 'custom',
              vrl_function: null,
              sql: undefined,
              aggregation: null,
              conditions: [{ column: 'status', operator: '=', value: '200' }],
              promql_condition: null
            },
            trigger_condition: {
              threshold: '5',
              period: '60',
              frequency: '10',
              silence: '15',
            },
            context_attributes: [
              { key: 'env', value: 'prod' },
              { key: 'team', value: 'infra' },
            ]
          }
      });
      it('generates correct payload for a new alert in custom tab', () => {
        const { formData, getSelectedTab, isAggregationEnabled, store, beingUpdated } = wrapper.vm;
      
        const result = wrapper.vm.getAlertPayload();
      
        expect(result.uuid).toBeUndefined();
        expect(result.is_real_time).toBe(true);
        expect(result.context_attributes).toEqual({
          env: 'prod',
          team: 'infra'
        });
        expect(result.query_condition.type).toBe('custom');
        expect(result.trigger_condition.threshold).toBe(5);
        expect(result.trigger_condition.period).toBe(60);
        expect(result.trigger_condition.frequency).toBe(10);
        expect(result.trigger_condition.silence).toBe(15);
        expect(result.description).toBe('Sample Alert');
        expect(result.query_condition.aggregation).toBeNull();
        expect(result.query_condition.promql_condition).toBeNull();
        expect(result.query_condition.sql).toBeUndefined();
        expect(result.createdAt).toBeDefined();
        expect(result.owner).toBe(wrapper.vm.store.state.userInfo.email);
        expect(result.lastTriggeredAt).toBeGreaterThan(0);
        expect(result.lastEditedBy).toBe(wrapper.vm.store.state.userInfo.email);
      });
      
    
    });

    describe('validate input fields with all the possible combinations', () => {
      it('passes validation for real-time alert', () => {
        wrapper.vm.formData.is_real_time = true;
        wrapper.vm.formData.trigger_condition.silence = 5;
      
        const result = wrapper.vm.validateInputs(wrapper.vm.formData, false);
        expect(result).toBe(true);
      });
      it('fails when silence is NaN', () => {
        wrapper.vm.formData.trigger_condition.silence = "a";

        const notifyMock = vi.fn();
        wrapper.vm.q.notify = notifyMock;
      
        const result = wrapper.vm.validateInputs(wrapper.vm.formData);
        expect(result).toBe(false);
          expect(wrapper.vm.q.notify).toHaveBeenCalledWith(expect.objectContaining({
          message: 'Silence Notification should not be empty'
        }));
      });
      it('fails when period is < 1 or NaN', () => {
        wrapper.vm.formData.trigger_condition.period = 0;
        wrapper.vm.formData.is_real_time = false;
        const notifyMock = vi.fn();
        wrapper.vm.q.notify = notifyMock;
      
        const result = wrapper.vm.validateInputs(wrapper.vm.formData);
        expect(result).toBe(false);
        expect(wrapper.vm.q.notify).toHaveBeenCalledWith(expect.objectContaining({
          message: 'Period should be greater than 0'
        }));
      });
      it('fails when aggregation fields are incomplete', () => {
        wrapper.vm.formData.is_real_time = false;
        wrapper.vm.formData.trigger_condition.threshold = "a";
        const notifyMock = vi.fn();
        wrapper.vm.q.notify = notifyMock;
      
        const result = wrapper.vm.validateInputs(wrapper.vm.formData);
        expect(result).toBe(false);
        expect(wrapper.vm.q.notify).toHaveBeenCalledWith(expect.objectContaining({
          message: 'Threshold should not be empty'
        }));
      });
      it('fails when invalid cron expression is passed', () => {
        cronParser.parseExpression = vi.fn().mockImplementation(() => {
          throw new Error('Invalid cron');
        });
        wrapper.vm.scheduledAlertRef = {
          cronJobError: ''
        };
      


        wrapper.vm.formData.is_real_time = false;
        wrapper.vm.formData.query_condition.aggregation = null;
        wrapper.vm.formData.trigger_condition.silence = '5';
        wrapper.vm.formData.trigger_condition.period = '60';
        wrapper.vm.formData.trigger_condition.threshold = '10';
        wrapper.vm.formData.trigger_condition.frequency_type = 'cron';
        wrapper.vm.formData.trigger_condition.operator = '>';
        wrapper.vm.formData.trigger_condition.cron = '';
      
        const result = wrapper.vm.validateInputs(wrapper.vm.formData);
        expect(result).toBeUndefined(); // function returns nothing in this case
        expect(wrapper.vm.scheduledAlertRef.cronJobError).toBe('Invalid cron expression!');
      });
      it('fails when scheduledAlertRef has cronJobError after validation', () => {
        cronParser.parseExpression = vi.fn().mockImplementation(() => {
          return {
              next: vi.fn(),
          }
        });

        const notifyMock = vi.fn();
        wrapper.vm.q.notify = notifyMock;
        wrapper.vm.scheduledAlertRef = {
          cronJobError: '',
          validateFrequency: vi.fn(),
        };
      
        wrapper.vm.formData.is_real_time = false
        wrapper.vm.formData.trigger_condition.silence = '5';
        wrapper.vm.formData.trigger_condition.period = '60';
        wrapper.vm.formData.trigger_condition.threshold = '10';
        wrapper.vm.formData.trigger_condition.frequency_type = 'cron';
        wrapper.vm.formData.trigger_condition.operator = '>';
        wrapper.vm.formData.trigger_condition.cron = '* * * * *';
        wrapper.vm.formData.query_condition.aggregation = null

        wrapper.vm.scheduledAlertRef.cronJobError = 'Invalid cron!';
      
        const result = wrapper.vm.validateInputs(wrapper.vm.formData);
        expect(result).toBe(false);
        expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
          message: 'Invalid cron!'
        }));
      });
      
      
      
    });
    describe('onSubmit', () => {
      let notifyMock: any;
      beforeEach(() => {
        window.HTMLElement.prototype.scrollIntoView = vi.fn();
        wrapper.vm.q = {
          notify: vi.fn().mockReturnValue(() => {})
        };
                wrapper.vm.navigateToErrorField = vi.fn();
          wrapper.vm.validateFormAndNavigateToErrorField = vi.fn().mockResolvedValue(true);
          wrapper.vm.validateSqlQueryPromise = vi.fn().mockResolvedValue(true);
      });
      it.skip('should submit alert successfully for creating new alert', async () => {
        const createAlertSpy = vi.spyOn(alertsService, 'create_by_alert_id');
        wrapper.vm.q = {
          notify: vi.fn(() => vi.fn())
        };

        wrapper.vm.formData.name = "test_alert";
        wrapper.vm.formData.stream_name = "_rundata";
        wrapper.vm.formData.stream_type = "logs";
        wrapper.vm.formData.query_condition.conditions = {
          "or": [
            { "column": "status", "operator": "=", "value": "200" }
          ]
        };
        wrapper.vm.formData.query_condition.aggregation = null;
        wrapper.vm.formData.query_condition.promql_condition = null;
        wrapper.vm.formData.query_condition.sql = undefined;
        wrapper.vm.formData.query_condition.vrl_function = null;
        wrapper.vm.formData.query_condition.multi_time_range = [];
        wrapper.vm.formData.query_condition.type = "custom";
        wrapper.vm.formData.query_condition.vrl_function = null;
        wrapper.vm.formData.query_condition.sql = undefined;
        wrapper.vm.formData.query_condition.promql_condition = null;
        wrapper.vm.formData.query_condition.aggregation = null;
        wrapper.vm.formData.destinations = ['test_destinations'];
        wrapper.vm.formData.context_attributes = ['test_context_attributes'];
        wrapper.vm.formData.enabled = true;
        wrapper.vm.formData.owner = 'test_owner';
        wrapper.vm.formData.lastTriggeredAt = 0;
        wrapper.vm.formData.lastEditedBy = '122122122';
        wrapper.vm.formData.folder_id = 'test_folder_id';

        await wrapper.vm.validateInputs(wrapper.vm.formData);
        await wrapper.vm.getAlertPayload();
        await wrapper.vm.onSubmit();
        await flushPromises();


        let mockResponse: any = {
          data: {
            "code": 200,
            "message": "Alert saved",
            "id": "2yis4t0dJCU7Vs4D3sEYHDsvDKF",
            "name": "test_alert"
          },
        }

        vi.mocked(alertsService.create_by_alert_id).mockResolvedValue(mockResponse);


        await flushPromises();
        //because we reset the data in the formData after the alert is saved
        expect(wrapper.vm.formData.name).toBe('');
        expect(wrapper.vm.formData.stream_name).toBe('');
        expect(wrapper.vm.formData.stream_type).toBe('');

      });

      it.skip('should update alert successfully for updating existing alert', async () => {
        wrapper.vm.q = {
          notify: vi.fn(() => vi.fn()) 
        };
        wrapper.vm.formData.name = "test_alert_for_updating";
        wrapper.vm.formData.id = "2yis4t0dJCU7Vs4D3sEYHDsvDKF";
        wrapper.vm.formData.is_real_time = "false";
        wrapper.vm.beingUpdated = true;
        wrapper.vm.formData.stream_name = "_rundata";
        wrapper.vm.formData.stream_type = "logs";
        wrapper.vm.formData.query_condition.conditions = {
          "or": [
            { "column": "status", "operator": "=", "value": "200" }
          ]
        };
        wrapper.vm.formData.query_condition.aggregation = null;
        wrapper.vm.formData.query_condition.promql_condition = null;
        wrapper.vm.formData.query_condition.sql = undefined;
        wrapper.vm.formData.query_condition.vrl_function = null;
        wrapper.vm.formData.query_condition.multi_time_range = [];
        wrapper.vm.formData.query_condition.type = "custom";
        wrapper.vm.formData.query_condition.vrl_function = null;
        wrapper.vm.formData.query_condition.sql = undefined;
        wrapper.vm.formData.query_condition.promql_condition = null;
        wrapper.vm.formData.query_condition.aggregation = null;
        wrapper.vm.formData.destinations = ['test_destinations'];
        wrapper.vm.formData.context_attributes = ['test_context_attributes'];
        wrapper.vm.formData.enabled = true;
        wrapper.vm.formData.owner = 'test_owner';
        wrapper.vm.formData.lastTriggeredAt = 0;
        wrapper.vm.formData.lastEditedBy = '122122122';
        wrapper.vm.formData.folder_id = 'test_folder_id';

        await wrapper.vm.validateInputs(wrapper.vm.formData);
        await wrapper.vm.getAlertPayload();
        await wrapper.vm.onSubmit();
        await flushPromises();


        let mockResponse: any = {
          data: {
            "code": 200,
            "message": "Alert updated",
            "id": "2yis4t0dJCU7Vs4D3sEYHDsvDKF",
            "name": "test_alert_for_updating"
          },
        }

        vi.mocked(alertsService.update_by_alert_id).mockResolvedValue(mockResponse);

        await flushPromises();
        //because we reset the data in the formData after the alert is saved
        expect(wrapper.vm.formData.name).toBe('');
        expect(wrapper.vm.formData.stream_name).toBe('');
        expect(wrapper.vm.formData.stream_type).toBe('');
      });

      it('should wait for validateSqlQueryPromise to resolve successfully', async () => {
        wrapper.vm.q = {
          notify: vi.fn(() => vi.fn())
        };
      
        // Required for triggering that SQL block
        wrapper.vm.formData.is_real_time = "false";
        wrapper.vm.formData.query_condition.type = "sql";
        wrapper.vm.formData.query_condition.sql = "SELECT * FROM test_table";
      
        // Provide a fake resolve
        wrapper.vm.validateSqlQueryPromise = Promise.resolve();
      
        // Return valid payload
        wrapper.vm.getAlertPayload = vi.fn(() => ({
          query_condition: {
            type: "sql",
            conditions: [],
          },
        }));
      
        // Mock alertsService.create_by_alert_id
        vi.mocked(alertsService.create_by_alert_id).mockResolvedValue({
          data: {
            code: 200,
            message: "Success",
          }
        });
      
        // Bypass validation
        wrapper.vm.validateFormAndNavigateToErrorField = vi.fn().mockResolvedValue(true);
        wrapper.vm.validateInputs = vi.fn().mockReturnValue(true);
        wrapper.vm.transformFEToBE = vi.fn().mockReturnValue([]);
      
        await wrapper.vm.onSubmit();
        await flushPromises();
        expect(wrapper.vm.formData.name).toBe('');
        expect(wrapper.vm.formData.stream_name).toBe('');
        expect(wrapper.vm.formData.stream_type).toBe('');
      });
      it('should show error when validateSqlQueryPromise rejects', async () => {
        const dismissMock = vi.fn();
        wrapper.vm.q = {
          notify: vi.fn(() => dismissMock)
        };
      
        wrapper.vm.formData.is_real_time = "false";
        wrapper.vm.formData.query_condition.type = "sql";
        wrapper.vm.formData.query_condition.sql = "SELECT * FROM test_table";
        wrapper.vm.formData.query_condition.cron = '* * * * *';
            
        wrapper.vm.getAlertPayload = vi.fn(() => ({
          query_condition: {
            type: "sql",
            conditions: [],
          },
        }));
      
        // Bypass validation
        wrapper.vm.validateFormAndNavigateToErrorField = vi.fn().mockResolvedValue(true);
        wrapper.vm.validateInputs = vi.fn().mockReturnValue(true);
        wrapper.vm.transformFEToBE = vi.fn().mockReturnValue([]);
      
        await wrapper.vm.onSubmit();
        await flushPromises();

          expect(wrapper.vm.q.notify).toHaveBeenCalledWith(
          expect.objectContaining({
            "message": "Selecting all Columns in SQL query is not allowed.",
            "timeout": 1500,
          })
        );
      });
      
      
    });
    describe('validateSqlQuery', () => {
      beforeEach(() => {
        wrapper.vm.q = { notify: vi.fn() };
        wrapper.vm.getParser = vi.fn(() => true);
    
        wrapper.vm.formData.query_condition.vrl_function = '';
        wrapper.vm.formData.query_condition.type = 'sql';
        wrapper.vm.formData.stream_name = '_rundata';
        wrapper.vm.formData.stream_type = 'logs';
    
        wrapper.vm.buildQueryPayload = vi.fn(() => ({
          query: { start_time: 100000 },
          aggs: {}
        }));
    
        wrapper.vm.store = {
          state: {
            selectedOrganization: { identifier: 'org-123' }
          }
        };
      });
    
      it('validates successfully when SQL is valid', async () => {
        wrapper.vm.formData.query_condition.sql = 'SELECT * FROM "_rundata"';

        searchService.search.mockResolvedValue({ data: {} });
    
        await wrapper.vm.validateSqlQuery();
        await flushPromises();
    
        expect(wrapper.vm.sqlQueryErrorMsg).toBe('Selecting all columns is not allowed');
      });

          
      it('validates successfully when SQL is valid', async () => {
        wrapper.vm.formData.query_condition.sql = 'SELECT job FROM "_rundata"';

        searchService.search.mockResolvedValue({ data: {} });
    
        await wrapper.vm.validateSqlQuery();
        await flushPromises();
    
        expect(wrapper.vm.sqlQueryErrorMsg).toBe('');
      });

    });
    describe('retransformBEToFE', () => {
      it('should return null if input is null or undefined', () => {
        expect(wrapper.vm.retransformBEToFE(null)).toBeNull();
        expect(wrapper.vm.retransformBEToFE(undefined)).toBeNull();
      });
    
      it('should return null if input has multiple keys', () => {
        const invalid = { and: [], or: [] };
        expect(wrapper.vm.retransformBEToFE(invalid)).toBeNull();
      });
    
      it('should transform a simple AND condition', () => {
        const input = {
          and: [
            { column: 'name', operator: '=', value: 'John', ignore_case: false }
          ]
        };
    
        const result = wrapper.vm.retransformBEToFE(input);
    
        expect(result).toEqual({
          groupId: 'mock-uuid',
          label: 'and',
          items: [
            {
              column: 'name',
              operator: '=',
              value: 'John',
              ignore_case: false,
              id: 'mock-uuid'
            }
          ]
        });
      });
    
      it('should transform nested condition groups', () => {
        const input = {
          or: [
            {
              and: [
                { column: 'age', operator: '>', value: 30, ignore_case: false }
              ]
            },
            { column: 'status', operator: '=', value: 'active', ignore_case: true }
          ]
        };
    
        const result = wrapper.vm.retransformBEToFE(input);
    
        expect(result).toEqual({
          groupId: 'mock-uuid',
          label: 'or',
          items: [
            {
              groupId: 'mock-uuid',
              label: 'and',
              items: [
                {
                  column: 'age',
                  operator: '>',
                  value: 30,
                  ignore_case: false,
                  id: 'mock-uuid'
                }
              ]
            },
            {
              column: 'status',
              operator: '=',
              value: 'active',
              ignore_case: true,
              id: 'mock-uuid'
            }
          ]
        });
      });
    });
  });

})
