// Copyright 2023 Zinc Labs Inc.

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at

//      http:www.apache.org/licenses/LICENSE-2.0

//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import http from "./http";

const billings = {
  get_quota_threshold: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/billings/quota_threshold`);
  },
  create_payment_subscribe: (org_identifier: string, data: object) => {
    return http().post(`/api/${org_identifier}/billings/payment_source`, data);
  },
  unsubscribe: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/billings/unsubscribe`);
  },
  list_subscription: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/billings/list_subscription`);
  },
  list_paymentsources: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/billings/list_paymentsource`);
  },
  resume_subscription: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/billings/resume_subscription`);
  },
  get_hosted_url: (org_identifier: string, plan_name: string) => {
    return http().get(`/api/${org_identifier}/billings/hosted_subscription_url?plan=${plan_name}`);
  },
  retrive_hosted_page: (org_identifier: string, hosted_page_id: string) => {
    return http().get(`/api/${org_identifier}/billings/hosted_page_status/${hosted_page_id}`);
  },
  change_payment_detail: (org_identifier: string, hosted_page_id: string) => {
    return http().get(`/api/${org_identifier}/billings/change_payment_detail/${hosted_page_id}`);
  },
  list_invoice_history: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/billings/invoices`);
  },
  get_data_usage: (org_identifier: string, usage_date: string) => {
    return http().get(`/api/${org_identifier}/billings/data_usage/${usage_date}`)
  }
};

export default billings;
