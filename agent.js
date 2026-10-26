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

/* ---------- partenaires (hôtels, voitures, activités, restaurants) ---------- */
// Pour chaque onglet du module de recherche, le premier partenaire que Travelpayouts accepte de convertir en lien affilié est retenu.
const PARTNERS_FILE = path.join(ROOT, 'data', 'partners.json');
const BRANDS = {
  'Booking.com': 'https://www.booking.com/', Agoda: 'https://www.agoda.com/', 'Trip.com': 'https://www.trip.com/', Expedia: 'https://www.expedia.com/',
  'Hotels.com': 'https://www.hotels.com/', Vrbo: 'https://www.vrbo.com/', 'Vio.com': 'https://www.vio.com/', Hostelworld: 'https://www.hostelworld.com/',
  DiscoverCars: 'https://www.discovercars.com/', EconomyBookings: 'https://www.economybookings.com/', QEEQ: 'https://www.qeeq.com/',
  Localrent: 'https://localrent.com/', GetYourGuide: 'https://www.getyourguide.com/', Klook: 'https://www.klook.com/',
  Tiqets: 'https://www.tiqets.com/', Viator: 'https://www.viator.com/', Tripadvisor: 'https://www.tripadvisor.com/',
  Kiwitaxi: 'https://kiwitaxi.com/', GetTransfer: 'https://gettransfer.com/', Intui: 'https://intui.travel/', 'Welcome Pickups': 'https://www.welcomepickups.com/',
  Airalo: 'https://www.airalo.com/', Yesim: 'https://yesim.app/', Drimsim: 'https://drimsim.com/', Saily: 'https://saily.com/',
  EKTA: 'https://ektatraveling.com/', SafetyWing: 'https://safetywing.com/', VisitorsCoverage: 'https://www.visitorscoverage.com/', Insubuy: 'https://www.insubuy.com/',
};
const TAB_BRANDS = {
  hotels: ['Booking.com', 'Agoda', 'Trip.com', 'Expedia', 'Hotels.com', 'Vrbo', 'Vio.com', 'Hostelworld'],
  voitures: ['DiscoverCars', 'EconomyBookings', 'QEEQ', 'Localrent'],
  activites: ['GetYourGuide', 'Klook', 'Viator', 'Tiqets'],
  restaurants: ['Tripadvisor', 'GetYourGuide', 'Klook'],
  transferts: ['Kiwitaxi', 'GetTransfer', 'Intui', 'Welcome Pickups'],
  esim: ['Airalo', 'Yesim', 'Drimsim', 'Saily'],
  assurance: ['EKTA', 'SafetyWing', 'VisitorsCoverage', 'Insubuy'],
};
async function discoverPartners() {
  const old = fs.existsSync(PARTNERS_FILE) ? JSON.parse(fs.readFileSync(PARTNERS_FILE, 'utf8')) : null;
  if (old && Date.now() - new Date(old.checkedAt) < 7 * 864e5 && !process.env.PARTNERS_REFRESH) return old;
  const names = Object.keys(BRANDS), brands = {};
  try {
    for (let i = 0; i < names.length; i += 10) {
      const batch = names.slice(i, i + 10);
      const res = await fetch('https://api.travelpayouts.com/links/v1/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Access-Token': CFG.token },
        body: JSON.stringify({ trs: Number(CFG.trs), marker: Number(CFG.marker), shorten: false, links: batch.map(n => ({ url: BRANDS[n] })) }),
      });
      const txt = await res.text();
      if (i === 0) report('notice', `Liens partenaires, réponse de Travelpayouts (${res.status}) : ${txt.slice(0, 700)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(txt), list = json.result?.links || json.links || json.result || [];
      batch.forEach((n, k) => {
        const out = Array.isArray(list) ? list[k] : null;
        const link = out && Object.values(out).find(v => typeof v === 'string' && /^https?:\/\//.test(v) && v !== BRANDS[n]);
        if (!link) return;
        const u = new URL(link), p = u.searchParams.get('p'), campaign = u.searchParams.get('campaign_id');
        brands[n] = { link, ...(p && campaign && { p, campaign_id: campaign }) };
      });
      await sleep(700);
    }
  } catch (e) {
    report('warning', `Liens partenaires indisponibles (${e.message}) : les onglets concernés restent « bientôt »`);
    return old || { checkedAt: null, brands: {}, tabs: {} };
  }
  const tabs = Object.fromEntries(Object.entries(TAB_BRANDS).map(([t, list]) => [t, list.find(n => brands[n])]).filter(([, n]) => n));
  report('notice', `Partenaires retenus : ${Object.entries(tabs).map(([t, n]) => `${t} → ${n}`).join(', ') || 'aucun'} (convertis : ${Object.keys(brands).join(', ') || 'aucun'})`);
  const out = { checkedAt: new Date().toISOString(), brands, tabs };
  fs.mkdirSync(path.dirname(PARTNERS_FILE), { recursive: true });
  fs.writeFileSync(PARTNERS_FILE, JSON.stringify(out, null, 1));
  return out;
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
// Les pages (accueil, trajets, destinations, mentions légales) sont fabriquées par pages.js.
const pages = require('./pages');

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
  const partners = CFG.mock ? { brands: {}, tabs: {} } : await discoverPartners();
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
  pages.buildSite(items, { CFG, OUT, partners, affLink, airlineName, frDate, frTime, stopsText, dayKey, report });
  console.log(`Site généré dans ${OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
