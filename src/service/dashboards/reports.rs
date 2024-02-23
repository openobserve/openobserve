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

use actix_web::http;
use config::{CONFIG, SMTP_CLIENT};
use futures::future::try_join_all;
use headless_chrome::{types::PrintToPdfOptions, Browser, LaunchOptions};
use lettre::{
    message::{header::ContentType, MultiPart, SinglePart},
    AsyncTransport, Message,
};

use crate::{
    common::{
        meta::{
            authz::Authz,
            dashboards::reports::{
                Report, ReportDashboard, ReportDashboardTab, ReportDestination, ReportTimerange,
                ReportTimerangeType,
            },
        },
        utils::auth::{remove_ownership, set_ownership},
    },
    service::db,
};

pub async fn save(org_id: &str, name: &str, mut report: Report) -> Result<(), anyhow::Error> {
    // Check if SMTP is enabled, otherwise don't save the report
    if !CONFIG.smtp.smtp_enabled {
        return Err(anyhow::anyhow!("SMTP configuration not enabled"));
    }

    // Atleast one `ReportDashboard` and `ReportDestination` needs to be present
    if report.dashboards.is_empty() || report.destinations.is_empty() {
        return Err(anyhow::anyhow!(
            "Atleast one dashboard/destination is required"
        ));
    }

    // Check if dashboards & tabs exist
    let mut tasks = Vec::with_capacity(report.dashboards.len());
    for dashboard in report.dashboards.iter() {
        let dash_id = &dashboard.dashboard;
        let folder = &dashboard.folder;
        let ReportDashboardTab::One(tab_id) = &dashboard.tabs;
        tasks.push(async move {
            let dashboard = db::dashboards::get(org_id, dash_id, folder).await?;
            // Check if the tab_id exists
            if let Some(dashboard) = dashboard.v3 {
                let mut tab_found = false;
                for tab in dashboard.tabs {
                    if &tab.tab_id == tab_id {
                        tab_found = true;
                    }
                }
                if tab_found {
                    Ok(())
                } else {
                    Err(anyhow::anyhow!("Tab not found"))
                }
            } else {
                Err(anyhow::anyhow!("Tab not found"))
            }
        });
    }
    if try_join_all(tasks).await.is_err() {
        return Err(anyhow::anyhow!("Some dashboards/tabs not found"));
    }
    if !name.is_empty() {
        report.name = name.to_string();
    }
    if report.name.is_empty() {
        return Err(anyhow::anyhow!("Report name is required"));
    }
    if report.name.contains('/') {
        return Err(anyhow::anyhow!("Report name cannot contain '/'"));
    }

    match db::dashboards::reports::set(org_id, &report).await {
        Ok(_) => {
            if name.is_empty() {
                set_ownership(org_id, "reports", Authz::new(&report.name)).await;
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

pub async fn get(org_id: &str, name: &str) -> Result<Report, anyhow::Error> {
    db::dashboards::reports::get(org_id, name)
        .await
        .map_err(|_| anyhow::anyhow!("Report not found"))
}

pub async fn list(org_id: &str) -> Result<Vec<Report>, anyhow::Error> {
    db::dashboards::reports::list(org_id).await
}

pub async fn delete(org_id: &str, name: &str) -> Result<(), (http::StatusCode, anyhow::Error)> {
    if db::dashboards::reports::get(org_id, name).await.is_err() {
        return Err((
            http::StatusCode::NOT_FOUND,
            anyhow::anyhow!("Report not found {}", name),
        ));
    }

    match db::dashboards::reports::delete(org_id, name).await {
        Ok(_) => {
            remove_ownership(org_id, "reports", Authz::new(name)).await;
            Ok(())
        }
        Err(e) => Err((http::StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

pub async fn trigger(org_id: &str, name: &str) -> Result<(), (http::StatusCode, anyhow::Error)> {
    let report = match db::dashboards::reports::get(org_id, name).await {
        Ok(report) => report,
        _ => {
            return Err((
                http::StatusCode::NOT_FOUND,
                anyhow::anyhow!("Report not found"),
            ));
        }
    };
    report
        .send_subscribers()
        .await
        .map_err(|e| (http::StatusCode::INTERNAL_SERVER_ERROR, e))
}

pub async fn enable(
    org_id: &str,
    name: &str,
    value: bool,
) -> Result<(), (http::StatusCode, anyhow::Error)> {
    let mut report = match db::dashboards::reports::get(org_id, name).await {
        Ok(report) => report,
        _ => {
            return Err((
                http::StatusCode::NOT_FOUND,
                anyhow::anyhow!("Report not found"),
            ));
        }
    };
    report.enabled = value;
    db::dashboards::reports::set(org_id, &report)
        .await
        .map_err(|e| (http::StatusCode::INTERNAL_SERVER_ERROR, e))
}

impl Report {
    /// Sends the report to subscribers
    pub async fn send_subscribers(&self) -> Result<(), anyhow::Error> {
        if self.dashboards.is_empty() {
            return Err(anyhow::anyhow!("Atleast one dashboard is required"));
        }

        // Currently only one `ReportDashboard` can be captured and sent
        let dashboard = &self.dashboards[0];
        let pdf_data = generate_report(
            dashboard,
            &self.timerange,
            &self.org_id,
            &CONFIG.auth.root_user_email,
            &CONFIG.auth.root_user_password,
        )
        .await?;
        self.send_email(&pdf_data).await
    }

    /// Sends emails to the [`Report`] recepients. Currently only one pdf data is supported.
    async fn send_email(&self, pdf_data: &Vec<u8>) -> Result<(), anyhow::Error> {
        if !CONFIG.smtp.smtp_enabled {
            return Err(anyhow::anyhow!("SMTP configuration not enabled"));
        }
        let mut recepients = vec![];
        for recepient in &self.destinations {
            match recepient {
                ReportDestination::Email(email) => recepients.push(email),
            }
        }

        let mut email = Message::builder()
            .from(CONFIG.smtp.smtp_from_email.parse()?)
            .subject(format!("Openobserve Report - {}", self.name));

        for recepient in recepients {
            email = email.to(recepient.parse()?);
        }

        let email = email
            .multipart(
                MultiPart::mixed()
                    .singlepart(SinglePart::html(self.description.to_string()))
                    .singlepart(
                        // Only supports PDF for now, attach the PDF
                        lettre::message::Attachment::new(
                            self.name.to_string(), // Attachment filename
                        )
                        .body(pdf_data.clone(), ContentType::parse("application/pdf")?),
                    ),
            )
            .unwrap();

        // Send the email
        match SMTP_CLIENT.as_ref().unwrap().send(email).await {
            Ok(_) => {
                log::debug!("Email sent successfully");
                Ok(())
            }
            Err(e) => {
                log::debug!("Email could not be sent: {e}");
                Err(anyhow::anyhow!("Error sending email: {e}"))
            }
        }
    }
}

async fn generate_report(
    dashboard: &ReportDashboard,
    timerange: &ReportTimerange,
    org_id: &str,
    user_id: &str,
    user_pass: &str,
) -> Result<Vec<u8>, anyhow::Error> {
    let dashboard_id = &dashboard.dashboard;
    let folder_id = &dashboard.folder;
    let ReportDashboardTab::One(tab_id) = &dashboard.tabs;

    let options = LaunchOptions::default_builder()
        .window_size(Some((1370, 730)))
        .build()?;
    let browser = Browser::new(options)?;

    let tab = browser.new_tab()?;

    let web_url = &CONFIG.common.web_url;
    tab.navigate_to(&format!("{web_url}/login"))?
        .wait_for_element("input[type='email']")?
        .click()?;
    tab.type_str(user_id)?;
    tab.wait_for_element("input[type='password']")?.click()?;
    tab.type_str(user_pass)?.press_key("Enter")?;
    tab.wait_until_navigated()?;
    tab.wait_for_element("aside")?;

    let dashb_url = match timerange.range_type {
        ReportTimerangeType::Relative => {
            format!(
                "{web_url}/dashboards/view?org_identifier={org_id}&dashboard={dashboard_id}&folder={folder_id}&tab={tab_id}&refresh=Off&period={}&var-__dynamic_filters=%255B%255D&print=true",
                &timerange.period
            )
        }
        ReportTimerangeType::Absolute => {
            format!(
                "{web_url}/dashboards/view?org_identifier={org_id}&dashboard={dashboard_id}&folder={folder_id}&tab={tab_id}&refresh=Off&from={}&to={}&var-__dynamic_filters=%255B%255D&print=true",
                &timerange.from, &timerange.to
            )
        }
    };

    tab.navigate_to(&dashb_url)?.wait_until_navigated()?;
    tab.wait_for_element("main")?;

    tab.wait_for_element("div.displayDiv")?;
    let pdf_data = tab.print_to_pdf(Some(PrintToPdfOptions {
        landscape: Some(true),
        ..Default::default()
    }))?;

    Ok(pdf_data)
}
