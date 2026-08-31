import * as cheerio from "cheerio";
import { fetchHtml } from "../services/http.js";
import { renderPage } from "../services/browser.js";
import { parseAnimePage } from "../parsers/animePage.js";
import { parseEpisodePage } from "../parsers/episodePage.js";
import { mapWithConcurrency } from "../utils/concurrency.js";

const ALLOWED_HOSTS = new Set(["animeflv.or.at", "www.animeflv.or.at"]);
const EPISODE_PATTERN = /episodio[-_/\s]?(\d{1,5})/i;

const assertSupportedUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Dominio no soportado: ${url.hostname}`);
  }
  return url.toString();
};

const normalizeText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const extractEpisodeNumber = (value) => {
  const match = String(value || "").match(EPISODE_PATTERN);
  return match ? Number(match[1]) : null;
};

const sourceFromObservedUrl = (url) => {
  const value = url.toLowerCase();
  if (!(value.includes(".m3u8") || value.includes("/m3u8/"))) return null;
  return {
    url,
    type: "hls",
    mimeType: null,
    provider: url.includes("zilla-networks.com") ? "zilla" : null,
    origin: "browser-network",
  };
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

const parseArchiveEpisodes = ({ html, pageUrl, animeTitle }) => {
  const $ = cheerio.load(html);
  const normalizedTitle = normalizeText(animeTitle);
  const episodes = new Map();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    const text = $(element).text().replace(/\s+/g, " ").trim();
    const combined = `${text} ${href}`;
    const episode = extractEpisodeNumber(combined);
    if (!episode) return;

    const normalizedCombined = normalizeText(combined);
    if (normalizedTitle && !normalizedCombined.includes(normalizedTitle)) return;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(href, pageUrl).toString();
    } catch {
      return;
    }

    episodes.set(episode, {
      absoluteEpisode: episode,
      pageUrl: absoluteUrl,
    });
  });

  return [...episodes.values()];
};

const getArchivePageCount = (html) => {
  const $ = cheerio.load(html);
  let maxPage = 1;

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    try {
      const url = new URL(href, "https://animeflv.or.at/");
      const page = Number(url.searchParams.get("episodes_page"));
      if (Number.isInteger(page) && page > maxPage) maxPage = page;
    } catch {
      // Ignore malformed links.
    }
  });

  return maxPage;
};

const discoverFromEpisodeArchive = async ({ siteUrl, animeTitle, concurrency }) => {
  const firstPageHtml = await fetchHtml(siteUrl);
  const pageCount = getArchivePageCount(firstPageHtml);
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);

  const pageResults = await mapWithConcurrency(pages, Math.min(concurrency, 3), async (page) => {
    const pageUrl = new URL(siteUrl);
    if (page > 1) pageUrl.searchParams.set("episodes_page", String(page));

    const html = page === 1 ? firstPageHtml : await fetchHtml(pageUrl.toString());
    return parseArchiveEpisodes({
      html,
      pageUrl: pageUrl.toString(),
      animeTitle,
    });
  });

  const deduped = new Map();
  for (const pageEpisodes of pageResults) {
    for (const episode of pageEpisodes) {
      deduped.set(episode.absoluteEpisode, episode);
    }
  }

  return [...deduped.values()].sort((a, b) => a.absoluteEpisode - b.absoluteEpisode);
};

const inspectEpisode = async (episode) => {
  try {
    const html = await fetchHtml(episode.pageUrl);
    let parsed = parseEpisodePage({
      html,
      pageUrl: episode.pageUrl,
      absoluteEpisode: episode.absoluteEpisode,
    });
    let renderMethod = "http";
    let browserError = null;

    if (parsed.sources.length === 0) {
      try {
        const rendered = await renderPage(episode.pageUrl);
        const browserParsed = parseEpisodePage({
          html: rendered.html,
          pageUrl: rendered.finalUrl || episode.pageUrl,
          absoluteEpisode: episode.absoluteEpisode,
        });
        const networkSources = rendered.observedMediaUrls
          .map(sourceFromObservedUrl)
          .filter(Boolean);
        parsed.sources = mergeSources(parsed.sources, browserParsed.sources, networkSources);
        renderMethod = "playwright";
      } catch (error) {
        browserError = error.message;
      }
    }

    return {
      ...parsed,
      renderMethod,
      browserError,
      error: null,
    };
  } catch (error) {
    return {
      absoluteEpisode: episode.absoluteEpisode,
      pageUrl: episode.pageUrl,
      sources: [],
      renderMethod: "http",
      browserError: null,
      error: error.message,
    };
  }
};

export const scrapeAnime = async (rawUrl, { concurrency = 4 } = {}) => {
  const pageUrl = assertSupportedUrl(rawUrl);
  const animeHtml = await fetchHtml(pageUrl);
  let anime = parseAnimePage({ html: animeHtml, pageUrl });

  let discoveredEpisodes = anime.episodes;
  let discoveryMethod = "anime-page";
  let renderMethod = "http";
  let browserError = null;

  if (discoveredEpisodes.length === 0) {
    try {
      const rendered = await renderPage(pageUrl, { settleMs: 2500 });
      const browserAnime = parseAnimePage({
        html: rendered.html,
        pageUrl: rendered.finalUrl || pageUrl,
      });

      if (browserAnime.episodes.length > 0) {
        anime = {
          title: browserAnime.title || anime.title,
          episodes: browserAnime.episodes,
        };
        discoveredEpisodes = browserAnime.episodes;
        discoveryMethod = "anime-page-browser";
        renderMethod = "playwright";
      }
    } catch (error) {
      browserError = error.message;
    }
  }

  if (discoveredEpisodes.length === 0) {
    const siteUrl = new URL("/", pageUrl).toString();
    discoveredEpisodes = await discoverFromEpisodeArchive({
      siteUrl,
      animeTitle: anime.title,
      concurrency,
    });
    discoveryMethod = "episode-archive";
  }

  const episodes = await mapWithConcurrency(discoveredEpisodes, Math.min(concurrency, 3), inspectEpisode);

  return {
    scraper: "animeflv.or.at",
    animeUrl: pageUrl,
    title: anime.title,
    mediaType: "anime",
    discoveryMethod,
    renderMethod,
    browserError,
    episodeCount: episodes.length,
    episodes,
    scrapedAt: new Date().toISOString(),
  };
};
