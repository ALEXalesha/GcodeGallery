// Обход папки: все файлы печати (src/core/formats.js) с подпапками или без. Только чтение
// каталогов и stat - сами файлы здесь не открываются. Скрытые папки и петли ссылок пропускаются.
'use strict';
const fs = require('fs');
const path = require('path');
const { isSupported, kindOf } = require('./formats');

const MAX_DEPTH = 32;

/**
 * @returns {Promise<Array<{path, rel, dir, name, kind, size, mtimeMs}>>} по пути
 */
async function scanFolder(root, { recursive = true, limit = 100000 } = {}) {
  const out = [];
  Object.defineProperty(out, 'skipped', { value: 0, writable: true, enumerable: false });   // файлы печати с именем не в UTF-8: их не открыть по имени - считаем и сообщаем (R11)
  const seen = new Set();
  const walk = async (dir, depth) => {
    if (depth > MAX_DEPTH || out.length >= limit) return;
    let real;
    try { real = await fs.promises.realpath(dir); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory(), isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try { const st = await fs.promises.stat(full); isDir = st.isDirectory(); isFile = st.isFile(); } catch { continue; }
      }
      if (!isDir && !isFile && e.name.includes('\uFFFD') && isSupported(e.name)) { out.skipped++; continue; }
      if (isDir) { if (recursive) await walk(full, depth + 1); continue; }
      if (!isFile || !isSupported(e.name)) continue;
      let st;
      try { st = await fs.promises.stat(full); } catch { if (e.name.includes('\uFFFD')) out.skipped++; continue; }
      const rel = path.relative(root, full);
      out.push({ path: full, rel, dir: path.dirname(rel) === '.' ? '' : path.dirname(rel), name: e.name, kind: kindOf(e.name), size: st.size, mtimeMs: Math.round(st.mtimeMs) });
    }
  };
  await walk(root, 0);
  return out;
}

/** Что изменилось между двумя обходами: добавлены, удалены, изменены (размер или время). */
function diffScans(before, after) {
  const old = new Map((before || []).map((f) => [f.path, f]));
  const now = new Map((after || []).map((f) => [f.path, f]));
  const added = [], removed = [], changed = [];
  for (const [p, f] of now) {
    const o = old.get(p);
    if (!o) added.push(f);
    else if (o.size !== f.size || o.mtimeMs !== f.mtimeMs) changed.push(f);
  }
  for (const [p, f] of old) if (!now.has(p)) removed.push(f);
  return { added, removed, changed, same: !added.length && !removed.length && !changed.length };
}

/**
 * Слежение за папкой: fs.watch (с подпапками) + редкий полный обход на случай, если событие
 * потерялось (сетевые диски). Пачка событий сливается за debounceMs в один обход.
 * onChange({added, removed, changed, files}) зовётся только когда что-то правда изменилось.
 */
function watchFolder(root, { recursive = true, debounceMs = 400, pollMs = 30000, onChange = () => {}, initial = [] } = {}) {
  let files = initial;
  let timer = null, running = false, again = false, closed = false;
  const rescan = async () => {
    if (closed) return;
    if (running) { again = true; return; }
    running = true;
    try {
      const next = await scanFolder(root, { recursive });
      const d = diffScans(files, next);
      files = next;
      if (!d.same && !closed) onChange(Object.assign(d, { files }));
    } finally {
      running = false;
      if (again && !closed) { again = false; schedule(); }
    }
  };
  const schedule = () => { if (closed) return; clearTimeout(timer); timer = setTimeout(rescan, debounceMs); };
  let watcher = null;
  try { watcher = fs.watch(root, { recursive, persistent: false }, schedule); watcher.on('error', () => {}); } catch { watcher = null; }
  const poll = pollMs > 0 ? setInterval(rescan, pollMs) : null;
  if (poll && poll.unref) poll.unref();
  return {
    rescan,
    get files() { return files; },
    close() { closed = true; clearTimeout(timer); if (poll) clearInterval(poll); if (watcher) try { watcher.close(); } catch { /* закрыт */ } },
  };
}

module.exports = { scanFolder, diffScans, watchFolder };
