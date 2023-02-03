use serde::{Deserialize, Serialize};

use super::{alert::Alert, functions::Transform, stream::Stream};

#[derive(Clone, Debug, Serialize, Deserialize)]

pub struct OrgSummary {
    pub streams: Vec<Stream>,
    pub functions: Vec<Transform>,
    pub alerts: Vec<Alert>,
}
