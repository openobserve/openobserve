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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, ToSchema)]
pub struct RequestCreateView {
    /// Base64 encoded string, containing all the data for a given view.
    /// This data is expected to be versioned so that the frontend can deserialize
    /// as required.
    pub data: serde_json::Value,

    /// User-readable name of the view, doesn't need to be unique.
    pub view_name: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct RequestUpdateView {
    /// Base64 encoded string, containing all the data for a given view.
    /// This data is expected to be versioned so that the frontend can deserialize
    /// as required.
    pub data: serde_json::Value,

    /// User-readable name of the view, doesn't need to be unique.
    pub view_name: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct View {
    pub org_id: String,
    pub data: serde_json::Value,
    pub view_id: String,
    pub view_name: String,
}

/// Save the bandwidth for a given view, without sending the actual data
/// This is expected to be used for listing views.
#[derive(Serialize, Deserialize, ToSchema)]
pub struct ViewWithoutData {
    pub org_id: String,
    pub view_id: String,
    pub view_name: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct ViewsWithoutData {
    pub views: Vec<ViewWithoutData>,
}
#[derive(Serialize, Deserialize, ToSchema)]
pub struct Views {
    pub views: Vec<View>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct ResponseDeleteView {
    pub org_id: String,
    pub view_id: String,
    //TODO(ansrivas): Check if we have access to view_name
    // pub view_name: String,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct ResponseCreateView {
    pub org_id: String,
    pub view_id: String,
    pub view_name: String,
}
