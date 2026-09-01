import { fetchHtml } from "../services/http.js";
import { renderPage } from "../services/browser.js";
import { parseGenericPage } from "../parsers/genericPage.js";
import { mapWithConcurrency } from "../utils/concurrency.js";

const MAX_RELATED_PAGES = 250;
const MAX_JSON_NODES = 5000;

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

const mergeRelatedPages = (...groups) => {
  const map = new Map();
  for (const group of groups) {
    for (const entry of group || []) {
      if (entry?.pageUrl) map.set(entry.pageUrl, entry);
    }
  }
  return [...map.values()];
};

const absoluteHttpUrl = (value, pageUrl) => {
  if (!value) return null;

  try {
    const url = new URL(String(value), pageUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

const extractUrlFromCandidate = (attrs, pageUrl) => {
  const directAttributes = [
    "href",
    "data-href",
    "data-url",
    "data-link",
    "data-src",
    "data-episode-url",
  ];

  for (const name of directAttributes) {
    const url = absoluteHttpUrl(attrs?.[name], pageUrl);
    if (url) return url;
  }

  const onclick = attrs?.onclick;
  if (!onclick) return null;

  const quotedUrl = onclick.match(/["']([^"']+(?:\.php|\/ver\/|\/watch\/|\/episode\/|\/episodio\/)[^"']*)["']/i);
  return quotedUrl ? absoluteHttpUrl(quotedUrl[1], pageUrl) : null;
};

const parseEpisodeIdentity = (value) => {
  const text = String(value || "");
  const patterns = [
    /temporada\s*(\d{1,3}).*?(?:episodio|cap[ií]tulo|episode)\s*(\d{1,5})/i,
    /season\s*(\d{1,3}).*?episode\s*(\d{1,5})/i,
    /s(\d{1,3})e(\d{1,5})/i,
    /(?:episodio|cap[ií]tulo|episode)\s*#?[-_:]?\s*(\d{1,5})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    if (match.length >= 3) {
      return { season: Number(match[1]), episode: Number(match[2]) };
    }

    return { season: null, episode: Number(match[1]) };
  }

  return { season: null, episode: null };
};

const dynamicRelatedPages = (candidates, pageUrl) => {
  const pages = new Map();

  for (const candidate of candidates || []) {
    const attrs = candidate?.attrs || {};
    const haystack = [candidate?.text, ...Object.values(attrs)].filter(Boolean).join(" ");
    let { season, episode } = parseEpisodeIdentity(haystack);

    if (!episode && /^\d{1,5}$/.test(String(attrs["data-episode"] || ""))) {
      episode = Number(attrs["data-episode"]);
    }

    if (!episode) continue;

    const url = extractUrlFromCandidate(attrs, pageUrl);
    if (!url || url === pageUrl) continue;

    pages.set(url, {
      pageUrl: url,
      season,
      episode,
      label: candidate?.text || `Episodio ${episode}`,
    });
  }

  return [...pages.values()];
};

const jsonRelatedPages = (responses, pageUrl) => {
  const pages = new Map();
  let visited = 0;

  const urlKeys = new Set([
    "url",
    "href",
    "link",
    "src",
    "path",
    "permalink",
    "episode_url",
    "episodeUrl",
    "watch_url",
    "watchUrl",
  ]);

  const episodeKeys = ["episode", "episode_number", "episodeNumber", "ep", "capitulo", "episodio"];
  const seasonKeys = ["season", "season_number", "seasonNumber", "temporada"];
  const labelKeys = ["title", "name", "label", "episode_title", "episodeTitle"];

  const visit = (value, contextUrl) => {
    if (visited >= MAX_JSON_NODES || value == null) return;
    visited += 1;

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, contextUrl));
      return;
    }

    if (typeof value !== "object") return;

    const entries = Object.entries(value);
    const text = entries
      .filter(([, candidate]) => ["string", "number"].includes(typeof candidate))
      .map(([key, candidate]) => `${key}:${candidate}`)
      .join(" ");

    let { season, episode } = parseEpisodeIdentity(text);

    if (!episode) {
      for (const key of episodeKeys) {
        const candidate = Number(value[key]);
        if (Number.isInteger(candidate) && candidate > 0 && candidate <= 100000) {
          episode = candidate;
          break;
        }
      }
    }

    if (!season) {
      for (const key of seasonKeys) {
        const candidate = Number(value[key]);
        if (Number.isInteger(candidate) && candidate > 0 && candidate <= 1000) {
          season = candidate;
          break;
        }
      }
    }

    let candidateUrl = null;
    for (const [key, candidate] of entries) {
      if (!urlKeys.has(key) || typeof candidate !== "string") continue;
      candidateUrl = absoluteHttpUrl(candidate, contextUrl || pageUrl);
      if (candidateUrl) break;
    }

    if (!candidateUrl) {
      for (const [, candidate] of entries) {
        if (typeof candidate !== "string") continue;
        if (!/(?:\/ver\/|\/watch\/|\/episode\/|\/episodio\/|\.php\?)/i.test(candidate)) continue;
        candidateUrl = absoluteHttpUrl(candidate, contextUrl || pageUrl);
        if (candidateUrl) break;
      }
    }

    if (episode && candidateUrl && candidateUrl !== pageUrl) {
      const label = labelKeys
        .map((key) => value[key])
        .find((candidate) => typeof candidate === "string" && candidate.trim());

      pages.set(candidateUrl, {
        pageUrl: candidateUrl,
        season,
        episode,
        label: label?.trim() || `Episodio ${episode}`,
      });
    }

    for (const [, child] of entries) {
      if (child && typeof child === "object") visit(child, contextUrl);
    }
  };

  for (const response of responses || []) {
    visit(response?.data, response?.url || pageUrl);
  }

  return [...pages.values()];
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
      const renderedPageUrl = rendered.finalUrl || pageUrl;
      const browserParsed = parseGenericPage({
        html: rendered.html,
        pageUrl: renderedPageUrl,
      });
      const networkSources = rendered.observedMediaUrls
        .map(sourceFromObservedUrl)
        .filter(Boolean);
      const browserRelatedPages = dynamicRelatedPages(
        rendered.navigationCandidates,
        renderedPageUrl,
      );
      const responseRelatedPages = jsonRelatedPages(
        rendered.jsonResponses,
        renderedPageUrl,
      );

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
        relatedPages: mergeRelatedPages(
          parsed.relatedPages,
          browserParsed.relatedPages,
          browserRelatedPages,
          responseRelatedPages,
        ),
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
