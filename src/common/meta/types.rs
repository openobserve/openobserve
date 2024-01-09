// Copyright 2023 Zinc Labs Inc.
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

use std::collections::HashMap;

use once_cell::sync::Lazy;

pub const NON_OWNING_ORG: [&str; 2] = ["org", "user"];

pub static OFGA_MODELS: Lazy<HashMap<&str, &str>> = Lazy::new(|| {
    let mut m = HashMap::new();
    m.insert("functions", "function");
    m.insert("dashboards", "dashboard");
    m.insert("folders", "folder");
    m.insert("templates", "template");
    m.insert("destinations", "destination");
    m.insert("alerts", "alert");
    m.insert("enrichment_tables", "enrichment_table");
    m.insert("settings", "settings");
    m.insert("organizations", "org");
    m.insert("kv", "kv");
    m.insert("users", "user");
    m.insert("schema", "o2_schema");
    m.insert("streams", "stream");
    m.insert("syslog-routes", "syslog-route");
    m.insert("summary", "summary");
    m.insert("passcode", "passcode");
    m.insert("rumtoken", "rumtoken");
    m
});
