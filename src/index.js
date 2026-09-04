import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scrapeUrl } from "./scrapers/index.js";
import { closeBrowser } from "./services/browser.js";
import { syncSourcesToSplay } from "./services/splay-api.js";

const args = process.argv.slice(2);
const inputUrl = args.find((arg) => !arg.startsWith("--"));
const syncEnabled = args.includes("--sync");
const tmdbArg = args.find((arg) => arg.startsWith("--tmdb="));
const tmdbId = tmdbArg ? Number(tmdbArg.split("=")[1]) : null;

if (!inputUrl) {
  console.error("Uso: pnpm scrape <url> [--sync --tmdb=<id>]");
  process.exit(1);
}

if (syncEnabled && (!Number.isInteger(tmdbId) || tmdbId <= 0)) {
  console.error("Para --sync debes indicar un TMDB ID válido con --tmdb=<id>");
  process.exit(1);
}

let exitCode = 0;

try {
  const result = await scrapeUrl(inputUrl);

  await mkdir("output", { recursive: true });

  const parsedUrl = new URL(inputUrl);
  const slug = parsedUrl.pathname.split("/").filter(Boolean).pop() || parsedUrl.hostname;
  const outputPath = resolve("output", `${slug}.json`);

  await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n", "utf8");

  console.log(`Título: ${result.title || slug}`);
  console.log(`Tipo: ${result.mediaType || (result.scraper === "animeflv.or.at" ? "anime/series" : "unknown")}`);
  if (result.renderMethod) console.log(`Render: ${result.renderMethod}`);

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

  if (syncEnabled) {
    const syncResult = await syncSourcesToSplay({ result, tmdbId });
    console.log(`Fuentes sincronizadas con SPlay: ${syncResult.synced}`);
    if (syncResult.skipped.length > 0) {
      console.log(`Fuentes omitidas: ${syncResult.skipped.length}`);
    }
  }
} catch (error) {
  console.error(error.message);
  exitCode = 1;
} finally {
  await closeBrowser().catch(() => {});
}

process.exitCode = exitCode;
