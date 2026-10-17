const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function createServer() {
  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.normalize(path.join(ROOT, pathname));
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeFor(file) }).end(data);
    });
  });
}

if (require.main === module) {
  const server = createServer();
  // Keep idle keep-alive connections much longer than Node's 5 s default: a full parallel e2e run opens
  // tens of thousands of requests, and closing idle sockets every 5 s piles up TIME_WAIT ports on Windows
  // until Chromium fails a navigation with net::ERR_NO_BUFFER_SPACE (seen once in a stress run).
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 121000;
  server.listen(PORT, HOST, () => {
    console.log(`Serving ${ROOT} on http://${HOST}:${PORT}`);
  });
}

module.exports = { mimeFor, createServer, ROOT, HOST, PORT };
