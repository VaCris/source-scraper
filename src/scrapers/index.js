import { scrapeAnime } from "./animeflv.js";
import { scrapeGeneric } from "./generic.js";

const animeFlvHosts = new Set(["animeflv.or.at", "www.animeflv.or.at"]);

export const scrapeUrl = async (rawUrl, options = {}) => {
  const url = new URL(rawUrl);

  if (animeFlvHosts.has(url.hostname) && url.pathname.startsWith("/anime/")) {
    return scrapeAnime(rawUrl, options);
  }

  return scrapeGeneric(rawUrl, options);
};
