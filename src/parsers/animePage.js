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

const addEpisode = (links, rawUrl, pageUrl, label = "") => {
  let absoluteUrl;
  try {
    absoluteUrl = new URL(String(rawUrl).replace(/\\\//g, "/"), pageUrl).toString();
  } catch {
    return;
  }

  const episode = getEpisodeNumber(`${absoluteUrl} ${label}`);
  if (!episode) return;

  if (!links.has(episode)) {
    links.set(episode, {
      absoluteEpisode: episode,
      pageUrl: absoluteUrl,
    });
  }
};

export const parseAnimePage = ({ html, pageUrl }) => {
  const $ = cheerio.load(html);
  const links = new Map();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    addEpisode(links, href, pageUrl, $(element).text().trim());
  });

  // Dynamic episode lists are sometimes serialized into scripts/data attributes
  // even when the anchors have not been rendered yet.
  const normalizedHtml = String(html)
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

  const episodeUrlPattern = /https?:\/\/[^\s"'<>]*?(?:episodio|episode|capitulo|cap)[-_\/\s]?\d{1,5}[^\s"'<>]*/gi;
  for (const match of normalizedHtml.matchAll(episodeUrlPattern)) {
    addEpisode(links, match[0].replace(/[),;]+$/, ""), pageUrl);
  }

  const relativeEpisodePattern = /["'](\/[^"']*?(?:episodio|episode|capitulo|cap)[-_\/\s]?\d{1,5}\/?)['"]/gi;
  for (const match of normalizedHtml.matchAll(relativeEpisodePattern)) {
    addEpisode(links, match[1], pageUrl);
  }

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
