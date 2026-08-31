import { fetchHtml } from "../services/http.js";
import { parseGenericPage } from "../parsers/genericPage.js";
import { mapWithConcurrency } from "../utils/concurrency.js";

const MAX_RELATED_PAGES = 250;

export const scrapeGeneric = async (rawUrl, { concurrency = 4, followRelated = true } = {}) => {
  const pageUrl = new URL(rawUrl).toString();
  const html = await fetchHtml(pageUrl);
  const root = parseGenericPage({ html, pageUrl });

  let items = [];
  if (followRelated && root.relatedPages.length > 0) {
    const candidates = root.relatedPages.slice(0, MAX_RELATED_PAGES);
    items = await mapWithConcurrency(candidates, concurrency, async (entry) => {
      try {
        const childHtml = await fetchHtml(entry.pageUrl);
        const parsed = parseGenericPage({ html: childHtml, pageUrl: entry.pageUrl });
        return {
          season: entry.season,
          episode: entry.episode,
          label: entry.label,
          pageUrl: entry.pageUrl,
          title: parsed.title,
          sources: parsed.sources,
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
    itemCount: items.length,
    items,
    scrapedAt: new Date().toISOString(),
  };
};
