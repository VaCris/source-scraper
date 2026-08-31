import { chromium } from "playwright";

const MEDIA_URL_PATTERN = /(\.m3u8(?:$|\?)|\/m3u8\/|\.mp4(?:$|\?)|\.webm(?:$|\?))/i;

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

  const remember = (candidate) => {
    if (MEDIA_URL_PATTERN.test(candidate)) observedMediaUrls.add(candidate);
  };

  page.on("request", (request) => remember(request.url()));
  page.on("response", (response) => remember(response.url()));

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout,
    });

    await page.waitForTimeout(settleMs);

    const html = await page.content();
    const title = await page.title();

    return {
      html,
      title,
      observedMediaUrls: [...observedMediaUrls],
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
