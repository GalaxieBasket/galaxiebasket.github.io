/*
 * Galaxie Basket - Participation rule engine (pure, no DOM / Firebase).
 *
 * Importable from the browser (type="module") and from Node.
 *
 * Game shape used by the functions below (in-memory form):
 *   {
 *     players:    { [id]: { name, number, weight } }, // optional; weight (1-5) balances lineups
 *     present:    [id],                         // players dressed for the game
 *     halves:     [[id] x 6],                   // Q1-Q3, 2 halves each (indices 0..5)
 *     locked:     [[id] x 6],                   // locked cells (kept / forbidden by the generator)
 *     injurySubs: [{ half, outId, inId, reason }],
 *   }
 *
 * Halves: 0=Q1.1, 1=Q1.2, 2=Q2.1, 3=Q2.2, 4=Q3.1, 5=Q3.2. Q4 has no rule.
 */

export const NUM_HALVES = 6;
export const SLOTS = 5;
export const MAX_CREDITS = 4;
export const MIN_CREDITS = 2;
export const MIN_PLAYERS = 8;
export const MAX_PLAYERS = 15;
export const MIN_REACHING = 8;
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 5;
export const DEFAULT_WEIGHT = 3;

/** Skill weight of a player (1-5, default 3). */
export function playerWeight(game, id) {
  const w = Number(game.players && game.players[id] && game.players[id].weight);
  return Number.isFinite(w) && w >= MIN_WEIGHT && w <= MAX_WEIGHT ? w : DEFAULT_WEIGHT;
}

/** Total skill weight of each half's lineup (listed players only): [n x 6]. */
export function halfWeights(game) {
  return normHalves(game.halves).map(l => [...new Set(l)].reduce((sum, id) => sum + playerWeight(game, id), 0));
}

export function halfLabel(h) {
  return `Q${Math.floor(h / 2) + 1} · ${h % 2 === 0 ? '1re' : '2e'} moitié`;
}

export function halfShortLabel(h) {
  return `Q${Math.floor(h / 2) + 1}·${(h % 2) + 1}`;
}

function normHalves(arr) {
  const out = [];
  for (let h = 0; h < NUM_HALVES; h++) out.push(Array.isArray(arr && arr[h]) ? arr[h].slice() : []);
  return out;
}

function playerLabel(game, id) {
  const p = game.players && game.players[id];
  if (!p) return String(id);
  const num = p.number !== undefined && p.number !== null && p.number !== '' ? `#${p.number} ` : '';
  return `${num}${p.name || id}`.trim();
}

/** Sorting helper: by jersey number (numeric), then name, then id. */
export function comparePlayers(game) {
  return (a, b) => {
    const pa = (game.players && game.players[a]) || {};
    const pb = (game.players && game.players[b]) || {};
    const na = Number(pa.number), nb = Number(pb.number);
    const fa = Number.isFinite(na), fb = Number.isFinite(nb);
    if (fa && fb && na !== nb) return na - nb;
    if (fa !== fb) return fa ? -1 : 1;
    const c = String(pa.name || '').localeCompare(String(pb.name || ''));
    return c !== 0 ? c : String(a).localeCompare(String(b));
  };
}

/** For each half, the set of credited players: listed players + incoming injury subs. */
export function creditSets(game) {
  const halves = normHalves(game.halves);
  const sets = halves.map(l => new Set(l));
  for (const s of game.injurySubs || []) {
    if (s && s.inId && s.half >= 0 && s.half < NUM_HALVES) sets[s.half].add(s.inId);
  }
  return sets;
}

/** Credited halves in Q1-Q3 per player: { [id]: count }. */
export function creditedHalves(game) {
  const counts = {};
  for (const set of creditSets(game)) for (const id of set) counts[id] = (counts[id] || 0) + 1;
  return counts;
}

/** Half index at which each player was substituted out (injury / disqualification). */
export function outHalves(game) {
  const out = {};
  for (const s of game.injurySubs || []) {
    if (s && s.outId && (out[s.outId] === undefined || s.half < out[s.outId])) out[s.outId] = s.half;
  }
  return out;
}

export function isComplete(game) {
  return analyse(game).complete;
}

function analyse(game) {
  const halves = normHalves(game.halves);
  const sets = creditSets(game);
  const present = new Set(game.present || []);
  const out = outHalves(game);
  const before = {}; // credits before the current half
  const required = [];
  let complete = true;
  for (let h = 0; h < NUM_HALVES; h++) {
    let avail = 0;
    for (const id of present) {
      if (out[id] !== undefined && out[id] < h) continue;
      if ((before[id] || 0) >= MAX_CREDITS) continue;
      avail++;
    }
    const req = Math.min(SLOTS, avail);
    required.push(req);
    if (new Set(halves[h]).size < req) complete = false;
    for (const id of sets[h]) before[id] = (before[id] || 0) + 1;
  }
  return { halves, sets, present, out, required, complete };
}

/**
 * Validate a game plan. Returns [{ level: 'error'|'warning'|'info', message, half?, playerId? }].
 */
export function validateGame(game) {
  const issues = [];
  const push = (level, message, extra) => issues.push(Object.assign({ level, message }, extra || {}));
  const { halves, sets, present, out, required, complete } = analyse(game);
  const lbl = id => playerLabel(game, id);
  const credits = creditedHalves(game);

  // 1. Number of players dressed
  if (present.size < MIN_PLAYERS) {
    push('error', `Seulement ${present.size} joueur(s) présent(s) : minimum ${MIN_PLAYERS} requis, sinon c'est un forfait.`);
  }
  if (present.size > MAX_PLAYERS) {
    push('error', `${present.size} joueurs présents : maximum ${MAX_PLAYERS} sur la feuille de match.`);
  }

  // Injury substitutions sanity
  const subs = game.injurySubs || [];
  for (const s of subs) {
    if (!s) continue;
    const h = s.half;
    if (!(h >= 0 && h < NUM_HALVES)) continue;
    if (s.outId && !present.has(s.outId)) {
      push('error', `${lbl(s.outId)} est sorti sur blessure/expulsion mais n'est pas présent.`, { half: h, playerId: s.outId });
    }
    if (s.inId && !present.has(s.inId)) {
      push('error', `${lbl(s.inId)} entre sur blessure/expulsion mais n'est pas présent.`, { half: h, playerId: s.inId });
    }
    if (s.outId && !halves[h].includes(s.outId)) {
      push('warning', `${lbl(s.outId)} est sorti en ${halfLabel(h)} mais n'est pas inscrit dans cette moitié : il n'est pas compté.`, { half: h, playerId: s.outId });
    }
    // V.2: a player who already has 4 halves cannot come back before Q4
    if (s.inId) {
      let prior = 0;
      for (let k = 0; k < h; k++) if (sets[k].has(s.inId)) prior++;
      if (prior >= MAX_CREDITS) {
        push('error', `${lbl(s.inId)} a déjà ${MAX_CREDITS} moitiés et ne peut pas revenir avant le 4e quart (règle V.2).`, { half: h, playerId: s.inId });
      }
    }
  }

  // Per-half checks
  for (let h = 0; h < NUM_HALVES; h++) {
    const list = halves[h];
    const uniq = new Set(list);
    if (uniq.size !== list.length) {
      push('error', `${halfLabel(h)} : un joueur est inscrit plusieurs fois.`, { half: h });
    }
    for (const id of uniq) {
      if (!present.has(id)) {
        push('error', `${lbl(id)} est absent mais inscrit en ${halfLabel(h)}.`, { half: h, playerId: id });
      }
      if (out[id] !== undefined && out[id] < h) {
        push('error', `${lbl(id)} est sorti sur blessure/expulsion (${halfLabel(out[id])}) et ne peut plus jouer en ${halfLabel(h)}.`, { half: h, playerId: id });
      }
    }
    const n = uniq.size;
    if (n > SLOTS) {
      push('error', `${halfLabel(h)} : ${n} joueurs sur le terrain (maximum ${SLOTS}).`, { half: h });
    } else if (n < required[h]) {
      push('warning', `${halfLabel(h)} : ${n}/${SLOTS} joueurs, il en manque ${required[h] - n}.`, { half: h });
    } else if (n < SLOTS) {
      push('warning', `${halfLabel(h)} : seulement ${n} joueur(s) éligible(s), jeu à effectif réduit.`, { half: h });
    }
  }

  // 3. Max 4 halves
  for (const id of Object.keys(credits)) {
    if (credits[id] > MAX_CREDITS) {
      push('error', `${lbl(id)} a ${credits[id]} moitiés (maximum ${MAX_CREDITS} aux quarts 1 à 3).`, { playerId: id });
    }
  }

  // 4. At least 8 players with 2+ halves
  const presentIds = [...present];
  const reaching = presentIds.filter(id => (credits[id] || 0) >= MIN_CREDITS).length;
  if (complete) {
    if (reaching < MIN_REACHING) {
      push('error', `Seulement ${reaching} joueur(s) avec au moins ${MIN_CREDITS} moitiés : il en faut ${MIN_REACHING}.`);
    }
  } else {
    feasibility(game, halves, sets, present, out, credits, issues, lbl);
  }

  if (complete && !issues.some(i => i.level !== 'info')) {
    push('info', 'Plan conforme à la règle de participation.');
  }
  return issues;
}

function feasibility(game, halves, sets, present, out, credits, issues, lbl) {
  const free = halves.map(l => Math.max(0, SLOTS - new Set(l).size));
  const totalFree = free.reduce((a, b) => a + b, 0);
  const ids = [...present];
  const reachable = [];
  for (const id of ids) {
    let avail = 0;
    for (let h = 0; h < NUM_HALVES; h++) {
      if (free[h] > 0 && !sets[h].has(id) && !(out[id] !== undefined && out[id] < h)) avail++;
    }
    const c = credits[id] || 0;
    const max = Math.min(MAX_CREDITS, c + avail);
    if (max >= MIN_CREDITS) reachable.push(Math.max(0, MIN_CREDITS - c));
  }
  if (ids.length >= MIN_PLAYERS) {
    if (reachable.length < MIN_REACHING) {
      issues.push({ level: 'warning', message: `Seulement ${reachable.length} joueur(s) peuvent encore atteindre ${MIN_CREDITS} moitiés : il en faut ${MIN_REACHING}.` });
    } else {
      reachable.sort((a, b) => a - b);
      const need = reachable.slice(0, MIN_REACHING).reduce((a, b) => a + b, 0);
      if (need > totalFree) {
        issues.push({ level: 'warning', message: `Il reste ${totalFree} place(s) libre(s) mais il en faut au moins ${need} pour que ${MIN_REACHING} joueurs atteignent ${MIN_CREDITS} moitiés.` });
      }
    }
  }
  for (let h = 0; h < NUM_HALVES; h++) {
    if (free[h] === 0) continue;
    let cand = 0;
    for (const id of ids) {
      if (sets[h].has(id)) continue;
      if (out[id] !== undefined && out[id] < h) continue;
      if ((credits[id] || 0) >= MAX_CREDITS) continue;
      cand++;
    }
    if (cand < free[h]) {
      issues.push({ level: 'warning', message: `${halfLabel(h)} ne pourra plus être complétée : ${free[h]} place(s) libre(s) pour ${cand} joueur(s) disponible(s).`, half: h });
    }
  }
}

/**
 * Generate lineups. Keeps locked cells that are listed (forced in) and treats locked cells
 * that are not listed as forbidden. All other cells are cleared and refilled.
 * Deterministic by default; pass `opts.seed` (any integer) to shuffle the tie-breaks and get a
 * different valid plan for each seed. Returns { halves, issues } and does not mutate the game.
 */
export function suggestLineups(game, opts = {}) {
  const cmp = comparePlayers(game);
  const present = [...new Set(game.present || [])].sort(cmp);
  if (opts.seed !== undefined) shuffle(present, mulberry32(opts.seed));
  const presentSet = new Set(present);
  const order = {};
  present.forEach((id, i) => { order[id] = i; });
  const oldHalves = normHalves(game.halves);
  const lockedIn = normHalves(game.locked);
  const out = outHalves(game);
  const subs = game.injurySubs || [];

  const kept = [];
  const forbidden = [];
  for (let h = 0; h < NUM_HALVES; h++) {
    const lk = new Set(lockedIn[h]);
    kept.push(oldHalves[h].filter((id, i, a) => lk.has(id) && presentSet.has(id) && a.indexOf(id) === i));
    forbidden.push(new Set(lockedIn[h].filter(id => !oldHalves[h].includes(id))));
  }
  // Outgoing players of an injury sub are forced in their half (if there is room).
  for (const s of subs) {
    if (s && s.outId && presentSet.has(s.outId) && s.half >= 0 && s.half < NUM_HALVES) {
      if (!kept[s.half].includes(s.outId) && kept[s.half].length < SLOTS) kept[s.half].push(s.outId);
    }
  }
  // Incoming players are already credited in that half: they are not listed again.
  const subIn = Array.from({ length: NUM_HALVES }, () => new Set());
  for (const s of subs) {
    if (s && s.inId && s.half >= 0 && s.half < NUM_HALVES && presentSet.has(s.inId) && !kept[s.half].includes(s.inId)) {
      subIn[s.half].add(s.inId);
    }
  }

  const credits = {};
  for (const id of present) credits[id] = 0;
  for (let h = 0; h < NUM_HALVES; h++) {
    for (const id of kept[h]) credits[id]++;
    for (const id of subIn[h]) credits[id]++;
  }

  const can = (id, h) =>
    !(out[id] !== undefined && out[id] < h) &&
    !forbidden[h].has(id) &&
    !kept[h].includes(id) &&
    !subIn[h].has(id);

  const need = kept.map(k => Math.max(0, SLOTS - k.length));
  const totalNeed = need.reduce((a, b) => a + b, 0);

  // Water-filling of targets: give each slot to the player with the lowest total.
  const add = {};
  const cap = {};
  for (const id of present) {
    add[id] = 0;
    let avail = 0;
    for (let h = 0; h < NUM_HALVES; h++) if (need[h] > 0 && can(id, h)) avail++;
    cap[id] = Math.min(Math.max(0, MAX_CREDITS - credits[id]), avail);
  }
  for (let u = 0; u < totalNeed; u++) {
    let best = null;
    for (const id of present) {
      if (add[id] >= cap[id]) continue;
      if (best === null || credits[id] + add[id] < credits[best] + add[best]) best = id;
    }
    if (best === null) break;
    add[best]++;
  }

  const run = hOrder => {
    const addL = Object.assign({}, add);
    const total = Object.assign({}, credits);
    const lastPlayed = {};
    for (const id of present) lastPlayed[id] = -10;
    const lists = new Array(NUM_HALVES);
    let short = 0;
    for (const h of hOrder) {
      const list = kept[h].slice();
      for (const id of list) lastPlayed[id] = h;
      const picks = present
        .filter(id => can(id, h) && addL[id] > 0)
        .sort((a, b) => (addL[b] - addL[a]) || (lastPlayed[a] - lastPlayed[b]) || (order[a] - order[b]));
      for (const id of picks) {
        if (list.length >= SLOTS) break;
        list.push(id);
        addL[id]--;
        total[id]++;
      }
      if (list.length < SLOTS) {
        // Fallback: anybody still allowed, fewest credits first.
        const rest = present
          .filter(id => can(id, h) && !list.includes(id) && total[id] < MAX_CREDITS)
          .sort((a, b) => (total[a] - total[b]) || (lastPlayed[a] - lastPlayed[b]) || (order[a] - order[b]));
        for (const id of rest) {
          if (list.length >= SLOTS) break;
          list.push(id);
          total[id]++;
        }
      }
      short += Math.max(0, SLOTS - list.length);
      for (const id of list) lastPlayed[id] = h;
      lists[h] = list;
    }
    return { lists, short };
  };

  // Natural order first; if a half cannot be filled, retry other half orders (deterministic).
  let best = run([0, 1, 2, 3, 4, 5]);
  if (best.short > 0) {
    for (const o of permutations([0, 1, 2, 3, 4, 5])) {
      const r = run(o);
      if (r.short < best.short) best = r;
      if (best.short === 0) break;
    }
  }
  balanceWeights(best.lists, id => playerWeight(game, id), h => new Set(kept[h]), can, subIn);
  const result = best.lists.map(l => l.slice().sort(cmp));

  const next = Object.assign({}, game, { halves: result });
  return { halves: result, issues: validateGame(next) };
}

/**
 * Even out the total skill weight of the halves. Two moves, both leaving the multiset of
 * participation counts unchanged (so the rule and the even split of halves still hold):
 *  - swap: x moves from half A to B and y from B to A (nobody's count changes);
 *  - hand-over: in half A, x (one of the players with an extra half) is replaced by y (one
 *    with one half less), so they exchange their counts.
 * Locked / forced cells never move. Mutates `lists`.
 */
function balanceWeights(lists, weight, keptSet, can, subIn) {
  const totals = lists.map(l => l.reduce((sum, id) => sum + weight(id), 0));
  const kept = lists.map((l, h) => keptSet(h));
  const count = {};
  lists.forEach((l, h) => {
    for (const id of l) count[id] = (count[id] || 0) + 1;
    for (const id of subIn[h]) count[id] = (count[id] || 0) + 1;
  });
  const fixed = new Set();
  lists.forEach((l, h) => { for (const id of kept[h]) fixed.add(id); for (const id of subIn[h]) fixed.add(id); });
  const ids = Object.keys(count).filter(id => !fixed.has(id));

  // Variance of the half totals (lower = more even).
  const variance = () => {
    let sum = 0, sumSq = 0;
    for (const t of totals) { sum += t; sumSq += t * t; }
    return sumSq / NUM_HALVES - (sum / NUM_HALVES) ** 2;
  };
  const moves = () => {
    const res = [];
    for (let a = 0; a < NUM_HALVES; a++) {
      for (const x of lists[a]) {
        if (fixed.has(x)) continue;
        // Hand-over: x (n+1 halves) gives half a to y (n halves).
        for (const y of ids) {
          if (count[x] === count[y] + 1 && count[y] >= MIN_CREDITS && !lists[a].includes(y) && can(y, a)) {
            res.push({ a, b: -1, x, y });
          }
        }
        // Swap: x moves a -> b, y moves b -> a.
        for (let b = a + 1; b < NUM_HALVES; b++) {
          if (lists[b].includes(x) || !can(x, b)) continue;
          for (const y of lists[b]) {
            if (!fixed.has(y) && !lists[a].includes(y) && can(y, a)) res.push({ a, b, x, y });
          }
        }
      }
    }
    return res.filter(m => weight(m.x) !== weight(m.y));
  };
  const apply = (m, undo) => {
    const [from, to] = undo ? [m.y, m.x] : [m.x, m.y];
    const d = weight(to) - weight(from);
    lists[m.a][lists[m.a].indexOf(from)] = to;
    totals[m.a] += d;
    if (m.b >= 0) {
      lists[m.b][lists[m.b].indexOf(to)] = from;
      totals[m.b] -= d;
    } else {
      count[from]--;
      count[to]++;
    }
  };
  const gainOf = (m, base) => { apply(m); const v = variance(); apply(m, true); return v - base; };

  for (let iter = 0; iter < 100; iter++) {
    const base = variance();
    if (base < 1e-9) break;
    const first = moves();
    let best = null;
    for (const m of first) {
      const g = gainOf(m, base);
      if (g < -1e-9 && (best === null || g < best.g)) best = { g, seq: [m] };
    }
    if (best === null) {
      // No single move helps: look for an improving pair of moves.
      for (const m of first) {
        apply(m);
        for (const m2 of moves()) {
          const g = gainOf(m2, base);
          if (g < -1e-9 && (best === null || g < best.g)) best = { g, seq: [m, m2] };
        }
        apply(m, true);
      }
    }
    if (best === null) break;
    for (const m of best.seq) apply(m);
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const res = [];
  arr.forEach((x, i) => {
    for (const p of permutations(arr.slice(0, i).concat(arr.slice(i + 1)))) res.push([x].concat(p));
  });
  return res;
}

/*
 * Roster CSV import (pure). Accepts ',', ';' or tab separators, quoted fields, a UTF-8 BOM and
 * an optional header row. Columns are found by header name (numéro / nom / prénom / niveau);
 * without a header the order is: number, name, level.
 * Returns { rows: [{ line, number, name, weight }], errors: [{ line, message }] }.
 */
export function parseRosterCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/).find(l => l.trim() !== '') || '';
  const sep = [';', '\t', ','].map(c => [c, splitCsvLine(firstLine, c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const lines = src.split(/\r?\n/).map((l, i) => ({ line: i + 1, cells: splitCsvLine(l, sep).map(c => c.trim()) }))
    .filter(l => l.cells.some(c => c !== ''));
  const rows = [];
  const errors = [];
  if (!lines.length) return { rows, errors };

  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z#]/g, '');
  const head = lines[0].cells.map(norm);
  const find = keys => head.findIndex(h => keys.includes(h));
  let col = {
    number: find(['numero', 'no', 'num', '#', 'number', 'dossard', 'chandail', 'jersey']),
    first: find(['prenom', 'firstname', 'first']),
    last: find(['nom', 'nomdefamille', 'lastname', 'last']),
    name: find(['joueur', 'joueuse', 'name', 'nomcomplet', 'fullname']),
    weight: find(['niveau', 'level', 'poids', 'weight', 'force']),
  };
  const hasHeader = Object.values(col).some(i => i >= 0);
  if (!hasHeader) col = { number: 0, first: -1, last: -1, name: 1, weight: 2 };
  else if (col.name < 0 && col.first < 0 && col.last >= 0) { col.name = col.last; col.last = -1; }

  for (const { line, cells } of hasHeader ? lines.slice(1) : lines) {
    const get = i => (i >= 0 && i < cells.length ? cells[i] : '');
    const name = [get(col.first), get(col.name), get(col.last)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const numRaw = get(col.number).replace(/^#/, '');
    const wRaw = get(col.weight);
    if (!name) { errors.push({ line, message: 'nom manquant' }); continue; }
    const number = Number(numRaw);
    if (numRaw === '' || !Number.isInteger(number) || number < 0 || number > 99) {
      errors.push({ line, message: `numéro invalide « ${numRaw} » pour ${name}` });
      continue;
    }
    let weight = DEFAULT_WEIGHT;
    if (wRaw !== '') {
      const w = Number(wRaw.replace(',', '.'));
      if (Number.isInteger(w) && w >= MIN_WEIGHT && w <= MAX_WEIGHT) weight = w;
      else errors.push({ line, message: `niveau invalide « ${wRaw} » pour ${name} : ${DEFAULT_WEIGHT} utilisé` });
    }
    rows.push({ line, number, name, weight });
  }
  return { rows, errors };
}

function splitCsvLine(line, sep) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Merge imported rows into a roster: a row whose name matches an existing player (case and
 * accents ignored) updates its number / level and reactivates it; other rows are added.
 * Returns { players, added: [row], updated: [row] }. `newId` creates ids for added players.
 */
export function mergeRoster(players, rows, newId) {
  const key = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const next = (players || []).map(p => Object.assign({}, p));
  const byName = {};
  next.forEach(p => { byName[key(p.name)] = p; });
  const added = [], updated = [];
  for (const r of rows) {
    const p = byName[key(r.name)];
    if (p) {
      p.number = r.number;
      p.weight = r.weight;
      p.active = true;
      updated.push(r);
    } else {
      const np = { id: newId(), name: r.name, number: r.number, weight: r.weight, active: true };
      next.push(np);
      byName[key(r.name)] = np;
      added.push(r);
    }
  }
  return { players: next, added, updated };
}
