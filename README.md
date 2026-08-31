# source-scraper

Scraper privado y desacoplado de SPlay GO para descubrir episodios desde una ficha de anime y extraer fuentes HLS expuestas directamente por las páginas de episodio.

## Instalación

```bash
pnpm install
```

## Uso

```bash
pnpm scrape https://animeflv.or.at/anime/one-piece/
```

El resultado se guarda en `output/<slug>.json`.

## Salida

Cada episodio incluye:

- `absoluteEpisode`
- `pageUrl`
- `sources[]`
- `error`

Una fuente HLS contiene:

- `url`
- `type: "hls"`
- `mimeType`
- `provider` cuando puede inferirse del host

## Diseño

El proyecto no escribe directamente en la base de datos de SPlay. Su responsabilidad es descubrir y estructurar fuentes. La importación hacia SPlay debe mantenerse como una capa separada.

## Alcance

Actualmente solo está habilitado `animeflv.or.at`. La estructura está preparada para añadir nuevos adaptadores en `src/scrapers/`.

Úsalo únicamente sobre fuentes y contenido para los que tengas autorización.
