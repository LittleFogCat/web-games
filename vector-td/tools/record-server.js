#!/usr/bin/env node
/* ============================================================
   VECTOR // 矢界防线 — local battle-record server (debug only)
   ------------------------------------------------------------
   - Serves the repository as static files, so the game can be
     opened at http://127.0.0.1:8787/vector-td/?debug=1
   - Accepts POST /__records with one record or { records: [...] }
   - Merges by record id, saves to tmp/records/records.json
   - GET /__records returns the merged array (debug inspection)
   No dependencies. Run: node vector-td/tools/record-server.js
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8787;
const LIMIT = 500;
const DATA_DIR = path.join(ROOT, 'tmp', 'records');
const DATA_FILE = path.join(DATA_DIR, 'records.json');
const NDJSON_FILE = path.join(DATA_DIR, 'records.ndjson');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadRecords() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((r) => r && r.v === 1 && r.id) : [];
  } catch (error) {
    return [];
  }
}

let records = loadRecords();

function saveRecords() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function appendNdjson(list) {
  if (!list.length) return;
  const text = list.map((r) => JSON.stringify(r)).join('\n') + '\n';
  fs.appendFileSync(NDJSON_FILE, text);
}

function shortRecord(record) {
  const date = new Date(record.finishedAt || Date.now());
  const stamp = date.toISOString().replace('T', ' ').slice(0, 19);
  return stamp + '  E1L' + (record.levelId || '?') + '  ' +
    (record.result === 'victory' ? '胜利' : '失败') + '  ' +
    (record.stars || 0) + '★  ' + Math.round(record.duration || 0) + 's' +
    (record.debug ? '  DEBUG' : '');
}

function mergeRecords(incoming) {
  const known = new Set(records.map((r) => r.id));
  const added = [];
  for (let i = 0; i < incoming.length; i++) {
    const record = incoming[i];
    if (!record || typeof record !== 'object' || record.v !== 1 || !record.id || !record.levelId) continue;
    if (known.has(record.id)) continue;
    known.add(record.id);
    records.push(record);
    added.push(record);
  }
  records.sort((a, b) => (Number(b.finishedAt) || 0) - (Number(a.finishedAt) || 0));
  if (records.length > LIMIT) records.length = LIMIT;
  if (added.length) {
    saveRecords();
    appendNdjson(added);
    added.forEach((record) => console.log('[record] ' + shortRecord(record)));
  }
  return added.length;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, callback) {
  const chunks = [];
  let size = 0;
  let failed = false;
  req.on('data', (chunk) => {
    if (failed) return;
    size += chunk.length;
    if (size > 4 * 1024 * 1024) {
      failed = true;
      callback(new Error('payload too large'));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (failed) return;
    callback(null, Buffer.concat(chunks).toString('utf8'));
  });
  req.on('error', (error) => {
    if (failed) return;
    failed = true;
    callback(error);
  });
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let file = path.resolve(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found: ' + pathname);
    return;
  }
  if (stat.isDirectory()) {
    file = path.join(file, 'index.html');
    try {
      stat = fs.statSync(file);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + pathname);
      return;
    }
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, 'http://' + HOST + ':' + PORT);
  let pathname;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  if (pathname === '/__records') {
    setCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      sendJson(res, 200, records);
      return;
    }
    if (req.method === 'POST') {
      readBody(req, (error, text) => {
        if (error) {
          sendJson(res, 413, { ok: false, error: error.message });
          return;
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch (parseError) {
          sendJson(res, 400, { ok: false, error: 'invalid json' });
          return;
        }
        const incoming = Array.isArray(body) ? body
          : Array.isArray(body && body.records) ? body.records
            : body && body.record ? [body.record]
              : [body];
        const added = mergeRecords(incoming);
        sendJson(res, 200, { ok: true, added: added, count: records.length });
      });
      return;
    }
    sendJson(res, 405, { ok: false, error: 'method not allowed' });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
    return;
  }
  serveStatic(req, res, pathname);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error('[record-server] port ' + PORT + ' is already in use. Set PORT=xxxx to use another port.');
  } else {
    console.error('[record-server]', error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log('[record-server] listening on http://' + HOST + ':' + PORT);
  console.log('[record-server] game:   http://' + HOST + ':' + PORT + '/vector-td/?debug=1');
  console.log('[record-server] records: ' + DATA_FILE + ' (' + records.length + ' loaded)');
  console.log('[record-server] API:     POST/GET http://' + HOST + ':' + PORT + '/__records');
});
