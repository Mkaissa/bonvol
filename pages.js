'use strict';
/*
 * BonVol – génération du site statique
 * Accueil, une page par trajet, une page par destination, mentions légales, sitemap.
 * Le style (static/style.css) et les interactions (static/site.js) sont copiés dans assets/.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATIC = path.join(__dirname, 'static');
const VILLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'villes.json'), 'utf8'));
const CITY = Object.fromEntries(VILLES.map(([name, country, code, lat, lon]) => [code, { name, country, lat, lon }]));
const CREDITS_FILE = path.join(STATIC, 'img', 'credits.json');
const CREDITS = fs.existsSync(CREDITS_FILE) ? JSON.parse(fs.readFileSync(CREDITS_FILE, 'utf8')) : {};

// Teinte posée sur la photo de chaque destination (couleur par défaut pour les nouvelles).
const COLORS = { DKR: '#0E4D64', ABJ: '#0F5132', ALG: '#1D4E89', CMN: '#9C3A22', TUN: '#135D9A', BKO: '#8A4B14', DLA: '#1E5631', FIH: '#1B3A57' };
const DEFAULT_COLOR = '#1B2F52';
// Carte de l'accueil : positions réglées à la main ; les autres villes sont placées d'après leurs coordonnées.
const MAP = { YMQ: [70, 84], PAR: [318, 84], BRU: [340, 46], LYS: [336, 126], ALG: [372, 208], TUN: [436, 196], CMN: [268, 222],
  BKO: [262, 350], DKR: [176, 330], ABJ: [300, 420], DLA: [420, 408], FIH: [462, 478] };
const LABEL = { YMQ: ['start', 0, -12], BRU: ['start', 9, -4], LYS: ['end', -9, 16] };

const TABS = [['vols', 'plane', 'Vols'], ['hotels', 'bed', 'Hôtels'], ['voitures', 'car', 'Voitures'], ['activites', 'ticket', 'Activités'], ['restaurants', 'food', 'Restaurants']];
const CATS = [
  ['hotels', 'bed', 'Hôtels & appartements', "Du riad à l'appartement en famille, comparez les prix de toutes les plateformes.", 'Comparer', true],
  ['voitures', 'car', 'Location de voiture', "Récupérez votre voiture à l'aéroport, avec les loueurs locaux et internationaux.", 'Comparer', true],
  ['activites', 'ticket', 'Activités & événements', "Visites, excursions, concerts, billets d'attractions : réservez avant de partir.", 'Découvrir', true],
  ['restaurants', 'food', 'Restaurants', "Bonnes adresses et expériences culinaires, réservables quand c'est possible.", 'Explorer'],
  [null, 'transfer', 'Transferts aéroport', "Un chauffeur vous attend à l'arrivée, prix fixé à l'avance."],
  [null, 'sim', 'eSIM & internet', "Joignable dès l'atterrissage, sans frais d'itinérance."],
  [null, 'shield', 'Assurance voyage', 'Santé, annulation, bagages : partez couvert.'],
];

const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="i-plane" viewBox="0 0 24 24"><path d="M10.5 13.5 3 11l1.5-1.5 7 1L16 6c1-1 3-1.5 3.5-1s0 2.5-1 3.5l-4.5 4.5 1 7L13.5 21 11 13.5"/></symbol>
<symbol id="i-bed" viewBox="0 0 24 24"><path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="2"/></symbol>
<symbol id="i-car" viewBox="0 0 24 24"><path d="M5 16H3v-4l2-5h14l2 5v4h-2M5 12h14"/><circle cx="7.5" cy="16.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/></symbol>
<symbol id="i-ticket" viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 1 0-4V4H4z"/><path d="M14 4v12" stroke-dasharray="2 2"/></symbol>
<symbol id="i-food" viewBox="0 0 24 24"><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2.2 1-3.5 4-3.5 7.5 0 1.6.9 2.5 3.5 2.5"/></symbol>
<symbol id="i-swap" viewBox="0 0 24 24"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
<symbol id="i-chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></symbol>
<symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></symbol>
<symbol id="i-send" viewBox="0 0 24 24"><path d="m21 3-9.5 9.5M21 3l-6.5 18-3-8.5L3 9.5z"/></symbol>
<symbol id="i-transfer" viewBox="0 0 24 24"><path d="M4 17V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v8M4 13h16M7 17v2M17 17v2"/></symbol>
<symbol id="i-sim" viewBox="0 0 24 24"><path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><rect x="9" y="11" width="6" height="6" rx="1"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3 5 6v6c0 4 3 7.5 7 9 4-1.5 7-5 7-9V6z"/><path d="m9 12 2 2 4-4"/></symbol>
</svg>`;
const PLANE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>';

/* ---------- utilitaires ---------- */
let ctx; // fourni par agent.js : CFG, OUT, affLink, airlineName, frDate, frTime, stopsText, dayKey, report
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => `${Math.round(n)} €`;
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cityName = code => CITY[code]?.name || code;
const icon = (id, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const frDay = iso => ctx.frDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
const brand = root => `<a class="brand" href="${root}"><span class="brand-mark">${PLANE}</span>Bon<em>Vol</em></a>`;
const flap = (n, cls = '') => `<span class="flap ${cls}" role="img" aria-label="${eur(n)}" data-flap>${[...String(Math.round(n))]
  .map(c => `<i aria-hidden="true">${c}</i>`).join('')}<span class="cur" aria-hidden="true">€</span></span>`;
const isFresh = it => !!(it.fresh && it.h.best);
const byPrice = (a, b) => a.h.best.price - b.h.best.price;
function mapPos(code) {
  if (MAP[code]) return MAP[code];
  const c = CITY[code];
  return c ? [clamp(8.614 * c.lon + 325.5, 20, 560), clamp(-7.249 * c.lat + 448.5, 20, 500)] : null;
}

/* ---------- gabarit commun ---------- */
function page({ title, desc, canonical, root, night, nightClass = '', nightBg = '', day, jsonld = '' }) {
  const { CFG } = ctx;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(CFG.siteName)}"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}"><meta name="theme-color" content="#08111F">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Figtree:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${root}assets/style.css?v=${ctx.ver}">
<script>document.documentElement.classList.add('js')</script>${jsonld}</head>
<body data-marker="${esc(CFG.marker)}" data-trs="${esc(CFG.trs)}" data-partners="${esc(JSON.stringify(ctx.partnerCfg))}">${ICONS}
${CFG.mock ? '<p class="demo">Mode démonstration : les prix affichés sont fictifs. En production, ils viennent de l\'API Travelpayouts.</p>' : ''}
<div class="night ${nightClass}">${nightBg}<div class="wrap">${nav(root)}${night}</div></div>
<main class="day"><div class="wrap">${day}</div></main>
${footer(root)}
<script src="${root}assets/villes.js?v=${ctx.ver}"></script><script src="${root}assets/site.js?v=${ctx.ver}"></script>
</body></html>`;
}

function nav(root) {
  const tg = ctx.CFG.tgPublic;
  return `<header class="nav">${brand(root)}<ul>
${TABS.map(([k, , label]) => `<li><a href="${root}#${k}">${label}</a></li>`).join('')}<li><a href="${root}#destinations">Destinations</a></li></ul>
${tg ? `<a class="alerts" href="${esc(tg)}">${icon('send')}Alertes Telegram</a>` : ''}</header>`;
}

function footer(root) {
  const { CFG } = ctx, tg = CFG.tgPublic;
  return `<footer><div class="wrap"><div class="f-grid">
<div>${brand(root)}<p style="margin:18px 0 0;max-width:34ch">Les vols pas chers entre l'Europe, l'Afrique et le Maghreb, surveillés chaque heure.</p></div>
<div><h4>Destinations</h4><ul>${ctx.dests.slice(0, 6).map(d => `<li><a href="${root}destinations/${d.slug}.html">${esc(d.name)}</a></li>`).join('')}</ul></div>
<div><h4>Voyager</h4><ul>${TABS.map(([k, , label]) => `<li><a href="${root}#${k}">${label}</a></li>`).join('')}</ul></div>
<div><h4>${esc(CFG.siteName)}</h4><ul><li><a href="${root}#comment">Comment ça marche</a></li>${tg ? `<li><a href="${esc(tg)}">Alertes Telegram</a></li>` : ''}
<li><a href="${root}mentions-legales.html">Mentions légales</a></li><li><a href="${root}mentions-legales.html#credits">Crédits photos</a></li></ul></div>
</div><p class="legal">Les prix proviennent de recherches récentes et sont confirmés au moment du clic chez le partenaire de réservation.
Certains liens sont affiliés : si vous réservez, ${esc(CFG.siteName)} touche une commission, sans surcoût pour vous.</p></div></footer>`;
}

/* ---------- briques ---------- */
function searchCard({ from = 'PAR', to = 'DKR', dest = to, chips = [] }) {
  const plus = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const city = (cls, id, label, code) => `<div class="field city ${cls}"><label for="${id}">${label}<span class="code">${code}</span></label>
<input id="${id}" value="${esc(cityName(code))}" data-code="${code}" role="combobox" aria-expanded="false" aria-autocomplete="list" autocomplete="off"></div>`;
  const date = (id, label, n, extra = '') => `<div class="field date"${extra}><label for="${id}">${label}</label><span class="dval" aria-hidden="true">${esc(frDay(plus(n)))}</span>
<input id="${id}" type="date" value="${plus(n)}"></div>`;
  const destChips = ctx.dests.slice(0, 5).map(d => `<button type="button" class="chip" data-c="${d.code}">${esc(d.name)}</button>`).join('');
  return `<form class="search" id="recherche" data-dest="${dest}" autocomplete="off">
<div class="s-top" role="tablist" aria-label="Que cherchez-vous ?">
${TABS.map(([k, ic, label], i) => `<button type="button" class="tab" role="tab" aria-selected="${i === 0}" data-tab="${k}">${icon(ic)}<span>${label}</span></button>`).join('')}
<div class="seg" role="group" aria-label="Type de voyage"><button type="button" aria-pressed="true" data-trip="rt">Aller-retour</button><button type="button" aria-pressed="false" data-trip="ow">Aller simple</button></div></div>
<div class="s-form" data-pane="vols"><div class="cities">${city('from', 'from', 'Départ', from)}
<button type="button" class="swap" aria-label="Inverser départ et arrivée">${icon('swap')}</button>${city('to', 'to', 'Arrivée', to)}</div>
<div class="dates">${date('dep', 'Aller', 30)}${date('ret', 'Retour', 44, ' id="retField"')}
<div class="field pax"><label for="pax">Voyageurs</label><select id="pax">${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}">${n} adulte${n > 1 ? 's' : ''}</option>`).join('')}</select></div></div>
<button class="go" type="submit">Rechercher${icon('arrow')}</button></div>
<div id="altPane"></div><p class="soon" id="soon" hidden></p>
<div class="s-foot" id="footVols">${chips.length ? `<span>Populaires</span>${chips.map(it => `<button type="button" class="chip" data-r="${it.r.from},${it.r.to}">${esc(it.r.fromName)} → ${esc(it.r.toName)} <b>${eur(it.h.best.price)}</b></button>`).join('')}` : ''}
<span class="trust">${icon('lock')}Toutes les compagnies comparées · réservation chez le partenaire</span></div>
<div class="s-foot" id="footAlt" hidden><span>Destinations</span>${destChips}<span class="trust">${icon('lock')}Réservation chez nos partenaires · sans surcoût</span></div>
</form>`;
}

function badge(it) {
  if (it.deal) return `<span class="badge deal">−${it.deal} %</span>`;
  if (it.usual) return '<span class="badge">Prix habituel</span>';
  const n = Math.min(it.h.days.length, 7);
  return `<span class="badge" title="L'agent construit l'historique de ce trajet : ${n} jour${n > 1 ? 's' : ''} sur 7">Historique <span class="dots" aria-hidden="true">${
    Array.from({ length: 7 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span></span>`;
}

function row(it, root) {
  const b = it.h.best, fresh = isFresh(it);
  const meta = fresh ? `<b>${esc(ctx.airlineName(b.airline))}</b><span>${cap(ctx.stopsText(b.transfers))} · ${esc(frDay(b.departure_at))}</span>`
    : '<b>Prix en attente</b><span>L\'agent surveille ce trajet</span>';
  return `<a class="b-row" href="${root}vols/${it.slug}.html" data-p="${fresh ? b.price : 99999}" data-d="${fresh ? b.departure_at.slice(0, 10) : '9999'}" data-s="${fresh ? b.transfers : 9}" data-deal="${it.deal || 0}">
<span class="leg"><span class="city"><b>${esc(it.r.fromName)}</b><span>${it.r.from}</span></span><span class="path"></span><span class="city"><b>${esc(it.r.toName)}</b><span>${it.r.to}</span></span></span>
<span class="meta">${meta}</span>${fresh ? flap(b.price) : '<span class="flap muted" role="img" aria-label="Prix en attente"><i aria-hidden="true">–</i><i aria-hidden="true">–</i></span>'}${badge(it)}${icon('chev', 'chev')}</a>`;
}

function board(list, { root, filters = false }) {
  const fresh = list.filter(isFresh), sorted = [...fresh.sort(byPrice), ...list.filter(it => !isFresh(it))];
  const top = Math.ceil(Math.max(100, ...fresh.map(it => it.h.best.price)) / 50) * 50;
  const n = { all: list.length, deal: list.filter(it => it.deal).length, direct: fresh.filter(it => it.h.best.transfers === 0).length };
  const bar = filters ? `<div class="filters reveal" role="group" aria-label="Filtrer les départs">
<button type="button" class="pill" aria-pressed="true" data-f="all">Tous <small>${n.all}</small></button>
<button type="button" class="pill" aria-pressed="false" data-f="deal">Bonnes affaires <small>${n.deal}</small></button>
<button type="button" class="pill" aria-pressed="false" data-f="direct">Vols directs <small>${n.direct}</small></button>
<label class="range">Budget max <input type="range" id="max" min="50" max="${top}" step="10" value="${top}" aria-label="Prix maximum"><output id="maxOut">Tous</output></label>
<select class="sort" id="sort" aria-label="Trier"><option value="price">Prix croissant</option><option value="date">Date de départ</option><option value="deal">Plus grosses baisses</option></select></div>` : '';
  return `${bar}<div class="board reveal"><div class="b-head"><span>Trajet</span><span>Vol</span><span>Aller simple dès</span><span>Statut</span><span></span></div>
<div id="rows">${sorted.map(it => row(it, root)).join('')}</div>${filters ? '<div class="empty" id="empty" hidden><b></b><span></span></div>' : ''}</div>`;
}

function routesMap(items) {
  const pairs = [...new Map(items.map(it => [`${it.r.from}-${it.r.to}`, it.r])).values()].filter(r => mapPos(r.from) && mapPos(r.to));
  const origins = new Set(pairs.map(r => r.from)), dests = new Set(pairs.map(r => r.to));
  const arcs = pairs.map(r => { const [x1, y1] = mapPos(r.from), [x2, y2] = mapPos(r.to);
    const mx = (x1 + x2) / 2 - (y2 - y1) * 0.25, my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.35 - 20;
    return `<path class="arc" d="M${x1} ${y1} Q${mx.toFixed(0)} ${my.toFixed(0)} ${x2} ${y2}"/>`; }).join('');
  const pts = [...origins].map(k => { const [x, y] = mapPos(k), [a, dx, dy] = LABEL[k] || ['end', -9, -7];
    return `<circle class="o" cx="${x}" cy="${y}" r="3"/><text x="${x + dx}" y="${y + dy}" text-anchor="${a}">${esc(cityName(k))}</text>`; })
    .concat([...dests].map((k, i) => { const [x, y] = mapPos(k);
      return `<circle class="ring" cx="${x}" cy="${y}" r="5" style="animation-delay:${(i % 6) * 0.45}s"/><circle class="d" cx="${x}" cy="${y}" r="3.5"/><text class="dt" x="${x + 10}" y="${y + 4}">${esc(cityName(k))}</text>`; })).join('');
  return `<svg class="routes-map" viewBox="0 0 600 520" aria-hidden="true"><defs><linearGradient id="arcGrad" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#EEF2F8" stop-opacity=".55"/><stop offset="1" stop-color="#FFB627"/></linearGradient></defs>${arcs}${pts}</svg>`;
}

function destCard(d, root, i) {
  const ph = CREDITS[d.code], color = COLORS[d.code] || DEFAULT_COLOR;
  const scene = `<svg class="scene" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="400" height="500" fill="${color}"/>
<circle cx="270" cy="235" r="80" fill="#FFD08A" opacity=".75"/><path d="M0 330 Q100 318 200 330 T400 326 V500 H0Z" fill="${color}" opacity=".9"/></svg>`;
  return `<a class="dest reveal" href="${root}destinations/${d.slug}.html" style="--c:${color}e6;transition-delay:${(i % 4) * 60}ms">${scene}
${ph ? `<img src="${root}assets/img/${d.code}.webp" alt="${esc(ph.alt)}" loading="lazy">` : ''}
<span class="txt"><small>${esc(d.country)}</small><h3>${esc(d.name)}</h3>${d.min ? `<span class="from">Vols dès <b>${eur(d.min)}</b></span>` : '<span class="from">Prix en attente</span>'}
<span class="via">Depuis ${esc(d.origins.join(' · '))}</span></span></a>`;
}

function cats(dest) {
  return `<div class="cats">${CATS.map(([tab, ic, title, text, cta, big]) => {
    const inner = `<span class="ico">${icon(ic)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p>`;
    return tab ? `<a class="cat${big ? ' big' : ''} reveal" href="#${tab}">${inner}<span class="more">${cta}${dest ? ` à ${esc(dest)}` : ''}${icon('arrow')}</span></a>`
      : `<div class="cat reveal">${inner}<span class="more" style="color:var(--muted)">Bientôt disponible</span></div>`;
  }).join('')}</div>`;
}

const secHead = (kicker, title, text = '', extra = '') => `<div class="sec-head reveal"><div><p class="kicker">${kicker}</p><h2>${title}</h2>${text ? `<p>${text}</p>` : ''}</div>${extra}</div>`;

function chartSvg(days) {
  if (days.length < 2) return '<p style="margin:0;color:var(--muted)">L\'historique se construit : la courbe apparaîtra dès le deuxième jour de relevés.</p>';
  const W = 520, H = 240, P = 28, ps = days.map(d => d.price), min = Math.min(...ps), max = Math.max(...ps);
  const x = i => P + i * (W - 2 * P) / (days.length - 1);
  const y = v => (max === min ? H / 2 : H - P - 22 - (v - min) * (H - 2 * P - 36) / (max - min));
  const pts = days.map((d, i) => `${x(i).toFixed(1)},${y(d.price).toFixed(1)}`);
  const iMin = ps.indexOf(min), n = days.length;
  const [anchor, lx, ly] = iMin > n * 0.7 ? ['end', x(iMin) - 12, y(min) + 5] : iMin < n * 0.3 ? ['start', x(iMin) + 12, y(min) + 5] : ['middle', x(iMin), y(min) - 14];
  const short = d => ctx.frDate(d, { day: 'numeric', month: 'short' });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Prix le plus bas par jour, de ${eur(min)} à ${eur(max)}">
<defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C2410C" stop-opacity=".16"/><stop offset="1" stop-color="#C2410C" stop-opacity="0"/></linearGradient></defs>
<path class="area" d="M${pts[0]} L${pts.join(' L')} L${x(n - 1).toFixed(1)},${H - P - 10} L${x(0).toFixed(1)},${H - P - 10}Z"/>
<polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
<circle class="dot" cx="${x(iMin).toFixed(1)}" cy="${y(min).toFixed(1)}" r="5"/>
<text class="lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}">${eur(min)} le ${short(days[iMin].date)}</text>
<text x="${P}" y="${H - 6}">${short(days[0].date)}</text><text x="${W - P}" y="${H - 6}" text-anchor="end">${short(days[n - 1].date)}</text></svg>`;
}

/* ---------- pages ---------- */
function buildIndex(items, now) {
  const { CFG, frTime } = ctx;
  const fresh = items.filter(isFresh).sort(byPrice), best = fresh[0];
  const next = new Date(now); next.setUTCMinutes(7, 0, 0); if (next <= new Date(now)) next.setUTCHours(next.getUTCHours() + 1);
  const names = ctx.dests.slice(0, 5).map(d => d.name);
  const bestHtml = best ? `<div class="best">${flap(best.h.best.price, 'lg')}<div><small>Meilleur prix du moment</small>
<strong>${esc(best.r.fromName)} → ${esc(best.r.toName)} · ${ctx.stopsText(best.h.best.transfers)} · ${esc(ctx.frDate(best.h.best.departure_at, { day: 'numeric', month: 'short' }))}</strong></div></div>` : '';
  const night = `<section class="hero"><div>
<span class="eyebrow"><span class="live"></span>Prix relevés à ${frTime(now)} · ${items.length} trajets surveillés</span>
<h1>Rentrer au pays,<br><em>moins cher.</em></h1>
<p class="lede">${esc(CFG.siteName)} surveille chaque heure les vols vers ${esc(names.slice(0, -1).join(', '))} ou ${esc(names.slice(-1)[0] || '')} — et vous prévient quand un prix chute vraiment.</p>
${bestHtml}</div>${routesMap(items)}</section>
${searchCard({ from: 'PAR', to: ctx.dests[0]?.code || 'DKR', chips: fresh.slice(0, 3) })}
<section class="board-sec" id="bons-plans">${secHead('Le tableau des départs', 'Les prix du moment,<br><em>relevés chaque heure.</em>',
    'Le prix le plus bas trouvé pour un aller simple sur les trois prochains mois. Une bonne affaire, c\'est au moins 25 % sous le prix habituel du trajet.',
    `<span class="updated"><span class="live"></span>Mis à jour à ${frTime(now)} · prochain relevé vers ${frTime(next.toISOString())}</span>`)}
${board(items, { root: './', filters: true })}</section>`;
  const sample = (items.some(it => it.deal) ? items.filter(it => it.deal) : fresh).slice(0, 2);
  const bubbles = sample.map(it => { const b = it.h.best;
    return `<div class="bubble">✈️ <b>${esc(it.r.fromName)} → ${esc(it.r.toName)} : ${eur(b.price)}</b> (aller simple)<br>${it.deal ? `−${it.deal} % par rapport au prix habituel (${eur(it.usual)})<br>` : ''}
Départ le ${esc(ctx.frDate(b.departure_at, { day: 'numeric', month: 'long' }))}, ${ctx.stopsText(b.transfers)}, ${esc(ctx.airlineName(b.airline))}<br><span class="lnk">Voir ce vol</span><span class="t">${frTime(now)}</span></div>`; }).join('');
  const tg = CFG.tgPublic ? `<section class="tg-band reveal"><span class="tg-ex">Exemple d'alerte</span><div>
<p class="kicker">Alertes gratuites</p><h2>Les vraies baisses,<br><em>avant tout le monde.</em></h2>
<p>Rejoignez le canal Telegram : une notification seulement quand un prix passe nettement sous son niveau habituel. Pas de spam, pas de compte à créer.</p>
<a class="btn-amber" href="${esc(CFG.tgPublic)}">${icon('send')}Rejoindre le canal</a></div>
<div class="phone" aria-hidden="true"><div class="screen"><div class="tg-head"><span class="tg-av">${PLANE}</span><div><b>${esc(CFG.siteName)} – vols pas chers</b><span>canal · alertes</span></div></div>
<div class="tg-body">${bubbles}</div></div></div></section>` : '';
  const day = `<section id="destinations">${secHead('Destinations', 'Où rentrez-vous <em>cette fois ?</em>', 'Vols, hôtels, voitures, activités et restaurants : tout ce qu\'il faut pour votre séjour, au meilleur prix relevé.')}
<div class="dest-grid">${ctx.dests.map((d, i) => destCard(d, './', i)).join('')}</div></section>
<section id="sur-place">${secHead('Sur place', 'Tout le voyage, <em>au même endroit.</em>', 'Une fois le billet trouvé, comparez le reste chez nos partenaires, sans surcoût pour vous.')}${cats()}</section>
<section id="comment">${secHead('Comment ça marche', 'Un agent qui veille <em>pour vous.</em>')}<div class="steps">
${[['On relève les prix', "Chaque heure, l'agent interroge les compagnies sur les trois prochains mois, pour chaque trajet."],
    ['On les compare', "Chaque prix est confronté à l'historique du trajet : on sait s'il est vraiment bas, ou juste habituel."],
    ['On vous prévient', 'Les vraies baisses partent aussitôt sur Telegram. Vous réservez directement chez la compagnie ou l\'agence.']]
    .map(([h, p], i) => `<div class="step reveal"><span class="flap" role="img" aria-label="Étape ${i + 1}"><i aria-hidden="true">0</i><i aria-hidden="true">${i + 1}</i></span><h3>${h}</h3><p>${p}</p></div>`).join('')}</div></section>
${tg}`;
  return page({
    title: `Vols pas chers vers l'Afrique et le Maghreb | ${CFG.siteName}`,
    desc: `Vols, hôtels, voitures et activités vers ${names.join(', ')} et plus. Prix surveillés chaque heure, alertes sur les vraies baisses.`,
    canonical: `${CFG.siteUrl}/`, root: './', night, day,
  });
}

function buildRoute(it) {
  const { CFG, frDate } = ctx, { r, h } = it, b = h.best, fresh = isFresh(it), name = `${r.fromName} → ${r.toName}`;
  const d = ctx.dests.find(x => x.code === r.to);
  const faq = [
    [`Quel est le prix habituel d'un vol ${name} ?`, it.usual ? `Sur notre historique récent, le prix habituel d'un aller simple ${name} est d'environ ${eur(it.usual)}.`
      : 'Notre historique est encore en construction pour ce trajet : le prix habituel sera calculé après 7 jours de relevés.'],
    [`Quel est le vol ${name} le moins cher constaté ?`, it.lowest ? `Le prix le plus bas relevé par notre agent est de ${eur(it.lowest.price)}, le ${frDate(it.lowest.date)}. Ce prix n'est pas forcément encore disponible.`
      : "Aucun prix relevé pour l'instant."],
    ['À quelle fréquence les prix sont-ils mis à jour ?', 'Notre agent relève les prix de ce trajet chaque heure. Ils proviennent de recherches récentes et peuvent avoir changé : le prix final est confirmé au moment du clic chez le partenaire de réservation.'],
  ];
  const jsonld = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) })}</script>`;
  const offer = fresh ? `<p class="kicker" style="color:var(--mist-2)">Aller simple dès</p>${flap(b.price, 'xl')}<div>${badge(it)}</div>
<dl><dt>Départ</dt><dd>${esc(frDate(b.departure_at))}</dd><dt>Vol</dt><dd>${cap(ctx.stopsText(b.transfers))}, ${esc(ctx.airlineName(b.airline))}</dd>
<dt>Prix</dt><dd>trouvé lors de recherches récentes</dd></dl>
<a class="btn-amber" href="${esc(ctx.affLink(b))}" rel="sponsored nofollow" target="_blank">Voir ce vol${icon('arrow')}</a>
<p class="fine">Prix et disponibilité confirmés au clic, chez le partenaire.</p>`
    : `<p class="kicker" style="color:var(--mist-2)">Prix en attente</p><p style="margin:0;color:var(--mist)">Aucun prix actuel pour ce trajet. L'agent le surveille et l'affichera dès qu'il en trouve un. En attendant, lancez une recherche ci-dessous.</p>`;
  const night = `<p class="crumb"><a href="../">Accueil</a><span>/</span>${d ? `<a href="../destinations/${d.slug}.html">${esc(r.toName)}</a><span>/</span>` : ''}${esc(name)}</p>
<section class="hero"><div><h1>Vol pas cher<br><em>${esc(name)}</em></h1>
<p class="lede">Le prix le plus bas trouvé récemment pour un aller simple, relevé chaque heure par notre agent, et son évolution jour après jour.</p></div>
<aside class="offer">${offer}</aside></section>
<div class="page-search">${searchCard({ from: r.from, to: r.to })}</div>`;
  const others = ctx.items.filter(x => x.r.to === r.to && x !== it);
  const day = `<section class="two"><div class="panel reveal"><h2>Le prix le plus bas, <em>jour par jour</em></h2>${chartSvg(h.days.slice(-60))}</div>
<div class="panel faq reveal"><h2>Questions fréquentes</h2>${faq.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div></section>
<section>${secHead('Sur place', `Votre séjour <em>à ${esc(r.toName)}</em>`, `Hôtels, voitures, activités et restaurants à ${esc(r.toName)}, chez nos partenaires.`)}${cats(r.toName)}</section>
${others.length ? `<section>${secHead(`Vers ${esc(r.toName)}`, 'Les autres <em>départs</em>')}${board(others, { root: '../' })}</section>` : ''}
<section>${secHead('Destinations', 'Ailleurs, <em>au même prix ?</em>')}<div class="dest-grid">${ctx.dests.filter(x => x.code !== r.to).slice(0, 4).map((x, i) => destCard(x, '../', i)).join('')}</div></section>`;
  return page({
    title: `Vol pas cher ${name}${fresh ? ` dès ${eur(b.price)}` : ''} | ${CFG.siteName}`,
    desc: `Prix des vols ${name} surveillés chaque heure, historique des prix et alertes sur les vraies baisses.`,
    canonical: `${CFG.siteUrl}/vols/${it.slug}.html`, root: '../', nightClass: 'page', night, day, jsonld,
  });
}

function buildDest(d) {
  const { CFG } = ctx, ph = CREDITS[d.code], cheapest = d.items.filter(isFresh).sort(byPrice)[0];
  const night = `<p class="crumb"><a href="../">Accueil</a><span>/</span><a href="../#destinations">Destinations</a><span>/</span>${esc(d.name)}</p>
<section class="hero"><div><span class="country">${esc(d.country)}</span><h1>Voyage à <em>${esc(d.name)}</em></h1>
<p class="lede">${d.min ? `Vols dès ${eur(d.min)} depuis ${esc(d.origins.join(', '))}, ` : ''}et tout pour votre séjour : hôtels, voitures, activités et restaurants.</p></div></section>
<div class="page-search">${searchCard({ from: cheapest?.r.from || d.items[0].r.from, to: d.code, chips: d.items.filter(isFresh).sort(byPrice).slice(0, 3) })}</div>`;
  const day = `<section>${secHead(`Vers ${esc(d.name)}`, `Les vols <em>du moment</em>`, 'Le prix le plus bas trouvé pour un aller simple, relevé chaque heure.')}${board(d.items, { root: '../' })}</section>
<section>${secHead('Sur place', `Votre séjour <em>à ${esc(d.name)}</em>`, `Hôtels, voitures, activités et restaurants à ${esc(d.name)}, chez nos partenaires.`)}${cats(d.name)}</section>
<section>${secHead('Destinations', 'Ailleurs, <em>au même prix ?</em>')}<div class="dest-grid">${ctx.dests.filter(x => x.code !== d.code).slice(0, 4).map((x, i) => destCard(x, '../', i)).join('')}</div></section>`;
  return page({
    title: `Voyage à ${d.name} : vols${d.min ? ` dès ${eur(d.min)}` : ''}, hôtels, voitures | ${CFG.siteName}`,
    desc: `Vols pas chers vers ${d.name} (${d.country}) depuis ${d.origins.join(', ')}, prix surveillés chaque heure, et tout pour votre séjour.`,
    canonical: `${CFG.siteUrl}/destinations/${d.slug}.html`, root: '../', nightClass: 'page dest-hero',
    nightBg: ph ? `<img src="../assets/img/${d.code}.webp" alt="" aria-hidden="true">` : '', night, day,
  });
}

function buildLegal() {
  const { CFG } = ctx, L = CFG.legal, v = s => (s ? esc(s) : '<em class="todo">[à compléter]</em>');
  const missing = Object.entries({ LEGAL_EDITOR: L.editor, LEGAL_ADDRESS: L.address, LEGAL_SIREN: L.siren, LEGAL_PHONE: L.phone, LEGAL_EMAIL: L.email })
    .filter(([, s]) => !s).map(([k]) => k);
  if (missing.length && !CFG.mock) ctx.report('warning', `Mentions légales incomplètes, variables manquantes : ${missing.join(', ')}`);
  const host = L.hostPhone ? `Téléphone : ${esc(L.hostPhone)}` : `Contact : <a href="${esc(L.hostContact)}">${esc(L.hostContact.replace(/^https?:\/\//, ''))}</a>`;
  const credits = Object.entries(CREDITS).map(([k, c]) => `<li><b>${esc(cityName(k))}</b> — <a href="${esc(c.page)}">${esc(c.author)}</a>, ${c.licenseUrl ? `<a href="${esc(c.licenseUrl)}">${esc(c.license)}</a>` : esc(c.license)}</li>`).join('');
  const night = `<section class="hero"><div><h1>Mentions <em>légales</em></h1><p class="lede">Qui édite ${esc(CFG.siteName)}, qui l'héberge, et comment le site fonctionne.</p></div></section>`;
  const day = `<div class="legal-grid">
<div class="panel"><h2>Éditeur du site</h2><p>${v(L.editor)}<br>${v(L.address)}<br>SIREN : ${v(L.siren)}<br>Téléphone : ${v(L.phone)}<br>E-mail : ${v(L.email)}</p><p>Directeur de la publication : ${v(L.editor)}</p></div>
<div class="panel"><h2>Hébergeur</h2><p>${v(L.hostName)}<br>${v(L.hostAddress)}<br>${host}</p></div>
<div class="panel"><h2>Prix affichés</h2><p>Les prix proviennent de recherches récentes effectuées sur Aviasales. Ils peuvent avoir changé depuis : le prix et la disponibilité sont confirmés au moment du clic chez le partenaire de réservation.</p></div>
<div class="panel"><h2>Liens affiliés</h2><p>Certains liens sont affiliés : si vous réservez après un clic, ${esc(CFG.siteName)} touche une commission, sans surcoût pour vous.</p></div>
<div class="panel wide"><h2>Données personnelles</h2><p>Ce site ne dépose aucun cookie et ne mesure pas l'audience. Les polices de caractères sont chargées depuis Google Fonts : votre navigateur contacte alors les serveurs de Google. La recherche de vols vous redirige vers notre partenaire Travelpayouts (Aviasales), dont la politique de confidentialité s'applique ensuite.</p></div>
${credits ? `<div class="panel wide" id="credits"><h2>Crédits photos</h2><ul class="credits-list">${credits}</ul><p style="margin-top:14px">Photos sous licence libre, via Wikimedia Commons.</p></div>` : ''}
</div>`;
  return page({
    title: `Mentions légales | ${CFG.siteName}`, desc: `Mentions légales du site ${CFG.siteName}.`,
    canonical: `${CFG.siteUrl}/mentions-legales.html`, root: './', nightClass: 'page', night, day,
  });
}

function buildSite(items, context) {
  ctx = context;
  const { OUT, CFG } = ctx, now = new Date().toISOString();
  // Destinations, dans l'ordre de routes.json.
  const dests = [];
  for (const it of items) {
    let d = dests.find(x => x.code === it.r.to);
    if (!d) dests.push(d = { code: it.r.to, name: it.r.toName, slug: norm(it.r.toName), country: CITY[it.r.to]?.country || '', items: [], origins: [] });
    d.items.push(it);
    if (!d.origins.includes(it.r.fromName)) d.origins.push(it.r.fromName);
  }
  for (const d of dests) { const p = d.items.filter(isFresh).map(it => it.h.best.price); d.min = p.length ? Math.min(...p) : null; }
  const pt = ctx.partners || {};
  const partnerCfg = Object.fromEntries(Object.entries(pt.tabs || {}).map(([tab, brand]) => [tab, { brand, ...pt.brands[brand] }]));
  Object.assign(ctx, { items, dests, partnerCfg });

  fs.mkdirSync(path.join(OUT, 'vols'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'destinations'), { recursive: true });
  fs.cpSync(STATIC, path.join(OUT, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'assets', 'villes.js'), `window.BV_CITIES=${JSON.stringify(VILLES.map(([n, c, k]) => [n, c, k]))};\n`);
  ctx.ver = crypto.createHash('md5').update(fs.readFileSync(path.join(STATIC, 'style.css')) + fs.readFileSync(path.join(STATIC, 'site.js')) + VILLES.length).digest('hex').slice(0, 8);

  fs.writeFileSync(path.join(OUT, 'index.html'), buildIndex(items, now));
  for (const it of items) fs.writeFileSync(path.join(OUT, 'vols', `${it.slug}.html`), buildRoute(it));
  for (const d of dests) fs.writeFileSync(path.join(OUT, 'destinations', `${d.slug}.html`), buildDest(d));
  fs.writeFileSync(path.join(OUT, 'mentions-legales.html'), buildLegal());
  const urls = [`${CFG.siteUrl}/`, ...dests.map(d => `${CFG.siteUrl}/destinations/${d.slug}.html`), ...items.map(it => `${CFG.siteUrl}/vols/${it.slug}.html`)];
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${u}</loc><lastmod>${ctx.dayKey()}</lastmod></url>`).join('')}</urlset>`);
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${CFG.siteUrl}/sitemap.xml\n`);
}

module.exports = { buildSite };
