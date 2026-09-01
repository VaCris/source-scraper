import { chromium } from "playwright";

const MEDIA_URL_PATTERN = /(\.m3u8(?:$|\?)|\/m3u8\/|\.mp4(?:$|\?)|\.webm(?:$|\?))/i;
const MAX_JSON_RESPONSES = 30;
const MAX_JSON_BODY_BYTES = 512 * 1024;

let browserPromise;

const getBrowser = async () => {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
};

export const renderPage = async (url, { timeout = 15000, settleMs = 1500 } = {}) => {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    locale: "es-419",
  });
  const page = await context.newPage();
  const observedMediaUrls = new Set();
  const jsonResponses = [];
  const pendingResponseReads = new Set();

  const remember = (candidate) => {
    if (MEDIA_URL_PATTERN.test(candidate)) observedMediaUrls.add(candidate);
  };

  page.on("request", (request) => remember(request.url()));
  page.on("response", (response) => {
    remember(response.url());

    if (jsonResponses.length >= MAX_JSON_RESPONSES) return;

    const request = response.request();
    const resourceType = request.resourceType();
    const contentType = String(response.headers()["content-type"] || "").toLowerCase();
    const looksJson = contentType.includes("application/json") || contentType.includes("+json");

    if (!looksJson || !["fetch", "xhr"].includes(resourceType)) return;

    const readPromise = (async () => {
      try {
        const body = await response.body();
        if (!body?.length || body.length > MAX_JSON_BODY_BYTES) return;

        const text = body.toString("utf8").trim();
        if (!text) return;

        const data = JSON.parse(text);
        if (jsonResponses.length >= MAX_JSON_RESPONSES) return;

        jsonResponses.push({
          url: response.url(),
          status: response.status(),
          data,
        });
      } catch {
        // Ignore unreadable, invalid or already-consumed JSON responses.
      }
    })();

    pendingResponseReads.add(readPromise);
    readPromise.finally(() => pendingResponseReads.delete(readPromise));
  });

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    await page.waitForTimeout(settleMs);
    await Promise.allSettled([...pendingResponseReads]);

    const html = await page.content();
    const title = await page.title();
    const navigationCandidates = await page.evaluate(() => {
      const values = [];
      const attributes = [
        "href",
        "data-href",
        "data-url",
        "data-link",
        "data-src",
        "data-episode-url",
        "data-episode",
        "onclick",
      ];

      const pushCandidate = (element) => {
        const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
        const attrs = {};

        for (const name of attributes) {
          const value = element.getAttribute?.(name);
          if (value) attrs[name] = value;
        }

        if (text || Object.keys(attrs).length > 0) {
          values.push({
            tag: element.tagName?.toLowerCase() || null,
            text,
            attrs,
          });
        }
      };

      document
        .querySelectorAll(
          "a[href], button, [role='button'], [data-href], [data-url], [data-link], [data-src], [data-episode-url], [data-episode], [onclick]",
        )
        .forEach(pushCandidate);

      return values;
    });

    return {
      html,
      title,
      observedMediaUrls: [...observedMediaUrls],
      navigationCandidates,
      jsonResponses,
      finalUrl: page.url(),
    };
  } finally {
    await context.close();
  }
};

export const closeBrowser = async () => {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = undefined;
  await browser.close();
};
