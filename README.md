# Ava Custody Demo

This project is a simple demo of ingesting ERC-20 balances and displaying a portfolio across **Ethereum** and **Avalanche C-Chain**. It consists of:

- **Ingest Worker (API / BFF)** – a Cloudflare Worker backed by **D1** and **KV** that pulls balances from Moralis, enriches them with metadata and prices from CoinGecko, and exposes them through a lightweight API.
- **Web App (React / Vite)** – a small UI that lets you enter a wallet address and view token balances and values.

The stack uses **Cloudflare Workers + D1 + KV**, **Hono**, **Drizzle ORM**, and **React**.

Website to view - `https://ava-custody-web.pages.dev/`

---

## Local development

Clone the repo and install dependencies with `npm install`. Wrangler is required (`npm install -g wrangler`) and Node 18+ is recommended.

The Ingest Worker expects a Moralis key. Place it in `apps/ingest-worker/.dev.vars` like this:

```
MORALIS_API_KEY=your_key_here
# CG_API_KEY=optional
```

From the repo root you can run `npm run dev`, which starts both the Worker on `http://127.0.0.1:8787` and the React UI on `http://127.0.0.1:3000`.

Before the UI can show balances, you need to ingest a wallet. Use curl or a browser to hit the ingest endpoint, for example:

```
curl "http://127.0.0.1:8787/ingest?address=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984&limit=150"
```

Then open the UI and enter the same address to see balances. Unknown tokens will appear as `UNK` until metadata and prices are backfilled by CoinGecko.

---

## Cloudflare deployment

Deploy the Ingest Worker from `apps/ingest-worker` with Wrangler. Log in with `wrangler login`, set your secrets with `wrangler secret put MORALIS_API_KEY`, and run:

```
wrangler deploy --config wrangler.toml --name ingest-worker
```

On first deploy you will be prompted to register a workers.dev subdomain. Once registered, your Worker is reachable at:

```
https://ingest-worker.<your-subdomain>.workers.dev
```

Test it with:

```
curl "https://ingest-worker.<your-subdomain>.workers.dev/ingest?address=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984&limit=150"
```

and

```
curl "https://ingest-worker.<your-subdomain>.workers.dev/portfolio?address=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"
```

The frontend is built with Vite. Run `npm run build` inside `apps/web` to produce a `dist/` folder, then deploy with Cloudflare Pages:

```
wrangler pages project create ava-custody-web
wrangler pages deploy dist --project-name=ava-custody-web
```

The site will be available at a `*.pages.dev` URL and is already allowed by the Worker’s CORS policy.

---

## Notes

- Tables are created automatically at runtime by the Worker (`ensureSchema`).
- Moralis has a hard cap of 2000+ tokens; use the `limit` query param to avoid large wallets.
- CoinGecko is rate limited. Tokens may appear as `UNK` until the background enrichment finishes.
- Data is persisted in D1 and cached in KV. Re-ingesting an address updates balances without creating duplicates.


---

## Deployment URLs

### Web Frontend (React/Vite)
- Local: http://127.0.0.1:3000
- Remote: https://ava-custody-web.pages.dev/

### Ingest Worker (Cloudflare Worker API)
- Local: http://127.0.0.1:8787
- Remote: https://ava-custody-demo.workers.dev

### Example API Calls

**Local**
```bash
curl "http://127.0.0.1:8787/ingest?address=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984&limit=150"
curl "http://127.0.0.1:8787/portfolio?address=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"
```

**Remote**
```bash
curl "https://ava-custody-demo.workers.dev/ingest?address=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984&limit=150"
curl "https://ava-custody-demo.workers.dev/portfolio?address=0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"
```
