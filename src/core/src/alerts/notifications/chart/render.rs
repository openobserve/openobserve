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

//! Pure-Rust chart rendering for alert notifications (no headless browser,
//! no report-server). plotters + an embedded DejaVu Sans (Bitstream Vera
//! license, see `font/LICENSE`) — system font discovery is unreliable in
//! containers, so the font ships in the binary.
//!
//! Style follows the alert-notification convention of Datadog-class tools
//! (validated against a live Slack channel in the design PoC): white
//! background, light gridlines, purple value line with a soft area fill,
//! dashed red/orange threshold lines, a red marker on the trigger point,
//! HH:MM UTC x-axis.

use std::sync::Once;

use plotters::prelude::*;

use super::payload::ChartPayload;

pub const CHART_WIDTH: u32 = 800;
pub const CHART_HEIGHT: u32 = 360;

/// The registered family name — every text style below must use exactly this.
const FONT_FAMILY: &str = "sans-serif";
static FONT_BYTES: &[u8] = include_bytes!("font/DejaVuSans.ttf");
static REGISTER_FONT: Once = Once::new();

fn ensure_font() {
    REGISTER_FONT.call_once(|| {
        // With only the `ab_glyph` backend there is no system-font fallback:
        // an unregistered family panics inside plotters at draw time, so a
        // corrupt embedded font must fail loudly here instead. (InvalidFont
        // doesn't impl Debug, hence no expect().)
        if plotters::style::register_font(FONT_FAMILY, FontStyle::Normal, FONT_BYTES).is_err() {
            panic!("embedded DejaVuSans.ttf is not a valid font");
        }
    });
}

fn hhmm(ts: u64) -> String {
    let secs_of_day = ts % 86_400;
    format!("{:02}:{:02}", secs_of_day / 3600, (secs_of_day % 3600) / 60)
}

/// Render the payload to PNG bytes. Deterministic for a given payload — the
/// render endpoint relies on this for cacheability (`Cache-Control` + the
/// per-node LRU key both assume identical input ⇒ identical output).
pub fn render_png(p: &ChartPayload) -> Result<Vec<u8>, anyhow::Error> {
    ensure_font();
    if p.points.len() < 2 {
        return Err(anyhow::anyhow!("need at least 2 points"));
    }

    let mut rgb = vec![0u8; (CHART_WIDTH * CHART_HEIGHT * 3) as usize];
    {
        let root =
            BitMapBackend::with_buffer(&mut rgb, (CHART_WIDTH, CHART_HEIGHT)).into_drawing_area();
        root.fill(&WHITE)?;

        let x_min = p.points.first().map(|pt| pt.0).unwrap_or(0);
        let x_max = p.points.last().map(|pt| pt.0).unwrap_or(x_min + 1);
        let x_max = x_max.max(x_min + 1);
        let mut y_max = p
            .points
            .iter()
            .map(|(_, v)| *v)
            .fold(f64::MIN, f64::max)
            .max(p.crit.unwrap_or(f64::MIN))
            .max(p.warn.unwrap_or(f64::MIN));
        let mut y_min = p
            .points
            .iter()
            .map(|(_, v)| *v)
            .fold(f64::MAX, f64::min)
            .min(0.0);
        // `partial_cmp` (not `y_max <= y_min`): NaN must also take the
        // degenerate-range fallback, and a negated float comparison hides
        // that case (clippy neg_cmp_op_on_partial_ord).
        if y_max.partial_cmp(&y_min) != Some(std::cmp::Ordering::Greater) {
            y_max = y_min + 1.0;
        }
        let pad = (y_max - y_min) * 0.15;
        y_max += pad;
        y_min -= pad * 0.3;

        let purple = RGBColor(98, 76, 245);
        let red = RGBColor(224, 62, 62);
        let orange = RGBColor(255, 158, 44);
        let grid = RGBColor(230, 230, 235);
        let axis_text = RGBColor(120, 120, 130);
        let title_text = RGBColor(40, 40, 50);

        let mut chart = ChartBuilder::on(&root)
            .margin(14)
            .caption(&p.title, (FONT_FAMILY, 18).into_font().color(&title_text))
            .x_label_area_size(28)
            .y_label_area_size(46)
            .build_cartesian_2d(x_min..x_max, y_min..y_max)?;

        chart
            .configure_mesh()
            .light_line_style(grid.mix(0.0))
            .bold_line_style(grid)
            .x_labels(6)
            .y_labels(6)
            .x_label_formatter(&|ts| hhmm(*ts))
            .y_label_formatter(&|v| {
                if v.abs() >= 1000.0 {
                    format!("{:.0}k", v / 1000.0)
                } else {
                    format!("{v:.4}")
                        .trim_end_matches('0')
                        .trim_end_matches('.')
                        .to_string()
                }
            })
            .label_style((FONT_FAMILY, 12).into_font().color(&axis_text))
            .axis_style(grid)
            .draw()?;

        // Draw the series in gap-broken segments: aggregation alerts record
        // no evaluation value below the warning band (the widened HAVING
        // filters those rows), so consecutive points can be far apart in
        // time. Interpolating across such a gap paints a false plateau
        // (live-verified: a baseline period rendered as a flat line at the
        // last breach value). A gap = interval > 3× the median sample
        // spacing; each segment gets its own fill + line, single points get
        // a small dot instead of an invisible zero-length line.
        let mut intervals: Vec<u64> = p.points.windows(2).map(|w| w[1].0 - w[0].0).collect();
        intervals.sort_unstable();
        let median = intervals.get(intervals.len() / 2).copied().unwrap_or(60);
        let gap = median.saturating_mul(3).max(1);
        let mut segments: Vec<&[(u64, f64)]> = Vec::new();
        let mut seg_start = 0usize;
        for i in 1..p.points.len() {
            if p.points[i].0 - p.points[i - 1].0 > gap {
                segments.push(&p.points[seg_start..i]);
                seg_start = i;
            }
        }
        segments.push(&p.points[seg_start..]);
        for seg in segments {
            if seg.len() == 1 {
                chart.draw_series(std::iter::once(Circle::new(
                    (seg[0].0, seg[0].1),
                    2,
                    purple.filled(),
                )))?;
                continue;
            }
            chart.draw_series(AreaSeries::new(
                seg.iter().map(|(t, v)| (*t, *v)),
                y_min,
                purple.mix(0.12),
            ))?;
            chart.draw_series(LineSeries::new(
                seg.iter().map(|(t, v)| (*t, *v)),
                purple.stroke_width(2),
            ))?;
        }

        if let Some(c) = p.crit {
            chart.draw_series(DashedLineSeries::new(
                [(x_min, c), (x_max, c)],
                8,
                5,
                red.stroke_width(2),
            ))?;
        }
        if let Some(w) = p.warn {
            chart.draw_series(DashedLineSeries::new(
                [(x_min, w), (x_max, w)],
                8,
                5,
                orange.stroke_width(2),
            ))?;
        }

        // Trigger marker: the point closest in time to the firing evaluation.
        if let Some((tt, tv)) = p
            .points
            .iter()
            .min_by_key(|(t, _)| t.abs_diff(p.trigger_ts))
            .copied()
        {
            chart.draw_series(std::iter::once(Circle::new((tt, tv), 5, red.filled())))?;
        }

        root.present()?;
    }

    use image::ImageEncoder;
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png).write_image(
        &rgb,
        CHART_WIDTH,
        CHART_HEIGHT,
        image::ColorType::Rgb8,
    )?;
    Ok(png)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::alerts::notifications::chart::payload::ChartPayload;

    fn sample() -> ChartPayload {
        ChartPayload {
            v: 1,
            exp: 2_000_000_000,
            title: "error_rate_high · default".into(),
            points: (0..90u64)
                .map(|i| (1_700_000_000 + i * 60, 1.5 + ((i as f64) * 0.7).sin() * 0.3))
                .collect(),
            crit: Some(5.0),
            warn: Some(3.0),
            trigger_ts: 1_700_000_000 + 89 * 60,
        }
    }

    #[test]
    fn renders_a_valid_png_with_expected_dimensions() {
        let png = render_png(&sample()).unwrap();
        // PNG magic signature.
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        // IHDR width/height are big-endian u32 at offsets 16/20.
        let w = u32::from_be_bytes(png[16..20].try_into().unwrap());
        let h = u32::from_be_bytes(png[20..24].try_into().unwrap());
        assert_eq!((w, h), (CHART_WIDTH, CHART_HEIGHT));
    }

    #[test]
    fn deterministic_for_identical_payload() {
        let a = render_png(&sample()).unwrap();
        let b = render_png(&sample()).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn fewer_than_two_points_is_an_error() {
        let mut p = sample();
        p.points.truncate(1);
        assert!(render_png(&p).is_err());
    }
}
