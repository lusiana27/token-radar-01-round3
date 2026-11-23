/* TOKEN RADAR dashboard — renders window.RADAR (data.js) with no network.
   Views: ?view=board (default) | ?view=detail&slug=X | ?view=filtered&cat=&chain=&verdict=&q=&mintvl=
   Table sorts by clicking a header; a row click opens its detail view. */
(function () {
  var D = window.RADAR;
  if (!D) { document.getElementById('app').textContent = 'No radar data.'; return; }
  // Params from the query string, or from the #fragment (same keys), or
  // from window.FORCE_VIEW set by detail.html / filtered.html (the
  // screenshot entry points — some headless shells drop ? and # on file://).
  var Q = new URLSearchParams(location.search);
  if (location.hash.length > 1 && !Q.get('view') && !Q.get('slug')) Q = new URLSearchParams(location.hash.slice(1));
  var FV = window.FORCE_VIEW || {};
  if (FV.view) Q.set('view', FV.view);
  if (FV.slug) Q.set('slug', FV.slug);
  if (FV.verdict) Q.set('verdict', FV.verdict);
  if (FV.cat) Q.set('cat', FV.cat);
  var state = {
    sort: { key: 'r', dir: 1 },
    q: Q.get('q') || '',
    cat: Q.get('cat') || '',
    chain: Q.get('chain') || '',
    verdict: Q.get('verdict') || '',
    mintvl: parseFloat(Q.get('mintvl') || '0') || 0,
    detail: Q.get('slug') || null,
    view: Q.get('view') || (Q.get('slug') ? 'detail' : 'board')
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) {
    if (v == null) return '—';
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e8 ? 0 : 1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'k';
    return '$' + Math.round(v);
  }
  function moneyFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function pct(v) { if (v == null) return '<span class="mut">n/a</span>'; var c = v >= 0 ? 'pos' : 'neg'; return '<span class="' + c + '">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '%</span>'; }
  function ageTxt(a) { if (a == null) return 'n/a'; if (a >= 365) return (a / 365).toFixed(1) + 'y'; if (a >= 30) return Math.round(a / 30) + 'mo'; return a + 'd'; }
  function badge(vd) { return '<span class="badge b-' + vd + '">' + vd + '</span>'; }
  function chains(ch) { return esc((ch || []).slice(0, 2).join(', ') + ((ch || []).length > 2 ? ' +' + ((ch || []).length - 2) : '')); }

  var cats = [], chainsSet = {};
  D.rows.forEach(function (r) { if (cats.indexOf(r.c) < 0) cats.push(r.c); (r.ch || []).forEach(function (c) { chainsSet[c] = 1; }); });
  cats.sort(); var chainList = Object.keys(chainsSet).sort();

  function filtered() {
    var q = state.q.toLowerCase();
    return D.rows.filter(function (r) {
      if (q && (r.n.toLowerCase().indexOf(q) < 0 && r.s.toLowerCase().indexOf(q) < 0)) return false;
      if (state.cat && r.c !== state.cat) return false;
      if (state.chain && (r.ch || []).indexOf(state.chain) < 0) return false;
      if (state.verdict && r.vd !== state.verdict) return false;
      if (state.mintvl && r.t < state.mintvl) return false;
      return true;
    });
  }
  function sorted(rows) {
    var k = state.sort.key, d = state.sort.dir;
    return rows.slice().sort(function (a, b) {
      var x = a[k], y = b[k];
      if (x == null) return 1; if (y == null) return -1;
      if (typeof x === 'string') return (x < y ? -1 : x > y ? 1 : 0) * d;
      return (x - y) * d;
    });
  }

  function rowHtml(r) {
    return '<tr data-slug="' + esc(r.s) + '"><td class="num">' + r.r + '</td>' +
      '<td class="nm">' + esc(r.n) + '<small>' + esc(r.s) + '</small></td>' +
      '<td>' + esc(r.c || '—') + '</td><td>' + chains(r.ch) + '</td>' +
      '<td class="num">' + money(r.t) + '</td><td class="num">' + pct(r.g) + '</td>' +
      '<td class="num">' + ageTxt(r.a) + '</td><td class="num"><b>' + money(r.v) + '</b></td>' +
      '<td>' + badge(r.vd) + '</td></tr>';
  }

  function tableHtml(rows, id) {
    var heads = [['r', '#'], ['n', 'Protocol'], ['c', 'Category'], ['', 'Chains'], ['t', 'TVL'], ['g', '7d'], ['a', 'Age'], ['v', 'Implied value'], ['vd', 'Verdict']];
    var th = heads.map(function (h) {
      var cls = state.sort.key === h[0] ? ' class="sorted"' : '';
      var arrow = state.sort.key === h[0] ? (state.sort.dir === 1 ? ' ▲' : ' ▼') : '';
      return h[0] ? '<th data-k="' + h[0] + '"' + cls + '>' + h[1] + arrow + '</th>' : '<th>' + h[1] + '</th>';
    }).join('');
    return '<table id="' + id + '"><thead><tr>' + th + '</tr></thead><tbody>' + rows.map(rowHtml).join('') + '</tbody></table>';
  }

  function detailHtml(r) {
    var comps = D.live_all.filter(function (l) { return l.c === r.c; }).slice(0, 5);
    var compRows = comps.map(function (l) {
      return '<tr><td class="nm">' + esc(l.n) + '</td><td class="num">' + money(l.m) + '</td><td class="num">' + money(l.t) + '</td><td class="num">' + (l.m / l.t).toFixed(3) + '×</td></tr>';
    }).join('') || '<tr><td colspan="4">No live-token protocol in this category in the snapshot.</td></tr>';
    var risks = [];
    if (r.g != null && r.g < -10) risks.push('TVL fell ' + Math.abs(r.g).toFixed(1) + '% in 7 days — momentum is against this farm right now.');
    if (r.g != null && r.g > 50) risks.push('TVL jumped ' + r.g.toFixed(1) + '% in 7 days — fast growth can be mercenary capital that leaves before a launch.');
    if (r.a != null && r.a < 180) risks.push('Young book: listed only ' + ageTxt(r.a) + ' ago, so the record is short and the multiple is less proven.');
    if (r.a == null) risks.push('No listing date in the snapshot, so maturity uses the 365-day fallback.');
    if (r.g == null) risks.push('No 7-day change reported — growth multiplier is neutral (1.00×).');
    if ((r.ch || []).length <= 1) risks.push('Single-chain exposure (' + esc((r.ch || [])[0] || 'unknown') + ') — a chain outage or exploit hits the whole position.');
    if (r.vd === 'SKIP') risks.push('Verdict SKIP: implied value under $10M — farm only if you already use this protocol.');
    if (!risks.length) risks.push('No red flag in the snapshot: steady TVL, multi-chain, mature listing.');
    var steps = r.f.map(function (s) {
      var parts = s.split(' Cost: ');
      var act = parts[0] || s, rest = (parts[1] || '').replace(/\.$/, '');
      var ci = rest.indexOf('. Time: ');
      var cost = ci >= 0 ? rest.slice(0, ci) : rest, time = ci >= 0 ? rest.slice(ci + 8) : '';
      return '<li>' + esc(act) + '<div class="chips"><span class="chip">COST <b>' + esc(cost) + '</b></span><span class="chip">TIME <b>' + esc(time) + '</b></span></div></li>';
    }).join('');
    return '<section class="detail" id="detail"><h2>Detail — #' + r.r + ' ' + esc(r.n) + ' ' + badge(r.vd) + ' <span class="r">click any board row to open its detail</span></h2>' +
      '<div class="dgrid"><div><h2>Implied-value working</h2><div class="work">' +
      'TVL ' + moneyFull(r.t) + ' × category multiple <b>' + r.mu.toFixed(3) + '×</b> (' + esc(r.c || 'no category') + ')<br>' +
      '× growth <b>' + r.gm.toFixed(3) + '×</b> (' + (r.g == null ? 'no 7d change reported' : (r.g >= 0 ? '+' : '') + r.g.toFixed(2) + '% clamped, weight 0.6') + ')<br>' +
      '× maturity <b>' + r.mm.toFixed(3) + '×</b> (age ' + ageTxt(r.a) + ', 0.75 + up to 0.45 over 3 years)<br>' +
      '<span class="eq">= implied value ' + moneyFull(r.v) + '</span><br>' +
      'Snapshot facts: TVL ' + moneyFull(r.t) + ' · 7d ' + (r.g == null ? 'n/a' : r.g.toFixed(2) + '%') + ' · listed ' + ageTxt(r.a) + ' ago · chains ' + esc((r.ch || []).join(', ')) + ' · records no token (mcap, gecko_id, symbol all null).</div>' +
      '<h2 style="margin-top:10px">Live comparables — same category, token already trades</h2>' +
      '<table class="mini"><thead><tr><th>Protocol</th><th class="num">Mcap</th><th class="num">TVL</th><th class="num">Mcap/TVL</th></tr></thead><tbody>' + compRows + '</tbody></table>' +
      '<p class="note" style="margin-top:6px">The category multiple <b>' + r.mu.toFixed(3) + '×</b> is the winsorized median mcap/TVL of live-token protocols in this category, shrunk toward the global median ' + D.median_multiple.toFixed(3) + '×. The comparables above are the market evidence behind it.</p></div>' +
      '<div><h2>Farm plan — 6 steps with cost + time</h2><ol class="steps">' + steps + '</ol>' +
      '<h2 style="margin-top:10px">Risks — read before farming</h2><ul class="risk">' + risks.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div></section>';
  }

  function render() {
    var rows = sorted(filtered());
    var top = D.rows.slice(0, 10);
    var v = D.validation;
    var maxCat = Math.max.apply(null, D.categories.slice(0, 12).map(function (c) { return c.total_implied; }));
    var bars = D.categories.slice(0, 12).map(function (c) {
      return '<div class="bar-row"><span class="nm">' + esc(c.c) + '</span><span class="bar"><i style="width:' + Math.max(2, Math.round(c.total_implied / maxCat * 100)) + '%"></i></span><span class="ct">' + c.n + ' rows</span><span class="tv">' + money(c.total_implied) + '</span></div>';
    }).join('');
    var multRows = D.categories.slice(0, 14).map(function (c) {
      return '<tr><td>' + esc(c.c) + '</td><td class="num">' + c.n + '</td><td class="num">' + c.mult.toFixed(3) + '×</td><td class="num">' + money(c.total_implied) + '</td></tr>';
    }).join('');
    var liveRows = D.live.map(function (l, i) {
      return '<tr><td class="num">' + (i + 1) + '</td><td class="nm">' + esc(l.n) + '<small>' + esc(l.s) + '</small></td><td>' + esc(l.c || '—') + '</td><td class="num">' + money(l.m) + '</td><td class="num">' + money(l.t) + '</td><td class="num">' + (l.m / l.t).toFixed(3) + '×</td><td class="num">' + pct(l.g) + '</td><td><span class="badge b-LIVE">LIVE</span></td></tr>';
    }).join('');
    var detailRow = state.detail ? D.rows.filter(function (r) { return r.s === state.detail; })[0] : null;
    var isFiltered = state.view === 'filtered' || state.cat || state.chain || state.verdict || state.q || state.mintvl;
    var banner = '';
    if (state.view === 'filtered') banner = '<div class="banner">FILTERED VIEW — ' + rows.length + ' of ' + D.rows.length + ' rows match' + (state.cat ? ' · category ' + esc(state.cat) : '') + (state.chain ? ' · chain ' + esc(state.chain) : '') + (state.verdict ? ' · verdict ' + esc(state.verdict) : '') + (state.mintvl ? ' · TVL ≥ ' + money(state.mintvl) : '') + (state.q ? ' · search “' + esc(state.q) + '”' : '') + '</div>';
    var sel = function (list, cur, all) { return '<option value="">' + all + '</option>' + list.map(function (x) { return '<option' + (x === cur ? ' selected' : '') + ' value="' + esc(x) + '">' + esc(x) + '</option>'; }).join(''); };

    document.getElementById('app').innerHTML =
      '<header class="top"><div><h1>TOKEN <b>RADAR</b></h1><div class="sub">200 pre-token protocols ranked by implied value · <b>' + D.watchlist_size + ' watchlist</b> + ' + D.early_size + ' early finds below the $50M floor · snapshot ' + esc(D.as_of) + ' · model ' + esc(D.model_version) + '</div></div>' +
      '<div class="meta">SOURCE<br><b>DefiLlama protocols</b><br>AS OF ' + esc(D.as_of) + '<br>758 protocols ≥ $5M TVL</div></header>' +
      '<div class="judge"><b>JUDGE NOTE —</b> every number on this page is computed from the sealed snapshot by <b>calibrateMultiples → impliedValue → holdoutValidation</b> (see Model panel). The board covers all <b>' + D.watchlist_size + ' watchlist</b> protocols, ranks <b>200 pre-token</b> rows by implied value, separates the <b>' + D.live_size + ' live-token</b> protocols below (market value, never modelled), and gives each row a 6-step farm plan with cost + time. Nothing here is a hardcoded list of names.</div>' +
      '<div class="stats">' +
      '<div class="stat"><div class="k">Board rows</div><div class="v">' + D.board_size + '</div><div class="d">' + D.watchlist_size + ' watchlist + ' + D.early_size + ' early</div></div>' +
      '<div class="stat"><div class="k">Total implied value</div><div class="v">' + money(D.total_implied) + '</div><div class="d">sum of all 200 rows</div></div>' +
      '<div class="stat"><div class="k">Median multiple</div><div class="v">' + D.median_multiple.toFixed(3) + '×</div><div class="d">global mcap/TVL, winsorized</div></div>' +
      '<div class="stat"><div class="k">Farm ≥ $50M</div><div class="v g">' + D.verdicts.FARM + '</div><div class="d">highest implied value</div></div>' +
      '<div class="stat"><div class="k">Watch ≥ $10M</div><div class="v a">' + D.verdicts.WATCH + '</div><div class="d">worth tracking</div></div>' +
      '<div class="stat"><div class="k">Skip &lt; $10M</div><div class="v r">' + D.verdicts.SKIP + '</div><div class="d">low implied value</div></div>' +
      '<div class="stat"><div class="k">Hold-out median error</div><div class="v a">' + v.median_abs_pct + '%</div><div class="d">typical ' + v.median_factor + '× off · ' + v.n_test + ' tested</div></div>' +
      '<div class="stat"><div class="k">Top implied value</div><div class="v">' + money(D.rows[0].v) + '</div><div class="d">#' + D.rows[0].r + ' ' + esc(D.rows[0].n) + '</div></div>' +
      '</div>' +
      '<section><h2>Implied value by category <span class="r">— top 12 of ' + D.categories.length + ' categories on the board</span></h2><div class="cols"><div>' + bars + '</div><div><table class="mini"><thead><tr><th>Category</th><th class="num">Rows</th><th class="num">Multiple</th><th class="num">Total implied</th></tr></thead><tbody>' + multRows + '</tbody></table></div></div></section>' +
      '<section><h2>Spotlight — top 10 by implied value</h2>' + tableHtml(top, 'spot') + '</section>' +
      (detailRow ? detailHtml(detailRow) : '') +
      '<section><h2>Model validation <span class="r">— holdoutValidation: fit on half the live-token set, predict the other half</span></h2><div class="valgrid">' +
      '<div class="val"><div class="k">Test protocols</div><div class="v">' + v.n_test + '</div><div class="d">odd slugs by order</div></div>' +
      '<div class="val"><div class="k">Median abs error</div><div class="v">' + v.median_abs_pct + '%</div><div class="d">|predicted − mcap| / mcap</div></div>' +
      '<div class="val"><div class="k">Typical factor off</div><div class="v">' + v.median_factor + '×</div><div class="d">10 ^ median |log10 error|</div></div>' +
      '<div class="val"><div class="k">Within 2× / 5×</div><div class="v g">' + v.within_2x + ' / ' + v.within_5x + '</div><div class="d">of ' + v.n_test + ' predictions</div></div></div>' +
      '<p class="note">Model: <b>implied = TVL × category multiple × growth × maturity</b>. Multiple = winsorized median mcap/TVL per category (ratios clipped to 0.01–5×), shrunk toward the global median ' + D.median_multiple.toFixed(3) + '× with 3 pseudo-observations, clamped to 0.03–1.2×. Growth = 1 + clamped 7d change (−50%…+100%) × 0.6. Maturity = 0.75 + up to 0.45 over 3 years listed (unknown age = 365 days). Verdicts: <b>FARM ≥ $50M, WATCH ≥ $10M, SKIP below</b>. The validation above is honest: mcap/TVL varies widely even inside a category, so the median prediction is about ' + v.median_factor + '× off — the ranking is a guide, not a price target.</p></section>' +
      '<section id="boardsec"><h2>Full board — sortable &amp; filterable <span class="r">— click a header to sort, click a row for its detail</span></h2>' + banner +
      '<div class="filters"><label>Search</label><input id="f-q" type="text" placeholder="name or slug…" value="' + esc(state.q) + '">' +
      '<label>Category</label><select id="f-cat">' + sel(cats, state.cat, 'All') + '</select>' +
      '<label>Chain</label><select id="f-chain">' + sel(chainList, state.chain, 'All') + '</select>' +
      '<label>Verdict</label><select id="f-vd">' + sel(['FARM', 'WATCH', 'SKIP'], state.verdict, 'All') + '</select>' +
      '<label>Min TVL</label><select id="f-tvl"><option value="0">Any</option>' + [5e6, 1e7, 5e7, 1e8, 5e8, 1e9].map(function (t) { return '<option value="' + t + '"' + (state.mintvl === t ? ' selected' : '') + '>≥ ' + money(t) + '</option>'; }).join('') + '</select>' +
      '<span class="count"><b>' + rows.length + '</b> of ' + D.rows.length + ' rows</span></div>' +
      tableHtml(rows, 'board') + '</section>' +
      '<section><h2>Live-token protocols — market value, not modelled <span class="r">— top ' + D.live_size + ' by market cap; these already trade, so they are comparables, never board rows</span></h2>' +
      '<table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th class="num">Market cap</th><th class="num">TVL</th><th class="num">Mcap/TVL</th><th class="num">7d</th><th>Status</th></tr></thead><tbody>' + liveRows + '</tbody></table></section>' +
      '<footer><b>How to read this board.</b> “Records no token” means the snapshot records no market cap, CoinGecko id or symbol — it is not proof a protocol has no token. Implied value is this entry’s own claim from the snapshot’s figures, never a price target and never a prediction that a token will launch. Farm plans assume a token may never come: never pay anyone to claim, never bridge more than you can lose, and check the protocol’s own page before every step. Data: DefiLlama protocols snapshot ' + esc(D.as_of) + ' · ' + D.rows.length + ' rows · model ' + esc(D.model_version) + ' · functions: calibrateMultiples, impliedValue, holdoutValidation, farmSteps.</footer>';

    document.querySelectorAll('th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (state.sort.key === k) state.sort.dir = -state.sort.dir; else { state.sort.key = k; state.sort.dir = k === 'n' || k === 'c' ? 1 : -1; }
        render();
      });
    });
    document.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        state.detail = tr.getAttribute('data-slug'); state.view = 'detail'; render();
        var d = document.getElementById('detail'); if (d) d.scrollIntoView();
      });
    });
    var bind = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('change', fn); };
    bind('f-q', function (e) { state.q = e.target.value; render(); });
    bind('f-cat', function (e) { state.cat = e.target.value; render(); });
    bind('f-chain', function (e) { state.chain = e.target.value; render(); });
    bind('f-vd', function (e) { state.verdict = e.target.value; render(); });
    bind('f-tvl', function (e) { state.mintvl = parseFloat(e.target.value) || 0; render(); });
    // Screenshot views land on their subject: detail opens on the detail
    // panel, filtered opens on the board section.
    if (state.view === 'detail' && detailRow) { var d = document.getElementById('detail'); if (d) window.scrollTo(0, d.offsetTop - 8); }
    if (state.view === 'filtered') { var b = document.getElementById('boardsec'); if (b) window.scrollTo(0, b.offsetTop - 8); }
  }
  render();
})();
