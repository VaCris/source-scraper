import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scrapeAnime } from "./scrapers/animeflv.js";

const inputUrl = process.argv[2];

if (!inputUrl) {
  console.error("Uso: pnpm scrape <url-del-anime>");
  process.exit(1);
}

try {
  const result = await scrapeAnime(inputUrl);

  await mkdir("output", { recursive: true });

  const slug = new URL(inputUrl).pathname
    .split("/")
    .filter(Boolean)
    .pop() || "anime";

  const outputPath = resolve("output", `${slug}.json`);
  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");

  const withSources = result.episodes.filter((episode) => episode.sources.length > 0).length;

  console.log(`Anime: ${result.title || slug}`);
  console.log(`Episodios detectados: ${result.episodeCount}`);
  console.log(`Episodios con fuente HLS: ${withSources}`);
  console.log(`Salida: ${outputPath}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
