import * as cheerio from "cheerio";

const isHls = ({ src, type }) => {
  const normalizedType = String(type || "").toLowerCase();
  const normalizedSrc = String(src || "").toLowerCase();

  return (
    normalizedType.includes("mpegurl") ||
    normalizedType.includes("m3u8") ||
    normalizedSrc.includes("/m3u8/") ||
    normalizedSrc.endsWith(".m3u8")
  );
};

const toSource = (url, mimeType = null) => ({
  url,
  type: "hls",
  mimeType,
  provider: url.includes("zilla-networks.com") ? "zilla" : null,
});

const normalizeEmbeddedUrl = (value) =>
  String(value || "")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

export const parseEpisodePage = ({ html, pageUrl, absoluteEpisode }) => {
  const $ = cheerio.load(html);
  const sources = [];

  $("video source[src], source[src], video[src]").each((_, element) => {
    const src = $(element).attr("src");
    const type = $(element).attr("type") || "";
    if (!src) return;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(normalizeEmbeddedUrl(src), pageUrl).toString();
    } catch {
      return;
    }

    if (isHls({ src: absoluteUrl, type })) {
      sources.push(toSource(absoluteUrl, type || null));
    }
  });

  // Some pages keep player URLs in data attributes or inline scripts instead
  // of rendering a <source> element in the initial HTML response.
  const normalizedHtml = normalizeEmbeddedUrl(html);
  const urlPattern = /https?:\/\/[^\s"'<>]+/gi;

  for (const match of normalizedHtml.matchAll(urlPattern)) {
    const candidate = match[0].replace(/[),;]+$/, "");
    if (!isHls({ src: candidate, type: "" })) continue;

    try {
      sources.push(toSource(new URL(candidate).toString()));
    } catch {
      // Ignore malformed embedded URLs.
    }
  }

  const deduped = [...new Map(sources.map((source) => [source.url, source])).values()];

  return {
    absoluteEpisode,
    pageUrl,
    sources: deduped,
  };
};
