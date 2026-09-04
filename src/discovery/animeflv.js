import * as cheerio from "cheerio";
import { fetchHtml } from "../services/http.js";

const BASE_URL = "https://animeflv.or.at";
const MAX_CATALOG_PAGES = 12;

const normalizeText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const slugify = (value) =>
  normalizeText(value)
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

const getTitles = (metadata) =>
  Array.from(
    new Set([metadata.title, metadata.originalTitle].filter(Boolean).map((value) => String(value).trim()))
  );

const extractAnimeLinks = (html, pageUrl) => {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $("a[href*='/anime/']").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    let url;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      return;
    }

    if (!url.startsWith(`${BASE_URL}/anime/`) || seen.has(url)) return;

    const title =
      $(element).attr("title") ||
      $(element).find("h1,h2,h3,h4,h5,strong,.title").first().text() ||
      $(element).text();

    seen.add(url);
    results.push({ url, title: String(title || "").replace(/\s+/g, " ").trim() });
  });

  return results;
};

const titleMatches = (candidate, titles) => {
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedCandidate) return false;
  return titles.some((title) => normalizeText(title) === normalizedCandidate);
};

const validateCandidate = async ({ url, titles }) => {
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const heading = $("h1").first().text().trim();
    const pageTitle = $("title").text().replace(/\s*[-–|].*$/, "").trim();
    const candidates = [heading, pageTitle].filter(Boolean);

    if (candidates.some((candidate) => titleMatches(candidate, titles))) {
      return { url, title: candidates[0] || titles[0], discoveryMethod: "animeflv-direct-slug" };
    }
  } catch {
    return null;
  }

  return null;
};

export const discoverAnimeFlv = async (metadata) => {
  if (metadata.mediaType !== "tv") return null;

  const titles = getTitles(metadata);
  if (titles.length === 0) return null;

  for (const title of titles) {
    const slug = slugify(title);
    if (!slug) continue;

    const direct = await validateCandidate({
      url: `${BASE_URL}/anime/${slug}/`,
      titles,
    });

    if (direct) return direct;
  }

  for (let page = 1; page <= MAX_CATALOG_PAGES; page += 1) {
    const pageUrl = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/?anime_page=${page}`;

    let html;
    try {
      html = await fetchHtml(pageUrl);
    } catch {
      continue;
    }

    const links = extractAnimeLinks(html, pageUrl);
    const match = links.find((item) => titleMatches(item.title, titles));
    if (match) {
      return {
        ...match,
        discoveryMethod: "animeflv-catalog",
      };
    }
  }

  return null;
};
