// Copyright 2025 OpenObserve Inc.
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

use std::{fmt, fmt::Formatter};

use datafusion::physical_plan::{DisplayFormatType, ExecutionPlan, ExecutionPlanVisitor};

#[derive(Debug, Clone, Copy)]
enum ShowMetrics {
    Aggregated,
    Full,
}

pub struct DisplayableExecutionPlan<'a> {
    inner: &'a dyn ExecutionPlan,
    show_metrics: ShowMetrics,
}

impl<'a> DisplayableExecutionPlan<'a> {
    pub fn new(inner: &'a dyn ExecutionPlan) -> Self {
        Self {
            inner,
            show_metrics: ShowMetrics::Aggregated,
        }
    }

    #[allow(dead_code)]
    pub fn with_full_metrics(inner: &'a dyn ExecutionPlan) -> Self {
        Self {
            inner,
            show_metrics: ShowMetrics::Full,
        }
    }

    pub fn indent(&self, verbose: bool) -> impl fmt::Display + 'a {
        let format_type = if verbose {
            DisplayFormatType::Verbose
        } else {
            DisplayFormatType::Default
        };
        struct Wrapper<'a> {
            format_type: DisplayFormatType,
            plan: &'a dyn ExecutionPlan,
            show_metrics: ShowMetrics,
        }
        impl fmt::Display for Wrapper<'_> {
            fn fmt(&self, f: &mut Formatter) -> fmt::Result {
                let mut visitor = IndentVisitor {
                    t: self.format_type,
                    f,
                    indent: 0,
                    show_metrics: self.show_metrics,
                };
                visit_plan(self.plan, &mut visitor)
            }
        }
        Wrapper {
            format_type,
            plan: self.inner,
            show_metrics: self.show_metrics,
        }
    }
}

struct IndentVisitor<'a, 'b> {
    t: DisplayFormatType,
    f: &'a mut Formatter<'b>,
    indent: usize,
    show_metrics: ShowMetrics,
}

impl ExecutionPlanVisitor for IndentVisitor<'_, '_> {
    type Error = fmt::Error;
    fn pre_visit(&mut self, plan: &dyn ExecutionPlan) -> Result<bool, Self::Error> {
        write!(self.f, "{:indent$}", "", indent = self.indent * 2)?;
        plan.fmt_as(self.t, self.f)?;
        match self.show_metrics {
            ShowMetrics::Aggregated => {
                if let Some(metrics) = plan.metrics() {
                    let metrics = metrics
                        .aggregate_by_name()
                        .sorted_for_display()
                        .timestamps_removed();

                    write!(self.f, ", metrics=[{metrics}]")?;
                } else {
                    write!(self.f, ", metrics=[]")?;
                }
            }
            ShowMetrics::Full => {
                if let Some(metrics) = plan.metrics() {
                    write!(self.f, ", metrics=[{metrics}]")?;
                } else {
                    write!(self.f, ", metrics=[]")?;
                }
            }
        }
        writeln!(self.f)?;
        self.indent += 1;
        Ok(true)
    }

    fn post_visit(&mut self, _plan: &dyn ExecutionPlan) -> Result<bool, Self::Error> {
        self.indent -= 1;
        Ok(true)
    }
}

// stop check the childern if it is the RemoteScanExec
fn visit_plan<V: ExecutionPlanVisitor>(
    plan: &dyn ExecutionPlan,
    visitor: &mut V,
) -> Result<(), V::Error> {
    visitor.pre_visit(plan)?;

    if plan.name() == "RemoteScanExec" {
        visitor.post_visit(plan)?;
        return Ok(());
    }

    for child in plan.children() {
        visit_plan(child.as_ref(), visitor)?;
    }

    visitor.post_visit(plan)?;
    Ok(())
}
