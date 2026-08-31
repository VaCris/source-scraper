import * as cheerio from "cheerio";

const EPISODE_PATTERNS = [
  /episodio[-_/\s]?(\d{1,5})/i,
  /episode[-_/\s]?(\d{1,5})/i,
  /capitulo[-_/\s]?(\d{1,5})/i,
  /cap[-_/\s]?(\d{1,5})/i,
];

const getEpisodeNumber = (value) => {
  for (const pattern of EPISODE_PATTERNS) {
    const match = String(value || "").match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
};

export const parseAnimePage = ({ html, pageUrl }) => {
  const $ = cheerio.load(html);
  const links = new Map();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(href, pageUrl).toString();
    } catch {
      return;
    }

    const text = $(element).text().trim();
    const episode = getEpisodeNumber(`${absoluteUrl} ${text}`);
    if (!episode) return;

    if (!links.has(episode)) {
      links.set(episode, {
        absoluteEpisode: episode,
        pageUrl: absoluteUrl,
      });
    }
  });

  const title =
    $("h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").text().trim() ||
    null;

  return {
    title,
    episodes: [...links.values()].sort((a, b) => a.absoluteEpisode - b.absoluteEpisode),
  };
};
