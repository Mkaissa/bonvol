/* BonVol — interactions : palettes, tableau des départs, module de recherche. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var CITIES = window.BV_CITIES || [];
  var NAME = {}; CITIES.forEach(function (c) { NAME[c[2]] = c[0]; });
  var cfg = document.body.dataset;

  /* chiffres à palettes : court défilement avant de se fixer */
  function shuffle(el) {
    if (reduce) return;
    $$('i', el).forEach(function (i, k) {
      var final = i.textContent; if (!/\d/.test(final)) return;
      var n = 8 + k * 3, t = setInterval(function () { if (n-- > 0) i.textContent = Math.floor(Math.random() * 10); else { clearInterval(t); i.textContent = final; } }, 55);
    });
  }
  $$('[data-flap]').forEach(shuffle);

  /* apparition au défilement */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { threshold: 0.12 });
    $$('.reveal').forEach(function (el) { io.observe(el); });
  } else $$('.reveal').forEach(function (el) { el.classList.add('in'); });

  /* tableau des départs : filtres et tri sur les lignes déjà présentes dans la page */
  var rows = $('#rows');
  if (rows && $('.filters')) {
    var state = { f: 'all', max: Infinity, sort: 'price' }, all = $$('.b-row', rows), empty = $('#empty');
    var render = function () {
      var list = all.filter(function (r) {
        var d = r.dataset, ok = +d.p <= state.max;
        if (state.f === 'direct') ok = ok && d.s === '0';
        if (state.f === 'deal') ok = ok && +d.deal > 0;
        r.hidden = !ok; return ok;
      });
      list.sort(state.sort === 'date' ? function (a, b) { return a.dataset.d.localeCompare(b.dataset.d); }
        : state.sort === 'deal' ? function (a, b) { return b.dataset.deal - a.dataset.deal || a.dataset.p - b.dataset.p; }
          : function (a, b) { return a.dataset.p - b.dataset.p; });
      list.forEach(function (r) { rows.appendChild(r); });
      if (empty) { empty.hidden = list.length > 0; $('b', empty).textContent = state.f === 'deal' ? 'Pas encore de bonne affaire' : 'Aucun départ dans ce budget';
        $('span', empty).textContent = state.f === 'deal' ? "L'agent construit l'historique de chaque trajet. Activez les alertes pour être prévenu dès la première." : 'Augmentez le budget maximum pour voir plus de trajets.'; }
    };
    $$('.pill').forEach(function (b) { b.addEventListener('click', function () { $$('.pill').forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); state.f = b.dataset.f; render(); }); });
    var max = $('#max');
    if (max) max.addEventListener('input', function () {
      state.max = +max.value >= +max.max ? Infinity : +max.value;
      $('#maxOut').textContent = +max.value >= +max.max ? 'Tous' : max.value + ' €';
      max.style.setProperty('--p', (max.value - max.min) / (max.max - max.min) * 100 + '%'); render();
    });
    var sort = $('#sort'); if (sort) sort.addEventListener('change', function () { state.sort = sort.value; render(); });
  }

  /* module de recherche */
  var form = $('#recherche');
  if (!form) return;
  var iso = function (d) { return d.toISOString().slice(0, 10); };
  var plus = function (n) { return iso(new Date(Date.now() + n * 864e5)); };
  var dep = $('#dep'), ret = $('#ret'), trip = 'rt';
  var showDate = function (i) { $('.dval', i.parentNode).textContent = new Date(i.value + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }); };
  function datePicker(i) {
    showDate(i);
    i.addEventListener('change', function () { if (i === dep) { ret.min = dep.value; if (ret.value < dep.value) ret.value = dep.value; showDate(ret); } showDate(i); });
    i.addEventListener('click', function () { try { i.showPicker(); } catch (e) { /* navigateur sans showPicker */ } });
    i.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); try { i.showPicker(); } catch (er) { /* idem */ } } });
  }
  dep.min = ret.min = plus(0); dep.value = plus(30); ret.value = plus(44);
  [dep, ret].forEach(datePicker);

  function setCity(input, code) { input.value = NAME[code] || code; input.dataset.code = code; $('.code', input.parentNode).textContent = code; }
  var fold = function (s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  function attachAuto(input) {
    var list = null, idx = -1;
    var close = function () { if (list) list.remove(); list = null; idx = -1; input.setAttribute('aria-expanded', 'false'); };
    var open = function () {
      var q = fold(input.value.trim()); close(); if (!q) return;
      var hits = CITIES.filter(function (c) { return fold(c[0]).indexOf(q) === 0 || c[2].toLowerCase() === q || fold(c[1]).indexOf(q) === 0; }).slice(0, 7);
      if (!hits.length) return;
      list = document.createElement('ul'); list.className = 'suggest'; list.setAttribute('role', 'listbox');
      list.innerHTML = hits.map(function (c) { return '<li role="option" data-k="' + c[2] + '"><b>' + c[0] + '</b><span>' + c[1] + '</span><em>' + c[2] + '</em></li>'; }).join('');
      list.addEventListener('mousedown', function (e) { var li = e.target.closest('li'); if (li) { e.preventDefault(); setCity(input, li.dataset.k); close(); } });
      input.parentNode.appendChild(list); input.setAttribute('aria-expanded', 'true');
    };
    input.addEventListener('input', function () { input.dataset.code = ''; $('.code', input.parentNode).textContent = ''; open(); });
    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('keydown', function (e) {
      if (!list) return; var items = $$('li', list);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach(function (li, i) { li.setAttribute('aria-selected', i === idx); }); }
      if (e.key === 'Enter') { e.preventDefault(); setCity(input, (items[idx] || items[0]).dataset.k); close(); }
      if (e.key === 'Escape') close();
    });
  }
  $$('.field.city input', form).forEach(attachAuto);
  $('.swap', form).addEventListener('click', function () { var a = $('#from'), b = $('#to'), ca = a.dataset.code; setCity(a, b.dataset.code); setCity(b, ca); });
  $$('.seg button', form).forEach(function (b) { b.addEventListener('click', function () {
    trip = b.dataset.trip; $$('.seg button', form).forEach(function (x) { x.setAttribute('aria-pressed', x === b); }); $('#retField').classList.toggle('off', trip === 'ow'); }); });
  $$('.chip[data-r]', form).forEach(function (c) { c.addEventListener('click', function () { var r = c.dataset.r.split(','); setCity($('#from'), r[0]); setCity($('#to'), r[1]); dep.focus(); }); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = $('#from').dataset.code, t = $('#to').dataset.code;
    if (!f || !t) { (f ? $('#to') : $('#from')).focus(); return; }
    var ddmm = function (s) { return s.slice(8, 10) + s.slice(5, 7); };
    var u = 'https://www.aviasales.com/search/' + f + ddmm(dep.value) + t + (trip === 'rt' ? ddmm(ret.value) : '') + $('#pax').value;
    var q = 'marker=' + cfg.marker + (cfg.trs ? '&trs=' + cfg.trs : '') + '&p=4114&u=' + encodeURIComponent(u) + '&campaign_id=100';
    window.open('https://tp.media/r?' + q, '_blank', 'noopener');
  });

  /* autres onglets : formulaires prêts, reliés aux partenaires dès qu'ils seront actifs */
  var PANES = {
    hotels: { go: 'Voir les hôtels', fields: [['Destination', 'city'], ['Arrivée', 'date', 30], ['Départ', 'date', 37], ['Voyageurs', 'sel', ['2 adultes', '1 adulte', '2 adultes, 1 enfant', '2 adultes, 2 enfants', 'Famille (5 et +)']]] },
    voitures: { go: 'Voir les voitures', fields: [['Prise en charge', 'city'], ['Début', 'date', 30], ['Fin', 'date', 37], ['Conducteur', 'sel', ['30 à 65 ans', '25 à 29 ans', 'Plus de 65 ans']]] },
    activites: { go: 'Voir les activités', fields: [['Destination', 'city'], ['Date', 'date', 31], ['Envie', 'sel', ['Tout voir', 'Visites & culture', 'Excursions', 'Plages & nature', 'Concerts & événements']]] },
    restaurants: { go: 'Trouver une table', fields: [['Ville', 'city'], ['Date', 'date', 30], ['Heure', 'sel', ['20:00', '19:30', '20:30', '21:00', '12:30', '13:00']], ['Personnes', 'sel', ['2 personnes', '1 personne', '3 personnes', '4 personnes', '6 et plus']]] },
  };
  var destCode = form.dataset.dest || 'DKR';
  function fieldHtml(f, i) {
    if (f[1] === 'city') return '<div class="field city from"><label for="a' + i + '">' + f[0] + '<span class="code">' + destCode + '</span></label><input id="a' + i + '" value="' + (NAME[destCode] || destCode) + '" data-code="' + destCode + '" role="combobox" aria-expanded="false" aria-autocomplete="list"></div>';
    if (f[1] === 'date') return '<div class="field date"><label for="a' + i + '">' + f[0] + '</label><span class="dval" aria-hidden="true"></span><input id="a' + i + '" type="date" value="' + plus(f[2]) + '" min="' + plus(0) + '"></div>';
    return '<div class="field"><label for="a' + i + '">' + f[0] + '</label><select id="a' + i + '">' + f[2].map(function (o) { return '<option>' + o + '</option>'; }).join('') + '</select></div>';
  }
  function showTab(v) {
    if (v !== 'vols' && !PANES[v]) return;
    $$('.tab', form).forEach(function (x) { x.setAttribute('aria-selected', x.dataset.tab === v); });
    var flights = v === 'vols', alt = $('#altPane');
    $('.s-form[data-pane=vols]').hidden = !flights; $('.seg', form).hidden = !flights; $('#soon').hidden = true;
    $('#footVols').hidden = !flights; $('#footAlt').hidden = flights;
    alt.innerHTML = '';
    if (flights) return;
    var p = PANES[v];
    alt.innerHTML = '<div class="s-form alt" style="grid-template-columns:1.6fr repeat(' + (p.fields.length - 1) + ',1fr) auto">' + p.fields.map(fieldHtml).join('') +
      '<button class="go" type="button">' + p.go + '<svg class="i" aria-hidden="true"><use href="#i-arrow"/></svg></button></div>';
    $$('input[type=date]', alt).forEach(datePicker); $$('.field.city input', alt).forEach(attachAuto);
    $('.go', alt).addEventListener('click', function () { var s = $('#soon'); s.hidden = false;
      s.textContent = 'Ce module arrive bientôt : nous finalisons nos partenaires pour les hôtels, voitures, activités et restaurants. En attendant, les vols sont disponibles.'; });
  }
  $$('.tab', form).forEach(function (t) { t.addEventListener('click', function () { showTab(t.dataset.tab); }); });
  $$('.chip[data-c]', form).forEach(function (c) { c.addEventListener('click', function () { var i = $('#altPane .field.city input'); if (i) setCity(i, c.dataset.c); }); });
  var fromHash = function () { var h = location.hash.slice(1); if (h === 'recherche') h = 'vols'; if (h === 'vols' || PANES[h]) { showTab(h); form.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); } };
  addEventListener('hashchange', fromHash); fromHash();
})();
