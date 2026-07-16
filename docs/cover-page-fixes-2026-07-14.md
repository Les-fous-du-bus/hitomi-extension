# Extension cover/page fixes — 2026-07-14 (@khun)

Handoff for the next session working in this repo. Shipped as commit `3754827`
(covers/pages repair across 9 sources), extensions live on `main`.

## Two root-cause classes

1. **Referer-gated cover CDN.** Parse is correct but the CDN returns 403 without
   the source's `Referer` (reproduced live 403→200 via `curl -H "Referer: <base>/"`).
   The extension emits `headers:{Referer:BASE_URL+"/"}` per list item + on detail;
   the **app** (v2.0.13-alpha.16+) forwards it to the image loader via the new
   `MangaItem.headers` / `MangaDetail.headers` channel. The extension change is a
   no-op on an app older than alpha.16 (the field is ignored) — backward-compatible.
2. **Per-source parse bug.** Fixed in the source's `.js`.

## Per source

| Source | Class | What changed | Notes |
|---|---|---|---|
| toonily | parse | `_parseListPage` → per-card block split (was a document-global first-match → same cover for every card) | CF-walled to Node; fix emulated 24/24 on captured DOM. Device-verify. |
| mangatown | Referer | emit Referer on list+search items + schemeless→https | fmcdn, same family as mangahere |
| mangapill | Referer | emit Referer on items+detail; `imgPattern` accepts `src` too (path-anchored) | cdn.readdetectiveconan |
| mangahere | Referer | emit Referer on `_parseTileList` items + getMangaDetail | fmcdn; cover URLs are time-signed (ttl ~1d) |
| mangabuddy | Referer + heal | Referer on catalog/detail/chapter items; `fetchNextData` self-heals a stale Next.js buildId (404 `{}` → refetch) | mangak.io. rx.qvzrc page CDN Referer EXTRAPOLATED — device-verify reader |
| webtoons | Referer + parse | Referer (origin-validated CDN); `_parseMangaListFromPage` rewritten per-card for the mobile m.webtoons layout | pstatic |
| sushi_scan | parse | `BASE_URL` `.net`→`.fr` (`.net` is Cloudflare-walled → blank catalogue); `_parseMangaReaderList` split on `.bsx` + `_extractImg`/`_absUrl` fallback | hasCloudflare kept true as safety net |
| manhwaz | parse | `parseCatalogPage` attribute-agnostic, anchored on `/storage/images/cover/` (was data-src-only → empty search) + Referer insurance | search 0→20 live; getPageList untouched (44/44) |
| mangakatana | parse | `parseChapterImages` follows the render-loop var (`ytaw`→`thzq`; `ytaw` is now a 1-element anti-scrape decoy) + var-agnostic tokenized-CDN fallback | pages 1→N. List-cover parse left as-is (see open) |

## Verify (live runtime)

```
node tools/cover-check.js src/manga/<source>.js   # cover stats: count/nonEmpty/distinct/withReferer + verdict
node tools/ext-test.js   src/manga/<source>.js     # end-to-end: list/search/detail/chapters/pages verdict
```
Plain Node fetch does NOT solve Cloudflare → CF sources (toonily, mangapark1, sometimes
mangabuddy/mangakatana) may show LIST-FAIL/RED here yet work in-app via the WebView CF path.
Read the source's `cloudflare` flag in `index.json` before concluding.

## Index integrity

`index.json` `version` (int) + `sha256` per entry. After editing any `.js`:
`bash scripts/resync-hashes.sh` (rewrites sha256). It serializes at **indent=2**; the
committed file is **indent=4** — reserialize `JSON.stringify(j,null,4)+"\n"` to keep the
diff minimal, then `--check` to confirm no drift (a drift = 100% of users blocked on install).
Bump the `version` int by hand for each changed source.

## Open

- **mangapark1**: NOT fixed. Initial diagnosis (WebView post-JS DOM strips data-src) was
  REFUTED — `fetchv2` returns raw HTML. Real cause unresolved (CF hard-block? holdingyouclose.xyz
  Referer/token gate at image load?). The proposed getPageList rewrite REGRESSED (whole-page img
  scan pulls carousel thumbs). Device-diagnose before touching.
- **mangakatana list covers**: ~7/80 tiles blank/dup (index-paired). A per-card block rewrite was
  tried but dropped 80→55 series (coverage downgrade) → reverted. Needs a fix that keeps all series.
- **toonily / mangabuddy pages**: device-verify (CF / extrapolated Referer).
