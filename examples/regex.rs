fn main() {
    let text = "(Hello_world), this is a test";
    let re = regex::Regex::new(r"(?i)\b(\w+)\b").unwrap();
    for cap in re.captures_iter(text) {
        println!("Match: {:?}", cap);
    }
}
