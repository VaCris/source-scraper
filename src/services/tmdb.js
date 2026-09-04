const normalizeBaseUrl = (value) => String(value || "").trim().replace(/\/$/, "");

const requestTmdb = async ({ mediaType, tmdbId }) => {
  const baseUrl = normalizeBaseUrl(process.env.SPLAY_API_URL);
  if (!baseUrl) throw new Error("Falta SPLAY_API_URL para consultar TMDB");

  const response = await fetch(
    `${baseUrl}/api/v1/tmdb/${mediaType}/${tmdbId}?language=es-ES`,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    }
  );

  if (response.status === 404) return null;

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message || body?.status_message || `TMDB respondió ${response.status}`);
  }

  return body;
};

const normalizeMetadata = ({ mediaType, body }) => {
  if (!body) return null;

  const title = mediaType === "tv" ? body.name : body.title;
  const originalTitle = mediaType === "tv" ? body.original_name : body.original_title;
  const date = mediaType === "tv" ? body.first_air_date : body.release_date;
  const year = /^\d{4}/.test(String(date || "")) ? Number(String(date).slice(0, 4)) : null;

  return {
    tmdbId: Number(body.id),
    mediaType,
    title: title || originalTitle || null,
    originalTitle: originalTitle || null,
    year,
    raw: body,
  };
};

export const getTmdbMetadata = async ({ tmdbId, mediaType }) => {
  const id = Number(tmdbId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("TMDB ID inválido");

  if (mediaType === "tv" || mediaType === "movie") {
    const body = await requestTmdb({ mediaType, tmdbId: id });
    return normalizeMetadata({ mediaType, body });
  }

  const tv = await requestTmdb({ mediaType: "tv", tmdbId: id });
  if (tv) return normalizeMetadata({ mediaType: "tv", body: tv });

  const movie = await requestTmdb({ mediaType: "movie", tmdbId: id });
  if (movie) return normalizeMetadata({ mediaType: "movie", body: movie });

  throw new Error(`No se encontró TMDB ${id} como TV ni película`);
};
