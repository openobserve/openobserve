// Copyright 2022 Zinc Labs Inc. and Contributors
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

use datafusion::error::Result;
use promql_parser::parser::Expr as PromExpr;

use super::Engine;
use crate::service::promql::value::Value;

pub async fn bottomk(ctx: &mut Engine, param: Box<PromExpr>, data: &Value) -> Result<Value> {
    super::eval_top(ctx, param, data, true).await
}
