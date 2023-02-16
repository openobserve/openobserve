// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use crate::{
    common::auth::get_hash,
    infra::config::{CONFIG, USERS},
};
use http_auth_basic::Credentials;
use tonic::{Request, Status};

pub fn check_auth(req: Request<()>) -> Result<Request<()>, Status> {
    if !req.metadata().contains_key(&CONFIG.grpc.org_header_key)
        && !req.metadata().contains_key("authorization")
    {
        return Err(Status::unauthenticated("No valid auth token"));
    }

    let token = req
        .metadata()
        .get("authorization")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let credentials = match Credentials::from_header(token) {
        Ok(c) => c,
        Err(_) => return Err(Status::unauthenticated("No valid auth token")),
    };

    let user = USERS.get(&CONFIG.auth.useremail).unwrap();
    let in_pass = get_hash(&credentials.password, &user.salt);

    if credentials.user_id.eq(&CONFIG.auth.useremail)
        && (user.password.eq(&credentials.password) || user.password.eq(&in_pass))
    {
        Ok(req)
    } else {
        Err(Status::unauthenticated("No valid auth token"))
    }
}
