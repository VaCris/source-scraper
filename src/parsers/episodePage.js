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

export const parseEpisodePage = ({ html, pageUrl, absoluteEpisode }) => {
  const $ = cheerio.load(html);
  const sources = [];

  $("video source[src], source[src]").each((_, element) => {
    const src = $(element).attr("src");
    const type = $(element).attr("type") || "";
    if (!src) return;

    let absoluteUrl;
    try {
      absoluteUrl = new URL(src, pageUrl).toString();
    } catch {
      return;
    }

    if (!isHls({ src: absoluteUrl, type })) return;

    sources.push({
      url: absoluteUrl,
      type: "hls",
      mimeType: type || null,
      provider: absoluteUrl.includes("zilla-networks.com") ? "zilla" : null,
    });
  });

  const deduped = [...new Map(sources.map((source) => [source.url, source])).values()];

  return {
    absoluteEpisode,
    pageUrl,
    sources: deduped,
  };
};
