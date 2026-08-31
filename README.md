# source-scraper

Scraper privado y desacoplado de SPlay GO para inspeccionar páginas de películas, series y anime a partir de una URL proporcionada manualmente.

El proyecto intenta extraer metadatos públicos, enlaces relacionados con episodios/capítulos y fuentes multimedia expuestas directamente en el HTML. No escribe en la base de datos de SPlay GO.

## Instalación

```bash
pnpm install
```

## Uso

```bash
pnpm scrape <url>
```

Ejemplos:

```bash
pnpm scrape https://animeflv.or.at/anime/one-piece/
pnpm scrape https://ejemplo.com/pelicula/mi-pelicula/
pnpm scrape https://ejemplo.com/serie/mi-serie/
```

El resultado se guarda en:

```text
output/<slug>.json
```

## Tipos soportados

### AnimeFLV

`animeflv.or.at/anime/...` continúa usando su adaptador específico para intentar descubrir episodios.

### Scraper genérico

Para cualquier otra URL se utiliza el adaptador genérico. Intenta detectar:

- título
- descripción
- poster
- película / serie cuando la página ofrece señales suficientes
- JSON-LD / Schema.org
- fuentes HLS
- fuentes MP4/WebM
- iframes embebidos
- enlaces de episodios o capítulos
- patrones `episodio-12`, `episode-12`, `S02E05`, etc.

Cuando detecta enlaces de capítulos o episodios, puede visitar esas páginas con concurrencia limitada y guardar las fuentes encontradas en cada una.

## Formato genérico

```json
{
  "scraper": "generic",
  "mediaUrl": "https://ejemplo.com/serie/foo/",
  "title": "Foo",
  "mediaType": "series",
  "sources": [],
  "itemCount": 2,
  "items": [
    {
      "season": 1,
      "episode": 1,
      "pageUrl": "https://ejemplo.com/serie/foo/s01e01/",
      "sources": []
    }
  ]
}
```

## Arquitectura

```text
src/
├── parsers/
│   ├── animePage.js
│   ├── episodePage.js
│   └── genericPage.js
├── scrapers/
│   ├── animeflv.js
│   ├── generic.js
│   └── index.js
├── services/
│   └── http.js
└── utils/
    └── concurrency.js
```

Los adaptadores específicos tienen prioridad cuando el dominio/ruta es reconocido. En cualquier otro caso se usa el scraper genérico.

## Limitaciones

El scraper HTTP no ejecuta JavaScript del sitio. Si una web construye su catálogo o reproductor únicamente en el navegador, esos datos pueden no aparecer en el resultado. Tampoco intenta evadir autenticación, DRM, restricciones de origen, cookies obligatorias ni otros controles de acceso.

Úsalo únicamente sobre páginas y contenido para los que tengas autorización.
