import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { scrapeUrl } from "./scrapers/index.js";
import { discoverSourcePage } from "./discovery/index.js";
import { closeBrowser } from "./services/browser.js";
import { syncSourcesToSplay } from "./services/splay-api.js";
import { getTmdbMetadata } from "./services/tmdb.js";

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const discoverEnabled = args.includes("--discover");
const syncEnabled = args.includes("--sync");
const tmdbArg = args.find((arg) => arg.startsWith("--tmdb="));
const typeArg = args.find((arg) => arg.startsWith("--type="));
const requestedType = typeArg ? typeArg.split("=")[1].toLowerCase() : null;

if (requestedType && !["tv", "movie"].includes(requestedType)) {
  console.error("--type solo acepta tv o movie");
  process.exit(1);
}

const resolveInput = async () => {
  if (discoverEnabled) {
    const tmdbId = Number(positional[0]);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      throw new Error("Uso: pnpm scrape:tmdb <tmdbId> [--type=tv|movie] [--sync]");
    }

    const metadata = await getTmdbMetadata({ tmdbId, mediaType: requestedType });
    if (!metadata) throw new Error(`No se encontró metadata para TMDB ${tmdbId}`);

    console.log(`TMDB: ${metadata.title || metadata.originalTitle || tmdbId} (${metadata.mediaType})`);

    const discovery = await discoverSourcePage(metadata);
    if (!discovery.url) {
      const attempted = discovery.attempts.map((item) => item.adapter).join(", ") || "ninguno";
      throw new Error(`No se encontró una página fuente. Adaptadores probados: ${attempted}`);
    }

    console.log(`Página encontrada: ${discovery.url}`);
    console.log(`Discovery: ${discovery.adapter} / ${discovery.discoveryMethod}`);

    return {
      inputUrl: discovery.url,
      tmdbId,
      metadata,
      discovery,
    };
  }

  const inputUrl = positional[0];
  if (!inputUrl) {
    throw new Error("Uso: pnpm scrape <url> [--sync --tmdb=<id>]");
  }

  const tmdbId = tmdbArg ? Number(tmdbArg.split("=")[1]) : null;
  if (syncEnabled && (!Number.isInteger(tmdbId) || tmdbId <= 0)) {
    throw new Error("Para --sync debes indicar un TMDB ID válido con --tmdb=<id>");
  }

  return { inputUrl, tmdbId, metadata: null, discovery: null };
};

let exitCode = 0;

try {
  const { inputUrl, tmdbId, metadata, discovery } = await resolveInput();
  const result = await scrapeUrl(inputUrl);

  if (metadata) {
    result.tmdbId = tmdbId;
    result.tmdbTitle = metadata.title;
    result.tmdbMediaType = metadata.mediaType;
    result.discovery = discovery;
  }

  await mkdir("output", { recursive: true });

  const parsedUrl = new URL(inputUrl);
  const slug = parsedUrl.pathname.split("/").filter(Boolean).pop() || parsedUrl.hostname;
  const outputName = discoverEnabled ? `tmdb-${tmdbId}-${slug}` : slug;
  const outputPath = resolve("output", `${outputName}.json`);

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
