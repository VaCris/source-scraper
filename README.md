# Source Scraper

Herramienta privada de scraping orientada a inspeccionar páginas de contenido multimedia a partir de una URL. El proyecto ya no está limitado a anime: su arquitectura permite trabajar con páginas de **películas, series y anime** mediante adaptadores específicos y un scraper genérico.

El scraper intenta obtener únicamente la información que la página expone directamente: metadatos, capítulos o episodios relacionados y fuentes multimedia presentes en el HTML. El proyecto está desacoplado de SPlay GO y **no escribe directamente en su base de datos**.

## Características

- Soporte para películas, series y anime.
- Entrada mediante una URL individual.
- Adaptadores específicos para sitios conocidos.
- Fallback mediante un scraper genérico para otros sitios.
- Extracción de título, descripción y póster.
- Lectura de JSON-LD / Schema.org cuando está disponible.
- Detección de episodios y capítulos.
- Reconocimiento de patrones como `episodio-12`, `episode-12` y `S02E05`.
- Extracción de fuentes HLS, MP4 y WebM expuestas en el HTML.
- Detección de reproductores mediante `iframe`.
- Recorrido de episodios con concurrencia limitada.
- Deduplicación de enlaces y fuentes.
- Exportación estructurada a JSON.

## Requisitos

- Node.js moderno con soporte para `fetch` nativo.
- pnpm.

## Instalación

```bash
pnpm install
```

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

Cada ejecución genera un archivo dentro de:

```text
output/<slug>.json
```

La carpeta `output/` está excluida del repositorio mediante `.gitignore`.

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
          Descarga del HTML
                │
                ▼
       Extracción de metadatos
                │
       ┌────────┴────────┐
       ▼                 ▼
Fuentes multimedia   Episodios/capítulos
                         │
                         ▼
                 Inspección limitada
                         │
                         ▼
                    Resultado JSON
```

Los adaptadores específicos tienen prioridad cuando el dominio y la ruta son reconocidos. Si no existe un adaptador compatible, se utiliza automáticamente el scraper genérico.

## Tipos de contenido

El resultado utiliza `mediaType` cuando existen señales suficientes para determinar el tipo de contenido.

Valores esperados:

```text
movie
series
anime
unknown
```

No se fuerza una clasificación cuando la página no proporciona información suficiente.

## Fuentes multimedia

El parser genérico puede reconocer fuentes que estén expuestas directamente en el documento, entre ellas:

```text
HLS     .m3u8
MP4     .mp4
WebM    .webm
Iframe  reproductores embebidos
```

Encontrar una URL multimedia no garantiza que pueda reproducirse desde otro dominio. El servidor de origen puede aplicar CORS, autenticación, cookies, URLs firmadas, restricciones de origen u otras políticas.

## Series y episodios

Cuando una página contiene enlaces reconocibles de episodios, el scraper intenta identificar información como:

```text
/episodio-12/
/episode-12/
/capitulo-12/
/s01e05/
```

Cuando es posible, el resultado separa:

```json
{
  "season": 1,
  "episode": 5,
  "pageUrl": "https://ejemplo.com/serie/foo/s01e05/",
  "sources": []
}
```

La numeración depende de la información publicada por el sitio de origen. El scraper no convierte automáticamente numeración absoluta de episodios a temporadas de servicios externos.

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
  "itemCount": 2,
  "items": [
    {
      "season": 1,
      "episode": 1,
      "pageUrl": "https://ejemplo.com/serie/foo/s01e01/",
      "sources": []
    }
  ],
  "scrapedAt": "2026-08-31T00:00:00.000Z"
}
```

La estructura puede contener información adicional dependiendo del adaptador utilizado.

## AnimeFLV

Las URLs con la estructura:

```text
https://animeflv.or.at/anime/<slug>/
```

utilizan el adaptador específico de AnimeFLV antes de recurrir al comportamiento genérico.

Actualmente existe una limitación conocida: determinadas listas de episodios y reproductores pueden generarse mediante JavaScript y no estar presentes en el HTML obtenido mediante una petición HTTP normal. En esos casos el scraper puede encontrar solamente una parte del catálogo.

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
│   └── http.js
└── utils/
    └── concurrency.js
```

### `parsers/`

Transforma HTML en información estructurada. Los parsers no deberían encargarse de persistencia ni integración con aplicaciones externas.

### `scrapers/`

Coordina las peticiones, selecciona los parsers correspondientes y construye el resultado final.

### `services/http.js`

Centraliza las solicitudes HTTP realizadas por el proyecto.

### `utils/concurrency.js`

Permite procesar múltiples páginas manteniendo un límite de concurrencia.

## Añadir un nuevo sitio

Los sitios que necesiten lógica particular deberían implementarse mediante un adaptador independiente en:

```text
src/scrapers/
```

El objetivo es evitar introducir selectores y reglas específicas de múltiples sitios dentro del scraper genérico.

Una integración nueva debería mantener una salida compatible con el modelo general del proyecto para que posteriormente pueda ser procesada por otra aplicación sin depender del sitio original.

## Integración con SPlay GO

Este repositorio funciona como herramienta independiente:

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

La separación es intencional. El scraper descubre y estructura información; otra capa debe validar qué datos se importan y cómo se almacenan.

## Limitaciones

El scraper actual trabaja principalmente sobre el HTML obtenido mediante HTTP y **no ejecuta JavaScript del sitio**. Por este motivo, una aplicación que construya completamente su catálogo o reproductor en el navegador puede producir resultados incompletos.

El proyecto tampoco intenta eludir:

- autenticación;
- DRM;
- controles de acceso;
- CORS;
- cookies obligatorias;
- restricciones de origen o referer;
- URLs firmadas o mecanismos equivalentes.

Una fuente detectada puede estar técnicamente presente en el HTML y aun así no ser utilizable fuera de su sitio de origen.

## Uso responsable

Utiliza el proyecto únicamente sobre sitios, fuentes y contenido para los que tengas autorización. Respeta las condiciones del servicio, derechos aplicables y límites razonables de solicitudes del sitio inspeccionado.
