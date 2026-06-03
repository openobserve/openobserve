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
    return http().get(
      `/api/${org_identifier}/billings/hosted_subscription_url?plan=${plan_name}`
    );
  },
  get_session_url: (org_identifier: string, customer_id: string) => {
    return http().get(
      `/api/${org_identifier}/billings/billing_portal?customer_id=${customer_id}`
    );
  },
  retrieve_hosted_page: (org_identifier: string, hosted_page_id: string) => {
    return http().get(
      `/api/${org_identifier}/billings/hosted_page_status/${hosted_page_id}`
    );
  },
  change_payment_detail: (org_identifier: string, hosted_page_id: string) => {
    return http().get(
      `/api/${org_identifier}/billings/change_payment_detail/${hosted_page_id}`
    );
  },
  list_invoice_history: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/billings/invoices`);
  },
  get_data_usage: (
    org_identifier: string,
    usage_date: string,
    data_type: string,
    member?: string
  ) => {
    let url = `/api/${org_identifier}/billings/data_usage/${usage_date}?data_type=${data_type}`;
    if (member) {
      url += `&member=${member}`;
    }
    return http().get(url);
  },
  submit_new_user_info: async ( org_identifier: string, payload: any,) => {
    return http().post(`/api/${org_identifier}/billings/new_user_attribution`, payload);
  },
  get_ai_usage: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/ai/usage`);
  },
  list_billing_group_members: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/billing_group/members`);
  },
  get_billing_group_membership: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/billing_group/membership`);
  },
  list_billing_group_invites: (org_identifier: string) => {
    return http().get(`/api/${org_identifier}/billing_group/invites`);
  },
  send_billing_group_invite: (org_identifier: string, invitee_org_id: string) => {
    return http().post(`/api/${org_identifier}/billing_group/invites`, {
      org_id: invitee_org_id,
    });
  },
  accept_billing_group_invite: (org_identifier: string, token: string) => {
    return http().post(
      `/api/${org_identifier}/billing_group/invites/${token}/accept`
    );
  },
  reject_billing_group_invite: (org_identifier: string, token: string) => {
    return http().delete(
      `/api/${org_identifier}/billing_group/invites/${token}/reject`
    );
  },
};

export default billings;
