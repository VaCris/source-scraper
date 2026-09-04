import { discoverAnimeFlv } from "./animeflv.js";

const discoveryAdapters = [
  {
    name: "animeflv.or.at",
    discover: discoverAnimeFlv,
  },
];

export const discoverSourcePage = async (metadata) => {
  const attempts = [];

  for (const adapter of discoveryAdapters) {
    try {
      const result = await adapter.discover(metadata);
      attempts.push({ adapter: adapter.name, found: Boolean(result) });
      if (result) {
        return {
          ...result,
          adapter: adapter.name,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({
        adapter: adapter.name,
        found: false,
        error: error.message,
      });
    }
  }

  return { url: null, adapter: null, attempts };
};
