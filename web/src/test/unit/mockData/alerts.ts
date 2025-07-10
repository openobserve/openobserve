// Copyright 2023 OpenObserve Inc.
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

export default {
  alerts: {
    get: {
      list: [
        {
          name: "alert1",
          stream: "default",
          query: {
            sql: "select * from default",
            from: 0,
            size: -1,
            start_time: 0,
            end_time: 0,
            query_type: "logs",
            track_total_hits: false,
          },
          condition: {
            column: "code",
            operator: "EqualTo",
            ignore_case: null,
            value: 500,
          },
          duration: 0,
          frequency: 0,
          time_between_alerts: 0,
          destination: "dest1",
          is_real_time: true,
          stream_type: "logs",
        },
        {
          name: "alert2",
          stream: "default",
          query: {
            sql: "select * from  'default'",
            from: 0,
            size: 100,
            start_time: 0,
            end_time: 0,
            query_type: "",
            track_total_hits: false,
          },
          condition: {
            column: "code",
            operator: "EqualTo",
            ignore_case: null,
            value: 500,
          },
          duration: 1,
          frequency: 2,
          time_between_alerts: 2,
          destination: "dest1",
          is_real_time: false,
          stream_type: "logs",
        },
      ],
    },
  },
  destinations: {
    get: [
      {
        name: "dest1",
        url: "abc",
        method: "post",
        headers: {},
        template: {
          name: "template1",
          body: '"This is string."',
          isDefault: true,
        },
      },
      {
        name: "dest2",
        url: "https://join.slack.com/share/enQtNTAyMDAzNDY",
        method: "post",
        headers: {},
        template: {
          name: "Template3",
          body: '\r\n[\r\n  {\r\n    "labels": {\r\n        "alertname": "{alert_name}",\r\n        "stream": "{stream_name}",\r\n        "organization": "{org_name}",\r\n        "alerttype": "{alert_type}",\r\n        "severity": "critical"\r\n    },\r\n    "annotations": {\r\n        "timestamp": "{timestamp}"\r\n    }\r\n  }\r\n]',
          isDefault: true,
        },
      },
    ],
  },
  templates: {
    get: [
      {
        name: "Template2",
        body: '\r\n{\r\n  "text": "{alert_name} is active"\r\n}',
        isDefault: true,
      },
      {
        name: "Template3",
        body: '\r\n[\r\n  {\r\n    "labels": {\r\n        "alertname": "{alert_name}",\r\n        "stream": "{stream_name}",\r\n        "organization": "{org_name}",\r\n        "alerttype": "{alert_type}",\r\n        "severity": "critical"\r\n    },\r\n    "annotations": {\r\n        "timestamp": "{timestamp}"\r\n    }\r\n  }\r\n]',
        isDefault: true,
      },
      {
        name: "template1",
        body: '"This is string."',
        isDefault: true,
      },
    ],
  },
};
