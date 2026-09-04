#!/bin/bash
# Raw-token audit over web/src — categorized counts.
cd /Users/ktx/Documents/KTX-Projects/openobserve/web || exit 1

# Common exclusions: tests, specs, mocks, vendored assets, token definition files
EXC=(--glob '!**/*.spec.ts' --glob '!**/*.spec.js' --glob '!src/test/**' --glob '!**/__mocks__/**'
     --glob '!src/assets/dashboard/echarts.min.js' --glob '!**/*.json' --glob '!**/*.md')
# Token definition files are the legitimate home of raw values
TOKENDEF=(--glob '!src/lib/styles/tokens/**')

SRC=(-g '*.vue' -g '*.ts' -g '*.js' -g '*.css' -g '*.scss' -g '*.sass')

section() { echo ""; echo "=== $1 ==="; }

section "1. HEX COLORS (app code, excl token defs)"
rg -o -i '#[0-9a-f]{3}(?:[0-9a-f]{3})?(?:[0-9a-f]{2})?\b' src "${SRC[@]}" "${EXC[@]}" "${TOKENDEF[@]}" 2>/dev/null | awk -F: '{print $1}' | sort | uniq -c | sort -rn > /tmp/audit_hex.txt
echo "total: $(awk '{s+=$1} END {print s}' /tmp/audit_hex.txt)  files: $(wc -l < /tmp/audit_hex.txt)"
head -25 /tmp/audit_hex.txt

section "2. RGB/RGBA/HSL (app code, excl token defs)"
rg -o -i '\b(rgba?|hsla?)\(' src "${SRC[@]}" "${EXC[@]}" "${TOKENDEF[@]}" 2>/dev/null | awk -F: '{print $1}' | sort | uniq -c | sort -rn > /tmp/audit_rgb.txt
echo "total: $(awk '{s+=$1} END {print s}' /tmp/audit_rgb.txt)  files: $(wc -l < /tmp/audit_rgb.txt)"
head -20 /tmp/audit_rgb.txt

section "3. LEGACY --o2-* USAGE (banned)"
rg -o -- '--o2-[a-z0-9-]+' src "${SRC[@]}" "${EXC[@]}" 2>/dev/null | awk -F: '{print $1}' | sort | uniq -c | sort -rn > /tmp/audit_o2.txt
echo "total: $(awk '{s+=$1} END {print s}' /tmp/audit_o2.txt)  files: $(wc -l < /tmp/audit_o2.txt)"
head -20 /tmp/audit_o2.txt

section "4. PX VALUES excluding 1px (styles: vue/css/scss only)"
rg -o -i '\b([2-9]|[1-9][0-9]+)(\.[0-9]+)?px\b' src -g '*.vue' -g '*.css' -g '*.scss' -g '*.sass' "${EXC[@]}" "${TOKENDEF[@]}" 2>/dev/null | awk -F: '{print $1}' | sort | uniq -c | sort -rn > /tmp/audit_px.txt
echo "total: $(awk '{s+=$1} END {print s}' /tmp/audit_px.txt)  files: $(wc -l < /tmp/audit_px.txt)"
head -25 /tmp/audit_px.txt

section "5. INLINE style= ATTRIBUTES in templates"
rg -c ' style="' src -g '*.vue' "${EXC[@]}" 2>/dev/null | sort -t: -k2 -rn > /tmp/audit_inline.txt
echo "total: $(awk -F: '{s+=$2} END {print s}' /tmp/audit_inline.txt)  files: $(wc -l < /tmp/audit_inline.txt)"
head -20 /tmp/audit_inline.txt

section "6. TAILWIND ARBITRARY VALUES [..px] / [#hex]"
rg -o -i '\-\[(#[0-9a-f]{3,8}|[0-9.]+(px|rem|em|vh|vw|%))\]' src -g '*.vue' "${EXC[@]}" 2>/dev/null | awk -F: '{print $1}' | sort | uniq -c | sort -rn > /tmp/audit_arb.txt
echo "total: $(awk '{s+=$1} END {print s}' /tmp/audit_arb.txt)  files: $(wc -l < /tmp/audit_arb.txt)"
head -20 /tmp/audit_arb.txt

section "7. TYPO UTILITIES (text-weight)"
rg -o '\b(text-weight-[a-z]+)\b' src -g '*.vue' "${EXC[@]}" 2>/dev/null | awk -F: '{print $1}' | sort | uniq -c | sort -rn > /tmp/audit_typo.txt
echo "total: $(awk '{s+=$1} END {print s}' /tmp/audit_typo.txt)  files: $(wc -l < /tmp/audit_typo.txt)"
head -20 /tmp/audit_typo.txt

section "8. PALETTE color= PROPS (color=\"red\" etc.)"
rg -o '\b(color|text-color)="(red|blue|green|orange|purple|teal|pink|amber|grey|gray|cyan|indigo|lime|brown|black|white|primary|secondary|positive|negative|warning|info|accent)(-[0-9]+)?"' src -g '*.vue' "${EXC[@]}" 2>/dev/null | awk -F: '{print $1}' | sort | uniq -c | sort -rn > /tmp/audit_qcolor.txt
echo "total: $(awk '{s+=$1} END {print s}' /tmp/audit_qcolor.txt)  files: $(wc -l < /tmp/audit_qcolor.txt)"
head -20 /tmp/audit_qcolor.txt

section "9. HARDCODED font-family"
rg -o -i 'font-family:\s*[^;"}]+' src "${SRC[@]}" "${EXC[@]}" "${TOKENDEF[@]}" 2>/dev/null | awk -F: '{print $1}' | sort | uniq -c | sort -rn > /tmp/audit_font.txt
echo "total: $(awk '{s+=$1} END {print s}' /tmp/audit_font.txt)  files: $(wc -l < /tmp/audit_font.txt)"
head -15 /tmp/audit_font.txt

section "10. CSS NAMED COLORS in style contexts (white/black as values)"
rg -o -i '(color|background|background-color|border-color|fill|stroke):\s*(white|black|red|green|blue|orange|yellow|gray|grey|transparent)\b' src -g '*.vue' -g '*.css' -g '*.scss' "${EXC[@]}" "${TOKENDEF[@]}" 2>/dev/null | grep -v -i transparent | awk -F: '{print $1}' | sort | uniq -c | sort -rn > /tmp/audit_named.txt
echo "total: $(awk '{s+=$1} END {print s}' /tmp/audit_named.txt)  files: $(wc -l < /tmp/audit_named.txt)"
head -15 /tmp/audit_named.txt

section "11. SCOPED <style> BLOCKS remaining"
rg -c '<style' src -g '*.vue' "${EXC[@]}" 2>/dev/null | wc -l | xargs echo "vue files with <style> blocks:"

section "SUMMARY BY DIRECTORY (hex+rgb+px+o2 combined)"
cat /tmp/audit_hex.txt /tmp/audit_rgb.txt /tmp/audit_px.txt /tmp/audit_o2.txt | awk '{n=$1; $1=""; split($2,p,"/"); print n, p[1]"/"p[2]}' | awk '{a[$2]+=$1} END {for (k in a) print a[k], k}' | sort -rn | head -20
