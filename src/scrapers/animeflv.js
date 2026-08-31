import { fetchHtml } from "../services/http.js";
import { parseAnimePage } from "../parsers/animePage.js";
import { parseEpisodePage } from "../parsers/episodePage.js";
import { mapWithConcurrency } from "../utils/concurrency.js";

const ALLOWED_HOSTS = new Set(["animeflv.or.at", "www.animeflv.or.at"]);

const assertSupportedUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Dominio no soportado: ${url.hostname}`);
  }
  return url.toString();
};

export const scrapeAnime = async (rawUrl, { concurrency = 4 } = {}) => {
  const pageUrl = assertSupportedUrl(rawUrl);
  const animeHtml = await fetchHtml(pageUrl);
  const anime = parseAnimePage({ html: animeHtml, pageUrl });

  const episodes = await mapWithConcurrency(anime.episodes, concurrency, async (episode) => {
    try {
      const html = await fetchHtml(episode.pageUrl);
      return {
        ...(await parseEpisodePage({
          html,
          pageUrl: episode.pageUrl,
          absoluteEpisode: episode.absoluteEpisode,
        })),
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
    episodeCount: episodes.length,
    episodes,
    scrapedAt: new Date().toISOString(),
  };
};
