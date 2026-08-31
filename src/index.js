import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scrapeUrl } from "./scrapers/index.js";

const inputUrl = process.argv[2];

if (!inputUrl) {
  console.error("Uso: pnpm scrape <url-de-pelicula-serie-o-anime>");
  process.exit(1);
}

try {
  const result = await scrapeUrl(inputUrl);

  await mkdir("output", { recursive: true });

  const parsedUrl = new URL(inputUrl);
  const slug = parsedUrl.pathname.split("/").filter(Boolean).pop() || parsedUrl.hostname;
  const outputPath = resolve("output", `${slug}.json`);

  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");

  console.log(`Título: ${result.title || slug}`);
  console.log(`Tipo: ${result.mediaType || (result.scraper === "animeflv.or.at" ? "anime/series" : "unknown")}`);

  if (Array.isArray(result.episodes)) {
    const withSources = result.episodes.filter((episode) => episode.sources?.length > 0).length;
    console.log(`Episodios detectados: ${result.episodeCount || result.episodes.length}`);
    console.log(`Episodios con fuentes: ${withSources}`);
  } else {
    console.log(`Fuentes en página principal: ${result.sources?.length || 0}`);
    console.log(`Capítulos/episodios detectados: ${result.itemCount || 0}`);
    const withSources = (result.items || []).filter((item) => item.sources?.length > 0).length;
    if (result.itemCount) console.log(`Capítulos/episodios con fuentes: ${withSources}`);
  }

  console.log(`Salida: ${outputPath}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
