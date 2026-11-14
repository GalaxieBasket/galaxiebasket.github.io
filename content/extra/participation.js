/*
 * Galaxie Basket - Participation planner (private tool for coaches).
 * Plain JS ES module. Rule engine lives in /participation-rules.js (no DOM / Firebase).
 * Firebase modular SDK is loaded lazily from gstatic.com.
 */
import {
  validateGame, suggestLineups, creditedHalves, outHalves, comparePlayers,
  halfLabel, halfShortLabel, playerWeight, halfWeights, NUM_HALVES, SLOTS, MIN_PLAYERS, MAX_PLAYERS,
  MIN_WEIGHT, MAX_WEIGHT, DEFAULT_WEIGHT, parseRosterCsv, mergeRoster,
} from '/participation-rules.js';


// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCWg7ZqSzZjj_CzXLBc8uDBuV29MDnJgvs",
  authDomain: "participationapp-70efb.firebaseapp.com",
  projectId: "participationapp-70efb",
  storageBucket: "participationapp-70efb.firebasestorage.app",
  messagingSenderId: "288703828319",
  appId: "1:288703828319:web:08ef2a153313d752c466ea",
  measurementId: "G-69W83M6NS7"
};

// Only used to show an "accès refusé" screen. The real enforcement is firestore.rules.
const ALLOWED_EMAILS = ['fabien@galaxiebasket.ca'];
// ---------------------------------------------------------------------------

const FB_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';
const CATEGORIES = { novice: 'Novice', mini: 'Mini', atome: 'Atome', benjamin: 'Benjamin' };
const Q4 = NUM_HALVES; // column index of quarter 4

const root = document.getElementById('participation-app');
const state = {
  user: null,
  denied: false,
  teams: [],
  games: [],
  route: { view: 'teams' },
  game: null, // working copy of the game being planned
  gameKey: null,
  lockMode: false,
  subForm: null,
  teamsError: null,
};
let fb = null; // firebase modules
let db = null;
let auth = null;
let unsubTeams = null;
let unsubGames = null;
let gamesTeamId = null;
let saveTimer = null;
let longFired = false;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const esc = s => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtDate = s => {
  if (!s) return '';
  const d = new Date(s + 'T12:00:00');
  return isNaN(d) ? s : d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
/** Date and optional time of a game, e.g. "sam. 30 nov. 2026 · 9h15". */
const fmtWhen = g => fmtDate(g.date) + (g.time ? ` · ${g.time.replace(':', 'h')}` : '');
const isPlaceholder = () => Object.values(firebaseConfig).some(v => v === 'REPLACE_ME');
const placeholderEmails = () => ALLOWED_EMAILS.every(e => /^COACH_EMAIL_/.test(e));
const team = () => state.teams.find(t => t.id === state.route.teamId);

// Firestore does not accept nested arrays: halves/locked are stored as [{ids: [...]}, ...].
function gameFromDoc(id, d) {
  const un = a => Array.from({ length: NUM_HALVES }, (_, h) => (a && a[h] && Array.isArray(a[h].ids) ? a[h].ids.slice() : []));
  return {
    id,
    date: d.date || '',
    time: d.time || '',
    opponent: d.opponent || '',
    location: d.location || '',
    players: d.players || {},
    // Attendance is stored as the list of absent players: everyone else on the team is present.
    // Legacy docs only had `present` over a player snapshot: derive the absent list from them.
    absent: Array.isArray(d.absent) ? d.absent.slice()
      : Object.keys(d.players || {}).filter(id => !(d.present || []).includes(id)),
    present: [],
    halves: un(d.halves),
    locked: un(d.locked),
    q4: Array.isArray(d.q4) ? d.q4.slice() : [],
    injurySubs: Array.isArray(d.injurySubs) ? d.injurySubs.map(s => Object.assign({}, s)) : [],
  };
}
const wrap = a => a.map(ids => ({ ids }));

/**
 * Fill `players` and `present` of a game from the team's current roster (mutates and returns g).
 * Players: active team players, plus anyone still used in the game's lineups (inactive or deleted
 * players fall back to the copy saved in the game). Present: active team players not marked absent.
 */
function resolveGame(g, t) {
  const refs = new Set();
  g.halves.concat(g.locked, [g.q4]).forEach(l => l.forEach(id => refs.add(id)));
  g.injurySubs.forEach(s => { if (s.outId) refs.add(s.outId); if (s.inId) refs.add(s.inId); });
  const players = {};
  const present = [];
  for (const p of (t && t.players) || []) {
    const active = p.active !== false;
    if (!active && !refs.has(p.id)) continue;
    players[p.id] = { name: p.name, number: p.number, weight: p.weight || DEFAULT_WEIGHT };
    if (active && !g.absent.includes(p.id)) present.push(p.id);
  }
  for (const id of refs) {
    if (!players[id]) players[id] = Object.assign({ name: 'Joueur supprimé', number: '' }, g.players[id] || {});
  }
  g.players = players;
  g.present = present;
  return g;
}

// ---------------------------------------------------------------------------
// Boot / auth
// ---------------------------------------------------------------------------
async function boot() {
  if (isPlaceholder()) { renderSetup(); return; }
  root.innerHTML = '<p class="pt-loading">Chargement…</p>';
  try {
    const [appM, authM, fsM] = await Promise.all([
      import(FB_BASE + 'firebase-app.js'),
      import(FB_BASE + 'firebase-auth.js'),
      import(FB_BASE + 'firebase-firestore.js'),
    ]);
    fb = Object.assign({}, appM, authM, fsM);
    const app = fb.initializeApp(firebaseConfig);
    auth = fb.getAuth(app);
    db = fb.initializeFirestore(app, {
      localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.error(e);
    root.innerHTML = '<div class="pt-setup"><h2>Erreur de chargement</h2><p>Impossible de charger Firebase. Vérifiez votre connexion Internet puis rechargez la page.</p></div>';
    return;
  }
  window.addEventListener('hashchange', onRoute);
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('toggle', e => { if (e.target.matches && e.target.matches('.pt-edit')) state.editOpen = e.target.open; }, true);
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointerup', cancelPress);
  root.addEventListener('pointerleave', cancelPress, true);
  root.addEventListener('pointercancel', cancelPress);
  root.addEventListener('contextmenu', e => { if (e.target.closest('.pt-cell')) e.preventDefault(); });
  fb.onAuthStateChanged(auth, user => {
    state.user = user;
    state.denied = !!user && !placeholderEmails() &&
      !ALLOWED_EMAILS.map(e => e.toLowerCase()).includes((user.email || '').toLowerCase());
    if (user && !state.denied) startData(); else stopData();
    render();
  });
  onRoute();
}

function renderSetup() {
  root.innerHTML = `<div class="pt-setup">
    <h2>Configuration requise</h2>
    <p>La page de participation n'est pas encore connectée à Firebase.</p>
    <ol>
      <li>Créez un projet Firebase, activez <b>Firestore</b> et <b>Authentication &gt; Google</b>.</li>
      <li>Ajoutez <code>galaxiebasket.ca</code> et <code>localhost</code> dans Authentication &gt; Domaines autorisés.</li>
      <li>Copiez la configuration web dans la constante <code>firebaseConfig</code> en haut de <code>participation.js</code>.</li>
      <li>Collez <code>firestore.rules</code> (avec les courriels des entraîneurs) dans la console Firestore.</li>
    </ol></div>`;
}

function startData() {
  if (unsubTeams) return;
  unsubTeams = fb.onSnapshot(fb.collection(db, 'teams'), snap => {
    state.teams = snap.docs.map(d => Object.assign({ id: d.id }, d.data()))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    state.teamsError = null;
    render();
  }, err => { console.error(err); state.teamsError = err; render(); });
  syncGamesListener();
}

function stopData() {
  if (unsubTeams) unsubTeams();
  if (unsubGames) unsubGames();
  unsubTeams = unsubGames = null;
  gamesTeamId = null;
  state.teams = []; state.games = []; state.game = null;
}

function syncGamesListener() {
  const tid = state.route.teamId || null;
  if (!db || !state.user || state.denied) return;
  if (tid === gamesTeamId && unsubGames) return;
  if (unsubGames) unsubGames();
  unsubGames = null; gamesTeamId = tid; state.games = [];
  if (!tid) return;
  unsubGames = fb.onSnapshot(fb.collection(db, 'teams', tid, 'games'), snap => {
    state.games = snap.docs.map(d => gameFromDoc(d.id, d.data()));
    if (state.route.view === 'planner') {
      const g = state.games.find(x => x.id === state.route.gameId);
      if (!saveTimer) { state.game = g ? JSON.parse(JSON.stringify(g)) : null; }
    }
    render();
  }, err => { console.error(err); state.teamsError = err; render(); });
}

function onRoute() {
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').filter(Boolean);
  let r = { view: 'teams' };
  if (parts[0] === 't' && parts[1]) {
    r = { view: 'roster', teamId: parts[1] };
    if (parts[2] === 'games') r.view = 'games';
    if (parts[2] === 'g' && parts[3]) { r.view = 'planner'; r.gameId = parts[3]; }
  }
  if (saveTimer) saveNow();
  state.route = r;
  state.game = null; state.subForm = null; state.lockMode = false; state.editOpen = false;
  syncGamesListener();
  if (r.view === 'planner') {
    const g = state.games.find(x => x.id === r.gameId);
    if (g) state.game = JSON.parse(JSON.stringify(g));
  }
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  if (!root || isPlaceholder()) return;
  if (state.game && team()) resolveGame(state.game, team());
  const wrapEl = root.querySelector('.pt-gridwrap');
  const sl = wrapEl ? wrapEl.scrollLeft : 0;
  if (!state.user) {
    root.innerHTML = `<div class="pt-center"><h2>Règle de participation</h2>
      <p class="pt-dim">Outil réservé aux entraîneurs de Galaxie Basket.</p>
      <button data-action="signin">Se connecter avec Google</button></div>`;
    return;
  }
  if (state.denied) {
    root.innerHTML = `<div class="pt-center"><h2>Accès refusé</h2>
      <p>Le compte <b>${esc(state.user.email)}</b> n'est pas autorisé à utiliser cet outil.</p>
      <button data-action="signout">Se déconnecter</button></div>`;
    return;
  }
  let body = '';
  if (state.teamsError) {
    body += `<div class="pt-alert error">Erreur d'accès aux données (${esc(state.teamsError.code || state.teamsError.message)}). Vérifiez les règles Firestore et votre connexion.</div>`;
  }
  const v = state.route.view;
  if (v === 'teams') body += viewTeams();
  else if (!team()) body += '<p class="pt-center pt-dim">Chargement de l’équipe…</p>';
  else if (v === 'roster') body += viewRoster();
  else if (v === 'games') body += viewGames();
  else if (v === 'planner') body += viewPlanner();
  root.innerHTML = topbar() + body;
  const nw = root.querySelector('.pt-gridwrap');
  if (nw) nw.scrollLeft = sl;
}

function topbar() {
  const t = team();
  const r = state.route;
  let crumbs = '<a href="#/">Équipes</a>';
  if (t) {
    crumbs += ` &rsaquo; <a href="#/t/${esc(t.id)}">${esc(t.name)}</a>`;
    if (r.view === 'roster') crumbs += ' &rsaquo; Joueurs';
    if (r.view === 'games' || r.view === 'planner') crumbs += ` &rsaquo; <a href="#/t/${esc(t.id)}/games">Matchs</a>`;
    if (r.view === 'planner' && state.game) crumbs += ` &rsaquo; ${esc(state.game.opponent || 'Match')}`;
  }
  return `<div class="pt-topbar"><div class="pt-crumbs">${crumbs}</div>
    <div class="pt-user">${esc(state.user.email)} <button class="pt-secondary pt-small" data-action="signout">Quitter</button></div></div>`;
}

function viewTeams() {
  const items = state.teams.map(t => `<li>
      <div class="pt-grow"><a href="#/t/${esc(t.id)}"><b>${esc(t.name)}</b></a>
      <div class="pt-dim">${esc(CATEGORIES[t.category] || '')} · moitiés de ${esc(t.halfMinutes)} min · ${(t.players || []).filter(p => p.active !== false).length} joueurs</div></div>
      <a class="pt-btn pt-small" href="#/t/${esc(t.id)}/games">Matchs</a>
    </li>`).join('');
  return `<h2>Équipes</h2>
    <ul class="pt-list">${items || '<li class="pt-dim">Aucune équipe pour le moment.</li>'}</ul>
    <h3>Nouvelle équipe</h3>
    <form class="pt-form" data-form="addTeam">
      <label>Nom<input name="name" required placeholder="Ex. Atome A"></label>
      <label>Catégorie<select name="category">${Object.entries(CATEGORIES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
      <button type="submit">Créer</button>
    </form>`;
}

function viewRoster() {
  const t = team();
  const players = (t.players || []).slice().sort((a, b) => (Number(a.number) - Number(b.number)) || String(a.name).localeCompare(String(b.name)));
  const items = players.map(p => `<li class="${p.active === false ? 'pt-inactive' : ''}">
      <input class="pt-num" type="number" min="0" max="99" inputmode="numeric" value="${esc(p.number)}" data-change="playerNumber" data-id="${esc(p.id)}" aria-label="Numéro">
      <div class="pt-grow"><input class="pt-name" value="${esc(p.name)}" data-change="playerName" data-id="${esc(p.id)}" aria-label="Nom"></div>
      <label class="pt-weight" title="Niveau (1 = débutant, 5 = fort)">★<select data-change="playerWeight" data-id="${esc(p.id)}" aria-label="Niveau">${weightOptions(p.weight)}</select></label>
      <button class="pt-secondary pt-small pt-icon" data-action="togglePlayer" data-id="${esc(p.id)}" title="${p.active === false ? 'Réactiver' : 'Désactiver'}" aria-label="${p.active === false ? 'Réactiver' : 'Désactiver'} ${esc(p.name)}">${p.active === false ? '↺' : '⏸'}</button>
      <button class="pt-danger pt-small pt-icon" data-action="deletePlayer" data-id="${esc(p.id)}" title="Supprimer" aria-label="Supprimer ${esc(p.name)}">🗑</button>
    </li>`).join('');
  return `<h2>${esc(t.name)} · Joueurs</h2>
    <div class="pt-toolbar"><a class="pt-btn" href="#/t/${esc(t.id)}/games">Voir les matchs</a></div>
    <ul class="pt-list">${items || '<li class="pt-dim">Aucun joueur.</li>'}</ul>
    <h3>Ajouter un joueur</h3>
    <form class="pt-form" data-form="addPlayer">
      <label>Numéro<input name="number" type="number" min="0" max="99" inputmode="numeric" required style="width:80px"></label>
      <label>Nom<input name="name" required placeholder="Prénom"></label>
      <label title="Niveau (1 = débutant, 5 = fort)">Niveau<select name="weight">${weightOptions(DEFAULT_WEIGHT)}</select></label>
      <button type="submit">Ajouter</button>
    </form>
    <h3>Importer un fichier CSV</h3>
    ${importPanel(t)}
    <p class="pt-dim">Le niveau (1 à 5) sert à équilibrer les alignements : « Générer » répartit les joueurs forts entre les moitiés.</p>
    <p class="pt-dim">Un joueur désactivé n'apparaît plus dans les matchs (sauf là où il est déjà inscrit) et peut être réactivé. « Supprimer » le retire définitivement de l'équipe.</p>`;
}

function importPanel(t) {
  const imp = state.importPreview;
  if (!imp || imp.teamId !== t.id) {
    return `<label class="pt-file"><input type="file" accept=".csv,.txt,text/csv,text/plain" data-change="importFile"><span class="pt-btn pt-secondary">Choisir un fichier…</span></label>
      <p class="pt-dim">Une ligne par joueur : numéro, nom, niveau (optionnel, 1 à 5). Séparateur virgule, point-virgule ou tabulation. Une ligne d'en-tête (Numéro ; Prénom ; Nom ; Niveau) est reconnue. Un joueur déjà inscrit (même nom) est mis à jour au lieu d'être dupliqué. Depuis Excel : Fichier › Enregistrer sous › CSV.</p>`;
  }
  const row = (r, tag) => `<tr><td>${esc(r.number)}</td><td>${esc(r.name)}</td><td>${esc(r.weight)}</td><td>${tag}</td></tr>`;
  const errs = imp.errors.map(e => `<div class="pt-alert warning">Ligne ${e.line} : ${esc(e.message)}</div>`).join('');
  const dups = imp.duplicateNumbers.map(n => `<div class="pt-alert warning">Numéro ${esc(n)} utilisé par plusieurs joueurs actifs.</div>`).join('');
  const empty = !imp.added.length && !imp.updated.length;
  return `<div class="pt-import">
    <div class="pt-dim">${esc(imp.fileName)} : ${imp.added.length} joueur(s) à ajouter, ${imp.updated.length} à mettre à jour.</div>
    ${errs}${dups}
    ${empty ? '<div class="pt-alert error">Aucun joueur valide dans ce fichier.</div>' : `<div class="pt-gridwrap"><table class="pt-grid pt-importtable"><thead><tr><th>#</th><th>Nom</th><th>Niveau</th><th></th></tr></thead>
      <tbody>${imp.added.map(r => row(r, 'Nouveau')).join('')}${imp.updated.map(r => row(r, 'Mise à jour')).join('')}</tbody></table></div>`}
    <div class="pt-toolbar">
      ${empty ? '' : '<button data-action="confirmImport">Importer</button>'}
      <button class="pt-secondary" data-action="cancelImport">Annuler</button>
    </div></div>`;
}

async function readImportFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const t = team();
  let text = await file.text();
  // Excel on Windows often saves CSV in Windows-1252: re-decode if UTF-8 decoding failed.
  if (text.includes(String.fromCharCode(0xFFFD))) text = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
  const { rows, errors } = parseRosterCsv(text);
  const merged = mergeRoster(t.players || [], rows, uid);
  const seen = {}, duplicateNumbers = [];
  for (const p of merged.players) {
    if (p.active === false) continue;
    if (seen[p.number] && !duplicateNumbers.includes(p.number)) duplicateNumbers.push(p.number);
    seen[p.number] = true;
  }
  state.importPreview = { teamId: t.id, fileName: file.name, errors, duplicateNumbers, ...merged };
  render();
}

/**
 * Printable sheet for the bench / score keeper, opened in a new tab (standalone HTML, so the
 * site's dark theme does not apply). Skill levels are deliberately left out: the sheet may be
 * seen by parents or officials.
 */
function printGame(g) {
  const t = team();
  const ids = g.present.slice().sort(comparePlayers(g));
  const absent = Object.keys(g.players).filter(id => !g.present.includes(id)).sort(comparePlayers(g));
  const credits = creditedHalves(g);
  const sub = {};
  for (const s of g.injurySubs) if (s.inId) sub[`${s.half}:${s.inId}`] = true;
  const nm = id => (g.players[id] ? `<b>${esc(g.players[id].number)}</b> ${esc(g.players[id].name)}` : esc(id));
  const cols = [];
  for (let h = 0; h <= NUM_HALVES; h++) cols.push(h);
  const colName = h => (h === Q4 ? 'Q4' : halfShortLabel(h));
  const lineup = h => (h === Q4 ? g.q4 : g.halves[h]).filter(id => g.present.includes(id)).sort(comparePlayers(g));

  const boxes = cols.map(h => {
    const list = lineup(h);
    const subs = h === Q4 ? [] : g.injurySubs.filter(s => s.half === h);
    return `<div class="box"><h3>${h === Q4 ? 'Q4 (substitution libre)' : esc(halfLabel(h))}</h3>
      <ol>${list.map(id => `<li>${nm(id)}</li>`).join('') || '<li class="dim">—</li>'}</ol>
      ${subs.map(s => `<div class="sub">${esc(s.reason === 'expulsion' ? 'Expulsion' : 'Blessure')} : ${nm(s.outId)} → ${nm(s.inId)}</div>`).join('')}</div>`;
  }).join('');

  const rows = ids.map(id => {
    const c = credits[id] || 0;
    const cells = cols.map(h => {
      const listed = (h === Q4 ? g.q4 : g.halves[h]).includes(id);
      const credit = h !== Q4 && !listed && sub[`${h}:${id}`];
      return `<td class="${h === Q4 ? 'q4' : ''}">${listed ? '✓' : (credit ? '+' : '')}</td>`;
    }).join('');
    return `<tr><td class="name">${nm(id)}</td>${cells}<td class="sum ${c > 4 || c < 2 ? 'warn' : ''}">${c}</td></tr>`;
  }).join('');

  const issues = validateGame(g).filter(i => i.level !== 'info');
  const alerts = issues.length
    ? `<div class="alerts">${issues.map(i => `<div>${i.level === 'error' ? '⛔' : '⚠️'} ${esc(i.message)}</div>`).join('')}</div>`
    : '<div class="okmsg">✅ Plan conforme à la règle de participation.</div>';

  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.name)} · ${esc(fmtWhen(g))} · ${esc(g.opponent || 'Match')}</title>
<style>
  @page { size: letter portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #000; background: #fff; margin: 0; padding: 16px; font-size: 11pt; }
  h1 { font-size: 16pt; margin: 0 0 2px; }
  h2 { font-size: 12pt; margin: 14px 0 6px; border-bottom: 2px solid #000; }
  .meta { color: #333; margin-bottom: 8px; }
  .boxes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .box { border: 1px solid #000; border-radius: 4px; padding: 4px 6px; break-inside: avoid; }
  .box h3 { font-size: 10pt; margin: 0 0 2px; }
  .box ol { margin: 0; padding-left: 18px; }
  .box li { line-height: 1.35; }
  .sub { font-size: 9pt; font-style: italic; margin-top: 2px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #000; padding: 3px 4px; text-align: center; }
  th { background: #eee; font-size: 9.5pt; }
  td.name { text-align: left; white-space: nowrap; }
  td.q4, th.q4 { border-left: 3px solid #000; }
  td.sum { font-weight: 700; }
  td.sum.warn { background: #fdd; }
  .alerts { border: 2px solid #c00; padding: 6px 8px; margin: 8px 0; }
  .okmsg { margin: 8px 0; }
  .dim, .foot { color: #555; }
  .foot { font-size: 8.5pt; margin-top: 10px; }
  .noprint { margin-bottom: 12px; }
  .noprint button { font-size: 11pt; padding: 6px 14px; }
  @media print { .noprint { display: none; } body { padding: 0; } th, td.sum.warn { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  @media (max-width: 600px) { .boxes { grid-template-columns: repeat(2, 1fr); } }
</style></head><body>
<div class="noprint"><button onclick="window.print()">🖨️ Imprimer / PDF</button></div>
<h1>Galaxie Basket · ${esc(t.name)}</h1>
<div class="meta">${esc(fmtWhen(g))} · ${esc(g.opponent || 'Adversaire ?')}${g.location ? ` · ${esc(g.location)}` : ''} · moitiés de ${esc(t.halfMinutes)} min · ${ids.length} joueurs présents</div>
${alerts}
<h2>Alignements</h2>
<div class="boxes">${boxes}</div>
<h2>Participation</h2>
<table><thead><tr><th>Joueur</th>${cols.map(h => `<th class="${h === Q4 ? 'q4' : ''}">${colName(h)}</th>`).join('')}<th>Σ Q1-Q3</th></tr></thead>
<tbody>${rows}</tbody></table>
${absent.length ? `<p class="dim">Absents : ${absent.map(nm).join(', ')}</p>` : ''}
<div class="foot">Règle de participation : au moins 8 joueurs jouent 2 moitiés ou plus et personne ne dépasse 4 moitiés aux quarts 1 à 3. ✓ = sur le terrain, + = demi-quart crédité (substitution sur blessure/expulsion). Imprimé le ${esc(new Date().toLocaleString('fr-CA'))}.</div>
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert("Impossible d'ouvrir la fenêtre d'impression : autorisez les fenêtres pop-up pour ce site."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function weightOptions(sel) {
  const cur = Number(sel) || DEFAULT_WEIGHT;
  let html = '';
  for (let w = MIN_WEIGHT; w <= MAX_WEIGHT; w++) html += `<option value="${w}" ${w === cur ? 'selected' : ''}>${w}</option>`;
  return html;
}

function viewGames() {
  const t = team();
  // Most recent day first; games of the same day (tournament) in time order.
  const games = state.games.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.time).localeCompare(String(b.time)));
  const items = games.map(g => `<li>
      <div class="pt-grow"><a href="#/t/${esc(t.id)}/g/${esc(g.id)}"><b>${esc(fmtWhen(g))}</b> · ${esc(g.opponent || 'Adversaire ?')}</a>
      <div class="pt-dim">${esc(g.location)} ${g.location ? '· ' : ''}${resolveGame(JSON.parse(JSON.stringify(g)), t).present.length} présents</div></div>
      <button class="pt-danger pt-small" data-action="deleteGame" data-id="${esc(g.id)}">Supprimer</button>
    </li>`).join('');
  return `<h2>${esc(t.name)} · Matchs</h2>
    <div class="pt-toolbar"><a class="pt-btn pt-secondary" href="#/t/${esc(t.id)}">Joueurs</a></div>
    <ul class="pt-list">${items || '<li class="pt-dim">Aucun match.</li>'}</ul>
    <h3>Nouveau match</h3>
    <form class="pt-form" data-form="addGame">
      <label>Date<input type="date" name="date" value="${today()}" required></label>
      <label>Heure<input type="time" name="time" step="300"></label>
      <label>Adversaire<input name="opponent" placeholder="Ex. Rosemont"></label>
      <label>Lieu<input name="location" placeholder="Ex. Gymnase"></label>
      <button type="submit">Créer</button>
    </form>
    <p class="pt-dim">Un match utilise les joueurs de l'équipe : tous les joueurs actifs sont présents par défaut, il suffit de marquer les absents dans le match.</p>`;
}

function viewPlanner() {
  const g = state.game;
  if (!g) return '<p class="pt-center pt-dim">Match introuvable ou en chargement…</p>';
  const t = team();
  const cmp = comparePlayers(g);
  const ids = Object.keys(g.players).sort(cmp);
  const present = new Set(g.present);
  const credits = creditedHalves(g);
  const out = outHalves(g);
  const sub = {}; // `${h}:${id}` -> incoming credit
  for (const s of g.injurySubs) if (s.inId) sub[`${s.half}:${s.inId}`] = true;

  const weights = halfWeights(g);
  const colHead = [];
  for (let h = 0; h <= NUM_HALVES; h++) {
    const n = h === Q4 ? g.q4.filter(id => present.has(id)).length : g.halves[h].filter(id => present.has(id)).length;
    // Q4 has free substitution: any number of players can be planned, at least 5 to start.
    const cls = h === Q4 ? (n >= SLOTS ? 'ok' : 'warn') : (n === SLOTS ? 'ok' : (n > SLOTS ? 'bad' : 'warn'));
    const count = h === Q4 ? `${n} j.` : `${n}/${SLOTS}`;
    colHead.push(`<th class="${h === Q4 ? 'pt-q4' : ''}" title="${h === Q4 ? 'Quatrième quart : substitution libre, autant de joueurs que voulu' : esc(halfLabel(h))}">${h === Q4 ? 'Q4' : halfShortLabel(h)}<span class="pt-colcount ${cls}">${count}</span>${h === Q4 ? '' : `<span class="pt-colweight" title="Niveau total de l'alignement">★${weights[h]}</span>`}</th>`);
  }
  const rows = ids.map(id => {
    const p = g.players[id];
    const isPresent = present.has(id);
    const c = credits[id] || 0;
    const bcls = c > 4 ? 'bad' : (c >= 2 ? 'ok' : 'warn');
    let cells = '';
    for (let h = 0; h <= NUM_HALVES; h++) {
      const listed = h === Q4 ? g.q4.includes(id) : g.halves[h].includes(id);
      const locked = h !== Q4 && g.locked[h].includes(id);
      const gone = h !== Q4 && out[id] !== undefined && out[id] < h;
      const credit = h !== Q4 && !listed && sub[`${h}:${id}`];
      const cls = ['pt-cell', listed ? 'in' : '', credit ? 'credit' : '', gone ? 'out' : '', locked ? 'lock' : ''].join(' ');
      const mark = listed ? '✓' : (credit ? '+' : (gone ? '✚' : ''));
      cells += `<td class="${h === Q4 ? 'pt-q4' : ''}"><button class="${cls}" data-p="${esc(id)}" data-h="${h}" ${!isPresent || (gone && !listed) ? 'disabled' : ''} aria-label="${esc(p.name)} ${h === Q4 ? 'Q4' : esc(halfLabel(h))}">${mark}</button></td>`;
    }
    return `<tr class="${isPresent ? '' : 'pt-absent'}"><td class="pt-player"><b>${esc(p.number)}</b> ${esc(p.name)} <span class="pt-pweight" title="Niveau">★${playerWeight(g, id)}</span></td>${cells}<td><span class="pt-badge ${bcls}">${c}</span></td></tr>`;
  }).join('');

  const chips = ids.map(id => `<span class="pt-chip ${present.has(id) ? 'on' : 'off'}" data-action="toggleAttendance" data-id="${esc(id)}">${esc(g.players[id].number)} ${esc(g.players[id].name)}</span>`).join('');

  const issues = validateGame(g);
  const order = { error: 0, warning: 1, info: 2 };
  const alerts = issues.slice().sort((a, b) => order[a.level] - order[b.level])
    .map(i => `<div class="pt-alert ${i.level}">${i.level === 'error' ? '⛔ ' : (i.level === 'warning' ? '⚠️ ' : '✅ ')}${esc(i.message)}</div>`).join('');

  return `<h2>${esc(fmtWhen(g))} · ${esc(g.opponent || 'Match')}</h2>
    <div class="pt-dim">${esc(g.location)} · ${esc(t.name)} · moitiés de ${esc(t.halfMinutes)} min</div>
    <details class="pt-edit" ${state.editOpen ? 'open' : ''}><summary>Modifier le match</summary>
      <div class="pt-form">
        <label>Date<input type="date" value="${esc(g.date)}" data-change="gameField" data-field="date" required></label>
        <label>Heure<input type="time" step="300" value="${esc(g.time)}" data-change="gameField" data-field="time"></label>
        <label>Adversaire / nom<input value="${esc(g.opponent)}" data-change="gameField" data-field="opponent" placeholder="Ex. Rosemont"></label>
        <label>Lieu<input value="${esc(g.location)}" data-change="gameField" data-field="location" placeholder="Ex. Gymnase"></label>
      </div></details>
    <h3>Présences (${g.present.length})</h3>
    <div class="pt-chips">${chips}</div>
    ${g.present.length > MAX_PLAYERS ? `<div class="pt-alert error">Maximum ${MAX_PLAYERS} joueurs sur la feuille de match.</div>` : ''}
    <div class="pt-dim">Touchez un nom pour le marquer présent ou absent.</div>
    <div class="pt-toolbar">
      <button data-action="generate">Générer</button>
      <button class="pt-secondary" data-action="clearUnlocked">Effacer</button>
      <button class="pt-secondary ${state.lockMode ? 'pt-active' : ''}" data-action="toggleLockMode">🔒 Verrouillage : ${state.lockMode ? 'oui' : 'non'}</button>
      <button class="pt-secondary" data-action="openSub">Blessure / expulsion</button>
      <button class="pt-secondary" data-action="print">🖨️ Imprimer</button>
    </div>
    <div class="pt-dim">Touchez une case pour ajouter/retirer un joueur. ${state.lockMode ? 'Mode verrouillage : touchez une case pour la verrouiller.' : 'Appui long (ou mode verrouillage) pour verrouiller une case : le générateur la conserve (case vide verrouillée = ne pas jouer).'}</div>
    <div class="pt-alerts">${alerts}</div>
    <div class="pt-gridwrap ${state.lockMode ? 'pt-lockmode' : ''}"><table class="pt-grid">
      <thead><tr><th class="pt-player">Joueur</th>${colHead.join('')}<th title="Moitiés comptées aux quarts 1 à 3">Σ</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${subPanel(g, ids)}
    ${subList(g)}`;
}

function subPanel(g, ids) {
  const f = state.subForm;
  if (!f) return '';
  const present = new Set(g.present);
  const listed = ids.filter(id => g.halves[f.half].includes(id));
  const incoming = ids.filter(id => present.has(id) && id !== f.outId && !g.halves[f.half].includes(id));
  const opt = (list, sel) => list.map(id => `<option value="${esc(id)}" ${id === sel ? 'selected' : ''}>${esc(g.players[id].number)} ${esc(g.players[id].name)}</option>`).join('');
  return `<div class="pt-panel"><h3>Blessure / expulsion</h3>
    <p class="pt-dim">Le joueur qui sort et celui qui entre reçoivent chacun une moitié, peu importe le temps joué. Le joueur sorti ne peut plus jouer aux quarts 1 à 3.</p>
    <div class="pt-form">
      <label>Moitié<select data-change="subHalf">${Array.from({ length: NUM_HALVES }, (_, h) => `<option value="${h}" ${h === f.half ? 'selected' : ''}>${esc(halfLabel(h))}</option>`).join('')}</select></label>
      <label>Joueur sorti<select data-change="subOut"><option value="">—</option>${opt(listed, f.outId)}</select></label>
      <label>Joueur entrant<select data-change="subIn"><option value="">—</option>${opt(incoming, f.inId)}</select></label>
      <label>Motif<select data-change="subReason"><option value="blessure" ${f.reason === 'blessure' ? 'selected' : ''}>Blessure</option><option value="expulsion" ${f.reason === 'expulsion' ? 'selected' : ''}>Expulsion</option></select></label>
      <button data-action="confirmSub" ${f.outId && f.inId ? '' : 'disabled'}>Confirmer</button>
      <button class="pt-secondary" data-action="closeSub">Annuler</button>
    </div></div>`;
}

function subList(g) {
  if (!g.injurySubs.length) return '';
  const nm = id => (g.players[id] ? `${g.players[id].number} ${g.players[id].name}` : id);
  return `<div class="pt-panel"><h3>Remplacements</h3><ul class="pt-list">${g.injurySubs.map((s, i) => `<li>
    <div class="pt-grow">${esc(halfLabel(s.half))} · ${esc(s.reason === 'expulsion' ? 'Expulsion' : 'Blessure')} : ${esc(nm(s.outId))} → ${esc(nm(s.inId))}</div>
    <button class="pt-secondary pt-small" data-action="deleteSub" data-i="${i}">Retirer</button></li>`).join('')}</ul></div>`;
}

// ---------------------------------------------------------------------------
// Planner state changes & saving
// ---------------------------------------------------------------------------
function changed() {
  render();
  scheduleSave();
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 500);
}

function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const g = state.game;
  const tid = state.route.teamId;
  if (!g || !tid || !db) return;
  fb.updateDoc(fb.doc(db, 'teams', tid, 'games', g.id), {
    date: g.date,
    time: g.time,
    opponent: g.opponent,
    location: g.location,
    players: g.players, // copy, used to show deleted players in old lineups
    absent: g.absent,
    present: g.present,
    halves: wrap(g.halves),
    locked: wrap(g.locked),
    q4: g.q4,
    injurySubs: g.injurySubs,
    updatedAt: fb.serverTimestamp(),
    updatedBy: state.user ? state.user.email : '',
  }).catch(err => { console.error(err); state.teamsError = err; render(); });
}

function toggleIn(list, id) {
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.push(id);
}

function toggleCell(id, h) {
  const g = state.game;
  if (!g || !g.present.includes(id)) return;
  toggleIn(h === Q4 ? g.q4 : g.halves[h], id);
  changed();
}

function toggleLock(id, h) {
  const g = state.game;
  if (!g || h === Q4) return;
  toggleIn(g.locked[h], id);
  changed();
}

function onPointerDown(e) {
  const b = e.target.closest('.pt-cell');
  if (!b || b.disabled) return;
  longFired = false;
  cancelPress();
  onPointerDown.timer = setTimeout(() => {
    longFired = true;
    toggleLock(b.dataset.p, Number(b.dataset.h));
  }, 550);
}
function cancelPress() { clearTimeout(onPointerDown.timer); }

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function onClick(e) {
  const cell = e.target.closest('.pt-cell');
  if (cell) {
    if (longFired) { longFired = false; return; }
    const id = cell.dataset.p, h = Number(cell.dataset.h);
    if (state.lockMode) toggleLock(id, h); else toggleCell(id, h);
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const g = state.game;
  const tid = state.route.teamId;
  switch (a) {
    case 'signin':
      fb.signInWithPopup(auth, new fb.GoogleAuthProvider()).catch(err => { console.error(err); alert('Connexion impossible : ' + (err.code || err.message)); });
      break;
    case 'signout':
      fb.signOut(auth);
      break;
    case 'togglePlayer': {
      const t = team();
      const players = (t.players || []).map(p => p.id === el.dataset.id ? Object.assign({}, p, { active: p.active === false }) : p);
      fb.updateDoc(fb.doc(db, 'teams', t.id), { players });
      break;
    }
    case 'deletePlayer': {
      const t = team();
      const p = (t.players || []).find(x => x.id === el.dataset.id);
      if (!p || !confirm(`Supprimer ${p.number !== '' && p.number !== undefined ? '#' + p.number + ' ' : ''}${p.name} de l'équipe ?\n\nIl disparaît des matchs à venir. Dans les matchs où il est déjà inscrit, son nom reste affiché.\nPour une absence temporaire, utilisez plutôt « Désactiver ».`)) break;
      fb.updateDoc(fb.doc(db, 'teams', t.id), { players: (t.players || []).filter(x => x.id !== p.id) })
        .catch(err => { console.error(err); alert('Suppression impossible : ' + (err.code || err.message)); });
      break;
    }
    case 'deleteGame':
      if (confirm('Supprimer ce match définitivement ?')) fb.deleteDoc(fb.doc(db, 'teams', tid, 'games', el.dataset.id));
      break;
    case 'toggleAttendance': {
      if (!g) break;
      const id = el.dataset.id;
      toggleIn(g.absent, id);
      resolveGame(g, team());
      if (!g.present.includes(id)) {
        g.halves.forEach(l => { const i = l.indexOf(id); if (i >= 0) l.splice(i, 1); });
        g.locked.forEach(l => { const i = l.indexOf(id); if (i >= 0) l.splice(i, 1); });
        const i = g.q4.indexOf(id); if (i >= 0) g.q4.splice(i, 1);
      }
      changed();
      break;
    }
    case 'confirmImport': {
      const imp = state.importPreview;
      state.importPreview = null;
      if (imp && imp.teamId === tid) fb.updateDoc(fb.doc(db, 'teams', tid), { players: imp.players }).catch(err => { console.error(err); alert('Import impossible : ' + (err.code || err.message)); });
      render();
      break;
    }
    case 'cancelImport':
      state.importPreview = null;
      render();
      break;
    case 'print':
      printGame(g);
      break;
    case 'generate': {
      if (g.present.length < MIN_PLAYERS) {
        alert(`Il faut au moins ${MIN_PLAYERS} joueurs présents pour générer les alignements (actuellement ${g.present.length}).\n\nAjoutez des joueurs à l'équipe (page Joueurs) ou retirez des absences en touchant les noms dans « Présences ».`);
        break;
      }
      // New seed on every click: each press proposes a different valid plan.
      const r = suggestLineups(g, { seed: Math.floor(Math.random() * 2 ** 31) });
      g.halves = r.halves;
      changed();
      break;
    }
    case 'clearUnlocked':
      g.halves = g.halves.map((l, h) => l.filter(id => g.locked[h].includes(id)));
      changed();
      break;
    case 'toggleLockMode':
      state.lockMode = !state.lockMode;
      render();
      break;
    case 'openSub':
      state.subForm = { half: 0, outId: '', inId: '', reason: 'blessure' };
      render();
      break;
    case 'closeSub':
      state.subForm = null;
      render();
      break;
    case 'confirmSub': {
      const f = state.subForm;
      if (!f || !f.outId || !f.inId) break;
      g.injurySubs.push({ half: f.half, outId: f.outId, inId: f.inId, reason: f.reason });
      // The player going out cannot play later in Q1-Q3: clean up his later cells.
      for (let h = f.half + 1; h < NUM_HALVES; h++) {
        g.halves[h] = g.halves[h].filter(id => id !== f.outId);
        g.locked[h] = g.locked[h].filter(id => id !== f.outId);
      }
      state.subForm = null;
      changed();
      break;
    }
    case 'deleteSub':
      g.injurySubs.splice(Number(el.dataset.i), 1);
      changed();
      break;
    default:
  }
}

function onChange(e) {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const k = el.dataset.change;
  const t = team();
  if (k === 'gameField') {
    const g = state.game;
    const field = el.dataset.field;
    if (!g || !['date', 'time', 'opponent', 'location'].includes(field)) return;
    const v = el.value.trim();
    if (field === 'date' && !v) { el.value = g.date; return; }
    g[field] = v;
    state.editOpen = true; // keep the edit panel open after re-render
    changed();
    return;
  }
  if (k === 'importFile') {
    readImportFile(el).catch(err => { console.error(err); alert('Lecture du fichier impossible : ' + err.message); });
    return;
  }
  if (k === 'playerName' || k === 'playerNumber' || k === 'playerWeight') {
    const players = (t.players || []).map(p => {
      if (p.id !== el.dataset.id) return p;
      if (k === 'playerName') return Object.assign({}, p, { name: el.value.trim() || p.name });
      if (k === 'playerWeight') return Object.assign({}, p, { weight: Number(el.value) });
      return Object.assign({}, p, { number: Number(el.value) });
    });
    fb.updateDoc(fb.doc(db, 'teams', t.id), { players });
    return;
  }
  const f = state.subForm;
  if (!f) return;
  if (k === 'subHalf') { f.half = Number(el.value); f.outId = ''; f.inId = ''; }
  if (k === 'subOut') f.outId = el.value;
  if (k === 'subIn') f.inId = el.value;
  if (k === 'subReason') f.reason = el.value;
  render();
}

function onSubmit(e) {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const fd = new FormData(form);
  const kind = form.dataset.form;
  const user = state.user ? state.user.email : '';
  if (kind === 'addTeam') {
    const category = fd.get('category');
    fb.addDoc(fb.collection(db, 'teams'), {
      name: String(fd.get('name')).trim(),
      category,
      halfMinutes: category === 'novice' ? 3 : 4,
      players: [],
      createdBy: user,
    });
    form.reset();
  } else if (kind === 'addPlayer') {
    const t = team();
    const players = (t.players || []).concat([{ id: uid(), name: String(fd.get('name')).trim(), number: Number(fd.get('number')), weight: Number(fd.get('weight')) || DEFAULT_WEIGHT, active: true }]);
    fb.updateDoc(fb.doc(db, 'teams', t.id), { players });
    form.reset();
  } else if (kind === 'addGame') {
    const t = team();
    const active = (t.players || []).filter(p => p.active !== false);
    const players = {};
    active.forEach(p => { players[p.id] = { name: p.name, number: p.number, weight: p.weight || DEFAULT_WEIGHT }; });
    const present = active.map(p => p.id);
    const empty = () => wrap(Array.from({ length: NUM_HALVES }, () => []));
    const ref = fb.doc(fb.collection(db, 'teams', t.id, 'games'));
    fb.setDoc(ref, {
      date: fd.get('date'),
      time: fd.get('time') || '',
      opponent: String(fd.get('opponent')).trim(),
      location: String(fd.get('location')).trim(),
      players, present, absent: [],
      halves: empty(), locked: empty(), q4: [], injurySubs: [],
      updatedAt: fb.serverTimestamp(), updatedBy: user,
    }).catch(err => { console.error(err); });
    location.hash = `#/t/${esc(t.id)}/g/${ref.id}`;
  }
}

boot();
