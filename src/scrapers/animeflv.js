import * as cheerio from "cheerio";
import { fetchHtml } from "../services/http.js";
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

export const scrapeAnime = async (rawUrl, { concurrency = 4 } = {}) => {
  const pageUrl = assertSupportedUrl(rawUrl);
  const animeHtml = await fetchHtml(pageUrl);
  const anime = parseAnimePage({ html: animeHtml, pageUrl });

  let discoveredEpisodes = anime.episodes;
  let discoveryMethod = "anime-page";

  // animeflv.or.at currently renders the episode list dynamically on anime pages,
  // so a plain HTTP request can contain the heading but zero episode anchors.
  // Fall back to the site's server-rendered latest-episode archive.
  if (discoveredEpisodes.length === 0) {
    const siteUrl = new URL("/", pageUrl).toString();
    discoveredEpisodes = await discoverFromEpisodeArchive({
      siteUrl,
      animeTitle: anime.title,
      concurrency,
    });
    discoveryMethod = "episode-archive";
  }

  const episodes = await mapWithConcurrency(discoveredEpisodes, concurrency, async (episode) => {
    try {
      const html = await fetchHtml(episode.pageUrl);
      return {
        ...parseEpisodePage({
          html,
          pageUrl: episode.pageUrl,
          absoluteEpisode: episode.absoluteEpisode,
        }),
        error: null,
      };
    } catch (error) {
      return {
        absoluteEpisode: episode.absoluteEpisode,
        pageUrl: episode.pageUrl,
        sources: [],
        error: error.message,
      };
    }
  });

  return {
    scraper: "animeflv.or.at",
    animeUrl: pageUrl,
    title: anime.title,
    discoveryMethod,
    episodeCount: episodes.length,
    episodes,
    scrapedAt: new Date().toISOString(),
  };
};
