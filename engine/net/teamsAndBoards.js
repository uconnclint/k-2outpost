// teamsAndBoards.js — TeamsAndBoards: voxel type's `Social` Durable Object
// (src/worker.js:344-488) ported near-verbatim — same endpoints, same JSON
// shapes, same weekly-reset mechanics. HTTP-only (no WebSocket at all), so
// unlike snapshotRelayRoom.js/tickedLobbyRoom.js this does NOT subclass
// RoomDO (which is fundamentally about WebSocket rooms); it extends the
// Workers `DurableObject` base directly, via the same lazily-resolved,
// plain-node-safe import `roomDO.js` uses (see its header for why a bare
// top-level `cloudflare:workers` import would break `node --test`).
//
// The one behavior change from the source: name inputs (player names, team
// names) run through `moderation.checkName` instead of the inline
// copy-pasted checker voxel type's worker.js carried — same validation,
// shared implementation.

import { resolveDurableObjectBase } from './roomDO.js';
import { checkName } from './moderation.js';

const DurableObjectBase = await resolveDurableObjectBase();

const validPid = (pid) => typeof pid === 'string' && /^[a-zA-Z0-9-]{8,64}$/.test(pid);

// Kid-supplied ids index these records, and the pid validator happily accepts "toString" or
// "constructor" — on a plain object those hit inherited Object.prototype members (register
// then throws assigning .name onto a built-in function). A null prototype makes every id just
// a key. Storage round-trips restore plain objects, so loads must re-strip via this too.
const bareRecord = (source) => Object.assign(Object.create(null), source);

/** Monday of the current week as "YYYY-MM-DD" — leaderboards reset here. */
export function weekKey(now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export class TeamsAndBoards extends DurableObjectBase {
  /**
   * @param {*} ctx
   * @param {*} env
   * @param {object} [options]
   * @param {number} [options.maxTeamSize=5]
   * @param {number} [options.maxTypingMsPerReport=600000]  10 minutes
   * @param {number} [options.maxScore=400]
   * @param {number} [options.maxWpm=250]
   * @param {string[]} [options.blocklist]  extra game-specific banned words for checkName
   */
  constructor(ctx, env, options = {}) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.maxTeamSize = Number.isInteger(options.maxTeamSize) ? options.maxTeamSize : 5;
    this.maxTypingMsPerReport = options.maxTypingMsPerReport ?? 10 * 60 * 1000;
    this.maxScore = options.maxScore ?? 400;
    this.maxWpm = options.maxWpm ?? 250;
    this.blocklist = options.blocklist;

    this.store = { players: bareRecord(), teams: bareRecord() };
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('store');
      if (saved) this.store = { players: bareRecord(saved.players), teams: bareRecord(saved.teams) };
    });
  }

  async save() { await this.ctx.storage.put('store', this.store); }

  checkName(raw, kind) {
    const result = checkName(raw, { blocklist: this.blocklist, maxLen: 20 });
    if (result.ok) return result;
    return { ok: false, reason: result.reason.replace(/^Name /, `${kind || 'Name'} `) };
  }

  weekOf(player) {
    player.weeks ||= {};
    return (player.weeks[weekKey()] ||= { typingMs: 0, bestScore: 0, bestWpm: 0, races: 0 });
  }

  teamOf(pid) {
    return Object.values(this.store.teams).find((t) => t.members.includes(pid)) || null;
  }

  leaveTeam(pid) {
    const t = this.teamOf(pid);
    if (!t) return;
    t.members = t.members.filter((m) => m !== pid);
    if (!t.members.length) delete this.store.teams[t.id];
  }

  teamView(t) {
    if (!t) return null;
    return {
      id: t.id,
      name: t.name,
      members: t.members.map((pid) => {
        const p = this.store.players[pid] || { name: '???' };
        const wk = p.weeks?.[weekKey()] || { typingMs: 0, bestScore: 0 };
        return { id: pid, name: p.name, typingMs: wk.typingMs, bestScore: wk.bestScore };
      }),
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    let body = {};
    if (request.method === 'POST') {
      try { body = await request.json(); } catch { body = {}; }
      // JSON "null"/primitives parse without throwing but would blow up destructuring below.
      if (!body || typeof body !== 'object') body = {};
    }

    if (path === '/api/register' && request.method === 'POST') {
      const { playerId, name } = body;
      if (!validPid(playerId)) return Response.json({ ok: false, reason: 'Bad player id' });
      const check = this.checkName(name, 'Name');
      if (!check.ok) return Response.json(check);
      this.store.players[playerId] ||= { name: check.name };
      this.store.players[playerId].name = check.name;
      await this.save();
      return Response.json({ ok: true, name: check.name, team: this.teamView(this.teamOf(playerId)) });
    }

    if (path === '/api/social') {
      const pid = url.searchParams.get('playerId');
      const mine = validPid(pid) ? this.teamOf(pid) : null;
      return Response.json({
        ok: true,
        team: this.teamView(mine),
        teams: Object.values(this.store.teams).map((t) => ({
          id: t.id, name: t.name, count: t.members.length, full: t.members.length >= this.maxTeamSize,
        })).sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    if (path === '/api/teams/create' && request.method === 'POST') {
      const { playerId, name } = body;
      if (!validPid(playerId) || !this.store.players[playerId]) {
        return Response.json({ ok: false, reason: 'Race once first, then create a team!' });
      }
      const check = this.checkName(name, 'Team name');
      if (!check.ok) return Response.json(check);
      const clash = Object.values(this.store.teams).find((t) => t.name.toLowerCase() === check.name.toLowerCase());
      if (clash) return Response.json({ ok: false, reason: 'A team already has that name' });
      this.leaveTeam(playerId);
      const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      this.store.teams[id] = { id, name: check.name, createdBy: playerId, members: [playerId] };
      await this.save();
      return Response.json({ ok: true, team: this.teamView(this.store.teams[id]) });
    }

    if (path === '/api/teams/join' && request.method === 'POST') {
      const { playerId, teamId } = body;
      if (!validPid(playerId) || !this.store.players[playerId]) {
        return Response.json({ ok: false, reason: 'Race once first, then join a team!' });
      }
      const t = this.store.teams[teamId];
      if (!t) return Response.json({ ok: false, reason: 'That team is gone' });
      if (t.members.includes(playerId)) return Response.json({ ok: true, team: this.teamView(t) });
      if (t.members.length >= this.maxTeamSize) {
        return Response.json({ ok: false, reason: `That team is full (${this.maxTeamSize} racers max)` });
      }
      this.leaveTeam(playerId);
      t.members.push(playerId);
      await this.save();
      return Response.json({ ok: true, team: this.teamView(t) });
    }

    if (path === '/api/teams/leave' && request.method === 'POST') {
      const { playerId } = body;
      if (validPid(playerId)) { this.leaveTeam(playerId); await this.save(); }
      return Response.json({ ok: true });
    }

    if (path === '/api/report' && request.method === 'POST') {
      const { playerId, typingMs, score, wpm, finished } = body;
      if (!validPid(playerId) || !this.store.players[playerId]) return Response.json({ ok: false });
      const wk = this.weekOf(this.store.players[playerId]);
      wk.typingMs += Math.max(0, Math.min(this.maxTypingMsPerReport, Number(typingMs) || 0));
      if (finished) {
        wk.races++;
        wk.bestScore = Math.max(wk.bestScore, Math.max(0, Math.min(this.maxScore, Math.round(Number(score) || 0))));
        wk.bestWpm = Math.max(wk.bestWpm, Math.max(0, Math.min(this.maxWpm, Math.round(Number(wpm) || 0))));
      }
      await this.save();
      return Response.json({ ok: true });
    }

    if (path === '/api/leaderboards') {
      const wk = weekKey();
      const players = Object.entries(this.store.players).map(([id, p]) => {
        const w = p.weeks?.[wk] || { typingMs: 0, bestScore: 0, bestWpm: 0 };
        return { id, name: p.name, team: this.teamOf(id)?.name || null, typingMs: w.typingMs, bestScore: w.bestScore, bestWpm: w.bestWpm };
      });
      const teams = Object.values(this.store.teams).map((t) => {
        const ms = t.members.map((pid) => this.store.players[pid]?.weeks?.[wk] || { typingMs: 0, bestScore: 0 });
        return {
          id: t.id, name: t.name, count: t.members.length,
          typingMs: ms.reduce((s, m) => s + m.typingMs, 0),
          bestScore: ms.reduce((s, m) => s + m.bestScore, 0),
        };
      });
      const top = (arr, key) => [...arr].filter((x) => x[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, 15);
      return Response.json({
        ok: true,
        week: wk,
        individuals: { time: top(players, 'typingMs'), score: top(players, 'bestScore') },
        teams: { time: top(teams, 'typingMs'), score: top(teams, 'bestScore') },
      });
    }

    return Response.json({ ok: false, reason: 'Unknown endpoint' }, { status: 404 });
  }
}
