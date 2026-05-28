# JobPulse ⚡

Real-time job tracker for Platform PM roles across multiple ATS platforms, with AI-powered relevance scoring.

## Features

- **Multi-ATS scanning** — Ashby, Greenhouse, Lever, BambooHR, SmartRecruiters
- **AI relevance scoring** — each job scored 0–100 against your resume using Claude
- **Smart filters** — recency, work type (remote/hybrid/on-site), region, job title keywords
- **Dynamic company catalog** — loaded from `public/companies.json`, no hardcoded list
- **GitHub sync** — companies added via the UI are committed directly to the repo via the GitHub API
- **localStorage fallback** — additions saved locally even without a GitHub token

## Setup

### 1. Open the app
Open `index.html` in a browser, or enable GitHub Pages:
- Repo → **Settings → Pages** → Source: `main` branch, `/ (root)`
- Your app will be live at `https://YOUR_USERNAME.github.io/jobpulse/`

### 2. Configure GitHub sync (optional but recommended)
Click the ⚙ gear icon in the top right and enter:
- **Personal Access Token** — generate at [github.com/settings/tokens](https://github.com/settings/tokens/new?scopes=repo&description=JobPulse) with `repo` scope
- **Repository** — `your-username/jobpulse`
- **Branch** — `main`

Once configured, any company you add via the "Add company" form will be committed directly to `public/companies.json`.

## Adding companies

Use the **Add company** form in the sidebar:
1. Select the ATS platform
2. Enter the company's slug (the URL path on their job board, e.g. `stripe` for `jobs.ashbyhq.com/stripe`)
3. Enter a display name
4. Click **Add**

With a GitHub token configured, the addition is committed to `public/companies.json` automatically. Without a token, it's saved to your browser's localStorage.

## Company catalog

`public/companies.json` is the source of truth for which companies are scanned. It's a simple JSON file:

```json
{
  "companies": [
    { "name": "HubSpot", "slug": "hubspot", "ats": "greenhouse" },
    { "name": "Notion",  "slug": "notion",  "ats": "ashby" }
  ]
}
```

Supported `ats` values: `ashby`, `greenhouse`, `lever`, `bamboohr`, `smartrecruiters`

## Scripts

```bash
# Validate companies.json schema
node scripts/validate-companies.js

# Validate + probe live ATS endpoints
node scripts/validate-companies.js --probe
```

Requires Node 18+.

## Architecture

```
jobpulse/
├── index.html                          # Frontend — single file app
├── public/
│   └── companies.json                  # Company catalog (source of truth)
├── scripts/
│   ├── validate-companies.js           # CI validation script
│   └── fetch-companies.js              # Future: auto-discovery script
└── .github/
    └── workflows/
        └── validate-companies.yml      # GitHub Action: validate on PR
```


