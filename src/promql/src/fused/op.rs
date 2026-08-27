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

use promql_parser::parser::token::{self, TokenId};

/// Aggregations that can fold range-function output incrementally through one
/// dense per-timestamp state per output group.
#[derive(Clone, Copy, Debug)]
pub(crate) enum FusedAggOp {
    Avg,
    Count,
    Group,
    Max,
    Min,
    Stddev,
    Stdvar,
    Sum,
}

impl FusedAggOp {
    pub(crate) fn from_token(id: TokenId) -> Option<Self> {
        match id {
            token::T_AVG => Some(Self::Avg),
            token::T_COUNT => Some(Self::Count),
            token::T_GROUP => Some(Self::Group),
            token::T_MAX => Some(Self::Max),
            token::T_MIN => Some(Self::Min),
            token::T_STDDEV => Some(Self::Stddev),
            token::T_STDVAR => Some(Self::Stdvar),
            token::T_SUM => Some(Self::Sum),
            _ => None,
        }
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Avg => "avg",
            Self::Count => "count",
            Self::Group => "group",
            Self::Max => "max",
            Self::Min => "min",
            Self::Stddev => "stddev",
            Self::Stdvar => "stdvar",
            Self::Sum => "sum",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fused_agg_op_token_coverage() {
        assert!(FusedAggOp::from_token(token::T_SUM).is_some());
        assert!(FusedAggOp::from_token(token::T_AVG).is_some());
        assert!(FusedAggOp::from_token(token::T_TOPK).is_none());
        assert!(FusedAggOp::from_token(token::T_QUANTILE).is_none());
        assert!(FusedAggOp::from_token(token::T_COUNT_VALUES).is_none());
    }
}
