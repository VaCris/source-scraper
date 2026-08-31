import { fetchHtml } from "../services/http.js";
import { renderPage } from "../services/browser.js";
import { parseGenericPage } from "../parsers/genericPage.js";
import { mapWithConcurrency } from "../utils/concurrency.js";

const MAX_RELATED_PAGES = 250;

const sourceFromObservedUrl = (url) => {
  const value = url.toLowerCase();
  let type = "unknown";
  if (value.includes(".m3u8") || value.includes("/m3u8/")) type = "hls";
  else if (value.includes(".mp4")) type = "mp4";
  else if (value.includes(".webm")) type = "webm";
  if (type === "unknown") return null;
  return { url, type, mimeType: null, origin: "browser-network" };
};

const mergeSources = (...groups) => {
  const map = new Map();
  for (const group of groups) {
    for (const source of group || []) {
      if (source?.url) map.set(source.url, source);
    }
  }
  return [...map.values()];
};

const parseWithBrowserFallback = async ({ html, pageUrl, forceBrowser = false }) => {
  let parsed = parseGenericPage({ html, pageUrl });
  let renderMethod = "http";

  const incomplete =
    parsed.sources.length === 0 ||
    (parsed.mediaType === "series" && parsed.relatedPages.length === 0);

  if (forceBrowser || incomplete) {
    try {
      const rendered = await renderPage(pageUrl);
      const browserParsed = parseGenericPage({
        html: rendered.html,
        pageUrl: rendered.finalUrl || pageUrl,
      });
      const networkSources = rendered.observedMediaUrls
        .map(sourceFromObservedUrl)
        .filter(Boolean);

      parsed = {
        ...parsed,
        title: browserParsed.title || parsed.title,
        description: browserParsed.description || parsed.description,
        poster: browserParsed.poster || parsed.poster,
        mediaType:
          browserParsed.mediaType !== "unknown"
            ? browserParsed.mediaType
            : parsed.mediaType,
        jsonLdTypes: [...new Set([...parsed.jsonLdTypes, ...browserParsed.jsonLdTypes])],
        sources: mergeSources(parsed.sources, browserParsed.sources, networkSources),
        relatedPages:
          browserParsed.relatedPages.length > parsed.relatedPages.length
            ? browserParsed.relatedPages
            : parsed.relatedPages,
      };
      renderMethod = "playwright";
    } catch (error) {
      parsed.browserError = error.message;
    }
  }

  return { parsed, renderMethod };
};

export const scrapeGeneric = async (rawUrl, { concurrency = 4, followRelated = true } = {}) => {
  const pageUrl = new URL(rawUrl).toString();
  const html = await fetchHtml(pageUrl);
  const { parsed: root, renderMethod } = await parseWithBrowserFallback({ html, pageUrl });

  let items = [];
  if (followRelated && root.relatedPages.length > 0) {
    const candidates = root.relatedPages.slice(0, MAX_RELATED_PAGES);
    items = await mapWithConcurrency(candidates, concurrency, async (entry) => {
      try {
        const childHtml = await fetchHtml(entry.pageUrl);
        const { parsed, renderMethod: childRenderMethod } = await parseWithBrowserFallback({
          html: childHtml,
          pageUrl: entry.pageUrl,
        });
        return {
          season: entry.season,
          episode: entry.episode,
          label: entry.label,
          pageUrl: entry.pageUrl,
          title: parsed.title,
          sources: parsed.sources,
          renderMethod: childRenderMethod,
          browserError: parsed.browserError || null,
          error: null,
        };
      } catch (error) {
        return {
          season: entry.season,
          episode: entry.episode,
          label: entry.label,
          pageUrl: entry.pageUrl,
          title: null,
          sources: [],
          renderMethod: "http",
          browserError: null,
          error: error.message,
        };
      }
    });
  }

  return {
    scraper: "generic",
    mediaUrl: pageUrl,
    title: root.title,
    description: root.description,
    poster: root.poster,
    mediaType: root.mediaType,
    jsonLdTypes: root.jsonLdTypes,
    sources: root.sources,
    renderMethod,
    browserError: root.browserError || null,
    itemCount: items.length,
    items,
    scrapedAt: new Date().toISOString(),
  };
};
