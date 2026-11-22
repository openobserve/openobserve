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

use plotters::{
    coord::types::{RangedCoordf64, RangedCoordu64},
    prelude::*,
};

use super::payload::ChartPayload;

pub const CHART_WIDTH: u32 = 800;
pub const CHART_HEIGHT: u32 = 360;

/// The registered family name — every text style below must use exactly this.
const FONT_FAMILY: &str = "sans-serif";
static FONT_BYTES: &[u8] = include_bytes!("font/DejaVuSans.ttf");
static REGISTER_FONT: Once = Once::new();
const PURPLE: RGBColor = RGBColor(98, 76, 245);
const RED: RGBColor = RGBColor(224, 62, 62);
const ORANGE: RGBColor = RGBColor(255, 158, 44);

type Chart<'a, 'b> =
    ChartContext<'a, BitMapBackend<'b>, Cartesian2d<RangedCoordu64, RangedCoordf64>>;

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
    let ((x_min, x_max), (y_min, y_max)) =
        axis_ranges(p).ok_or_else(|| anyhow::anyhow!("nothing to draw"))?;

    let mut rgb = vec![0u8; (CHART_WIDTH * CHART_HEIGHT * 3) as usize];
    {
        let root =
            BitMapBackend::with_buffer(&mut rgb, (CHART_WIDTH, CHART_HEIGHT)).into_drawing_area();
        root.fill(&WHITE)?;

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

        let gap = gap_threshold(&p.points);
        if let Some(band) = p.band.as_deref().filter(|b| b.len() == p.points.len()) {
            draw_band(&mut chart, &p.points, band, gap)?;
        }
        draw_line(&mut chart, &p.points, gap, y_min, !p.is_anomaly())?;

        if let Some(c) = p.crit {
            chart.draw_series(DashedLineSeries::new(
                [(x_min, c), (x_max, c)],
                8,
                5,
                RED.stroke_width(2),
            ))?;
        }
        if let Some(w) = p.warn {
            chart.draw_series(DashedLineSeries::new(
                [(x_min, w), (x_max, w)],
                8,
                5,
                ORANGE.stroke_width(2),
            ))?;
        }

        if p.is_anomaly() {
            chart.draw_series(
                p.marks
                    .iter()
                    .map(|&(t, v)| Circle::new((t, v), 5, RED.filled())),
            )?;
        } else if let Some((tt, tv)) = p
            .points
            .iter()
            .min_by_key(|(t, _)| t.abs_diff(p.trigger_ts))
            .copied()
        {
            chart.draw_series(std::iter::once(Circle::new((tt, tv), 5, RED.filled())))?;
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

/// The x and y ranges, or None when nothing can be drawn. A threshold chart needs two
/// points; an anomaly chart needs one point or one mark, and its band and marks stay in range.
fn axis_ranges(p: &ChartPayload) -> Option<((u64, u64), (f64, f64))> {
    let anomaly = p.is_anomaly();
    if p.points.len() < 2 && !(anomaly && (!p.points.is_empty() || !p.marks.is_empty())) {
        return None;
    }
    let band = p.band.iter().flatten().flatten();
    let marks: &[(u64, f64)] = if anomaly { &p.marks } else { &[] };
    let (x_min, x_max) = if anomaly {
        let times = p.points.iter().chain(marks).map(|(t, _)| *t);
        let (lo, hi) = (times.clone().min()?, times.max()?);
        // One timestamp gives an empty range; centre it in an hour.
        if hi > lo {
            (lo, hi)
        } else {
            (lo.saturating_sub(1800), hi + 1800)
        }
    } else {
        // Main's range: first to last point, at least one second wide.
        let lo = p.points.first()?.0;
        (lo, p.points.last()?.0.max(lo + 1))
    };
    let values = p
        .points
        .iter()
        .chain(marks)
        .map(|(_, v)| *v)
        .chain(band.flat_map(|&(l, u)| [l, u]));
    let mut y_max = values
        .clone()
        .fold(f64::MIN, f64::max)
        .max(p.crit.unwrap_or(f64::MIN))
        .max(p.warn.unwrap_or(f64::MIN));
    let mut y_min = values.fold(f64::MAX, f64::min).min(0.0);
    // `partial_cmp` (not `y_max <= y_min`): NaN must also take the
    // degenerate-range fallback (clippy neg_cmp_op_on_partial_ord).
    if y_max.partial_cmp(&y_min) != Some(std::cmp::Ordering::Greater) {
        y_max = y_min + 1.0;
    }
    let pad = (y_max - y_min) * 0.15;
    y_max += pad;
    y_min -= pad * 0.3;
    // An overflowed span (e.g. 1e308 and -1e308) makes plotters loop forever.
    if !(y_max - y_min).is_finite() {
        return None;
    }
    Some(((x_min, x_max), (y_min, y_max)))
}

/// Aggregation alerts record no value below the warning band, so interpolating across a
/// time gap (> 3x the median spacing) would paint a false plateau.
fn gap_threshold(points: &[(u64, f64)]) -> u64 {
    let mut intervals: Vec<u64> = points
        .windows(2)
        .map(|w| w[1].0.saturating_sub(w[0].0))
        .collect();
    intervals.sort_unstable();
    let median = intervals.get(intervals.len() / 2).copied().unwrap_or(60);
    median.saturating_mul(3).max(1)
}

/// Index ranges of `points` split at every time gap and every index `keep` rejects.
fn segments(
    points: &[(u64, f64)],
    gap: u64,
    keep: impl Fn(usize) -> bool,
) -> Vec<std::ops::Range<usize>> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    for i in 0..points.len() {
        if !keep(i) {
            if let Some(s) = start.take() {
                out.push(s..i);
            }
            continue;
        }
        match start {
            Some(s) if points[i].0.saturating_sub(points[i - 1].0) > gap => {
                out.push(s..i);
                start = Some(i);
            }
            Some(_) => {}
            None => start = Some(i),
        }
    }
    if let Some(s) = start {
        out.push(s..points.len());
    }
    out
}

fn draw_line(
    chart: &mut Chart<'_, '_>,
    points: &[(u64, f64)],
    gap: u64,
    y_min: f64,
    fill: bool,
) -> Result<(), anyhow::Error> {
    for seg in segments(points, gap, |_| true) {
        let seg = &points[seg];
        if seg.len() == 1 {
            // The scheduled chart keeps the dot size it always had.
            let radius = if fill { 2 } else { 3 };
            chart.draw_series(std::iter::once(Circle::new(
                (seg[0].0, seg[0].1),
                radius,
                PURPLE.filled(),
            )))?;
            continue;
        }
        // The band is the shaded area of an anomaly chart; a value fill would cover it.
        if fill {
            chart.draw_series(AreaSeries::new(
                seg.iter().copied(),
                y_min,
                PURPLE.mix(0.12),
            ))?;
        }
        chart.draw_series(LineSeries::new(seg.iter().copied(), PURPLE.stroke_width(2)))?;
    }
    Ok(())
}

/// A bucket without bounds leaves a gap in the band rather than bridging its neighbours.
fn draw_band(
    chart: &mut Chart<'_, '_>,
    points: &[(u64, f64)],
    band: &[Option<(f64, f64)>],
    gap: u64,
) -> Result<(), anyhow::Error> {
    let shade = PURPLE.mix(0.16);
    for seg in segments(points, gap, |i| band[i].is_some()) {
        let edges: Vec<(u64, f64, f64)> = seg
            .filter_map(|i| band[i].map(|(l, u)| (points[i].0, l, u)))
            .collect();
        if let [(t, l, u)] = edges[..] {
            chart.draw_series(std::iter::once(PathElement::new(
                vec![(t, l), (t, u)],
                shade.stroke_width(6),
            )))?;
            continue;
        }
        let outline: Vec<(u64, f64)> = edges
            .iter()
            .map(|&(t, _, u)| (t, u))
            .chain(edges.iter().rev().map(|&(t, l, _)| (t, l)))
            .collect();
        chart.draw_series(std::iter::once(Polygon::new(outline, shade.filled())))?;
    }
    Ok(())
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
            band: None,
            marks: Vec::new(),
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

    fn anomaly_sample() -> ChartPayload {
        let points: Vec<(u64, f64)> = (0..40u64)
            .map(|i| {
                (
                    1_700_000_000 + i * 300,
                    100.0 + ((i as f64) * 0.5).sin() * 5.0,
                )
            })
            .collect();
        let band = points
            .iter()
            .enumerate()
            .map(|(i, &(_, v))| (i != 12).then_some((v - 10.0, v + 10.0)))
            .collect();
        let mut points = points;
        points[30].1 = 160.0;
        ChartPayload {
            v: 1,
            exp: 2_000_000_000,
            title: "latency_spike · default".into(),
            marks: vec![points[30], (1_700_000_000 + 35 * 300, 0.0)],
            points,
            crit: None,
            warn: None,
            trigger_ts: 1_700_000_000 + 39 * 300,
            band: Some(band),
        }
    }

    fn red_pixels(png: &[u8]) -> usize {
        let img = image::load_from_memory_with_format(png, image::ImageFormat::Png)
            .unwrap()
            .to_rgb8();
        img.pixels()
            .filter(|px| px.0 == [RED.0, RED.1, RED.2])
            .count()
    }

    #[test]
    fn renders_band_and_marks_deterministically() {
        let p = anomaly_sample();
        let a = render_png(&p).unwrap();
        assert_eq!(&a[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        assert_eq!(a, render_png(&p).unwrap());
        assert!(red_pixels(&a) > 0);
        let mut no_band = p.clone();
        no_band.band = Some(vec![None; no_band.points.len()]);
        assert_ne!(a, render_png(&no_band).unwrap());
    }

    #[test]
    fn an_anomaly_chart_without_marks_has_no_red_dot() {
        let mut p = anomaly_sample();
        p.marks.clear();
        assert!(p.is_anomaly());
        assert_eq!(red_pixels(&render_png(&p).unwrap()), 0);
        // The threshold chart still marks its trigger point.
        assert!(red_pixels(&render_png(&sample()).unwrap()) > 0);
    }

    #[test]
    fn overflowing_value_range_is_an_error() {
        for (hi, lo) in [(1e308, -1e308), (9e307, -9e307), (f64::MAX, 0.0)] {
            let mut p = sample();
            p.points[0].1 = hi;
            p.points[1].1 = lo;
            assert!(render_png(&p).is_err(), "{hi} / {lo}");
        }
        let mut p = anomaly_sample();
        p.marks = vec![(1_700_000_000, 1e308), (1_700_000_060, -1e308)];
        assert!(render_png(&p).is_err());
    }

    #[test]
    fn large_finite_value_range_renders() {
        for (hi, lo) in [(1e308, 0.0), (1e300, -1e300), (1e15, -1e15)] {
            let mut p = sample();
            p.points[0].1 = hi;
            p.points[1].1 = lo;
            assert!(render_png(&p).is_ok(), "{hi} / {lo}");
        }
    }

    #[test]
    fn one_value_point_renders() {
        let mut p = anomaly_sample();
        p.points.truncate(1);
        p.band = Some(vec![Some((90.0, 110.0))]);
        p.marks.clear();
        assert!(render_png(&p).is_ok());
    }

    #[test]
    fn only_absence_marks_render() {
        let mut p = anomaly_sample();
        p.points.clear();
        p.band = Some(Vec::new());
        p.marks = vec![(1_700_000_000, 0.0), (1_700_003_600, 0.0)];
        let png = render_png(&p).unwrap();
        assert!(red_pixels(&png) > 0);
        p.marks.clear();
        assert!(render_png(&p).is_err());
    }

    #[test]
    fn band_and_marks_stay_inside_the_axis_ranges() {
        let mut p = anomaly_sample();
        p.points = (0..10u64)
            .map(|i| (1_700_000_000 + i * 60, 80.0 + i as f64 * 2.0))
            .collect();
        p.band = Some(vec![Some((180.0, 220.0)); 10]);
        p.marks = vec![(1_700_000_000 + 900, 300.0)];
        let ((x_min, x_max), (y_min, y_max)) = axis_ranges(&p).unwrap();
        assert!(y_min <= 80.0 && y_max >= 300.0, "{y_min}..{y_max}");
        assert!(x_min <= 1_700_000_000 && x_max >= 1_700_000_900);
        p.marks.clear();
        let (_, (y_min, y_max)) = axis_ranges(&p).unwrap();
        assert!(y_min <= 80.0 && y_max >= 220.0, "{y_min}..{y_max}");
    }
}
