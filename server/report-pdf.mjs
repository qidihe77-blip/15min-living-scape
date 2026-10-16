import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderFacilityReportHtml } from './report.mjs';

const run = promisify(execFile);

// PDF output is only a browser print of the same independent report HTML.
export function reportPdfHtml(report) {
  return renderFacilityReportHtml(report);
}

export function createReportPdfExporter({ root, browserExecutable = process.env.PDF_BROWSER_EXECUTABLE, timeoutMs = 25000 } = {}) {
  const base = resolve(root, 'tmp', 'pdfs');
  const cache = new Map();
  const pending = new Map();
  let queue = Promise.resolve();
  let waiting = 0;

  async function executable() {
    const paths = [browserExecutable, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean);
    for (const path of paths) {
      try { await access(path); return path; } catch { /* try the next installed browser */ }
    }
    throw new Error('PDF_BROWSER_UNAVAILABLE');
  }

  async function make(report) {
    await mkdir(base, { recursive: true });
    const folder = await mkdtemp(join(base, 'report-'));
    try {
      const html = join(folder, 'report.html');
      const pdf = join(folder, 'report.pdf');
      await writeFile(html, reportPdfHtml(report), 'utf8');
      await run(await executable(), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-pdf-header-footer', '--user-data-dir=' + join(folder, 'browser-profile'), '--print-to-pdf=' + pdf, pathToFileURL(html).href], { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 });
      const data = await readFile(pdf);
      if (data.length < 1000 || data.length > 20 * 1024 * 1024 || data.subarray(0, 5).toString() !== '%PDF-') throw new Error('INVALID_PDF_OUTPUT');
      return data;
    } finally {
      const location = relative(base, resolve(folder));
      if (location && !location.startsWith('..') && !isAbsolute(location)) await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
    }
  }

  return { async export(report) {
    const key = createHash('sha256').update(JSON.stringify(report)).digest('hex');
    if (cache.has(key)) return cache.get(key);
    if (pending.has(key)) return pending.get(key);
    if (waiting >= 3) throw new Error('PDF_BUSY');
    waiting += 1;
    const work = queue.then(() => make(report));
    queue = work.catch(() => {});
    pending.set(key, work);
    try {
      const data = await work;
      if (cache.size >= 8) cache.delete(cache.keys().next().value);
      cache.set(key, data);
      return data;
    } finally {
      waiting -= 1;
      pending.delete(key);
    }
  } };
}
