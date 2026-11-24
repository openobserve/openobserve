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

use infra::secret_store::{
    http::{outcome_of_error, outcome_of_status},
    redact::{HumanOutcome, OutcomeClass},
};

use super::send::SendError;

pub fn outcome_of(result: &anyhow::Result<String>) -> HumanOutcome {
    match result {
        Ok(text) => HumanOutcome {
            ok: true,
            status: text
                .strip_prefix("sent status: ")
                .and_then(|tail| tail.split_whitespace().next())
                .and_then(|status| status.parse().ok()),
            class: None,
        },
        Err(error) => error_outcome(error),
    }
}

fn error_outcome(error: &anyhow::Error) -> HumanOutcome {
    let class = match error.downcast_ref::<SendError>() {
        Some(SendError::Rejected { status, .. } | SendError::RedirectRefused(status)) => {
            return outcome_of_status(status.as_u16());
        }
        Some(SendError::Blocked(message)) => message
            .strip_prefix("secret_error:")
            .and_then(|tail| tail.split(':').next())
            .and_then(|code| code.parse().ok())
            .map_or(OutcomeClass::Connect, OutcomeClass::SecretError),
        Some(SendError::NoOrgMemberRecipient(_) | SendError::Render(_)) => OutcomeClass::Connect,
        None => {
            if let Some(error) = error.downcast_ref::<reqwest::Error>() {
                return outcome_of_error(error);
            }
            match error.to_string().strip_prefix("transport_error:") {
                Some("timeout") => OutcomeClass::Timeout,
                Some("dns") => OutcomeClass::Dns,
                Some("tls") => OutcomeClass::Tls,
                Some("redirect_refused") => OutcomeClass::RedirectRefused,
                _ => OutcomeClass::Connect,
            }
        }
    };
    HumanOutcome {
        ok: false,
        status: None,
        class: Some(class),
    }
}

#[cfg(test)]
mod tests {
    use std::{future::pending, sync::Arc, time::Duration};

    use reqwest::{
        StatusCode,
        dns::{Name, Resolve, Resolving},
    };
    use serde_json::{json, to_value};

    use super::*;

    struct PendingDns;

    impl Resolve for PendingDns {
        fn resolve(&self, _: Name) -> Resolving {
            Box::pin(pending())
        }
    }

    #[test]
    fn successful_sends_return_an_optional_status() {
        for (message, status) in [
            ("sent status: 204 No Content", Some(204)),
            ("sent status: unknown", None),
            ("message sent", None),
        ] {
            assert_eq!(
                to_value(outcome_of(&Ok(message.into()))).unwrap(),
                json!({"ok": true, "status": status, "class": null})
            );
        }
    }

    #[test]
    fn send_errors_return_only_status_and_class() {
        for (error, status, class) in [
            (
                SendError::Rejected {
                    status: StatusCode::UNAUTHORIZED,
                    body: Some("provider text".into()),
                },
                Some(401),
                "http_4xx",
            ),
            (
                SendError::Rejected {
                    status: StatusCode::BAD_GATEWAY,
                    body: None,
                },
                Some(502),
                "http_5xx",
            ),
            (
                SendError::RedirectRefused(StatusCode::FOUND),
                Some(302),
                "redirect_refused",
            ),
            (
                SendError::Blocked("secret_error:secret_deleted:TOKEN:OTHER".into()),
                None,
                "secret_error:secret_deleted",
            ),
            (
                SendError::Blocked("secret_error:secret_unset".into()),
                None,
                "secret_error:secret_unset",
            ),
            (
                SendError::Blocked("secret_error:unknown_code:TOKEN".into()),
                None,
                "connect",
            ),
            (SendError::Blocked("blocked".into()), None, "connect"),
            (SendError::Render("render failed".into()), None, "connect"),
            (
                SendError::NoOrgMemberRecipient(vec!["someone@example.org".into()]),
                None,
                "connect",
            ),
        ] {
            assert_eq!(
                to_value(outcome_of(&Err(error.into()))).unwrap(),
                json!({"ok": false, "status": status, "class": class})
            );
        }
    }

    #[test]
    fn transport_errors_round_trip_their_class() {
        for class in ["timeout", "dns", "tls", "connect", "redirect_refused"] {
            let result = Err(anyhow::anyhow!("transport_error:{class}"));
            assert_eq!(
                to_value(outcome_of(&result)).unwrap(),
                json!({"ok": false, "status": null, "class": class})
            );
        }
        for error in ["transport_error:unknown", "arbitrary provider text"] {
            let result = Err(anyhow::anyhow!("{error}"));
            assert_eq!(
                to_value(outcome_of(&result)).unwrap(),
                json!({"ok": false, "status": null, "class": "connect"})
            );
        }
    }

    #[tokio::test]
    async fn reqwest_timeouts_keep_their_class() {
        let client = reqwest::Client::builder()
            .no_proxy()
            .dns_resolver(Arc::new(PendingDns))
            .timeout(Duration::from_millis(50))
            .build()
            .unwrap();
        let error = client
            .get("https://pending.invalid")
            .send()
            .await
            .unwrap_err();
        assert_eq!(
            to_value(outcome_of(&Err(error.into()))).unwrap(),
            json!({"ok": false, "status": null, "class": "timeout"})
        );
    }
}
