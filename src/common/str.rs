#[inline(always)]
#[cfg(target_arch = "x86_64")]
pub fn find(haystack: &str, needle: &str) -> bool {
    memchr::memmem::find(haystack.as_bytes(), needle.as_bytes()).is_some()
}

#[inline(always)]
#[cfg(not(target_arch = "x86_64"))]
pub fn find(haystack: &str, needle: &str) -> bool {
    haystack.contains(needle)
}

#[cfg(test)]
mod test_utils {
    use super::*;
    #[test]
    fn test_find() {
        let haystack = "This is Zinc-oxide";
        let needle = "oxide";
        let result = find(haystack, needle);
        assert_eq!(result, true)
    }
}
