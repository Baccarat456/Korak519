## What are Apify Actors?

- Actors are serverless cloud programs that can perform anything from a simple action, like filling out a web form, to a complex operation, like crawling an entire website or removing duplicates from a large dataset.
- Actors are programs packaged as Docker images, which accept a well-defined JSON input, perform an action, and optionally produce structured JSON output.

Substack Newsletter Directory scraper notes
- This scaffold uses CheerioCrawler by default. Substack pages are often static, but some discovery UIs or paywall flows may require Playwright; set `useBrowser=true` if needed.
- Respect Substack Terms of Service and robots.txt. Do not attempt to bypass paywalls or collect subscriber PII.
- For production-scale use prefer official APIs or partner data sources where possible. Use polite crawling (rate limits, proxies, backoff).
- Recommended next steps: add RSS validation (fetch RSS to confirm feed), normalize topic taxonomy, support CSV/CSV import of newsletter URLs, or convert to Playwright-first for robust extraction.

Quick local setup
1) Create directory and paste the files into the corresponding paths.
2) Install dependencies:
   - npm install
3) Run locally:
   - apify run
4) Deploy:
   - apify login
   - apify push

If you want, I can implement one of these next steps now:
- Convert to Playwright-first flow with improved wait/selectors for Substack discovery UI.
- Add RSS validation: fetch each discovered feed URL and extract recent post titles/dates.
- Extend input schema to accept CSV of newsletter URLs and add deduplication.
- Add dataset schema fields for normalized topics and language detection.

Which next step would you like me to implement?