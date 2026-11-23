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

//! The proof-loss e-mail: one hour into a holder's 72 hours its org's admins are told which one
//! DNS record to add and when the claim can lapse. One template, two wordings, chosen by the
//! record's type; a node without SMTP sends nothing and fails nothing.

use config::{
    SMTP_CLIENT, get_config,
    meta::{destinations::Email, user::UserRole},
};
use futures::future::BoxFuture;
use infra::table::org_users::{OrgUserRecord, list_users_by_org};
use o2_enterprise::enterprise::status_pages::proof_loss::{self, ProofLoss, RecordType};

/// Registers the sender with the verifier; it runs on every node role that checks claims.
pub fn register() {
    proof_loss::register(notify);
}

/// What the notice needs outside the process, so a test can stand in for each part.
#[async_trait::async_trait]
trait Mail: Send + Sync {
    fn smtp_enabled(&self) -> bool;
    async fn admins(&self, org_id: &str) -> anyhow::Result<Vec<String>>;
    async fn send(
        &self,
        to: Vec<String>,
        subject: &str,
        (text, html): (String, String),
    ) -> anyhow::Result<()>;
    /// `<web_url><base_uri>` without a trailing slash.
    fn origin(&self) -> String;
}

struct LiveMail;

#[async_trait::async_trait]
impl Mail for LiveMail {
    fn smtp_enabled(&self) -> bool {
        get_config().smtp.smtp_enabled && SMTP_CLIENT.is_some()
    }

    async fn admins(&self, org_id: &str) -> anyhow::Result<Vec<String>> {
        Ok(admin_emails(&list_users_by_org(org_id).await?))
    }

    async fn send(
        &self,
        to: Vec<String>,
        subject: &str,
        (text, html): (String, String),
    ) -> anyhow::Result<()> {
        let recipients = Email { recipients: to };
        openobserve_core::alerts::alert::send_email_notification(
            subject,
            &recipients,
            Some(text),
            html,
        )
        .await?;
        Ok(())
    }

    fn origin(&self) -> String {
        let common = &get_config().common;
        let origin = format!("{}{}", common.web_url, common.base_uri);
        origin.trim_end_matches('/').to_string()
    }
}

fn notify(loss: ProofLoss) -> BoxFuture<'static, anyhow::Result<()>> {
    Box::pin(async move { deliver(&LiveMail, &loss).await })
}

/// Sends the notice to the org's admins; nothing when SMTP is not set up or the org has none.
async fn deliver(mail: &dyn Mail, loss: &ProofLoss) -> anyhow::Result<()> {
    if !mail.smtp_enabled() {
        return Ok(());
    }
    let admins = mail.admins(&loss.org_id).await?;
    if admins.is_empty() {
        return Ok(());
    }
    let link = dialog_link(&mail.origin(), &loss.org_id, &loss.page_id);
    let notice = compose(loss, &link);
    mail.send(admins, &notice.subject, (notice.text, notice.html))
        .await
}

/// The members with the admin role.
fn admin_emails(users: &[OrgUserRecord]) -> Vec<String> {
    users
        .iter()
        .filter(|user| user.role == UserRole::Admin)
        .map(|user| user.email.clone())
        .collect()
}

struct Notice {
    subject: String,
    text: String,
    html: String,
}

/// The two wordings never name the other proof: the CNAME one says the domain does not point at
/// the target, the TXT one that the record is not in DNS. Neither says it was there before.
fn compose(loss: &ProofLoss, link: &str) -> Notice {
    let lapse = chrono::DateTime::from_timestamp_micros(loss.lapse_at)
        .map(|at| at.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_default();
    let what = match loss.record_type {
        RecordType::Cname => format!(
            "The domain {} does not point at {}.",
            loss.hostname, loss.record_value
        ),
        RecordType::Txt => format!(
            "The TXT record of the domain {} is not in DNS.",
            loss.hostname
        ),
    };
    let record = format!(
        "{} {} {}",
        loss.record_name,
        loss.record_type.as_str(),
        loss.record_value
    );
    let lines = [
        format!(
            "{what} It belongs to the status page \"{}\".",
            loss.page_name
        ),
        "Add this DNS record where the domain's DNS is managed:".to_string(),
        record,
        format!(
            "If the record is not in DNS by {lapse}, the domain is released from the status page and the page is not served on it."
        ),
    ];
    Notice {
        subject: format!("The custom domain {} needs a DNS record", loss.hostname),
        html: html_of(&lines, link),
        text: format!("{}\n\nOpen the status pages: {link}", lines.join("\n\n")),
    }
}

/// The record goes in a `pre` block and the link is an anchor; everything is escaped, the page
/// name is the org's own text.
fn html_of(lines: &[String; 4], link: &str) -> String {
    let [what, add, record, lapse] = lines.each_ref().map(|line| escape(line));
    let link = escape(link);
    format!(
        "<p>{what}</p><p>{add}</p><pre>{record}</pre><p>{lapse}</p><p>Open the status pages: <a href=\"{link}\">{link}</a></p>"
    )
}

/// The status pages view of the org with the page whose Domains dialog the notice is about.
fn dialog_link(origin: &str, org_id: &str, page_id: &str) -> String {
    let (org, page) = (urlencoding::encode(org_id), urlencoding::encode(page_id));
    format!("{origin}/web/synthetics?org_identifier={org}&section=status-pages&domains={page}")
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    const ORG: &str = "acme";
    /// 2026-12-05 10:30:00 UTC.
    const LAPSE: i64 = 1_796_466_600_000_000;

    fn loss(record_type: RecordType) -> ProofLoss {
        let (name, value) = match record_type {
            RecordType::Cname => ("status.example.com", "abcdefghijklmnop.domains.example.com"),
            RecordType::Txt => ("_o2-verify.status.example.com", "o2v_0123456789abcdef"),
        };
        ProofLoss {
            org_id: ORG.to_string(),
            page_id: "page-1".to_string(),
            page_name: "Acme status".to_string(),
            hostname: "status.example.com".to_string(),
            record_type,
            record_name: name.to_string(),
            record_value: value.to_string(),
            lapse_at: LAPSE,
        }
    }
    /// Recipients, subject, text and html of one mail.
    type Sent = (Vec<String>, String, String, String);

    #[derive(Default)]
    struct FakeMail {
        smtp: bool,
        admins: Vec<String>,
        reads: Mutex<usize>,
        sent: Mutex<Vec<Sent>>,
    }

    #[async_trait::async_trait]
    impl Mail for FakeMail {
        fn smtp_enabled(&self) -> bool {
            self.smtp
        }

        async fn admins(&self, _org_id: &str) -> anyhow::Result<Vec<String>> {
            *self.reads.lock().unwrap() += 1;
            Ok(self.admins.clone())
        }

        async fn send(
            &self,
            to: Vec<String>,
            subject: &str,
            (text, html): (String, String),
        ) -> anyhow::Result<()> {
            let sent = (to, subject.to_string(), text, html);
            self.sent.lock().unwrap().push(sent);
            Ok(())
        }

        fn origin(&self) -> String {
            "https://o2.example.com".to_string()
        }
    }

    fn member(email: &str, role: UserRole) -> OrgUserRecord {
        OrgUserRecord {
            email: email.to_string(),
            org_id: ORG.to_string(),
            role,
            token: String::new(),
            rum_token: None,
            created_at: 0,
            allow_static_token: false,
        }
    }

    async fn sent_for(record_type: RecordType) -> Sent {
        let mail = FakeMail {
            smtp: true,
            admins: vec!["admin@acme.test".to_string()],
            ..Default::default()
        };
        deliver(&mail, &loss(record_type)).await.unwrap();
        let sent = mail.sent.lock().unwrap();
        assert_eq!(sent.len(), 1);
        sent[0].clone()
    }

    #[tokio::test]
    async fn with_smtp_unset_nothing_is_sent_read_or_failed() {
        let mail = FakeMail {
            smtp: false,
            admins: vec!["admin@acme.test".to_string()],
            ..Default::default()
        };

        let outcome = deliver(&mail, &loss(RecordType::Cname)).await;

        assert!(outcome.is_ok());
        assert!(mail.sent.lock().unwrap().is_empty());
        assert_eq!(*mail.reads.lock().unwrap(), 0, "no member was looked up");
    }

    #[tokio::test]
    async fn an_org_without_admins_gets_no_mail() {
        let mail = FakeMail {
            smtp: true,
            ..Default::default()
        };

        assert!(deliver(&mail, &loss(RecordType::Txt)).await.is_ok());

        assert!(mail.sent.lock().unwrap().is_empty());
    }

    #[test]
    fn the_recipients_are_the_members_with_the_admin_role() {
        let users = [
            member("admin@acme.test", UserRole::Admin),
            member("editor@acme.test", UserRole::Editor),
            member("viewer@acme.test", UserRole::Viewer),
            member("second-admin@acme.test", UserRole::Admin),
            member("service@acme.test", UserRole::ServiceAccount),
        ];

        let recipients = admin_emails(&users);

        assert_eq!(recipients, ["admin@acme.test", "second-admin@acme.test"]);
    }

    #[tokio::test]
    async fn the_mail_goes_to_the_admins_and_names_the_page_the_record_the_lapse_and_the_link() {
        for record_type in [RecordType::Cname, RecordType::Txt] {
            let (to, subject, text, html) = sent_for(record_type).await;
            let loss = loss(record_type);

            assert_eq!(to, ["admin@acme.test"]);
            assert!(subject.contains("status.example.com"), "{subject}");
            for body in [&text, &html] {
                assert!(body.contains("Acme status"), "{body}");
                assert!(body.contains("2026-12-05 10:30 UTC"), "{body}");
                assert!(body.contains("org_identifier=acme"), "{body}");
                let record = format!(
                    "{} {} {}",
                    loss.record_name,
                    record_type.as_str(),
                    loss.record_value
                );
                assert!(body.contains(&record), "{record} in {body}");
            }
        }
    }

    #[tokio::test]
    async fn the_cname_wording_says_the_domain_does_not_point_at_the_target() {
        let (_, subject, text, html) = sent_for(RecordType::Cname).await;

        for body in [&subject, &text, &html] {
            assert!(!body.contains("TXT"), "{body}");
            for word in ["_o2-verify", "no longer", "back", "proxy"] {
                assert!(!body.contains(word), "{word} in {body}");
            }
        }
        assert!(text.contains("does not point at abcdefghijklmnop.domains.example.com"));
    }

    #[tokio::test]
    async fn the_txt_wording_says_the_record_is_not_in_dns_and_shows_its_name_and_value() {
        let (_, subject, text, html) = sent_for(RecordType::Txt).await;

        for body in [&subject, &text, &html] {
            assert!(!body.contains("CNAME"), "{body}");
            for word in ["no longer", "back", "proxy"] {
                assert!(!body.contains(word), "{word} in {body}");
            }
        }
        assert!(text.contains("is not in DNS"));
        assert!(text.contains("_o2-verify.status.example.com TXT o2v_0123456789abcdef"));
    }

    #[test]
    fn the_link_is_the_status_pages_view_with_the_org_and_the_page_url_encoded() {
        let plain = dialog_link("https://o2.example.com/base", "acme", "page-1");
        assert_eq!(
            plain,
            "https://o2.example.com/base/web/synthetics?org_identifier=acme&section=status-pages&domains=page-1"
        );

        let awkward = dialog_link("https://o2.example.com", "acme corp/é", "p&1=2#x");

        assert_eq!(
            awkward,
            "https://o2.example.com/web/synthetics?org_identifier=acme%20corp%2F%C3%A9&section=status-pages&domains=p%261%3D2%23x"
        );
    }

    #[tokio::test]
    async fn both_parts_of_the_mail_carry_the_page_specific_link() {
        let (_, _, text, html) = sent_for(RecordType::Cname).await;
        let link = "https://o2.example.com/web/synthetics?org_identifier=acme&section=status-pages&domains=page-1";

        assert!(
            text.ends_with(&format!("Open the status pages: {link}")),
            "{text}"
        );
        assert!(
            html.contains(&format!("<a href=\"{}\">", link.replace('&', "&amp;"))),
            "{html}"
        );
    }

    #[test]
    fn the_html_part_carries_the_link_as_an_anchor_and_the_text_part_as_a_line() {
        let link = "https://o2.example.com/web/synthetics?org_identifier=acme&section=status-pages";

        let notice = compose(&loss(RecordType::Txt), link);

        assert!(
            notice
                .html
                .contains(&format!("<a href=\"{}\">", link.replace('&', "&amp;")))
        );
        assert!(
            notice
                .text
                .ends_with(&format!("Open the status pages: {link}"))
        );
    }

    #[test]
    fn a_page_name_cannot_inject_markup_into_the_html_part() {
        let hostile = ProofLoss {
            page_name: "<script>alert(1)</script>".to_string(),
            ..loss(RecordType::Cname)
        };

        let notice = compose(&hostile, "https://o2.example.com/");

        assert!(!notice.html.contains("<script>"), "{}", notice.html);
        assert!(notice.html.contains("&lt;script&gt;"));
    }
}
