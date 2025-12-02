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

export const actionScriptsMockData = {
  list: [
    {
      id: "test-action-1",
      name: "Test Action 1",
      description: "Test action description 1",
      created_by: "test@example.com",
      created_at: 1672531200000000,
      execution_details_type: "scheduled",
      execution_details: "repeat",
      last_run_at: 1672531300000000,
      last_successful_at: 1672531350000000,
      status: "active",
      cron_expr: "0 0 * * *",
      service_account: "service1@example.com",
      environment_variables: {
        ENV_VAR_1: "value1",
        ENV_VAR_2: "value2",
      },
      zip_file_name: "test-action-1.zip",
      enabled: true,
      type: "scheduled",
    },
    {
      id: "test-action-2",
      name: "Test Action 2",
      description: "Test action description 2",
      created_by: "admin@example.com",
      created_at: 1672531400000000,
      execution_details_type: "service",
      execution_details: "service",
      last_run_at: null,
      last_successful_at: null,
      status: "inactive",
      service_account: "service2@example.com",
      environment_variables: {},
      zip_file_name: "test-action-2.zip",
      enabled: false,
      type: "service",
    },
  ],
  single: {
    id: "test-action-1",
    name: "Test Action 1",
    description: "Test action description 1",
    created_by: "test@example.com",
    created_at: 1672531200000000,
    execution_details_type: "scheduled",
    execution_details: "repeat",
    last_run_at: 1672531300000000,
    last_successful_at: 1672531350000000,
    status: "active",
    cron_expr: "0 0 * * *",
    service_account: "service1@example.com",
    environment_variables: {
      ENV_VAR_1: "value1",
      ENV_VAR_2: "value2",
    },
    zip_file_name: "test-action-1.zip",
    enabled: true,
    type: "scheduled",
    timezone: "UTC",
  },
  serviceAccounts: {
    data: [
      { email: "service1@example.com" },
      { email: "service2@example.com" },
      { email: "service3@example.com" },
    ],
  },
};

export default actionScriptsMockData;