# Source Scraper

Herramienta de scraping para inspeccionar páginas de contenido multimedia a partir de una URL. Soporta **películas, series y anime** mediante una arquitectura híbrida basada en HTTP, Cheerio y Playwright.

La estrategia principal utiliza HTTP + Cheerio para mantener las ejecuciones rápidas y ligeras. Cuando una página depende de JavaScript y el HTML inicial no contiene suficiente información, **Playwright con Chromium funciona como fallback**, permitiendo analizar el DOM renderizado y detectar solicitudes multimedia realizadas durante la navegación.

## Características

- Soporte para películas, series y anime.
- Scraping a partir de una URL individual.
- Adaptadores específicos para sitios que requieren reglas propias.
- Scraper genérico para páginas no reconocidas.
- HTTP + Cheerio como estrategia principal.
- Playwright + Chromium como fallback para contenido dinámico.
- Extracción de título, descripción y póster.
- Lectura de JSON-LD / Schema.org.
- Detección de episodios y capítulos.
- Reconocimiento de patrones como `episodio-12`, `episode-12` y `S02E05`.
- Detección de HLS, MP4 y WebM expuestos por la página.
- Detección de reproductores mediante `iframe`.
- Observación de URLs multimedia durante el renderizado del navegador.
- Procesamiento de páginas relacionadas con concurrencia limitada.
- Deduplicación de enlaces y fuentes.
- Exportación de resultados a JSON.

## Requisitos

- Node.js moderno con soporte para `fetch` nativo.
- pnpm.
- Chromium administrado por Playwright.

## Instalación

```bash
pnpm install
pnpm playwright:install
```

`playwright:install` instala la versión de Chromium requerida por Playwright.

## Uso

```bash
pnpm scrape <url>
```

Ejemplos:

```bash
pnpm scrape https://ejemplo.com/pelicula/mi-pelicula/
pnpm scrape https://ejemplo.com/serie/mi-serie/
```

Cada ejecución genera un archivo:

```text
output/<slug>.json
```

La carpeta `output/` está excluida del repositorio mediante `.gitignore`.

## Flujo de scraping

```text
URL
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
 ¿Datos suficientes?
     │         │
    sí         no
     │         │
     │         ▼
     │   Playwright + Chromium
     │         │
     │         ├── DOM renderizado
     │         └── tráfico multimedia
     │         │
     └─────────┘
          │
          ▼
      Resultado JSON
```

Playwright no se inicia necesariamente para todas las páginas. El scraper intenta primero obtener un resultado mediante HTTP y utiliza el navegador cuando detecta que faltan fuentes o contenido relacionado que podría depender de JavaScript.

## HTTP + Cheerio

La primera etapa descarga el HTML directamente y lo procesa con Cheerio.

Esta estrategia es apropiada para páginas que exponen en el documento inicial:

- metadatos;
- JSON-LD;
- enlaces a episodios;
- etiquetas `video` o `source`;
- iframes;
- URLs multimedia incluidas en el markup.

Al evitar un navegador cuando no es necesario, el consumo de memoria y el tiempo de ejecución se mantienen bajos.

## Playwright fallback

Cuando el resultado HTTP parece incompleto, el scraper puede abrir la URL mediante Chromium en modo headless.

El navegador permite obtener:

1. El HTML después de ejecutar JavaScript.
2. Elementos agregados dinámicamente al DOM.
3. Enlaces de episodios generados en el cliente.
4. Fuentes multimedia añadidas durante la ejecución.
5. URLs multimedia observadas en requests y responses de la página.

El navegador se reutiliza durante una misma ejecución y se cierra cuando termina el comando.

El resultado indica qué estrategia produjo los datos:

```json
{
  "renderMethod": "http"
}
```

o:

```json
{
  "renderMethod": "playwright"
}
```

Si Chromium no está disponible o el fallback falla, el scraper conserva la información obtenida mediante HTTP y puede incluir:

```json
{
  "browserError": "mensaje del error"
}
```

## Tipos de contenido

Cuando existen señales suficientes, `mediaType` puede tomar uno de estos valores:

```text
movie
series
anime
unknown
```

La clasificación se basa en información encontrada en la página. Si no hay evidencia suficiente, se conserva `unknown` en lugar de forzar un tipo.

## Fuentes multimedia

El scraper puede reconocer fuentes como:

```text
HLS     .m3u8 o rutas /m3u8/
MP4     .mp4
WebM    .webm
Iframe  reproductores embebidos
```

Una fuente detectada puede indicar su origen:

```json
{
  "url": "https://media.example/video/master.m3u8",
  "type": "hls",
  "mimeType": null,
  "origin": "browser-network"
}
```

Otros valores de `origin` pueden identificar fuentes encontradas directamente en etiquetas multimedia, iframes o markup.

Encontrar una URL no implica que pueda utilizarse desde cualquier entorno. El servidor de origen puede aplicar políticas propias de acceso y reproducción.

## Series y episodios

El parser busca patrones habituales en enlaces y texto, por ejemplo:

```text
/episodio-12/
/episode-12/
/capitulo-12/
/s01e05/
```

Cuando la información lo permite, temporada y episodio se representan por separado:

```json
{
  "season": 1,
  "episode": 5,
  "pageUrl": "https://ejemplo.com/serie/foo/s01e05/",
  "sources": [],
  "renderMethod": "http"
}
```

La numeración se conserva según la información publicada por la página inspeccionada.

## Formato de salida

Ejemplo de una serie procesada mediante el scraper genérico:

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

El formato puede incluir campos adicionales cuando un adaptador específico dispone de más información.

## Adaptadores específicos

La arquitectura permite implementar reglas particulares para sitios cuya estructura no puede resolverse adecuadamente mediante el parser genérico.

Actualmente existe un adaptador para URLs con la estructura:

```text
https://animeflv.or.at/anime/<slug>/
```

Su proceso de descubrimiento intenta diferentes estrategias:

```text
HTML de la ficha
      │
      ▼
Playwright si no aparecen episodios
      │
      ▼
Descubrimiento alternativo disponible
```

Las páginas de episodio también pueden utilizar Playwright cuando el HTML inicial no contiene fuentes.

El campo `discoveryMethod` permite conocer cómo se obtuvo la lista de episodios.

Ejemplos:

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

### `src/index.js`

Punto de entrada del CLI. Recibe la URL, ejecuta el scraper correspondiente y escribe el resultado en `output/`.

### `parsers/`

Transforman HTML en estructuras de datos. Se encargan de interpretar metadatos, episodios y fuentes encontradas.

### `scrapers/`

Coordinan las solicitudes HTTP, parsers, navegación con Playwright y procesamiento de páginas relacionadas.

### `services/http.js`

Centraliza las solicitudes HTTP utilizadas por la estrategia ligera.

### `services/browser.js`

Gestiona Chromium mediante Playwright. Obtiene HTML renderizado y registra URLs multimedia observadas durante la navegación.

### `utils/concurrency.js`

Permite procesar varias páginas manteniendo un límite de concurrencia.

## Añadir soporte para otro sitio

Si un sitio requiere selectores o reglas particulares, debe implementarse como un adaptador independiente dentro de:

```text
src/scrapers/
```

Después puede registrarse en el selector de scrapers para que las URLs compatibles utilicen automáticamente ese adaptador.

La lógica específica de un sitio debe mantenerse fuera del scraper genérico siempre que sea posible. Esto evita mezclar reglas incompatibles y facilita mantener cada integración de forma independiente.

## Rendimiento

El navegador es considerablemente más costoso que una solicitud HTTP convencional. Por ese motivo, el proyecto utiliza un enfoque híbrido en lugar de procesar todas las URLs con Chromium.

Para colecciones grandes conviene mantener una concurrencia limitada. Abrir demasiadas páginas simultáneamente puede aumentar rápidamente el consumo de memoria y provocar bloqueos o timeouts.

## Limitaciones

Playwright permite ejecutar JavaScript y observar el comportamiento normal de una página, pero no elimina las restricciones impuestas por servidores externos.

El proyecto no intenta eludir:

- autenticación;
- DRM;
- controles de acceso;
- CORS;
- cookies obligatorias;
- restricciones de origen o referer;
- URLs firmadas u otros mecanismos equivalentes.

Una fuente puede aparecer en el DOM o en el tráfico del navegador y aun así no ser accesible fuera de su contexto original.

## Uso responsable

Utiliza el proyecto únicamente sobre sitios, fuentes y contenido para los que tengas autorización. Respeta las condiciones del servicio, derechos aplicables y límites razonables de solicitudes de los sitios inspeccionados.
