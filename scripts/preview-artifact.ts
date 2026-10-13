/**
 * Serves the built Artifact the way claude.ai does: the page content wrapped
 * in a bare document, with snapshot.json next to it.
 *
 *   npm run preview:artifact [-- --port 3101 --dir dist/artifact]
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const dir = path.resolve(arg('--dir', 'dist/artifact'));
const port = Number(arg('--port', '3101'));

// The same skeleton the Artifact host wraps around a published page.
const HEAD = '<!doctype html><html><head><meta charset="utf8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/health') return void res.writeHead(200).end('ok');
    if (/^\/lang-[a-z]+\.json$/.test(url.pathname)) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return void res.end(await readFile(path.join(dir, url.pathname.slice(1))));
    }
    if (url.pathname === '/snapshot.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return void res.end(await readFile(path.join(dir, 'snapshot.json')));
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return void res.end(`${HEAD}${await readFile(path.join(dir, 'signal-ai.html'), 'utf8')}</body></html>`);
    }
    res.writeHead(404).end('Not found');
  } catch {
    res.writeHead(503).end('The Artifact has not been built yet. Run "npm run build:artifact".');
  }
}).listen(port, () => console.log(`Artifact preview on http://localhost:${port}`));
