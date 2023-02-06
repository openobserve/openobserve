use chrono::{
    DateTime, Datelike, Duration, FixedOffset, Local, NaiveDateTime, TimeZone, Timelike, Utc,
};
use std::ops::Sub;

fn main() {
    let s = "2022-09-27T00:00:00Z";
    let time = DateTime::parse_from_rfc3339(s).unwrap();
    println!("{:?}, {:?}", time, time.timestamp_micros());

    let s = "2022-08-29 18:23:23";
    let fmt = "%Y-%m-%d %H:%M:%S";
    let time = NaiveDateTime::parse_from_str(s, fmt).unwrap();
    println!("{:?}", time);

    let s = "2022-09-27T18:23:23+08:00";
    let fmt = "%Y-%m-%dT%H:%M:%S%z";
    let time = NaiveDateTime::parse_from_str(s, fmt).unwrap();
    println!("{:?}", time);

    /* let dt = Utc.with_ymd_and_hms(2022, 9, 12, 2, 0, 0).unwrap(); // `2014-07-08T09:10:11Z`
       println!("{:?}, {:?}", dt, dt.timestamp_micros());
    */
    let dt = Utc.timestamp_nanos(1661752800000000000);
    println!("{:?}", dt);

    let dt = Utc.timestamp_nanos(1661731871000000000);
    println!("{:?}", dt);

    let dt = Utc.timestamp_nanos(1662102671000000000);
    println!("{:?}", dt);

    let dt = parse_time("2022-08-29 18:23:23").unwrap();
    println!("{:?}", dt.to_string());

    let dt = parse_time("2022-08-29T18:23:23Z").unwrap();
    println!("{:?}", dt.to_string());

    let dt = parse_time("2022-08-29T18:23:23+08:00").unwrap();
    println!("{:?}", dt.to_string());

    let dt = parse_time("2022-10-13T04:38:52.260290946+08:00").unwrap();
    println!("{:?}", dt.to_string());
    let dt = parse_time("2022-10-13T04:38:52.260290946Z").unwrap();
    println!("{:?}", dt.to_string());
    let dt = parse_time("2022-10-13T04:38:52.260Z").unwrap();
    println!("{:?}", dt.to_string());
    let dt = parse_time("2022-10-13T04:38:52Z").unwrap();
    println!("{:?}", dt.to_string());
    let dt = parse_time("2022-10-13T04:38:52").unwrap();
    println!("{:?}", dt.to_string());
    let dt = parse_time("2022-10-13 04:38:52").unwrap();
    println!("{:?}", dt.to_string());

    let dt = chrono::Utc::now().timestamp_micros();
    println!("{:?}", dt);

    let now = Utc::now().sub(Duration::hours(1));
    let offset: DateTime<Utc> = Utc
        .with_ymd_and_hms(now.year(), now.month(), now.day(), now.hour(), 0, 0)
        .unwrap();
    println!("{:?}", now);
    println!("{:?}", offset);

    let offset_in_sec = Local::now().offset().local_minus_utc();
    println!("offset: {:?}", offset_in_sec);
    println!("offset: {:?}", sys_info::hostname());
}

fn parse_time(s: &str) -> Result<DateTime<FixedOffset>, anyhow::Error> {
    if s.contains('T') {
        if s.len() == 19 {
            let fmt = "%Y-%m-%dT%H:%M:%S";
            let ret = Utc.datetime_from_str(s, fmt)?;
            Ok(ret.into())
        } else {
            Ok(chrono::DateTime::parse_from_rfc3339(s)?)
        }
    } else if s.contains(',') {
        Ok(chrono::DateTime::parse_from_rfc2822(s)?)
    } else {
        let fmt = "%Y-%m-%d %H:%M:%S";
        let ret = Utc.datetime_from_str(s, fmt)?;
        Ok(ret.into())
    }
}
