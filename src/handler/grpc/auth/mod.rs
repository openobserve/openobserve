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

use crate::infra::config::{CONFIG, ROOT_USER};
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
        Err(err) => {
            log::info!("Err authenticating {}", err);
            return Err(Status::unauthenticated("No valid auth token"));
        }
    };

    let user = ROOT_USER.get("root").unwrap();
    if credentials.user_id.eq(&user.email) && credentials.password.eq(&user.token) {
        Ok(req)
    } else {
        Err(Status::unauthenticated("No valid auth token"))
    }
}

#[cfg(test)]
mod test_utils {

    use crate::meta::user::User;
    use tonic::metadata::MetadataValue;

    use super::*;
    #[actix_web::test]
    async fn test_check_auth() {
        ROOT_USER.insert(
            "root".to_string(),
            User {
                email: "admin@example.com".to_string(),
                password: "Complexpass#123".to_string(),
                role: crate::meta::user::UserRole::Root,
                salt: "Complexpass#123".to_string(),
                token: "token".to_string(),
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
            },
        );
        let mut request = tonic::Request::new(());

        let token: MetadataValue<_> = "basic YWRtaW5AZXhhbXBsZS5jb206dG9rZW4=".parse().unwrap();
        let meta: &mut tonic::metadata::MetadataMap = request.metadata_mut();
        meta.insert("authorization", token.clone());

        let res = check_auth(request);
        assert!(res.is_ok())
    }
}
