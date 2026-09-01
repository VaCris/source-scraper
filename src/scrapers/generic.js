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

const emptyParsedPage = (pageUrl) => ({
  pageUrl,
  title: null,
  description: null,
  poster: null,
  mediaType: "unknown",
  sources: [],
  relatedPages: [],
  jsonLdTypes: [],
});

const parseWithBrowserFallback = async ({ html = "", pageUrl, forceBrowser = false, httpError = null }) => {
  let parsed = html
    ? parseGenericPage({ html, pageUrl })
    : emptyParsedPage(pageUrl);
  let renderMethod = html ? "http" : "none";

  const incomplete =
    parsed.sources.length === 0 ||
    (parsed.mediaType === "series" && parsed.relatedPages.length === 0);

  if (forceBrowser || incomplete || !html) {
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
        pageUrl: browserParsed.pageUrl || parsed.pageUrl,
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
      if (!html && httpError) {
        parsed.httpError = httpError.message;
      }
    }
  }

  return { parsed, renderMethod };
};

const fetchWithBrowserFallback = async (pageUrl) => {
  try {
    const html = await fetchHtml(pageUrl);
    return parseWithBrowserFallback({ html, pageUrl });
  } catch (httpError) {
    return parseWithBrowserFallback({
      html: "",
      pageUrl,
      forceBrowser: true,
      httpError,
    });
  }
};

export const scrapeGeneric = async (rawUrl, { concurrency = 4, followRelated = true } = {}) => {
  const pageUrl = new URL(rawUrl).toString();
  const { parsed: root, renderMethod } = await fetchWithBrowserFallback(pageUrl);

  if (!root.title && root.sources.length === 0 && root.relatedPages.length === 0 && root.browserError) {
    const details = [root.httpError, root.browserError].filter(Boolean).join(" | ");
    throw new Error(details || `No se pudo consultar ${pageUrl}`);
  }

  let items = [];
  if (followRelated && root.relatedPages.length > 0) {
    const candidates = root.relatedPages.slice(0, MAX_RELATED_PAGES);
    items = await mapWithConcurrency(candidates, concurrency, async (entry) => {
      try {
        const { parsed, renderMethod: childRenderMethod } = await fetchWithBrowserFallback(entry.pageUrl);
        return {
          season: entry.season,
          episode: entry.episode,
          label: entry.label,
          pageUrl: entry.pageUrl,
          title: parsed.title,
          sources: parsed.sources,
          renderMethod: childRenderMethod,
          browserError: parsed.browserError || null,
          error: parsed.browserError && !parsed.title && parsed.sources.length === 0
            ? [parsed.httpError, parsed.browserError].filter(Boolean).join(" | ")
            : null,
        };
      } catch (error) {
        return {
          season: entry.season,
          episode: entry.episode,
          label: entry.label,
          pageUrl: entry.pageUrl,
          title: null,
          sources: [],
          renderMethod: "none",
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
    httpError: root.httpError || null,
    browserError: root.browserError || null,
    itemCount: items.length,
    items,
    scrapedAt: new Date().toISOString(),
  };
};
