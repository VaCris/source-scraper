const DEFAULT_PROVIDER_BY_HOST = {
  "streamtape.com": "streamtape",
  "bysesukior.com": "bysesukior",
  "luluvid.com": "lulustream",
  "lulustream.com": "lulustream",
  "player4me.xyz": "player4me",
  "zilla-networks.com": "zilla",
};

const BULK_SIZE = 100;

const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/$/, "");

const getProviderSlug = (sourceUrl) => {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase();

    for (const [host, providerSlug] of Object.entries(DEFAULT_PROVIDER_BY_HOST)) {
      if (hostname === host || hostname.endsWith(`.${host}`)) {
        return providerSlug;
      }
    }
  } catch {
    return null;
  }

  return null;
};

const normalizeSourceType = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "hls") return "HLS";
  if (normalized === "mp4" || normalized === "webm") return "MP4";
  if (normalized === "iframe") return "IFRAME";
  return null;
};

const toApiMediaType = (mediaType) => {
  if (mediaType === "movie") return "MOVIE";
  if (mediaType === "series" || mediaType === "anime") return "TV";
  return null;
};

const collectCandidateSources = (result) => {
  const candidates = [];

  for (const source of result.sources || []) {
    candidates.push({ source, season: null, episode: null });
  }

  for (const item of result.items || []) {
    for (const source of item.sources || []) {
      candidates.push({
        source,
        season: item.season ?? 1,
        episode: item.episode ?? null,
      });
    }
  }

  for (const episodeItem of result.episodes || []) {
    for (const source of episodeItem.sources || []) {
      candidates.push({
        source,
        season: episodeItem.season ?? 1,
        episode: episodeItem.episode ?? null,
      });
    }
  }

  return candidates;
};

const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

export const buildSplaySources = ({ result, tmdbId }) => {
  const mediaType = toApiMediaType(result.mediaType);
  if (!mediaType) {
    throw new Error(`No se puede sincronizar mediaType=${result.mediaType || "unknown"}`);
  }

  const skipped = [];
  const dedupe = new Set();
  const sources = [];

  for (const candidate of collectCandidateSources(result)) {
    const sourceUrl = candidate.source?.url;
    const providerSlug = sourceUrl ? getProviderSlug(sourceUrl) : null;
    const sourceType = normalizeSourceType(candidate.source?.type);

    if (!sourceUrl || !providerSlug || !sourceType) {
      skipped.push({
        url: sourceUrl || null,
        reason: !sourceUrl
          ? "missing-url"
          : !providerSlug
            ? "unknown-provider"
            : "unsupported-source-type",
      });
      continue;
    }

    if (mediaType === "TV" && !candidate.episode) {
      skipped.push({ url: sourceUrl, reason: "missing-episode" });
      continue;
    }

    const payload = {
      tmdbId: Number(tmdbId),
      mediaType,
      providerSlug,
      sourceType,
      sourceUrl,
      ...(mediaType === "TV"
        ? {
            seasonNumber: Number(candidate.season || 1),
            episodeNumber: Number(candidate.episode),
          }
        : {}),
    };

    const key = [
      payload.tmdbId,
      payload.mediaType,
      payload.providerSlug,
      payload.sourceUrl,
      payload.seasonNumber || "-",
      payload.episodeNumber || "-",
    ].join("|");

    if (dedupe.has(key)) continue;
    dedupe.add(key);
    sources.push(payload);
  }

  return { sources, skipped };
};

export const syncSourcesToSplay = async ({ result, tmdbId }) => {
  const baseUrl = normalizeBaseUrl(process.env.SPLAY_API_URL);
  const adminApiKey = String(process.env.SPLAY_ADMIN_API_KEY || "").trim();

  if (!baseUrl) throw new Error("Falta SPLAY_API_URL");
  if (!adminApiKey) throw new Error("Falta SPLAY_ADMIN_API_KEY");

  const prepared = buildSplaySources({ result, tmdbId });
  if (prepared.sources.length === 0) {
    return { synced: 0, skipped: prepared.skipped, batches: 0 };
  }

  let synced = 0;
  const batches = chunk(prepared.sources, BULK_SIZE);

  for (const sources of batches) {
    const response = await fetch(`${baseUrl}/admin/sources/bulk`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-admin-api-key": adminApiKey,
      },
      body: JSON.stringify({ sources }),
      signal: AbortSignal.timeout(20000),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const message = body?.message || `SPlay API respondió ${response.status}`;
      throw new Error(message);
    }

    synced += Array.isArray(body?.sources) ? body.sources.length : sources.length;
  }

  return {
    synced,
    skipped: prepared.skipped,
    batches: batches.length,
  };
};
