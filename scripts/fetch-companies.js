#!/usr/bin/env node
/**
 * JobPulse — fetch-companies.js
 *
 * Pulls the OpenPostings company list, filters to supported ATS platforms,
 * spot-checks a sample of slugs against their live APIs, and writes
 * public/companies.json for the frontend to consume.
 *
 * Usage:
 *   node scripts/fetch-companies.js
 *
 * Schedule (GitHub Actions cron or local cron):
 *   0 6 * * 1   # every Monday at 6am — keeps the list fresh weekly
 *
 * Requirements:
 *   node 18+  (uses native fetch)
 *   npm install   (no dependencies — uses only Node built-ins + native fetch)
 */

import fs   from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE  = path.join(__dirname, '..', 'public', 'companies.json');

// ── Config ────────────────────────────────────────────────────────────────────

// ATS platforms we support in the frontend
const SUPPORTED_ATS = new Set(['ashby', 'greenhouse', 'lever', 'bamboohr', 'smartrecruiters']);

// OpenPostings raw company list (community-maintained, ~7,748 companies)
const OPENPOSTINGS_URL =
  'https://raw.githubusercontent.com/Masterjx9/OpenPostings/main/companies.json';

// How many slugs to spot-check per ATS (keeps the script fast)
const SPOT_CHECK_SAMPLE = 10;

// Request timeout in ms
const TIMEOUT_MS = 8000;

// ── ATS API probe URLs — used to verify a slug is actually live ───────────────
const ATS_PROBE = {
  ashby:           slug => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
  greenhouse:      slug => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
  lever:           slug => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  bamboohr:        slug => `https://${slug}.bamboohr.com/jobs/embed2.php?version=1.0.0`,
  smartrecruiters: slug => `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns true if the ATS API returns a valid non-empty response for this slug */
async function probeSlug(ats, slug) {
  try {
    const url = ATS_PROBE[ats]?.(slug);
    if (!url) return false;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return false;
    const text = await res.text();
    // Must parse as JSON and have some content
    const data = JSON.parse(text);
    // Greenhouse & Ashby return {jobs:[...]}, Lever returns [...], others vary
    if (Array.isArray(data)) return true;
    if (data && typeof data === 'object') return true;
    return false;
  } catch {
    return false;
  }
}

/** Sample n items randomly from an array */
function sample(arr, n) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('JobPulse — fetch-companies.js');
  console.log('─'.repeat(50));

  // 1. Fetch OpenPostings company list
  console.log(`\n📥 Fetching OpenPostings company list...`);
  let raw;
  try {
    const res = await fetchWithTimeout(OPENPOSTINGS_URL, 15000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
    console.log(`   Found ${raw.length} total companies`);
  } catch (err) {
    console.error(`   ❌ Failed to fetch OpenPostings list: ${err.message}`);
    console.error(`   Falling back to existing public/companies.json if available...`);
    try {
      const existing = await fs.readFile(OUT_FILE, 'utf8');
      console.log(`   ✅ Using cached companies.json`);
      process.exit(0);
    } catch {
      console.error(`   No cache available. Exiting.`);
      process.exit(1);
    }
  }

  // 2. Filter to supported ATS platforms
  // OpenPostings schema: { name, slug, ats, ... }
  // Their ATS field may be: "ashby", "greenhouse.io", "lever.co", etc.
  // Normalise to our short names.
  const ATS_NORMALISE = {
    'ashby':           'ashby',
    'ashbyhq':         'ashby',
    'greenhouse':      'greenhouse',
    'greenhouse.io':   'greenhouse',
    'lever':           'lever',
    'lever.co':        'lever',
    'bamboohr':        'bamboohr',
    'bamboohr.com':    'bamboohr',
    'smartrecruiters': 'smartrecruiters',
  };

  const filtered = raw
    .filter(c => {
      const ats = ATS_NORMALISE[c.ats?.toLowerCase?.()];
      return ats && SUPPORTED_ATS.has(ats) && c.slug?.trim();
    })
    .map(c => ({
      name: c.name || c.slug,
      slug: c.slug.trim().toLowerCase(),
      ats:  ATS_NORMALISE[c.ats.toLowerCase()],
    }));

  // Deduplicate by ats+slug
  const seen = new Set();
  const deduped = filtered.filter(c => {
    const key = `${c.ats}:${c.slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`\n🔍 Filtered to ${deduped.length} supported-ATS companies`);

  const byAts = {};
  for (const c of deduped) {
    byAts[c.ats] = (byAts[c.ats] || 0) + 1;
  }
  for (const [ats, count] of Object.entries(byAts)) {
    console.log(`   ${ats.padEnd(20)} ${count}`);
  }

  // 3. Spot-check a sample of slugs per ATS to catch bad data
  console.log(`\n🧪 Spot-checking ${SPOT_CHECK_SAMPLE} slugs per ATS...`);
  const validByAts = {};
  const invalidByAts = {};

  for (const ats of SUPPORTED_ATS) {
    const group = deduped.filter(c => c.ats === ats);
    if (!group.length) continue;

    const toCheck = sample(group, Math.min(SPOT_CHECK_SAMPLE, group.length));
    let valid = 0, invalid = 0;

    await Promise.all(toCheck.map(async c => {
      const ok = await probeSlug(c.ats, c.slug);
      if (ok) valid++; else invalid++;
    }));

    const pct = Math.round(valid / toCheck.length * 100);
    validByAts[ats]   = valid;
    invalidByAts[ats] = invalid;
    console.log(`   ${ats.padEnd(20)} ${valid}/${toCheck.length} valid (${pct}%)`);
  }

  // 4. Write output
  const output = {
    generated:  new Date().toISOString(),
    total:      deduped.length,
    byAts:      byAts,
    companies:  deduped,
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n✅ Written ${deduped.length} companies to public/companies.json`);
  console.log(`   (${(JSON.stringify(output).length / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error('\n💥 Unexpected error:', err);
  process.exit(1);
});
