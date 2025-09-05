use lettre::{AsyncSmtpTransport, Tokio1Executor};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct SmtpConfig {
    pub from_email: String,
    pub reply_to: String,
    pub client: &'static AsyncSmtpTransport<Tokio1Executor>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[cfg_attr(test, derive(PartialEq))]
pub struct EmailDetails {
    #[serde(alias = "recepients")]
    pub recipients: Vec<String>,
    pub title: String,
    pub name: String,
    pub message: String,
    pub dashb_url: String,
}

#[derive(Debug, PartialEq, Clone)]
pub enum ReportType {
    PDF,
    Cache,
}

#[derive(Serialize, Debug, Deserialize, Clone)]
pub struct Report {
    pub dashboards: Vec<ReportDashboard>,
    pub email_details: EmailDetails,
}

#[derive(Serialize, Debug, Deserialize, Clone)]
pub struct ReportDashboard {
    pub dashboard: String,
    pub folder: String,
    pub tabs: Vec<String>,
    #[serde(default)]
    pub variables: Vec<ReportDashboardVariable>,
    /// The timerange of dashboard data.
    #[serde(default)]
    pub timerange: ReportTimerange,
}

#[derive(Serialize, Debug, Default, Deserialize, Clone)]
pub struct ReportDashboardVariable {
    pub key: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Serialize, Debug, Default, Deserialize, Clone, PartialEq)]
pub enum ReportTimerangeType {
    #[default]
    #[serde(rename = "relative")]
    Relative,
    #[serde(rename = "absolute")]
    Absolute,
}

#[derive(Serialize, Debug, Deserialize, Clone)]
pub struct ReportTimerange {
    #[serde(rename = "type")]
    pub range_type: ReportTimerangeType,
    pub period: String, // 15m, 4M etc. For relative.
    pub from: i64,      // For absolute, in microseconds
    pub to: i64,        // For absolute, in microseconds
}

impl Default for ReportTimerange {
    fn default() -> Self {
        Self {
            range_type: ReportTimerangeType::default(),
            period: "1w".to_string(),
            from: 0,
            to: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recipients_backwards_compatibility() {
        // The serde alias allows loading data created before the typo was fixed.
        let email_details = EmailDetails {
            recipients: vec!["foo@example.com".to_string()],
            title: "title".to_string(),
            name: "name".to_string(),
            message: "message".to_string(),
            dashb_url: "https://example.com/dashb_url".to_string(),
        };
        let json = serde_json::to_string(&email_details).unwrap();
        let json_using_alias = json.replace("recipients", "recepients");
        let email_details_from_alias: EmailDetails =
            serde_json::from_str(&json_using_alias).unwrap();
        assert_eq!(email_details, email_details_from_alias);
    }
}
