# Source Scraper

Herramienta privada de scraping orientada a inspeccionar páginas de contenido multimedia a partir de una URL. El proyecto soporta **películas, series y anime** mediante adaptadores específicos y un scraper genérico.

El flujo principal usa HTTP + Cheerio por ser más ligero. Cuando una página depende de JavaScript y el resultado HTTP parece incompleto, el scraper puede usar **Playwright con Chromium como fallback** para inspeccionar el DOM ya renderizado y observar solicitudes multimedia realizadas por la propia página.

El proyecto está desacoplado de SPlay GO y **no escribe directamente en su base de datos**.

## Características

- Soporte para películas, series y anime.
- Entrada mediante una URL individual.
- Adaptadores específicos para sitios conocidos.
- Scraper genérico para otros sitios.
- HTTP + Cheerio como primera estrategia.
- Playwright como fallback para páginas dinámicas.
- Extracción de título, descripción y póster.
- Lectura de JSON-LD / Schema.org cuando está disponible.
- Detección de episodios y capítulos.
- Reconocimiento de patrones como `episodio-12`, `episode-12` y `S02E05`.
- Extracción de fuentes HLS, MP4 y WebM expuestas por la página.
- Detección de reproductores mediante `iframe`.
- Observación de URLs multimedia solicitadas durante el renderizado del navegador.
- Recorrido de episodios con concurrencia limitada.
- Deduplicación de enlaces y fuentes.
- Exportación estructurada a JSON.

## Requisitos

- Node.js moderno con soporte para `fetch` nativo.
- pnpm.
- Chromium instalado mediante Playwright.

## Instalación

```bash
pnpm install
pnpm playwright:install
```

El segundo comando instala el Chromium administrado por Playwright.

## Uso

```bash
pnpm scrape <url>
```

### Anime

```bash
pnpm scrape https://animeflv.or.at/anime/one-piece/
```

### Película

```bash
pnpm scrape https://ejemplo.com/pelicula/mi-pelicula/
```

### Serie

```bash
pnpm scrape https://ejemplo.com/serie/mi-serie/
```

Cada ejecución genera:

```text
output/<slug>.json
```

La carpeta `output/` está excluida mediante `.gitignore`.

## Cómo funciona

```text
URL proporcionada
       │
       ▼
Selección de scraper
       │
       ├── Adaptador específico
       │
       └── Scraper genérico
                │
                ▼
          HTTP + Cheerio
                │
                ▼
       ¿Resultado suficiente?
          │             │
         sí             no
          │             │
          │             ▼
          │       Playwright / Chromium
          │             │
          │             ├── DOM renderizado
          │             └── requests multimedia
          │             │
          └─────────────┘
                │
                ▼
          Resultado JSON
```

Playwright no se abre necesariamente en cada ejecución. Se utiliza cuando la extracción HTTP no encuentra fuentes o cuando una serie parece no haber expuesto sus episodios en el HTML inicial.

## Playwright fallback

El navegador se ejecuta en modo headless y se reutiliza durante una ejecución del scraper. Cada página usa un contexto separado y el navegador se cierra al terminar el comando.

El fallback puede obtener dos tipos de información adicionales:

1. El HTML después de ejecutar JavaScript.
2. URLs multimedia observadas en las requests/responses de la página, como `.m3u8`, `.mp4`, `.webm` o rutas que contienen `/m3u8/`.

Cuando Playwright participa, el resultado puede incluir:

```json
{
  "renderMethod": "playwright"
}
```

Si HTTP fue suficiente:

```json
{
  "renderMethod": "http"
}
```

Si Chromium no está instalado o Playwright falla, el scraper conserva el resultado HTTP disponible y puede incluir `browserError` con el motivo del fallo.

## Tipos de contenido

El resultado utiliza `mediaType` cuando existen señales suficientes para determinar el tipo:

```text
movie
series
anime
unknown
```

No se fuerza una clasificación cuando la página no proporciona información suficiente.

## Fuentes multimedia

El parser puede reconocer:

```text
HLS     .m3u8 o rutas /m3u8/
MP4     .mp4
WebM    .webm
Iframe  reproductores embebidos
```

Las fuentes pueden proceder del DOM, markup o tráfico observado por el navegador. Por ejemplo:

```json
{
  "url": "https://media.example/video/master.m3u8",
  "type": "hls",
  "mimeType": null,
  "origin": "browser-network"
}
```

Encontrar una URL multimedia **no garantiza que pueda reproducirse desde otro dominio**. El servidor de origen puede aplicar CORS, autenticación, cookies, URLs firmadas, restricciones de origen u otras políticas.

## Series y episodios

Cuando una página contiene enlaces reconocibles de episodios, el scraper intenta identificar patrones como:

```text
/episodio-12/
/episode-12/
/capitulo-12/
/s01e05/
```

Cuando es posible, el resultado separa temporada y episodio:

```json
{
  "season": 1,
  "episode": 5,
  "pageUrl": "https://ejemplo.com/serie/foo/s01e05/",
  "sources": [],
  "renderMethod": "http"
}
```

La numeración depende del sitio de origen. El scraper no transforma automáticamente numeración absoluta a temporadas de servicios externos.

## Formato de salida

Un resultado genérico puede tener esta forma:

```json
{
  "scraper": "generic",
  "mediaUrl": "https://ejemplo.com/serie/foo/",
  "title": "Foo",
  "mediaType": "series",
  "description": null,
  "poster": null,
  "sources": [],
  "renderMethod": "playwright",
  "browserError": null,
  "itemCount": 2,
  "items": [
    {
      "season": 1,
      "episode": 1,
      "pageUrl": "https://ejemplo.com/serie/foo/s01e01/",
      "sources": [],
      "renderMethod": "http"
    }
  ],
  "scrapedAt": "2026-08-31T00:00:00.000Z"
}
```

## AnimeFLV

Las URLs con esta estructura:

```text
https://animeflv.or.at/anime/<slug>/
```

usan el adaptador específico de AnimeFLV.

El adaptador intenta, en orden:

```text
HTML de la ficha
      ↓
Playwright sobre la ficha si no hay episodios
      ↓
archivo server-rendered como último fallback
```

Las páginas de episodio también pueden abrirse con Playwright si el HTML HTTP no contiene fuentes.

El campo `discoveryMethod` permite distinguir cómo se encontró el catálogo, por ejemplo:

```text
anime-page
anime-page-browser
episode-archive
```

## Arquitectura

```text
src/
├── index.js
├── parsers/
│   ├── animePage.js
│   ├── episodePage.js
│   └── genericPage.js
├── scrapers/
│   ├── animeflv.js
│   ├── generic.js
│   └── index.js
├── services/
│   ├── browser.js
│   └── http.js
└── utils/
    └── concurrency.js
```

### `services/browser.js`

Gestiona Chromium mediante Playwright, devuelve el HTML renderizado y registra las URLs multimedia observadas durante la navegación.

### `services/http.js`

Centraliza las solicitudes HTTP ligeras.

### `parsers/`

Transforma HTML en información estructurada sin encargarse de persistencia.

### `scrapers/`

Coordina HTTP, fallback de navegador, parsers y construcción del resultado final.

## Añadir un nuevo sitio

Los sitios que requieran reglas particulares deberían tener un adaptador independiente dentro de:

```text
src/scrapers/
```

El objetivo es mantener el scraper genérico libre de selectores específicos de cada proveedor.

## Integración con SPlay GO

El proyecto permanece separado de SPlay GO:

```text
Source Scraper
     │
     ▼
Resultado JSON
     │
     ▼
Importador / validación
     │
     ▼
SPlay GO API
```

La separación es intencional: el scraper descubre y estructura información; otra capa decide qué se importa y cómo se almacena.

## Limitaciones

Playwright permite inspeccionar contenido generado por JavaScript, pero no hace que una fuente externa sea automáticamente reutilizable. El proyecto no intenta eludir:

- autenticación;
- DRM;
- controles de acceso;
- CORS;
- cookies obligatorias;
- restricciones de origen o referer;
- URLs firmadas o mecanismos equivalentes.

Una fuente puede aparecer en el DOM o en el tráfico del navegador y aun así no ser utilizable fuera del sitio original.

## Uso responsable

Utiliza el proyecto únicamente sobre sitios, fuentes y contenido para los que tengas autorización. Respeta las condiciones del servicio, derechos aplicables y límites razonables de solicitudes del sitio inspeccionado.
