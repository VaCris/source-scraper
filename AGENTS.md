# Source Scraper — Development Guidelines

## Project Overview

Source Scraper is a Node.js scraping tool for extracting structured metadata and publicly exposed media information from movie, series, and anime pages.

Core strategy:

- HTTP + Cheerio for lightweight extraction.
- Playwright + Chromium only as fallback for JavaScript-rendered pages.
- Site-specific adapters when generic extraction is insufficient.
- Normalized JSON output written to `output/`.

## Architecture

```text
src/
├── index.js
├── parsers/
├── scrapers/
├── services/
│   ├── browser.js
│   └── http.js
└── utils/
```

### Responsibilities

- `src/index.js`: CLI arguments, scraper execution, output writing, final cleanup only.
- `parsers/`: pure HTML/data parsing. No network, browser, filesystem, or CLI state.
- `scrapers/`: orchestration, fallback decisions, traversal, adapter-specific behavior.
- `services/http.js`: all ordinary HTTP access.
- `services/browser.js`: Playwright lifecycle, rendered HTML, browser-observed media URLs.
- `utils/`: genuinely shared infrastructure helpers.

## Scraping Rules

Always prefer the cheapest path:

```text
fetch -> parse -> fallback if needed -> normalize -> output
```

Do not use Playwright when HTTP extraction already provides the required data.

Playwright fallback is appropriate when:

- expected episodes are absent from static HTML;
- dynamic DOM content is required;
- no media source is visible in static markup;
- JavaScript clearly builds the relevant content.

Prefer deterministic waits such as `waitForSelector()` over long arbitrary sleeps.

## Browser Lifecycle

Reuse a single Chromium instance per CLI execution. Do not launch one browser per episode.

Always close pages/contexts after use, and close the shared browser from a `finally` block in the CLI.

Browser concurrency must remain conservative.

## Concurrency

Use the shared concurrency utility for collections. Never use unbounded `Promise.all()` over episode or catalog lists.

A failure on one related page must not terminate the entire scrape. Return a per-item `error` where possible.

## Generic vs Site-Specific Logic

Keep `generic.js` and generic parsers provider-agnostic.

Do not add site-specific selectors to generic code. Create `src/scrapers/<site>.js` and register the adapter in `src/scrapers/index.js`.

Do not duplicate behavior already handled by the generic parser.

## Normalized Values

Media types:

```text
movie
series
anime
unknown
```

Source types:

```text
hls
mp4
webm
iframe
unknown
```

Do not guess a media type without enough evidence. Use `unknown` when ambiguous.

Preserve useful source metadata such as `url`, `type`, `mimeType`, and `origin`.

## URLs and Deduplication

Normalize discovered URLs relative to the page:

```js
new URL(value, pageUrl).toString();
```

Ignore malformed URLs safely.

Deduplicate related pages and sources by normalized absolute URL before visiting or emitting them.

## Error Handling

Use early returns and isolated `try/catch` blocks around individual page operations.

Browser fallback failures should preserve valid HTTP results when possible.

Fatal errors are appropriate only when the initial requested URL cannot be processed at all.

## Output

Keep results JSON-serializable and stable. Site adapters may add fields, but should preserve common naming and avoid unnecessary breaking changes.

Useful common fields include:

```text
scraper
mediaUrl
title
mediaType
description
poster
sources
renderMethod
browserError
items
scrapedAt
```

## Performance

Optimize in this order:

1. Avoid unnecessary requests.
2. Prefer HTTP over Chromium.
3. Deduplicate URLs before visiting.
4. Limit concurrency.
5. Reuse browser instances.
6. Avoid parsing the same page repeatedly.

Do not add databases, workers, queues, or caching layers without a concrete requirement.

## Code Style

- ES modules.
- `const` by default.
- `async/await` for asynchronous code.
- Early returns over nested branches.
- Small functions with one responsibility.
- No emojis in code or CLI output.
- Keep comments concise and useful.
- Keep dependencies minimal.
- Use terse, direct commit messages.

Examples:

```text
feat: add browser fallback
fix: dedupe discovered sources
fix: close browser on failure
docs: update scraper guidelines
```

## Don'ts

- Don't use Playwright for every request.
- Don't put site-specific selectors in generic code.
- Don't duplicate HTTP or browser lifecycle logic.
- Don't launch one Chromium instance per episode.
- Don't use unlimited concurrency.
- Don't silently swallow failures.
- Don't abort a catalog because one child page failed.
- Don't hardcode a movie, series, anime, or episode into generic logic.
- Don't bypass authentication, DRM, CORS, signed URLs, access controls, or equivalent restrictions.
