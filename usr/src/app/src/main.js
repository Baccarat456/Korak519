// Apify SDK + Crawlee starter for Substack Newsletter Directory scraper
import { Actor } from 'apify';
import { CheerioCrawler, PlaywrightCrawler, Dataset } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const {
  startUrls = ['https://substack.com/discover'],
  maxRequestsPerCrawl = 500,
  useBrowser = false,
  followInternalOnly = true,
} = input;

// Normalize start requests
function prepareStartRequests(urls) {
  return (urls || []).map((u) => {
    try {
      const parsed = new URL(u);
      return { url: u, userData: { startHost: parsed.host } };
    } catch (e) {
      return { url: u, userData: {} };
    }
  });
}

// Heuristic extraction for Substack newsletter pages (Cheerio)
async function extractNewsletterFromCheerio({ request, $, log }) {
  const url = request.loadedUrl ?? request.url;
  log.info('Extracting newsletter metadata', { url });

  // Title: commonly in h1 or meta
  const title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim() ||
    '';

  // Author / publisher
  const author =
    $('[data-test="publisher-name"]').first().text().trim() ||
    $('a[href*="/p/"]').first().text().trim() ||
    $('meta[name="author"]').attr('content') ||
    '';

  // Description / tagline
  const description =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    $('.site-description, .newsletter-subtitle, .sub-header').first().text().trim() ||
    '';

  // Topics/tags may be listed as links to /tag/
  const topics = [];
  $('a[href*="/tag/"], a[href*="/topics/"], .tags a, .topic').each((i, el) => {
    const t = $(el).text().trim();
    if (t) topics.push(t);
  });

  // RSS feed: Substack exposes /feed or /feed.xml or /feed
  let rss = '';
  $('link[type="application/rss+xml"], a[href$="/feed"], a[href$="/rss"]').each((i, el) => {
    const href = $(el).attr('href');
    if (href && !rss) {
      try { rss = new URL(href, url).toString(); } catch { rss = href; }
    }
  });
  // Fallback: common Substack feed pattern: https://<name>.substack.com/feed
  if (!rss) {
    try {
      const host = new URL(url).host;
      // If URL is a subdomain like name.substack.com
      if (host.endsWith('substack.com')) {
        rss = `${url.replace(/\/$/, '')}/feed`;
      }
    } catch (e) {}
  }

  // Latest post snippet (if present)
  const latestPostTitle = $('.post-preview h3, .post-list-item h3').first().text().trim() || '';
  const latestPostUrl = $('.post-preview a[href], .post-list-item a[href]').first().attr('href') || '';
  let latestPost = '';
  if (latestPostTitle) {
    try {
      latestPost = latestPostTitle + (latestPostUrl ? ` — ${new URL(latestPostUrl, url).toString()}` : '');
    } catch {
      latestPost = latestPostTitle;
    }
  }

  // Subscribers count is often not public; attempt to find any numeric badges or meta
  let subscribers = '';
  const subMatch = $('body').text().match(/[\d,]{2,}\s+(?:subscribers|subscribers?)/i);
  if (subMatch) subscribers = subMatch[0];

  const record = {
    title,
    author,
    description,
    topics: Array.from(new Set(topics)),
    rss,
    latest_post: latestPost,
    subscribers: subscribers || '',
    substack_url: url,
    extracted_at: new Date().toISOString(),
  };

  await Dataset.pushData(record);
  log.info('Saved newsletter record', { title, url });
}

// Playwright extraction (for JS-heavy or protected pages)
async function extractNewsletterFromPlaywright({ page, request, log }) {
  const url = request.loadedUrl ?? request.url;
  log.info('Extracting (browser) newsletter metadata', { url });

  await page.waitForTimeout(700).catch(() => {});

  const title = (await page.locator('h1').first().innerText().catch(() => '')) ||
                (await page.title().catch(() => ''));
  const author = (await page.locator('[data-test="publisher-name"]').first().innerText().catch(() => '')) ||
                 (await page.locator('meta[name="author"]').getAttribute('content').catch(() => '')) || '';
  const description = (await page.locator('meta[property="og:description"]').getAttribute('content').catch(() => '')) ||
                      (await page.locator('meta[name="description"]').getAttribute('content').catch(() => '')) ||
                      '';

  const topics = [];
  for (const el of await page.locator('a[href*="/tag/"], a[href*="/topics/"], .tags a').all().catch(() => [])) {
    const t = (await el.innerText().catch(() => '')).trim();
    if (t) topics.push(t);
  }

  let rss = '';
  try {
    rss = (await page.locator('link[type="application/rss+xml"]').first().getAttribute('href').catch(() => '')) || '';
  } catch (e) {}

  const latestPostTitle = (await page.locator('.post-preview h3, .post-list-item h3').first().innerText().catch(() => '')).trim() || '';
  const latestPostUrl = (await page.locator('.post-preview a[href], .post-list-item a[href]').first().getAttribute('href').catch(() => '')) || '';
  let latestPost = '';
  if (latestPostTitle) {
    try { latestPost = latestPostTitle + (latestPostUrl ? ` — ${new URL(latestPostUrl, url).toString()}` : ''); } catch { latestPost = latestPostTitle; }
  }

  // subscribers attempt
  const bodyText = (await page.content().catch(() => '')) || '';
  const subMatch = bodyText.match(/[\d,]{2,}\s+(?:subscribers|subscribers?)/i);
  const subscribers = subMatch ? subMatch[0] : '';

  const record = {
    title,
    author,
    description,
    topics: Array.from(new Set(topics)),
    rss,
    latest_post: latestPost,
    subscribers,
    substack_url: url,
    extracted_at: new Date().toISOString(),
  };

  await Dataset.pushData(record);
  log.info('Saved newsletter record (browser)', { title, url });
}

const proxyConfiguration = await Actor.createProxyConfiguration();

if (!useBrowser) {
  const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxRequestsPerCrawl,
    async requestHandler({ enqueueLinks, request, $, log }) {
      const url = request.loadedUrl ?? request.url;
      log.info('Processing (cheerio)', { url });

      // Enqueue candidate newsletter pages found on discovery/tag/listing pages
      await enqueueLinks({
        globs: ['**/*.substack.com/**', '**/s/*', '**/tag/**', '**/discover**', '**/posts/**'],
        transformRequestFunction: (r) => {
          if (followInternalOnly) {
            try {
              const startHost = request.userData.startHost || new URL(request.url).host;
              if (new URL(r.url).host !== startHost && !r.url.includes('substack.com')) return null;
            } catch (e) {
              // ignore
            }
          }
          return r;
        },
      });

      // If this looks like a newsletter page (substack domain or /p/ post pages), extract
      const isSubstackDomain = (url.includes('substack.com') || url.match(/^[^/]+\.substack\.com/));
      if (isSubstackDomain || url.includes('/archive') || url.includes('/posts/')) {
        await extractNewsletterFromCheerio({ request, $, log });
      } else {
        log.debug('Listing page — links enqueued', { url });
      }
    },
  });

  await crawler.run(prepareStartRequests(startUrls));
} else {
  const crawler = new PlaywrightCrawler({
    launchContext: {},
    maxRequestsPerCrawl,
    async requestHandler({ page, enqueueLinks, request, log }) {
      const url = request.loadedUrl ?? request.url;
      log.info('Processing (playwright)', { url });

      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      // Enqueue newsletter links
      await enqueueLinks({
        globs: ['**/*.substack.com/**', '**/s/*', '**/tag/**', '**/posts/**'],
        transformRequestFunction: (r) => {
          if (followInternalOnly) {
            try {
              const startHost = request.userData.startHost || new URL(request.url).host;
              if (new URL(r.url).host !== startHost && !r.url.includes('substack.com')) return null;
            } catch (e) {
              // ignore
            }
          }
          return r;
        },
      });

      const isSubstackDomain = (url.includes('substack.com') || url.match(/^[^/]+\.substack\.com/));
      if (isSubstackDomain || url.includes('/archive') || url.includes('/posts/')) {
        await extractNewsletterFromPlaywright({ page, request, log });
      } else {
        log.debug('Listing page — links enqueued (browser)', { url });
      }
    },
  });

  await crawler.run(prepareStartRequests(startUrls));
}

await Actor.exit();
