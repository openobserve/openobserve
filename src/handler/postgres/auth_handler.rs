// Copyright 2023 Zinc Labs Inc.
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
use pgwire::api::auth::{LoginInfo, ServerParameterProvider, StartupHandler};
use pgwire::api::{auth, ClientInfo, METADATA_DATABASE, PgWireConnectionState};
use pgwire::error::{ErrorInfo, PgWireError, PgWireResult};
use pgwire::messages::{PgWireBackendMessage, PgWireFrontendMessage};
use async_trait::async_trait;
use futures::{Sink, SinkExt};
use std::collections::HashMap;
use std::fmt::Debug;
use std::sync::Arc;
use pgwire::messages::response::ErrorResponse;
use pgwire::messages::startup::{Authentication};


pub struct PostgresAuthHandler {
    username: String,
    password: String,
    parameter_provider: Arc<PostgresParameterProvider>
}

impl PostgresAuthHandler {
    pub fn new(
        username: String,
        password: String,
    ) -> Self {
        Self {
            username,
            password,
            parameter_provider: Arc::new(Default::default()),
        }
    }

    async fn send_error<C>(
        &self, client: &mut C, severity: String, code: String, message: String
    ) -> PgWireResult<()>
        where
            C: ClientInfo + Send + Sink<PgWireBackendMessage> + Unpin,
            C::Error: Debug,
            PgWireError: From<<C as Sink<PgWireBackendMessage>>::Error>,
    {
        let error_info = ErrorInfo::new(severity, code, message);
        let response = ErrorResponse::from(error_info);

        client.feed(PgWireBackendMessage::ErrorResponse(response)).await?;
        client.close().await?;
        Ok(())
    }


    fn check_db_exist(&self, db_name: &String) -> CheckResult {
        if db_name.eq("default") {
            CheckResult::Found
        } else {
            CheckResult::NotFound
        }
    }

}


#[derive(Debug)]
pub struct PostgresParameterProvider {
    server_version: String,
    server_encoding: String,
    client_encoding: String,
    date_style: String,
    integer_datetimes: String
}

impl Default for PostgresParameterProvider {
    fn default() -> Self {
        Self {
            server_version: env!("CARGO_PKG_VERSION").to_owned(),
            server_encoding: "UTF8".to_owned(),
            client_encoding: "UTF8".to_owned(),
            date_style: "ISO YMD".to_owned(),
            integer_datetimes: "on".to_owned(),
        }
    }
}

impl ServerParameterProvider for PostgresParameterProvider {
    fn server_parameters<C>(&self, _client: &C) -> Option<HashMap<String, String>>
        where
            C: ClientInfo
    {
        let mut params = HashMap::with_capacity(5);
        params.insert("server_version".to_owned(), self.server_version.clone());
        params.insert("server_encoding".to_owned(), self.server_encoding.clone());
        params.insert("client_encoding".to_owned(), self.client_encoding.clone());
        params.insert("DateStyle".to_owned(), self.date_style.clone());
        params.insert("integer_datetimes".to_owned(), self.integer_datetimes.clone());
        Some(params)
    }
}

#[async_trait]
impl StartupHandler for PostgresAuthHandler {

    async fn on_startup<C>(
        &self,
        client: &mut C,
        message: PgWireFrontendMessage
    ) -> PgWireResult<()>
    where
        C: ClientInfo + Sink<PgWireBackendMessage> + Unpin + Send,
        C::Error: Debug,
        PgWireError: From<<C as Sink<PgWireBackendMessage>>::Error>,
    {
        match message {
            PgWireFrontendMessage::Startup(ref startup) => {
                auth::save_startup_parameters_to_metadata(client, startup);

                let db_name = client.metadata().get(METADATA_DATABASE);
                if db_name.is_none() {
                    self.send_error(client, "FATAL".to_owned(), "3D000".to_owned(), "Database not specified".to_owned()).await?;
                    return Ok(());
                }

                if CheckResult::NotFound.eq(&self.check_db_exist(db_name.unwrap())) {
                    self.send_error(client, "FATAL".to_owned(), "3D000".to_owned(), "Database not found".to_owned()).await?;
                    return Ok(());
                }
                client.set_state(PgWireConnectionState::AuthenticationInProgress);
                client.send(PgWireBackendMessage::Authentication(
                    Authentication::CleartextPassword
                )).await?;
                return Ok(())
            }

            PgWireFrontendMessage::PasswordMessageFamily(pwd) => {
                let pwd = pwd.into_password()?;
                let login_info = LoginInfo::from_client_info(client);

                if !self.password.eq(pwd.password()) || !self.username.eq(login_info.user().unwrap_or(&String::from("root"))) {
                    return self.send_error(client, "FATAL".to_owned(), "28P01".to_owned(), "Password authentication failed".to_owned()).await;
                }

                auth::finish_authentication(client, self.parameter_provider.as_ref()).await;
                return Ok(())
            }
            _ => {}
        }
        Ok(())
    }
}

#[derive(PartialEq)]
enum CheckResult {
    Found,
    NotFound
}
