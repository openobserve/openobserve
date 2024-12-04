use chrono::{DateTime, FixedOffset};
use config::meta::dashboards::{v1, v2, v3, v4, v5};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use utoipa::ToSchema;

/// HTTP request body for the `CreateDashboard` endpoint.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateDashboardRequestBody(JsonValue);

/// HTTP response body for `CreateDashboard` endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct CreateDashboardResponseBody(DashboardDetails);

/// HTTP response body for `GetDashboard` endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct GetDashboardResponseBody(DashboardDetails);

/// HTTP request body for `UpdateDashboard` endpoint.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateDashboardRequestBody(JsonValue);

/// HTTP response body for `UpdateDashboard` endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct UpdateDashboardResponseBody(DashboardDetails);

/// HTTP URL query component that contains parameters for listing dashboards.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(style = Form, parameter_in = Query)]
pub struct ListDashboardsQuery {
    /// Optional folder ID filter parameter
    ///
    /// If neither `folder` nor any other filter parameter are set then this
    /// will search for all dashboards in the "default" folder.
    ///
    /// If `folder` is not set and another filter parameter, such as `title`, is
    /// set then this will search for dashboards in all folders.
    folder: Option<String>,

    /// The optional case-insensitive title substring with which to filter
    /// dashboards.
    title: Option<String>,
}

/// HTTP response body for `ListDashboards` endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct ListDashboardsResponseBody {
    pub dashboards: Vec<ListDashboardsResponseBodyItem>,
}

/// An item in the list returned by the `ListDashboards` endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct ListDashboardsResponseBodyItem {
    #[serde(default)]
    pub dashboard_id: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default = "datetime_now")]
    #[schema(value_type = String, format = DateTime)]
    pub created: DateTime<FixedOffset>,
    pub hash: String,
    pub version: i32,

    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v1: Option<JsonValue>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v2: Option<JsonValue>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v3: Option<JsonValue>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v4: Option<JsonValue>,
    #[deprecated(note = "use GetDashboard endpoint to get dashboard details")]
    pub v5: Option<JsonValue>,
}

/// HTTP request body for `MoveDashboard` endpoint.
#[derive(Debug, Clone, PartialEq, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveDashboardRequestBody {
    pub from: String,
    pub to: String,
}

/// Version-specific dashboard details and hash.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct DashboardDetails {
    pub version: i32,
    pub v1: Option<JsonValue>,
    pub v2: Option<JsonValue>,
    pub v3: Option<JsonValue>,
    pub v4: Option<JsonValue>,
    pub v5: Option<JsonValue>,
    pub hash: String,
}

impl TryFrom<CreateDashboardRequestBody> for config::meta::dashboards::Dashboard {
    type Error = serde_json::Error;

    fn try_from(value: CreateDashboardRequestBody) -> Result<Self, Self::Error> {
        let json = value.0;
        parse_dashboard_request(json)
    }
}

impl TryFrom<config::meta::dashboards::Dashboard> for CreateDashboardResponseBody {
    type Error = serde_json::Error;

    fn try_from(value: config::meta::dashboards::Dashboard) -> Result<Self, Self::Error> {
        Ok(Self(value.try_into()?))
    }
}

impl TryFrom<config::meta::dashboards::Dashboard> for GetDashboardResponseBody {
    type Error = serde_json::Error;

    fn try_from(value: config::meta::dashboards::Dashboard) -> Result<Self, Self::Error> {
        Ok(Self(value.try_into()?))
    }
}

impl TryFrom<UpdateDashboardRequestBody> for config::meta::dashboards::Dashboard {
    type Error = serde_json::Error;

    fn try_from(value: UpdateDashboardRequestBody) -> Result<Self, Self::Error> {
        let json = value.0;
        parse_dashboard_request(json)
    }
}

impl TryFrom<config::meta::dashboards::Dashboard> for UpdateDashboardResponseBody {
    type Error = serde_json::Error;

    fn try_from(value: config::meta::dashboards::Dashboard) -> Result<Self, Self::Error> {
        Ok(Self(value.try_into()?))
    }
}

impl ListDashboardsQuery {
    pub fn into(self, org_id: &str) -> config::meta::dashboards::ListDashboardsParams {
        match self {
            Self {
                folder: Some(f),
                title: Some(t),
            } => config::meta::dashboards::ListDashboardsParams::new(org_id)
                .with_folder_id(&f)
                .where_title_contains(&t),
            Self {
                folder: None,
                title: Some(t),
            } => {
                config::meta::dashboards::ListDashboardsParams::new(org_id).where_title_contains(&t)
            }
            Self {
                folder: Some(f),
                title: None,
            } => config::meta::dashboards::ListDashboardsParams::new(org_id).with_folder_id(&f),
            Self {
                folder: None,
                title: None,
            } => {
                // To preserve backwards-compatability when no filter parameters
                // are given we will list the contents of the default folder.
                config::meta::dashboards::ListDashboardsParams::new(org_id)
                    .with_folder_id(config::meta::folder::DEFAULT_FOLDER)
            }
        }
    }
}

impl TryFrom<Vec<config::meta::dashboards::Dashboard>> for ListDashboardsResponseBody {
    type Error = serde_json::Error;

    fn try_from(value: Vec<config::meta::dashboards::Dashboard>) -> Result<Self, Self::Error> {
        let dashboards: Result<Vec<ListDashboardsResponseBodyItem>, _> = value
            .into_iter()
            .map(TryInto::<ListDashboardsResponseBodyItem>::try_into)
            .collect();
        Ok(Self {
            dashboards: dashboards?,
        })
    }
}

impl TryFrom<config::meta::dashboards::Dashboard> for ListDashboardsResponseBodyItem {
    type Error = serde_json::Error;

    #[allow(deprecated)]
    fn try_from(value: config::meta::dashboards::Dashboard) -> Result<Self, Self::Error> {
        Ok(Self {
            dashboard_id: value.dashboard_id().unwrap_or_default().to_owned(),
            title: value.title().unwrap_or_default().to_owned(),
            description: value.description().unwrap_or_default().to_owned(),
            role: value.role().unwrap_or_default().to_owned(),
            owner: value.owner().unwrap_or_default().to_owned(),
            created: value.created_at_deprecated().unwrap_or_default(),
            hash: value.hash,
            version: value.version,
            // Populate deprecated fields until they are removed from the API.
            v1: value.v1.as_ref().map(serde_json::to_value).transpose()?,
            v2: value.v2.as_ref().map(serde_json::to_value).transpose()?,
            v3: value.v3.as_ref().map(serde_json::to_value).transpose()?,
            v4: value.v4.as_ref().map(serde_json::to_value).transpose()?,
            v5: value.v5.as_ref().map(serde_json::to_value).transpose()?,
        })
    }
}

impl TryFrom<config::meta::dashboards::Dashboard> for DashboardDetails {
    type Error = serde_json::Error;

    fn try_from(value: config::meta::dashboards::Dashboard) -> Result<Self, Self::Error> {
        Ok(Self {
            version: value.version,
            v1: value.v1.as_ref().map(serde_json::to_value).transpose()?,
            v2: value.v2.as_ref().map(serde_json::to_value).transpose()?,
            v3: value.v3.as_ref().map(serde_json::to_value).transpose()?,
            v4: value.v4.as_ref().map(serde_json::to_value).transpose()?,
            v5: value.v5.as_ref().map(serde_json::to_value).transpose()?,
            hash: value.hash,
        })
    }
}

impl TryFrom<DashboardDetails> for config::meta::dashboards::Dashboard {
    type Error = serde_json::Error;

    #[allow(deprecated)]
    fn try_from(value: DashboardDetails) -> Result<Self, Self::Error> {
        Ok(Self {
            version: value.version,
            v1: value.v1.map(serde_json::from_value).transpose()?,
            v2: value.v2.map(serde_json::from_value).transpose()?,
            v3: value.v3.map(serde_json::from_value).transpose()?,
            v4: value.v4.map(serde_json::from_value).transpose()?,
            v5: value.v5.map(serde_json::from_value).transpose()?,
            hash: value.hash,
        })
    }
}

/// Parses the JSON value from an HTTP request body into a dashboard.
fn parse_dashboard_request(
    value: JsonValue,
) -> Result<config::meta::dashboards::Dashboard, serde_json::Error> {
    // Pull the version field out of the JSON. If it doesn't exist, assume the
    // default version is 1.
    let version = value
        .as_object()
        .and_then(|o| o.get("version"))
        .and_then(|v| v.as_i64())
        .unwrap_or(1);

    let dash = match version {
        1 => {
            let inner: v1::Dashboard = serde_json::from_value(value)?;
            inner.into()
        }
        2 => {
            let inner: v2::Dashboard = serde_json::from_value(value)?;
            inner.into()
        }
        3 => {
            let inner: v3::Dashboard = serde_json::from_value(value)?;
            inner.into()
        }
        4 => {
            let inner: v4::Dashboard = serde_json::from_value(value)?;
            inner.into()
        }
        _ => {
            let inner: v5::Dashboard = serde_json::from_value(value)?;
            inner.into()
        }
    };
    Ok(dash)
}
