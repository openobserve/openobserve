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

use std::net::{SocketAddr};
use std::sync::Arc;
use futures::future::{Abortable, AbortHandle};
use pgwire::tokio::process_socket;
use tokio::sync::Mutex;
use tokio::net::{TcpListener};
use tokio::task::JoinHandle;
use tokio_rustls::TlsAcceptor;
use crate::common::infra::config::Postgres;
use crate::common::infra::errors::Error;
use crate::handler::postgres::auth_handler::PostgresAuthHandler;
use crate::handler::postgres::query_handler::PostgresQueryHandler;
use crate::handler::tls::setup_tls;

pub struct PostgresServer {
    address: String,
    port: u16,
    tls: bool,
    query_handler: Arc<PostgresQueryHandler>,
    auth_handler: Arc<PostgresAuthHandler>,
    acceptor: Mutex<Acceptor>,
}

pub struct Acceptor {
    abort_handle: Option<AbortHandle>,
    join_handle: Option<JoinHandle<()>>
}

pub struct HandlerHolder {
    auth_handler: Arc<PostgresAuthHandler>,
    query_handler: Arc<PostgresQueryHandler>
}

impl HandlerHolder {
    pub fn new(server: & PostgresServer) -> Self {
        Self {
            auth_handler: server.auth_handler.clone(),
            query_handler: server.query_handler.clone()
        }
    }
}

impl Acceptor {
    fn new() -> Self {
        Self {
            abort_handle: None,
            join_handle: None
        }
    }

    async fn start(&mut self, addr: SocketAddr, handler_holder: Arc<HandlerHolder>, tls_acceptor: Option<Arc<TlsAcceptor>>) -> Result<(), Error> {
        let (abort_handle, abort_registration) = AbortHandle::new_pair();

        self.abort_handle = Some(abort_handle);
        let listener = TcpListener::bind(addr).await?;
        let local_addr = listener.local_addr()?;
        let listener = Abortable::new(async { listener }, abort_registration);

        log::info!("starting postgres server at {local_addr}");

        let join_handler = tokio::spawn(async move {
            let listener = listener.await.unwrap();
            loop {
                let incoming_socket = listener.accept().await.unwrap();
                let tls_acceptor = tls_acceptor.clone();
                let query_handler = handler_holder.clone();
                let _ = tokio::spawn(async move {
                    let _ = process_socket(
                       incoming_socket.0,
                        tls_acceptor,
                       query_handler.auth_handler.clone(),
                        query_handler.query_handler.clone(),
                       query_handler.query_handler.clone()
                        ).await;
                });
            }
        });

        self.join_handle.get_or_insert(join_handler);
        Ok(())
    }

    async fn shutdown(&mut self) -> Result<(), Error> {
        match self.join_handle.take() {
            Some(join_handler) => {
                self.abort_handle.take().unwrap().abort();
                match join_handler.await {
                    Ok(_) => {
                        log::info!("postgres server is shutdown")
                    }
                    Err(_) => {
                        log::error!("postgres server shutdown failed")
                    }
                }
            }
            None => {
                log::warn!("postgres server is not started")
            }
        }
        Ok(())
    }
}

impl PostgresServer {

    pub fn new(
        config: &Postgres
    ) -> Self {
        Self {
            address: "0.0.0.0".to_owned(),
            port: config.port,
            tls: config.tls,
            query_handler: Arc::new(PostgresQueryHandler {}),
            auth_handler: Arc::new(PostgresAuthHandler::new(config.username.to_owned(), config.password.to_owned())),
            acceptor: Mutex::new(Acceptor::new()),
        }
    }

    pub async fn start(& self) -> Result<(), anyhow::Error> {
        let paddr: SocketAddr = format!("{}:{}", &self.address, &self.port).parse()?;
        let mut acceptor = self.acceptor.lock().await;
        if acceptor.join_handle.is_none() {
            let tls_acceptor = if self.tls {
                Some(Arc::new(setup_tls().unwrap()))
            } else {
                None
            };
            let handler_holder = Arc::new(HandlerHolder::new(self));
            acceptor.start(paddr, handler_holder, tls_acceptor).await?;
        } else {
            log::warn!("postgres server has been started")
        }
        Ok(())
    }

    pub async fn shutdown(&self) -> Result<(), Error> {
        let mut acceptor = self.acceptor.lock().await;
        acceptor.shutdown().await
    }
}


#[cfg(test)]
mod tests {
    use std::thread::sleep;
    use std::time::Duration;
    use super::*;

    #[tokio::test]
    async fn start_pg_server() {
        let postgres = Postgres {
            username: "root".to_string(),
            password: "".to_string(),
            port: 5432,
            tls: false,
            enabled: true,
            cert_path: "".to_string(),
            key_path: "".to_string(),
        };
        let server = PostgresServer::new(&postgres);
        server.start().await;
        sleep(Duration::from_secs(1000));
        server.shutdown().await;
    }
}