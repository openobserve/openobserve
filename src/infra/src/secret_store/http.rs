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

use std::error::Error;

use config::utils::ssrf_guard::{RedirectMode, build_secret_bearing_client, find_ssrf_refusal};

use super::redact::{HumanOutcome, OutcomeClass, Redactor};

pub fn client(builder: reqwest::ClientBuilder) -> reqwest::Result<reqwest::Client> {
    build_secret_bearing_client(builder, RedirectMode::Deny)
}

pub fn outcome_of_status(status: u16) -> HumanOutcome {
    if (300..=399).contains(&status) {
        return HumanOutcome {
            ok: false,
            status: Some(status),
            class: Some(OutcomeClass::RedirectRefused),
        };
    }
    HumanOutcome::from_status(status)
}

pub fn outcome_of_error(err: &reqwest::Error) -> HumanOutcome {
    let class = if err.is_timeout() {
        OutcomeClass::Timeout
    } else if err.is_redirect() {
        OutcomeClass::RedirectRefused
    } else if err.is_connect() && find_ssrf_refusal(err).is_none() {
        let sources = chain_text(err.source()).to_ascii_lowercase();
        if sources.contains("dns error") {
            OutcomeClass::Dns
        } else if sources.contains("certificate")
            || sources.contains("tls")
            || sources.contains("ssl")
        {
            OutcomeClass::Tls
        } else {
            OutcomeClass::Connect
        }
    } else {
        OutcomeClass::Connect
    };
    HumanOutcome {
        ok: false,
        status: None,
        class: Some(class),
    }
}

pub fn redacted_error(err: reqwest::Error, redactor: &Redactor) -> String {
    redactor.redact(&chain_text(Some(&err.without_url())))
}

fn chain_text(mut source: Option<&(dyn Error + 'static)>) -> String {
    let mut parts = Vec::new();
    while let Some(err) = source {
        parts.push(err.to_string());
        source = err.source();
    }
    parts.join(": ")
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::{json, to_value};
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        time::timeout,
    };

    use super::*;

    fn local_client() -> reqwest::Client {
        client(
            reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(5)),
        )
        .unwrap()
    }

    #[test]
    fn status_outcomes_serialize() {
        for (status, ok, class) in [
            (200, true, None),
            (302, false, Some("redirect_refused")),
            (404, false, Some("http_4xx")),
            (503, false, Some("http_5xx")),
        ] {
            assert_eq!(
                to_value(outcome_of_status(status)).unwrap(),
                json!({"ok": ok, "status": status, "class": class})
            );
        }
    }

    #[tokio::test]
    async fn redirect_is_reported_without_connecting_to_location() {
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let target_addr = target.local_addr().unwrap();
        let origin_addr = origin.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = origin.accept().await.unwrap();
            let mut buf = [0; 4096];
            assert!(stream.read(&mut buf).await.unwrap() > 0);
            let reply = format!(
                "HTTP/1.1 302 Found\r\nLocation: http://{target_addr}/\r\nContent-Length: 0\r\n\r\n"
            );
            stream.write_all(reply.as_bytes()).await.unwrap();
        });
        let response = local_client()
            .get(format!("http://{origin_addr}/"))
            .send()
            .await
            .unwrap();
        server.await.unwrap();
        assert_eq!(
            to_value(outcome_of_status(response.status().as_u16())).unwrap(),
            json!({"ok": false, "status": 302, "class": "redirect_refused"})
        );
        assert!(
            timeout(Duration::from_millis(50), target.accept())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn refused_connection_is_classified_and_its_url_is_removed() {
        let client = local_client();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        let err = client
            .get(format!("http://{addr}/?token=CANARY"))
            .send()
            .await
            .unwrap_err();
        assert_eq!(
            to_value(outcome_of_error(&err)).unwrap(),
            json!({"ok": false, "status": null, "class": "connect"})
        );
        let message = redacted_error(err, &Redactor::for_attempt(["CANARY"]));
        assert!(!message.contains("CANARY"));
        assert!(!message.contains(&format!("{addr}/?token")));
    }
}
