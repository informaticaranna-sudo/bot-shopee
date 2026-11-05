// Servidor sem dependências externas. Requer Node 18 ou superior.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const API_URL = process.env.SHOPEE_API_URL || 'https://open-api.affiliate.shopee.com.br/graphql';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || '';
const DATA_DIR = path.join(__dirname, 'data');
const CFG_FILE = path.join(DATA_DIR, 'config.json');
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const HOSTS_OK = ['shopee.com.br', 'shp.ee', 'shope.ee'];

// ---------- credenciais ----------
function loadCfg() {
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch {}
  return {
    appId: process.env.SHOPEE_APP_ID || c.appId || '',
    secret: process.env.SHOPEE_SECRET || c.secret || ''
  };
}
function saveCfg(appId, secret) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const old = loadCfg();
  const cfg = { appId: appId || old.appId, secret: secret || old.secret };
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg), { mode: 0o600 });
}
const mask = s => (s ? s.slice(0, 3) + '•••' + s.slice(-2) : '');

// ---------- senha do painel ----------
function authed(req) {
  if (!PANEL_PASSWORD) return true;
  const got = Buffer.from(String(req.headers['x-panel-password'] || ''));
  const want = Buffer.from(PANEL_PASSWORD);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ---------- link -> ids ----------
const hostOk = u => { try { const h = new URL(u).hostname; return HOSTS_OK.some(d => h === d || h.endsWith('.' + d)); } catch { return false; } };
function parseIds(u) {
  let m = u.match(/i\.(\d+)\.(\d+)/);
  if (m) return { shopId: m[1], itemId: m[2] };
  try {
    m = new URL(u).pathname.match(/\/(\d{5,})\/(\d{5,})(?:\/|$)/);
    if (m) return { shopId: m[1], itemId: m[2] };
  } catch {}
  return null;
}
async function resolveLink(input) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Cole um link completo começando com https://');
  if (!hostOk(url)) throw new Error('O link precisa ser da Shopee.');
  for (let i = 0; i < 6; i++) {
    const ids = parseIds(url);
    if (ids) return ids;
    const r = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA } });
    const loc = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && loc) {
      url = new URL(loc, url).href;
      if (!hostOk(url)) break;
    } else break;
  }
  const ids = parseIds(url);
  if (!ids) throw new Error('Não consegui achar o código do produto nesse link. Tente colar o link completo do produto.');
  return ids;
}

// ---------- API de afiliados ----------
async function shopeeQuery(query) {
  const { appId, secret } = loadCfg();
  if (!appId || !secret) throw new Error('Configure o AppID e o Secret da Shopee primeiro.');
  const payload = JSON.stringify({ query });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHash('sha256').update(appId + ts + payload + secret).digest('hex');
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `SHA256 Credential=${appId}, Timestamp=${ts}, Signature=${sig}`
    },
    body: payload
  });
  const j = await r.json().catch(() => ({}));
  if (j.errors && j.errors.length) throw new Error('Shopee: ' + j.errors.map(e => e.message).join(' | '));
  if (!r.ok) throw new Error('A Shopee respondeu com erro ' + r.status);
  return j.data;
}
const brl = n => Number(n).toFixed(2).replace('.', ',');

async function buscarProduto(link) {
  const { shopId, itemId } = await resolveLink(link);
  const data = await shopeeQuery(`{
    productOfferV2(itemId: ${itemId}, shopId: ${shopId}) {
      nodes { itemId productName priceMin priceMax priceDiscountRate offerLink productLink shopName imageUrl }
    }
  }`);
  const p = data && data.productOfferV2 && data.productOfferV2.nodes && data.productOfferV2.nodes[0];
  if (!p) throw new Error('A Shopee não devolveu esse produto. Ele pode não participar do programa de afiliados.');
  const por = parseFloat(p.priceMin);
  const taxa = parseFloat(p.priceDiscountRate) || 0;
  const de = taxa > 0 && taxa < 100 ? por / (1 - taxa / 100) : por;
  return {
    nome: p.productName,
    por: brl(por),
    de: brl(de),
    desconto: taxa,
    link: p.offerLink || p.productLink || link,
    imagem: p.imageUrl || '',
    loja: p.shopName || ''
  };
}

// ---------- http ----------
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((ok, no) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 20000) { req.destroy(); no(new Error('grande')); } });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
  });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
    }
    if (url.pathname === '/api/status') {
      const c = loadCfg();
      return send(res, 200, { needsPassword: !!PANEL_PASSWORD, authed: authed(req), configured: !!(c.appId && c.secret), appId: mask(c.appId) });
    }
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { erro: 'Não encontrado' });
    if (!authed(req)) return send(res, 401, { erro: 'Senha do painel incorreta.' });

    if (req.method === 'POST' && url.pathname === '/api/config') {
      const b = await body(req);
      saveCfg(String(b.appId || '').trim(), String(b.secret || '').trim());
      const c = loadCfg();
      return send(res, 200, { ok: true, configured: !!(c.appId && c.secret), appId: mask(c.appId) });
    }
    if (req.method === 'GET' && url.pathname === '/api/imagem') {
      const u = url.searchParams.get('u') || '';
      let h = '';
      try { h = new URL(u).hostname; } catch {}
      if (!/^https:\/\//.test(u) || !/(^|\.)(susercontent\.com|shopee\.com\.br|shopee\.com)$/.test(h)) return send(res, 400, { erro: 'Imagem não permitida' });
      const r = await fetch(u, { headers: { 'user-agent': UA }, redirect: 'error' });
      if (!r.ok) return send(res, 400, { erro: 'Não consegui baixar a imagem' });
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 8e6) return send(res, 400, { erro: 'Imagem muito grande' });
      res.writeHead(200, { 'content-type': r.headers.get('content-type') || 'image/jpeg' });
      return res.end(buf);
    }
    if (req.method === 'POST' && url.pathname === '/api/produto') {
      const b = await body(req);
      return send(res, 200, await buscarProduto(String(b.link || '')));
    }
    send(res, 404, { erro: 'Não encontrado' });
  } catch (e) {
    send(res, 400, { erro: e.message || 'Erro inesperado' });
  }
}).listen(PORT, () => console.log(`Painel rodando em http://localhost:${PORT}`));
