'use strict';
/*
 * BonVol – agent de surveillance des prix de vols
 * 1. Récupère les prix réels via l'API Travelpayouts (Aviasales)
 * 2. Garde un historique quotidien par trajet
 * 3. Détecte les vraies baisses (prix actuel nettement sous le prix habituel)
 * 4. Envoie une alerte Telegram
 * 5. Génère le site statique (pages SEO par trajet + sitemap) dans /docs
 *
 * Lancer en démo :   MOCK=1 node agent.js
 * Lancer en réel :   TP_TOKEN=xxx TP_MARKER=yyy node agent.js
 */
const fs = require('fs');
const path = require('path');

const CFG = {
  token: process.env.TP_TOKEN || '',
  marker: process.env.TP_MARKER || '',
  trs: process.env.TP_TRS || '',       // numéro du projet Travelpayouts (« source= » dans l'adresse du tableau de bord)
  tgBot: process.env.TG_BOT_TOKEN || '',
  tgChat: process.env.TG_CHAT_ID || '',
  tgPublic: process.env.TG_PUBLIC_LINK || '',
  tgTest: process.env.TG_TEST === '1',   // case « Envoyer un message de test » du bouton Run workflow
  siteUrl: (process.env.SITE_URL || 'https://exemple.com').replace(/\/$/, ''),
  siteName: process.env.SITE_NAME || 'BonVol',
  tz: process.env.SITE_TZ || 'Europe/Paris',
  mock: process.env.MOCK === '1',
  currency: 'eur',
  monthsAhead: 3,      // mois de départ surveillés
  dealRatio: 0.75,     // bonne affaire = prix <= 75 % du prix habituel
  minHistory: 7,       // jours d'historique avant de déclarer une bonne affaire
  freshHours: 6,       // au-delà, un prix n'est plus affiché comme actuel
  legal: {             // mentions légales (obligatoires dès qu'on touche des commissions)
    editor: process.env.LEGAL_EDITOR || '',
    address: process.env.LEGAL_ADDRESS || '',
    siren: process.env.LEGAL_SIREN || '',
    phone: process.env.LEGAL_PHONE || '',
    email: process.env.LEGAL_EMAIL || '',
    hostName: process.env.HOST_NAME || 'GitHub, Inc.',
    hostAddress: process.env.HOST_ADDRESS || '88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, États-Unis',
    hostPhone: process.env.HOST_PHONE || '',   // GitHub ne publie pas de numéro : on affiche alors son formulaire
    hostContact: process.env.HOST_CONTACT || 'https://support.github.com/contact',
  },
};

const ROOT = __dirname;
// La démo écrit à part : ses faux prix ne doivent jamais servir d'historique en production.
const HISTORY_FILE = path.join(ROOT, 'data', CFG.mock ? 'history.mock.json' : 'history.json');
const OUT = path.join(ROOT, CFG.mock ? 'demo' : 'docs');
const routes = JSON.parse(fs.readFileSync(path.join(ROOT, 'routes.json'), 'utf8'));

// Noms prioritaires (accents, noms courts) ; toutes les autres compagnies viennent de la base Travelpayouts.
const AIRLINES = {
  AF: 'Air France', AT: 'Royal Air Maroc', AH: 'Air Algérie', TU: 'Tunisair',
  HF: "Air Côte d'Ivoire", SN: 'Brussels Airlines', TO: 'Transavia', V7: 'Volotea',
  TK: 'Turkish Airlines', AC: 'Air Canada', SS: 'Corsair', ET: 'Ethiopian Airlines',
  KQ: 'Kenya Airways', HC: 'Air Sénégal', FR: 'Ryanair', U2: 'easyJet',
};
const AIRLINES_URL = 'https://api.travelpayouts.com/data/en/airlines.json';
const airlineDb = {};

/* ---------- utilitaires ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const slugOf = r => `${norm(r.fromName)}-${norm(r.toName)}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => `${Math.round(n)} €`;
const dayKey = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: CFG.tz }); // AAAA-MM-JJ, heure de Paris
const frDate = (iso, o = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Date(iso).toLocaleDateString('fr-FR', { timeZone: CFG.tz, ...o });
const frTime = iso => new Date(iso)
  .toLocaleTimeString('fr-FR', { timeZone: CFG.tz, hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
const airlineName = c => AIRLINES[c] || airlineDb[c] || c || 'Compagnie non précisée';
// Dans GitHub Actions, ces messages s'affichent en annotations sur la page du lancement.
const report = (level, msg) => console.log(process.env.GITHUB_ACTIONS === 'true' ? `::${level}::${msg}` : msg);
const stopsText = n => (n === 0 ? 'direct' : n === 1 ? '1 escale' : `${n} escales`);
function median(a) {
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function monthsAhead() {
  const d = new Date(), out = [];
  for (let i = 0; i < CFG.monthsAhead; i++) {
    out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  }
  return out;
}
function affLink(o) {
  if (!o || !o.link) return '#';
  // Redirection Travelpayouts : compte le clic, le rattache au projet (trs), puis renvoie sur Aviasales avec le marker.
  const q = new URLSearchParams({ marker: CFG.marker, ...(CFG.trs && { trs: CFG.trs }), p: '4114',
    u: `https://www.aviasales.com${o.link}`, campaign_id: '100' });
  return `https://tp.media/r?${q}`;
}

/* ---------- données ---------- */
async function fetchOffers(r) {
  const offers = [];
  for (const month of monthsAhead()) {
    const url = new URL('https://api.travelpayouts.com/aviasales/v3/prices_for_dates');
    url.search = new URLSearchParams({
      origin: r.from, destination: r.to, departure_at: month, one_way: 'true',
      sorting: 'price', currency: CFG.currency, limit: '10', token: CFG.token,
    }).toString();
    try {
      const res = await fetch(url);
      if (!res.ok) { report('warning', `API ${res.status} : ${r.from}-${r.to} ${month}`); continue; }
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) offers.push(...json.data);
    } catch (e) {
      report('warning', `Erreur réseau ${r.from}-${r.to} : ${e.message}`);
    }
    await sleep(400); // reste poli avec l'API
  }
  return offers.filter(o => o.price > 0).sort((a, b) => a.price - b.price);
}

function mockOffers(r, i) {
  const base = r.mockBase || 300;
  const isDeal = i % 4 === 0;
  const price = Math.round(base * (isDeal ? 0.62 : 0.95 + Math.random() * 0.15));
  const dep = new Date(Date.now() + (20 + i * 3) * 864e5);
  return [{ price, airline: ['AF', 'AT', 'AH', 'TU', 'HF', 'SN'][i % 6], departure_at: dep.toISOString(),
    transfers: i % 3 === 0 ? 0 : 1, link: '' }];
}
function mockHistory(r) {
  const base = r.mockBase || 300, out = [];
  for (let d = 45; d >= 1; d--) {
    out.push({ date: dayKey(new Date(Date.now() - d * 864e5)), price: Math.round(base * (0.9 + Math.random() * 0.25)) });
  }
  return out;
}

async function loadAirlines() {
  try {
    const res = await fetch(AIRLINES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const a of await res.json()) if (a.code) airlineDb[a.code] = a.name || a.name_translations?.en || '';
  } catch (e) { report('warning', `Noms des compagnies indisponibles (${e.message}) : les codes seront affichés`); }
}

const loadHistory = () => (fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : {});
function saveHistory(h) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 1));
}

/* ---------- alertes ---------- */
function shouldAlert(h) {
  if (!h.lastAlert) return true;
  const age = Date.now() - new Date(h.lastAlert.at);
  return age > 24 * 3600e3 || h.best.price < h.lastAlert.price * 0.95;
}
async function tgSend(text) {
  if (!CFG.tgBot || !CFG.tgChat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${CFG.tgBot}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CFG.tgChat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) report('error', `Telegram refuse le message : ${(await res.json().catch(() => ({}))).description || res.status}`);
    return res.ok;
  } catch (e) { report('error', `Telegram : ${e.message}`); return false; }
}
async function sendTelegram(it) {
  const b = it.h.best;
  const text = [
    `✈️ <b>${esc(it.r.fromName)} → ${esc(it.r.toName)} : ${eur(b.price)}</b> (aller simple)`,
    `−${it.deal} % par rapport au prix habituel (${eur(it.usual)})`,
    `Départ le ${frDate(b.departure_at)}, ${stopsText(b.transfers)}, ${esc(airlineName(b.airline))}`,
    `<a href="${esc(affLink(b))}">Voir ce vol</a>`,
    `<i>Prix trouvé lors de recherches récentes : il peut avoir changé, le prix final est confirmé au clic.</i>`,
  ].join('\n');
  return tgSend(text);
}

/* ---------- site ---------- */
const CSS = `
:root{--bg:#EEF2F7;--surface:#FFFFFF;--ink:#14213D;--muted:#55627A;--line:#CFD8E3;--good:#17804F;--good-bg:#DDF2E7;
--board:#10203A;--board-ink:#F5B700;--board-soft:#C9D3E0;--board-cell:#1A2E50;--board-line:#0A1628;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0B1424;--surface:#13203A;--ink:#E6ECF4;--muted:#9AA8BD;--line:#24324A;
--good:#4CD08F;--good-bg:#123A2A;--board:#060D19;--board-cell:#13233F;--board-line:#02060D;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Figtree,system-ui,sans-serif}
a{color:inherit}
:focus-visible{outline:3px solid var(--board-ink);outline-offset:2px}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
header.top{display:flex;justify-content:space-between;align-items:center;padding:20px 0}
.logo{font:700 26px/1 "Barlow Condensed",sans-serif;text-decoration:none;letter-spacing:.5px}
.logo span{display:inline-block;background:var(--board);color:var(--board-ink);padding:2px 7px;margin-right:4px;border-radius:3px}
.tg{font-weight:600;text-decoration:none;border:1.5px solid var(--ink);padding:7px 14px;border-radius:999px;font-size:15px}
h1{font:700 clamp(36px,6vw,64px)/1.02 "Barlow Condensed",sans-serif;margin:28px 0 12px;max-width:16ch}
.lede{color:var(--muted);font-size:19px;max-width:56ch;margin:0 0 32px}
.demo{background:#FFE7A3;color:#3B2A00;padding:10px 14px;border-radius:6px;font-size:14px;margin:12px 0 0}
.board{background:var(--board);color:var(--board-soft);border-radius:10px;padding:18px 18px 8px;box-shadow:0 18px 40px -24px rgba(6,13,25,.6)}
.board-head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px;
font:600 15px/1 "Barlow Condensed",sans-serif;letter-spacing:1px;color:var(--board-soft);padding:0 6px 14px;border-bottom:2px solid var(--board-line)}
.board-head b{color:var(--board-ink);font-size:22px;letter-spacing:.5px}
.row,.row-h{display:grid;grid-template-columns:1fr 1.3fr 9.5em 1.2fr;gap:14px;align-items:center;padding:12px 6px;
font:600 21px/1.2 "Barlow Condensed",sans-serif;text-decoration:none;color:var(--board-soft)}
.row-h{font-size:13px;letter-spacing:1px;padding:12px 6px 4px;color:#7D8BA3}
.row{border-bottom:1px solid var(--board-line)}
.row:hover{background:var(--board-cell)}
.row .to{color:#fff}
.flap{display:inline-flex;gap:3px}
.flap i{font-style:normal;display:inline-grid;place-items:center;width:1.05em;height:1.45em;background:var(--board-cell);
color:var(--board-ink);border-radius:3px;font-size:24px;
background:linear-gradient(var(--board-cell) 49%,var(--board-line) 49% 52%,var(--board-cell) 52%)}
.status{font-size:17px;justify-self:end;text-align:right}
.status.deal{color:#4CD08F}
.status.wait{color:#7D8BA3}
.note{color:var(--muted);font-size:14px;margin:14px 0 0;max-width:70ch}
section.how{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin:64px 0}
section.how h2{font:700 24px/1.1 "Barlow Condensed",sans-serif;margin:0 0 6px}
section.how p{margin:0;color:var(--muted)}
.cta-tg{background:var(--board);color:var(--board-soft);border-radius:10px;padding:28px;margin:0 0 64px;display:flex;
justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap}
.cta-tg h2{font:700 30px/1.05 "Barlow Condensed",sans-serif;margin:0;color:#fff}
.btn{display:inline-block;background:var(--board-ink);color:#10203A;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px}
.crumb{font-size:15px;color:var(--muted)}
.offer{display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:center;margin:8px 0 12px}
.offer .flap i{font-size:44px}
.offer dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:4px 14px;color:var(--board-soft)}
.offer dt{color:#7D8BA3}.offer dd{margin:0;color:#fff}
.badge{display:inline-block;background:var(--good-bg);color:var(--good);font-weight:700;padding:3px 10px;border-radius:4px;margin:0 0 10px}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:22px;margin:28px 0}
.panel h2{font:700 26px/1.1 "Barlow Condensed",sans-serif;margin:0 0 12px}
.chart{width:100%;height:auto;color:var(--ink)}
.chart .dot{fill:var(--good)}
.chart text{fill:var(--muted);font:15px Figtree,sans-serif}
.chart .lbl{fill:var(--good);font-weight:700}
.faq h3{font-size:18px;margin:18px 0 4px}.faq p{margin:0;color:var(--muted)}
footer{border-top:1px solid var(--line);padding:24px 0 40px;color:var(--muted);font-size:14px}
@media (max-width:720px){
 .row,.row-h{grid-template-columns:1fr auto;row-gap:2px}
 .row .from{grid-column:1;font-size:15px;color:#7D8BA3}
 .row .to{grid-column:1;grid-row:2}
 .row .flap{grid-column:2;grid-row:1 / span 2;justify-self:end}
 .row .status{grid-column:1 / -1;justify-self:start;text-align:left}
 .row-h{display:none}
 section.how{grid-template-columns:1fr;gap:20px}
 .offer{grid-template-columns:1fr}
}`;

const flap = n => `<span class="flap" aria-label="${eur(n)}">${[...`${Math.round(n)}€`].map(c => `<i aria-hidden="true">${c}</i>`).join('')}</span>`;

function layout({ title, desc, canonical, body, jsonld = '', root = './' }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Figtree:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>${jsonld}</head><body><div class="wrap">
<header class="top"><a class="logo" href="${root}"><span>✈</span>${esc(CFG.siteName)}</a>
${CFG.tgPublic ? `<a class="tg" href="${esc(CFG.tgPublic)}">Recevoir les alertes</a>` : ''}</header>
${CFG.mock ? '<p class="demo">Mode démonstration : les prix affichés sont fictifs. En production, ils viennent de l\'API Travelpayouts.</p>' : ''}
${body}
<footer>Les prix proviennent de recherches récentes et sont vérifiés au moment du clic chez le partenaire de réservation.
Certains liens sont affiliés : si vous réservez, ${esc(CFG.siteName)} touche une commission, sans surcoût pour vous.
<br><a href="${root}mentions-legales.html">Mentions légales</a></footer>
</div></body></html>`;
}

function statusHtml(it) {
  if (!it.h.best || !it.fresh) return '<span class="status wait">En attente</span>';
  if (it.deal) return `<span class="status deal">Bonne affaire −${it.deal} %</span>`;
  if (!it.usual) return '<span class="status wait">Historique en cours</span>';
  return '<span class="status">Prix habituel</span>';
}

function buildIndex(items, updated) {
  const sorted = [...items].sort((a, b) => (b.deal || 0) - (a.deal || 0));
  const rows = sorted.map(it => `<a class="row" href="vols/${it.slug}.html">
<span class="from">${esc(it.r.fromName)}</span><span class="to">${esc(it.r.toName)}</span>
${it.h.best && it.fresh ? flap(it.h.best.price) : '<span class="flap"><i>–</i><i>–</i><i>–</i></span>'}
${statusHtml(it)}</a>`).join('');
  const body = `<h1>Vols pas chers vers l'Afrique et le Maghreb</h1>
<p class="lede">Notre agent compare les prix chaque heure sur ${items.length} trajets et signale les vraies baisses dès qu'il les repère.</p>
<div class="board" role="region" aria-label="Tableau des prix">
<div class="board-head"><b>Départs surveillés</b><span>Mis à jour le ${frDate(updated, { day: 'numeric', month: 'long' })} à ${frTime(updated)}</span></div>
<div class="row-h"><span>Départ</span><span>Destination</span><span>Aller simple dès</span><span style="justify-self:end">Statut</span></div>
${rows}</div>
<p class="note">Une bonne affaire est un prix au moins 25 % sous le prix habituel du trajet, calculé sur notre historique.</p>
<section class="how">
<div><h2>On surveille</h2><p>Chaque heure, les prix de chaque trajet sont relevés sur les trois prochains mois.</p></div>
<div><h2>On compare</h2><p>Chaque prix est comparé à l'historique du trajet pour savoir s'il est vraiment bas.</p></div>
<div><h2>On vous prévient</h2><p>Les vraies baisses partent aussitôt sur notre canal d'alertes.</p></div>
</section>
${CFG.tgPublic ? `<div class="cta-tg"><h2>Les bonnes affaires arrivent d'abord sur Telegram</h2><a class="btn" href="${esc(CFG.tgPublic)}">Rejoindre le canal</a></div>` : ''}`;
  return layout({
    title: `Vols pas chers vers l'Afrique et le Maghreb | ${CFG.siteName}`,
    desc: `Prix des vols vers Dakar, Abidjan, Alger, Casablanca, Tunis et plus, surveillés chaque heure. Alertes sur les vraies baisses.`,
    canonical: `${CFG.siteUrl}/`, body,
  });
}

function chartSvg(days) {
  if (days.length < 2) return '<p>L\'historique se construit : revenez dans quelques jours.</p>';
  const W = 420, H = 220, P = 24, ps = days.map(d => d.price);
  const min = Math.min(...ps), max = Math.max(...ps);
  const x = i => P + i * (W - 2 * P) / (days.length - 1);
  const y = v => (max === min ? H / 2 : H - P - 18 - (v - min) * (H - 2 * P - 30) / (max - min));
  const pts = days.map((d, i) => `${x(i).toFixed(1)},${y(d.price).toFixed(1)}`).join(' ');
  const iMin = ps.indexOf(min), n = days.length;
  const [anchor, lx, ly] = iMin > n * 0.7 ? ['end', x(iMin) - 12, y(min) + 5]
    : iMin < n * 0.3 ? ['start', x(iMin) + 12, y(min) + 5] : ['middle', x(iMin), y(min) - 12];
  const short = d => frDate(d, { day: 'numeric', month: 'short' });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prix le plus bas par jour, de ${eur(min)} à ${eur(max)}">
<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
<circle class="dot" cx="${x(iMin)}" cy="${y(min)}" r="5"/>
<text class="lbl" x="${lx}" y="${ly}" text-anchor="${anchor}">${eur(min)} le ${short(days[iMin].date)}</text>
<text x="${P}" y="${H - 6}">${short(days[0].date)}</text>
<text x="${W - P}" y="${H - 6}" text-anchor="end">${short(days[days.length - 1].date)}</text></svg>`;
}

function buildRoute(it) {
  const { r, h } = it, b = h.best, name = `${r.fromName} → ${r.toName}`;
  const faq = [
    [`Quel est le prix habituel d'un vol ${name} ?`, it.usual
      ? `Sur notre historique récent, le prix habituel d'un aller simple ${name} est d'environ ${eur(it.usual)}.`
      : `Notre historique est encore en construction pour ce trajet.`],
    [`Quel est le vol ${name} le moins cher constaté ?`, it.lowest
      ? `Le prix le plus bas relevé par notre agent est de ${eur(it.lowest.price)}, le ${frDate(it.lowest.date)}. Ce prix n'est pas forcément encore disponible.`
      : `Aucun prix relevé pour l'instant.`],
    [`À quelle fréquence les prix sont-ils mis à jour ?`, `Notre agent relève les prix de ce trajet chaque heure. Ils proviennent de recherches récentes et peuvent avoir changé : le prix final est confirmé au moment du clic chez le partenaire de réservation.`],
  ];
  const jsonld = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  })}</script>`;
  const offer = b && it.fresh ? `<div class="board"><div class="offer">${flap(b.price)}<div>
${it.deal ? `<span class="badge">−${it.deal} % sous le prix habituel</span>` : ''}
<dl><dt>Départ</dt><dd>${frDate(b.departure_at)}</dd><dt>Vol</dt><dd>${stopsText(b.transfers)}, ${esc(airlineName(b.airline))}</dd>
<dt>Prix</dt><dd>trouvé lors de recherches récentes, confirmé au clic</dd></dl></div></div>
<p style="margin:0 6px 14px"><a class="btn" href="${esc(affLink(b))}" rel="sponsored nofollow">Voir ce vol</a></p></div>`
    : `<div class="panel"><p>Aucun prix actuel pour ce trajet. L'agent le surveille et l'affichera dès qu'il en trouve un.</p></div>`;
  const body = `<p class="crumb"><a href="../">Tous les trajets</a></p>
<h1>Vol pas cher ${esc(name)}</h1>
<p class="lede">Le prix le plus bas trouvé récemment pour un aller simple, et son évolution jour après jour.</p>
${offer}
<div class="panel"><h2>Le prix le plus bas, jour par jour</h2>${chartSvg(h.days.slice(-60))}</div>
<div class="panel faq"><h2>Questions fréquentes</h2>${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}</div>`;
  return layout({
    title: `Vol pas cher ${name}${b && it.fresh ? ` dès ${eur(b.price)}` : ''} | ${CFG.siteName}`,
    desc: `Prix des vols ${name} surveillés chaque heure, historique des prix et alertes sur les vraies baisses.`,
    canonical: `${CFG.siteUrl}/vols/${it.slug}.html`, body, jsonld, root: '../',
  });
}

function buildLegal() {
  const L = CFG.legal, v = s => (s ? esc(s) : '<em>[à compléter]</em>');
  const missing = Object.entries({ LEGAL_EDITOR: L.editor, LEGAL_ADDRESS: L.address, LEGAL_SIREN: L.siren,
    LEGAL_PHONE: L.phone, LEGAL_EMAIL: L.email }).filter(([, s]) => !s).map(([k]) => k);
  if (missing.length && !CFG.mock) report('warning', `Mentions légales incomplètes, variables manquantes : ${missing.join(', ')}`);
  const body = `<h1>Mentions légales</h1>
<div class="panel"><h2>Éditeur du site</h2>
<p>${v(L.editor)}<br>${v(L.address)}<br>SIREN : ${v(L.siren)}<br>Téléphone : ${v(L.phone)}<br>E-mail : ${v(L.email)}</p>
<p>Directeur de la publication : ${v(L.editor)}</p></div>
<div class="panel"><h2>Hébergeur</h2>
<p>${v(L.hostName)}<br>${v(L.hostAddress)}<br>${L.hostPhone ? `Téléphone : ${esc(L.hostPhone)}`
    : `Contact : <a href="${esc(L.hostContact)}">${esc(L.hostContact.replace(/^https?:\/\//, ''))}</a>`}</p></div>
<div class="panel"><h2>Prix affichés</h2>
<p>Les prix proviennent de recherches récentes effectuées sur Aviasales. Ils peuvent avoir changé depuis : le prix et la disponibilité sont confirmés au moment du clic chez le partenaire de réservation.</p></div>
<div class="panel"><h2>Liens affiliés</h2>
<p>Certains liens sont affiliés : si vous réservez après un clic, ${esc(CFG.siteName)} touche une commission, sans surcoût pour vous.</p></div>
<div class="panel"><h2>Données personnelles</h2>
<p>Ce site ne dépose aucun cookie et ne mesure pas l'audience. Les polices de caractères sont chargées depuis Google Fonts : votre navigateur contacte alors les serveurs de Google.</p></div>`;
  return layout({
    title: `Mentions légales | ${CFG.siteName}`, desc: `Mentions légales du site ${CFG.siteName}.`,
    canonical: `${CFG.siteUrl}/mentions-legales.html`, body,
  });
}

function buildSite(items) {
  const now = new Date().toISOString();
  fs.mkdirSync(path.join(OUT, 'vols'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), buildIndex(items, now));
  for (const it of items) fs.writeFileSync(path.join(OUT, 'vols', `${it.slug}.html`), buildRoute(it));
  fs.writeFileSync(path.join(OUT, 'mentions-legales.html'), buildLegal());
  const urls = [`${CFG.siteUrl}/`, ...items.map(it => `${CFG.siteUrl}/vols/${it.slug}.html`)];
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${u}</loc><lastmod>${dayKey()}</lastmod></url>`).join('')}</urlset>`);
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${CFG.siteUrl}/sitemap.xml\n`);
}

/* ---------- programme principal ---------- */
async function main() {
  if (!CFG.mock && !CFG.token) {
    console.error('TP_TOKEN manquant. Pour une démo : MOCK=1 node agent.js');
    process.exit(1);
  }
  if (CFG.tgTest) {
    const ok = await tgSend(`✅ Test ${esc(CFG.siteName)} : le bot peut publier dans ce canal. Les alertes arriveront ici.`);
    if (ok) report('notice', 'Telegram : message de test envoyé');
    else if (!CFG.tgBot || !CFG.tgChat) report('error', 'Telegram : TG_BOT_TOKEN ou TG_CHAT_ID manquant');
  }
  if (!CFG.mock) await loadAirlines();
  const history = loadHistory(), today = dayKey(), items = [];
  for (const [i, r] of routes.entries()) {
    const key = `${r.from}-${r.to}`;
    const h = (history[key] ||= { days: [], best: null, lastAlert: null });
    if (CFG.mock && h.days.length === 0) h.days = mockHistory(r);

    const offers = CFG.mock ? mockOffers(r, i) : await fetchOffers(r);
    const o = offers[0];
    if (o) {
      h.best = { price: o.price, airline: o.airline, departure_at: o.departure_at,
        transfers: o.transfers ?? 0, link: o.link || '', seenAt: new Date().toISOString() };
      const t = h.days.find(d => d.date === today);
      if (t) t.price = Math.min(t.price, o.price); else h.days.push({ date: today, price: o.price });
      h.days = h.days.slice(-120);
    }

    const past = h.days.filter(d => d.date !== today).map(d => d.price);
    const usual = past.length >= CFG.minHistory ? median(past) : null;
    const fresh = !!h.best && Date.now() - new Date(h.best.seenAt) < CFG.freshHours * 3600e3;
    const deal = fresh && usual && h.best.price <= usual * CFG.dealRatio
      ? Math.round((1 - h.best.price / usual) * 100) : 0;
    const lowest = h.days.reduce((m, d) => (!m || d.price < m.price ? d : m), null);
    const it = { r, key, slug: slugOf(r), h, usual, deal, fresh, lowest };
    items.push(it);

    if (deal && shouldAlert(h) && await sendTelegram(it)) {
      h.lastAlert = { price: h.best.price, at: new Date().toISOString() };
    }
    console.log(`${key.padEnd(8)} ${o ? eur(o.price).padStart(6) : '   –  '}${deal ? `  bonne affaire −${deal} %` : ''}`);
  }
  const noPrice = items.filter(it => !it.fresh).map(it => it.key);
  if (noPrice.length) report('warning', `Pas de prix actuel pour : ${noPrice.join(', ')}`);
  saveHistory(history);
  buildSite(items);
  console.log(`Site généré dans ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
