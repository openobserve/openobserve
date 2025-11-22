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

import http from "./http";

const settings = {
  createLogo: (org_identifier: string, formData: any, theme: string = 'light') => {
    const url: string = `/api/${org_identifier}/settings/logo?theme=${theme}`;
    const headers = {
      "Content-Type": "multipart/form-data",
    };
    return http(headers).post(url, formData);
  },
  deleteLogo: (org_identifier: string, theme: string = 'light') => {
    return http().delete(`/api/${org_identifier}/settings/logo?theme=${theme}`);
  },
  updateCustomText: (org_identifier: string, key: string, value: string) => {
    return http().post(`/api/${org_identifier}/settings/logo/text`, value);
  },
  // SAML Configuration
  get_saml_config: () => {
    return http().get(`/api/saml/config`);
  },
  update_saml_config: (config: any) => {
    return http().put(`/api/saml/config`, config);
  },
  delete_saml_config: () => {
    return http().delete(`/api/saml/config`);
  },
};

export default settings;
