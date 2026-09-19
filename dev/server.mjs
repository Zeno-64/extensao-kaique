// Servidor local do "WhatsApp falso" para testar o painel sem o WhatsApp real.
// Uso: npm run harness  →  abra http://localhost:5178
// Parâmetros: ?nomods=1 (sem módulos internos do WhatsApp)  ?nolink=1 (WhatsApp não trata links wa.me)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json' };
const PORT = Number(process.env.PORT) || 5178;

http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const rel = u.startsWith('/ext/') ? u.slice(5) : u === '/' ? 'dev/harness.html' : u.slice(1);
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Harness em http://localhost:${PORT}`));
