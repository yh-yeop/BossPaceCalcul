import {
  LIMIT_MIN, analyze, predict, requiredControl, minRatio, clamp, fmtTime, fmtTimeKo, parseTime,
} from './calc.js';
import { renderCard } from './share.js';

const $ = id => document.getElementById(id);
const el = {
  boss: $('boss'), ratio: $('ratio'),
  min: $('clearMin'), sec: $('clearSec'), hp: $('hpLeft'), deadMin: $('deadMin'), deadSec: $('deadSec'),
  clearBox: $('clearInputs'), failBox: $('failInputs'),
  btnClear: $('modeClear'), btnFail: $('modeFail'),
  track: $('track'), fill: $('fill'), mark: $('idealMark'),
  ctrlPct: $('ctrlPct'), ctrlNote: $('ctrlNote'), minRatio: $('minRatio'), verdict: $('verdict'),
  ctrlIn: $('ctrlIn'), ctrlSync: $('ctrlSync'),
  tabRatio: $('tabRatio'), tabTime: $('tabTime'), paneRatio: $('paneRatio'), paneTime: $('paneTime'),
  goalRatio: $('goalRatio'), goalMin: $('goalMin'), goalSec: $('goalSec'),
  outRatio: $('outRatio'), outTime: $('outTime'),
  feelList: $('feelList'), toast: $('toast'),
  histList: $('histList'), histChart: $('histChart'),
};

const STATE_KEY = 'bpc:state';

let mode = 'clear';
let goalTab = 'ratio';
let ctrlOverride = false; // 기준 컨트롤을 직접 입력했는지
let last = null;          // 마지막 기록 분석 결과

const num = e => { const v = parseFloat(e.value); return isFinite(v) ? v : 0; };
const f1 = v => (isFinite(v) ? v.toFixed(1) : '불가');
// 분·초 입력 두 칸 → 분(소수)
const minutesOf = (m, s) => num(m) + clamp(num(s), 0, 59) / 60;
// 분(소수) → ["m", "ss"] / 분·초 입력 두 칸에 넣기
function splitMinSec(min) {
  const total = Math.round(min * 60);
  return [String(Math.floor(total / 60)), String(total % 60)];
}
function setMinSec(m, s, min) { [m.value, s.value] = splitMinSec(min); }
// 딜 불가 시간이 있으면 "딜 불가 N분 제외" 문구
const deadNote = dead => (dead > 0 ? `딜 불가 ${fmtTimeKo(dead)} 제외` : '');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 불가 환경 무시 */ }
}

/* ---------- 모드 / 탭 ---------- */
function setMode(m) {
  mode = m;
  el.clearBox.hidden = m !== 'clear';
  el.failBox.hidden = m !== 'fail';
  el.btnClear.setAttribute('aria-pressed', m === 'clear');
  el.btnFail.setAttribute('aria-pressed', m === 'fail');
  update();
}
function setTab(t) {
  goalTab = t;
  el.paneRatio.hidden = t !== 'ratio';
  el.paneTime.hidden = t !== 'time';
  for (const [b, on] of [[el.tabRatio, t === 'ratio'], [el.tabTime, t === 'time']]) {
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-selected', on);
  }
  persist();
}
/* ---------- 입력 상태 ---------- */
function readState() {
  return {
    boss: el.boss.value.trim(), ratio: el.ratio.value, mode,
    min: el.min.value, sec: el.sec.value, hp: el.hp.value, deadMin: el.deadMin.value, deadSec: el.deadSec.value,
    goalRatio: el.goalRatio.value, goalMin: el.goalMin.value, goalSec: el.goalSec.value, goalTab,
  };
}
function persist() { save(STATE_KEY, readState()); }
function applyState(s) {
  if (!s) return;
  const map = { boss: el.boss, ratio: el.ratio, min: el.min, sec: el.sec, hp: el.hp,
    deadMin: el.deadMin, deadSec: el.deadSec, goalRatio: el.goalRatio, goalMin: el.goalMin, goalSec: el.goalSec };
  for (const [k, e] of Object.entries(map)) if (s[k] != null) e.value = s[k];
  if (s.goalTab) goalTab = s.goalTab;
  if (s.mode === 'clear' || s.mode === 'fail') mode = s.mode;
}

// 공유 링크: ?b=보스&r=184.6&t=13:00  또는  ?r=184.6&hp=24.7  (+ 선택 d=1:30 딜 불가 시간)
function stateFromUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has('r')) return null;
  const s = { ratio: q.get('r'), boss: q.get('b') || '', deadMin: '0', deadSec: '0' };
  if (q.has('hp')) {
    s.mode = 'fail'; s.hp = q.get('hp');
  } else if (q.has('t')) {
    s.mode = 'clear'; [s.min, s.sec] = splitMinSec(parseTime(q.get('t')));
  }
  if (q.has('d')) [s.deadMin, s.deadSec] = splitMinSec(parseTime(q.get('d')));
  return s;
}
function shareUrl() {
  const q = new URLSearchParams();
  const boss = el.boss.value.trim();
  if (boss) q.set('b', boss);
  q.set('r', String(num(el.ratio)));
  if (mode === 'clear') q.set('t', fmtTime(minutesOf(el.min, el.sec)));
  else q.set('hp', String(num(el.hp)));
  const dead = minutesOf(el.deadMin, el.deadSec);
  if (dead > 0) q.set('d', fmtTime(dead));
  return location.origin + location.pathname + '?' + q.toString();
}

/* ---------- 계산 & 렌더 ---------- */
function update() {
  const ratio = num(el.ratio);
  const timeMin = minutesOf(el.min, el.sec);
  const hpLeft = clamp(num(el.hp), 0, 100);
  const deadMin = minutesOf(el.deadMin, el.deadSec);
  const a = analyze({ ratio, mode, timeMin, hpLeft, deadMin });
  last = { ...a, ratio, timeMin, hpLeft, valid: ratio > 0 && a.c > 0 };

  renderRecord();
  if (!ctrlOverride) el.ctrlIn.value = last.valid ? f1(a.c * 100) : '';
  el.ctrlSync.hidden = !ctrlOverride;
  renderGoal();
  renderFeel();
  persist();
}

function renderRecord() {
  const { ratio, ideal, actual, c, cleared, timeMin, hpLeft, dead, elapsed, valid } = last;
  const minR = minRatio(c, LIMIT_MIN, dead);
  const dn = deadNote(dead);

  el.ctrlPct.innerHTML = valid ? f1(c * 100) + '<small>%</small>' : '—';
  el.minRatio.textContent = valid ? f1(minR) : '—';
  el.ctrlNote.textContent = valid
    ? `배율이 요구하는 분당 ${ideal.toFixed(2)}% 중 ${actual.toFixed(2)}%를 뽑음${dn ? ` (${dn})` : ''}`
    : '';

  // 트랙: 20분 대비 위치
  const myPct = cleared ? clamp(timeMin / LIMIT_MIN * 100, 0, 100) : 100;
  const idealPct = ideal > 0 ? clamp(100 / ideal / LIMIT_MIN * 100, 0, 100) : 100;
  el.fill.style.width = myPct + '%';
  el.mark.style.left = `calc(${idealPct}% - 1px)`;
  el.fill.className = 'fill ' + (cleared ? 'done' : 'short');

  const v = el.verdict;
  if (ratio <= 0) { v.className = 'verdict'; v.textContent = '배율을 입력하면 결과가 나옵니다.'; return; }
  if (!valid && dead > 0 && dead >= elapsed) {
    v.className = 'verdict'; v.textContent = '딜 불가 시간이 걸린 시간보다 길 수 없습니다.'; return;
  }
  if (!valid) { v.className = 'verdict'; v.textContent = '기록을 입력하면 결과가 나옵니다.'; return; }
  const tail = dn ? ` <span class="dead-note">${dn}</span>` : '';
  if (cleared) {
    v.className = 'verdict ok';
    const over = timeMin > LIMIT_MIN ? ' (20분 초과 기록이라 참고용입니다)' : '';
    v.innerHTML = `배율 ${f1(ratio)}을 <b>${fmtTimeKo(timeMin)}</b>에 클리어. 이 컨트롤이면 배율 <b>${f1(minR)}</b>까지 20분 안에 잡힙니다.${over}${tail}`;
  } else {
    v.className = 'verdict no';
    v.innerHTML = `배율 ${f1(ratio)}에서 <b>${f1(hpLeft)}%</b> 남기고 종료. 20분 컷하려면 배율이 <b>${f1(minR)}</b> 이상이어야 합니다.${tail}`;
  }
}

// 02·03·파티 계산에 적용하는 딜 불가 시간 — 내 기록에 넣은 값을 같은 패턴으로 가정한다
function deadBase() { return last?.dead || 0; }

function baseControl() {
  if (!ctrlOverride) return last?.valid ? last.c : 0;
  const v = num(el.ctrlIn) / 100;
  return v > 0 ? v : 0;
}

function kv(label, value, unit = '', note = '', cls = '') {
  return `<dl class="kv"><dt>${label}</dt><dd class="${cls}">${value}${unit ? `<small>${unit}</small>` : ''}</dd>${note ? `<p>${note}</p>` : ''}</dl>`;
}

function renderGoal() {
  const c = baseControl();
  if (!(c > 0)) {
    const msg = '<p class="empty">기준 컨트롤이 있어야 계산됩니다.</p>';
    el.outRatio.innerHTML = msg; el.outTime.innerHTML = msg;
    return;
  }

  const dead = deadBase();
  const dn = deadNote(dead);
  const withDead = note => (dn ? `${note} · ${dn}` : note);

  // 다른 배율이면?
  const gr = num(el.goalRatio);
  const p = predict(gr, c, dead);
  if (!p) {
    el.outRatio.innerHTML = '<p class="empty">배율을 입력하세요.</p>';
  } else if (p.cleared) {
    const need = requiredControl(gr, LIMIT_MIN, dead);
    el.outRatio.innerHTML =
      kv('예상 클리어 타임', fmtTime(p.timeMin), '', withDead(`체감 배율 ${f1(gr * c)} · 20분보다 ${fmtTimeKo(LIMIT_MIN - p.timeMin)} 여유`), 'ok-text') +
      kv('필요 컨트롤 (20분 컷)', f1(need * 100), '%', `지금보다 ${f1((c - need) * 100)}%p 여유`);
  } else {
    const need = requiredControl(gr, LIMIT_MIN, dead);
    el.outRatio.innerHTML =
      kv('20분 종료 시 남은 hp', f1(p.hpLeft), '%', withDead(`체감 배율 ${f1(gr * c)} · 잡으려면 약 ${fmtTime(p.timeMin)} 필요`), 'no-text') +
      kv('필요 컨트롤 (20분 컷)', f1(need * 100), '%', isFinite(need) ? `지금보다 ${f1((need - c) * 100)}%p 더 필요` : '딜 불가 시간이 20분 이상');
  }

  // 목표 시간
  const t = minutesOf(el.goalMin, el.goalSec);
  const ratio = num(el.ratio);
  if (!(t > 0)) {
    el.outTime.innerHTML = '<p class="empty">목표 시간을 입력하세요.</p>';
    return;
  }
  const minR = minRatio(c, t, dead);
  let html = kv(`${fmtTime(t)} 컷 최소 배율`, f1(minR), '',
    isFinite(minR) ? withDead('기준 컨트롤을 유지할 때') : '목표 시간이 딜 불가 시간보다 짧습니다');
  if (ratio > 0) {
    const need = requiredControl(ratio, t, dead);
    const ok = c >= need;
    html += kv(`배율 ${f1(ratio)}에서 필요 컨트롤`, f1(need * 100), '%',
      !isFinite(need) ? '불가' : ok ? `이미 달성 (${f1((c - need) * 100)}%p 여유)` : `${f1((need - c) * 100)}%p 더 필요`,
      ok ? 'ok-text' : 'no-text');
  }
  el.outTime.innerHTML = html;
}

// 배율 단계별 체감 배율 표. 내 기록 배율과 20분 컷 경계도 함께 넣는다
const FEEL_STEPS = [50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500];

function renderFeel() {
  const c = baseControl();
  if (!(c > 0)) {
    el.feelList.innerHTML = '<li class="empty">기준 컨트롤이 있어야 계산됩니다.</li>';
    return;
  }
  const dead = deadBase();
  const mine = num(el.ratio);
  const edge = minRatio(c, LIMIT_MIN, dead);
  const rows = FEEL_STEPS.map(r => ({ r }));
  if (mine > 0) rows.push({ r: mine, label: '내 기록' });
  if (isFinite(edge)) rows.push({ r: edge, label: '20분 컷 경계' });
  const seen = new Set();
  const list = rows
    .sort((a, b) => a.r - b.r || (b.label ? 1 : -1))
    .filter(x => { const k = f1(x.r); if (seen.has(k)) return false; seen.add(k); return true; });

  el.feelList.innerHTML = list.map(({ r, label }) => {
    const feel = r * c;
    const p = predict(r, c, dead);
    const pred = p.cleared
      ? `<span class="ok-text">${fmtTime(p.timeMin)}</span>`
      : `<span class="no-text">hp ${f1(p.hpLeft)}%</span>`;
    const cls = label === '내 기록' ? ' class="mine"' : label ? ' class="edge"' : '';
    return `<li${cls}><button type="button" data-r="${f1(r)}">
      <span class="f-ratio">${f1(r)}${label ? `<span class="tag">${label}</span>` : ''}</span>
      <span class="f-feel ${p.cleared ? 'ok-text' : 'no-text'}">${f1(feel)}</span>
      <span class="f-pred">${pred}</span>
    </button></li>`;
  }).join('');
}

el.feelList.addEventListener('click', e => {
  const b = e.target.closest('button[data-r]');
  if (!b) return;
  el.goalRatio.value = b.dataset.r;
  setTab('ratio');
  renderGoal();
  $('goalTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------- 공유 ---------- */
let toastTimer;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2000);
}

$('copyLink').addEventListener('click', async () => {
  const url = shareUrl();
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('링크를 복사했습니다');
  } catch {
    prompt('아래 링크를 복사하세요', url);
  }
});

$('saveImage').addEventListener('click', async () => {
  if (!last?.valid) { toast('먼저 기록을 입력하세요'); return; }
  const { ratio, c, cleared, timeMin, hpLeft, ideal, dead } = last;
  const boss = el.boss.value.trim();
  const dn = deadNote(dead);
  const blob = await renderCard({
    title: boss || `배율 ${f1(ratio)}`,
    line: (boss ? `배율 ${f1(ratio)} · ` : '') +
      (cleared ? `${fmtTimeKo(timeMin)} 클리어` : `20분 종료 · hp ${f1(hpLeft)}% 남음`) + (dn ? ` · ${dn}` : ''),
    cleared,
    myPct: cleared ? clamp(timeMin / LIMIT_MIN * 100, 0, 100) : 100,
    idealPct: clamp(100 / ideal / LIMIT_MIN * 100, 0, 100),
    ctrl: f1(c * 100),
    minRatio: f1(minRatio(c, LIMIT_MIN, dead)),
    url: shareUrl().replace(/^https?:\/\//, ''),
  });
  if (!blob) { toast('이미지를 만들지 못했습니다'); return; }
  const name = `boss-pace-${(boss || f1(ratio)).replace(/[\\/:*?"<>|\s]+/g, '_')}.png`;
  const file = new File([blob], name, { type: 'image/png' });

  // 모바일은 공유 시트, 그 외는 다운로드
  if (matchMedia('(pointer:coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('이미지를 저장했습니다');
});

/* ---------- 기록 히스토리 ---------- */
// 이 브라우저에만 저장된다. 서버 없음.
const REC_KEY = 'bpc:records';
const REC_MAX = 60;
let records = load(REC_KEY, []);
if (!Array.isArray(records)) records = [];
records = records.filter(r => r && isFinite(r.ts) && isFinite(r.c) && r.c > 0);

const pad2 = n => String(n).padStart(2, '0');
const fmtDate = ts => { const d = new Date(ts); return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`; };
const fmtDateFull = ts => { const d = new Date(ts); return `${d.getFullYear()}.${fmtDate(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function sparkline(rs) {
  const W = 600, H = 120, L = 8, R = 52, T = 14, B = 22;
  const iw = W - L - R, ih = H - T - B;
  const vals = rs.map(r => r.c * 100);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 4) { lo -= 2; hi += 2; }
  const padY = (hi - lo) * 0.12; lo -= padY; hi += padY;
  const x = i => L + (rs.length === 1 ? iw / 2 : i / (rs.length - 1) * iw);
  const y = v => T + ih - (v - lo) / (hi - lo) * ih;
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const parts = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="컨트롤 추이 그래프">`];
  // 100% = 배율과 같은 페이스
  if (100 > lo && 100 < hi) {
    parts.push(`<line x1="${L}" y1="${y(100).toFixed(1)}" x2="${L + iw}" y2="${y(100).toFixed(1)}" stroke="#E8B75C" stroke-width="1" stroke-dasharray="4 4" opacity=".7"/>`);
    parts.push(`<text x="${L + iw + 6}" y="${(y(100) + 4).toFixed(1)}" fill="#E8B75C" font-size="11" font-family="IBM Plex Mono,monospace">100%</text>`);
  }
  parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#8E7BE8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
  vals.forEach((v, i) => {
    const last = i === vals.length - 1;
    parts.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${last ? 4.5 : 3}" fill="${rs[i].cleared ? '#4FD1A5' : '#E2574C'}" stroke="#150F1E" stroke-width="1.5"/>`);
  });
  const vi = vals.length - 1;
  parts.push(`<text x="${L + iw + 6}" y="${(y(vals[vi]) + 4).toFixed(1)}" fill="#EDE7F7" font-size="12" font-weight="600" font-family="IBM Plex Mono,monospace">${f1(vals[vi])}</text>`);
  parts.push(`<text x="${L}" y="${H - 6}" fill="#6F6291" font-size="11" font-family="IBM Plex Mono,monospace">${fmtDate(rs[0].ts)}</text>`);
  parts.push(`<text x="${L + iw}" y="${H - 6}" text-anchor="end" fill="#6F6291" font-size="11" font-family="IBM Plex Mono,monospace">${fmtDate(rs[vi].ts)} · ${rs.length}회</text>`);
  parts.push('</svg>');
  return parts.join('');
}

function renderHistory() {
  if (!records.length) {
    el.histList.innerHTML = '<li class="empty">저장된 기록이 없습니다.</li>';
    el.histChart.hidden = true;
    return;
  }
  const byTime = records.slice().sort((a, b) => a.ts - b.ts);
  el.histChart.hidden = byTime.length < 2;
  if (!el.histChart.hidden) el.histChart.innerHTML = sparkline(byTime);
  el.histList.innerHTML = byTime.slice().reverse().map(r => {
    const res = r.cleared
      ? `<span class="ok-text">${fmtTime(r.timeMin)}</span>`
      : `<span class="no-text">hp ${f1(r.hpLeft)}%</span>`;
    return `<li data-ts="${r.ts}">
      <button type="button" class="hist-row" data-load="${r.ts}" title="${fmtDateFull(r.ts)} 기록 불러오기">
        <span class="h-date">${fmtDate(r.ts)}</span>
        <span class="h-boss">${r.boss ? esc(r.boss) : '—'}<small>${f1(r.ratio)}</small></span>
        <span class="h-res">${res}</span>
        <span class="h-ctrl">${f1(r.c * 100)}%</span>
      </button>
      <button type="button" class="h-del" data-del="${r.ts}" aria-label="이 기록 삭제" title="삭제">×</button>
    </li>`;
  }).join('');
}

function saveRecord() {
  if (!last?.valid) { toast('먼저 기록을 입력하세요'); return; }
  const rec = {
    ts: Date.now(), boss: el.boss.value.trim(), ratio: last.ratio, cleared: last.cleared,
    timeMin: last.cleared ? last.timeMin : null, hpLeft: last.cleared ? null : last.hpLeft, c: last.c,
  };
  if (last.dead > 0) rec.dead = last.dead;
  records.push(rec);
  if (records.length > REC_MAX) records = records.slice(records.length - REC_MAX);
  save(REC_KEY, records);
  renderHistory();
  toast('기록을 저장했습니다');
}

function loadRecord(r) {
  el.boss.value = r.boss || '';
  el.ratio.value = String(r.ratio);
  if (r.cleared) setMinSec(el.min, el.sec, r.timeMin);
  else el.hp.value = String(r.hpLeft);
  setMinSec(el.deadMin, el.deadSec, r.dead > 0 ? r.dead : 0);
  ctrlOverride = false;
  setMode(r.cleared ? 'clear' : 'fail');
  $('recTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  toast(`${fmtDateFull(r.ts)} 기록을 불러왔습니다`);
}

$('saveRecord').addEventListener('click', saveRecord);
el.histList.addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if (del) {
    records = records.filter(r => String(r.ts) !== del.dataset.del);
    save(REC_KEY, records);
    renderHistory();
    return;
  }
  const b = e.target.closest('button[data-load]');
  if (!b) return;
  const r = records.find(x => String(x.ts) === b.dataset.load);
  if (r) loadRecord(r);
});

/* ---------- 초기화 ---------- */
[25, 50, 75].forEach(p => {
  const t = document.createElement('div');
  t.className = 'tick'; t.style.left = p + '%';
  el.track.insertBefore(t, el.track.firstChild);
});

el.btnClear.onclick = () => setMode('clear');
el.btnFail.onclick = () => setMode('fail');
el.tabRatio.onclick = () => setTab('ratio');
el.tabTime.onclick = () => setTab('time');

[el.ratio, el.min, el.sec, el.hp, el.deadMin, el.deadSec, el.goalRatio, el.goalMin, el.goalSec]
  .forEach(e => e.addEventListener('input', update));
el.boss.addEventListener('input', update);
el.ctrlIn.addEventListener('input', () => {
  ctrlOverride = el.ctrlIn.value !== '';
  el.ctrlSync.hidden = !ctrlOverride;
  renderGoal();
  renderFeel();
});
el.ctrlSync.addEventListener('click', () => { ctrlOverride = false; update(); });

const fromUrl = stateFromUrl();
applyState(load(STATE_KEY, null));
applyState(fromUrl);
setTab(goalTab);
setMode(mode);
renderHistory();
