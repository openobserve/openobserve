# Bundled fonts

Both families are vendored rather than loaded from a CDN, and both are compiled
into the OpenObserve binary along with the rest of `web/dist`.

| File                       | Family     | Version | Upstream                             |
| -------------------------- | ---------- | ------- | ------------------------------------ |
| `Geist-Variable.woff2`     | Geist      | 1.800   | https://github.com/vercel/geist-font |
| `GeistMono-Variable.woff2` | Geist Mono | 1.700   | https://github.com/vercel/geist-font |

## License

SIL Open Font License 1.1 — full text in [`OFL.txt`](./OFL.txt), copied verbatim
from upstream. Redistributing the fonts (which every release does) requires that
copyright notice and license to travel with them, so `OFL.txt` must stay next to
the `.woff2` files.

Vite only emits assets that something imports, so `vite.config.ts` copies
`OFL.txt` to `dist/fonts/OFL.txt` via the `font-license` plugin — that is what
puts it inside the binary alongside the fonts.

Geist declares **no Reserved Font Name**, so a renamed derivative would be
permitted — we ship the fonts unmodified.

## Re-vendoring

Copy the two variable `.woff2` files from an upstream release and refresh
`OFL.txt` and the versions above:

```
packages/next/dist/fonts/geist-sans/Geist-Variable.woff2
packages/next/dist/fonts/geist-mono/GeistMono-Variable.woff2
```

The `@font-face` rules that consume them live in
`web/src/lib/styles/tokens/base.css`.
