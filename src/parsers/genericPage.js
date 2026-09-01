import * as cheerio from "cheerio";

const VIDEO_EXTENSIONS = [".m3u8", ".mp4", ".webm", ".mkv"];

const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();

const absoluteUrl = (value, pageUrl) => {
  if (!value) return null;

  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return null;
  }
};

const detectSourceType = (url, mimeType = "") => {
  const value = `${url} ${mimeType}`.toLowerCase();

  if (value.includes("m3u8") || value.includes("mpegurl")) return "hls";
  if (value.includes(".mp4") || value.includes("video/mp4")) return "mp4";
  if (value.includes(".webm") || value.includes("video/webm")) return "webm";
  if (value.includes(".mkv") || value.includes("matroska")) return "mkv";

  return "unknown";
};

const parseJsonLd = ($) => {
  const values = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).text().trim();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  });

  return values;
};

const flattenJsonLd = (items) => {
  const result = [];

  const visit = (value) => {
    if (!value || typeof value !== "object") return;

    result.push(value);
    if (Array.isArray(value["@graph"])) value["@graph"].forEach(visit);
  };

  items.forEach(visit);
  return result;
};

const detectMediaType = (jsonLd, $) => {
  const types = jsonLd
    .flatMap((item) => (Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]]))
    .filter(Boolean)
    .map((type) => String(type).toLowerCase());

  if (types.some((type) => ["tvseries", "tvseason", "tvepisode", "series"].includes(type))) {
    return "series";
  }

  if (types.some((type) => ["movie", "film"].includes(type))) return "movie";

  const bodyText = normalize($("body").text()).toLowerCase();
  if (/\btemporada\b|\bseason\b|\bepisodio\b|\bepisode\b/.test(bodyText)) return "series";

  return "unknown";
};

const collectSources = ($, pageUrl, rawHtml) => {
  const sources = new Map();

  const add = (value, mimeType = null, origin = "dom") => {
    const url = absoluteUrl(value, pageUrl);
    if (!url) return;

    const type = detectSourceType(url, mimeType || "");
    if (type === "unknown" && !VIDEO_EXTENSIONS.some((ext) => url.toLowerCase().includes(ext))) return;

    sources.set(url, { url, type, mimeType, origin });
  };

  $("video[src], audio[src], source[src]").each((_, element) => {
    add($(element).attr("src"), $(element).attr("type") || null, "media-tag");
  });

  $("iframe[src]").each((_, element) => {
    const url = absoluteUrl($(element).attr("src"), pageUrl);
    if (!url) return;

    sources.set(url, { url, type: "iframe", mimeType: null, origin: "iframe" });
  });

  const normalizedHtml = String(rawHtml || "").replace(/\\\//g, "/");
  const urlPattern = /https?:\/\/[^\s"'<>]+/gi;

  for (const match of normalizedHtml.matchAll(urlPattern)) {
    const cleaned = match[0].replace(/&amp;/g, "&");
    add(cleaned, null, "markup");
  }

  return [...sources.values()];
};

const collectRelatedPages = ($, pageUrl) => {
  const links = new Map();
  const patterns = [
    /episodio[-_\s/]?(\d{1,5})/i,
    /episode[-_\s/]?(\d{1,5})/i,
    /cap[ií]tulo[-_\s/]?(\d{1,5})/i,
    /season[-_\s/]?(\d{1,3}).*episode[-_\s/]?(\d{1,5})/i,
    /s(\d{1,3})e(\d{1,5})/i,
  ];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const url = absoluteUrl(href, pageUrl);
    if (!url) return;

    const text = normalize($(element).text());
    const dataEpisode = Number($(element).attr("data-ep") || $(element).attr("data-episode"));
    const value = `${url} ${text}`;
    let season = null;
    let episode = Number.isInteger(dataEpisode) && dataEpisode > 0 ? dataEpisode : null;

    if (!episode) {
      try {
        const parsedUrl = new URL(url);
        const queryEpisode = Number(
          parsedUrl.searchParams.get("ep") ||
          parsedUrl.searchParams.get("episode") ||
          parsedUrl.searchParams.get("episodio"),
        );
        if (Number.isInteger(queryEpisode) && queryEpisode > 0) episode = queryEpisode;
      } catch {
        // URL was already normalized above; keep regex fallback for safety.
      }
    }

    if (!episode) {
      for (const pattern of patterns) {
        const match = value.match(pattern);
        if (!match) continue;

        if (match.length >= 3) {
          season = Number(match[1]);
          episode = Number(match[2]);
          break;
        }

        episode = Number(match[1]);
        break;
      }
    }

    if (!episode) return;

    links.set(url, {
      pageUrl: url,
      season,
      episode,
      label: text || `Episodio ${episode}`,
    });
  });

  return [...links.values()];
};

export const parseGenericPage = ({ html, pageUrl }) => {
  const $ = cheerio.load(html);
  const jsonLd = flattenJsonLd(parseJsonLd($));
  const primary = jsonLd.find((item) => item?.name || item?.headline) || null;

  const title =
    normalize(primary?.name || primary?.headline) ||
    normalize($('meta[property="og:title"]').attr("content")) ||
    normalize($("h1").first().text()) ||
    normalize($("title").text()) ||
    null;

  const description =
    normalize(primary?.description) ||
    normalize($('meta[name="description"]').attr("content")) ||
    normalize($('meta[property="og:description"]').attr("content")) ||
    null;

  const poster = absoluteUrl(
    primary?.image?.url ||
      primary?.image ||
      $('meta[property="og:image"]').attr("content") ||
      $(".banner-poster").attr("src") ||
      $(".poster img").attr("src"),
    pageUrl,
  );

  return {
    pageUrl,
    title,
    description,
    poster,
    mediaType: detectMediaType(jsonLd, $),
    sources: collectSources($, pageUrl, html),
    relatedPages: collectRelatedPages($, pageUrl),
    jsonLdTypes: [
      ...new Set(
        jsonLd
          .flatMap((item) => (Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]]))
          .filter(Boolean),
      ),
    ],
  };
};
