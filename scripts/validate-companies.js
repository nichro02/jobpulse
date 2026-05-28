#!/usr/bin/env node
/**
 * validate-companies.js
 *
 * Run as part of CI (GitHub Actions) or locally:
 *   node scripts/validate-companies.js           # schema check only
 *   node scripts/validate-companies.js --probe   # schema + live API probe
 */

import fs   from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'public', 'companies.json');
const PROBE = process.argv.includes('--probe');
const PROBE_SAMPLE = 5; // per ATS when probing

const SUPPORTED_ATS = ['ashby', 'greenhouse', 'lever', 'bamboohr', 'smartrecruiters'];

const ATS_PROBE_URL = {
  ashby:           s => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
  greenhouse:      s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever:           s => `https://api.lever.co/v0/postings/${s}?mode=json`,
  bamboohr:        s => `https://${s}.bamboohr.com/jobs/embed2.php?version=1.0.0`,
  smartrecruiters: s => `https://api.smartrecruiters.com/v1/companies/${s}/postings`,
};

let errors = 0;
let warnings = 0;

function fail(msg)  { console.error(`  ❌ ${msg}`); errors++; }
function warn(msg)  { console.warn(`  ⚠️  ${msg}`); warnings++; }
function ok(msg)    { console.log(`  ✅ ${msg}`); }

async function probe(ats, slug) {
  const url = ATS_PROBE_URL[ats]?.(slug);
  if (!url) return false;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 7000);
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok;
  } catch { return false; }
}

function sample(arr, n) {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

async function main() {
  console.log('Validating public/companies.json\n');

  // 1. Parse
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch (e) {
    fail(`Could not parse JSON: ${e.message}`);
    process.exit(1);
  }

  // 2. Top-level schema
  if (!Array.isArray(raw.companies)) fail('Missing or non-array "companies" field');
  else ok(`Found ${raw.companies.length} companies`);

  // 3. Per-entry validation
  const seen = new Set();
  for (const [i, c] of (raw.companies || []).entries()) {
    const loc = `companies[${i}] "${c.name || c.slug}"`;
    if (!c.name?.trim())                         fail(`${loc}: missing "name"`);
    if (!c.slug?.trim())                         fail(`${loc}: missing "slug"`);
    if (!SUPPORTED_ATS.includes(c.ats))          fail(`${loc}: unsupported ats "${c.ats}"`);
    if (/[A-Z\s]/.test(c.slug))                  warn(`${loc}: slug should be lowercase with no spaces`);
    const key = `${c.ats}:${c.slug}`;
    if (seen.has(key))                           fail(`${loc}: duplicate ${key}`);
    seen.add(key);
  }

  if (errors) {
    console.log(`\n${errors} error(s), ${warnings} warning(s). Schema check FAILED.`);
    process.exit(1);
  }
  ok(`Schema valid — ${warnings} warning(s)`);

  // 4. Optional live probe
  if (PROBE) {
    console.log(`\nProbing ${PROBE_SAMPLE} slugs per ATS...\n`);
    for (const ats of SUPPORTED_ATS) {
      const group = raw.companies.filter(c => c.ats === ats);
      if (!group.length) continue;
      const toCheck = sample(group, Math.min(PROBE_SAMPLE, group.length));
      const results = await Promise.all(toCheck.map(c => probe(c.ats, c.slug)));
      const passed = results.filter(Boolean).length;
      const pct = Math.round(passed / toCheck.length * 100);
      if (pct < 50) warn(`${ats}: only ${passed}/${toCheck.length} slugs responding`);
      else ok(`${ats}: ${passed}/${toCheck.length} slugs responding (${pct}%)`);
    }
  }

  console.log(`\nDone. ${errors} error(s), ${warnings} warning(s).`);
  if (errors) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
