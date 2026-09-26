import {
  LIMIT_MIN, analyze, predict, requiredControl, minRatio, clamp, fmtTime, fmtTimeKo,
  parseKoNum, fmtKoShort, ratioFor,
} from './calc.js';
import { BOSSES, SOURCE } from './data.js';
import { renderCard } from './share.js';

const $ = id => document.getElementById(id);
const el = {
  boss: $('boss'), bossNames: $('bossNames'), ratio: $('ratio'), ratioNote: $('ratioNote'),
  min: $('clearMin'), sec: $('clearSec'), hp: $('hpLeft'),
  clearBox: $('clearInputs'), failBox: $('failInputs'),
  btnClear: $('modeClear'), btnFail: $('modeFail'),
  track: $('track'), fill: $('fill'), mark: $('idealMark'),
  ctrlPct: $('ctrlPct'), ctrlNote: $('ctrlNote'), minRatio: $('minRatio'), verdict: $('verdict'),
  ctrlIn: $('ctrlIn'), ctrlSync: $('ctrlSync'),
  tabRatio: $('tabRatio'), tabTime: $('tabTime'), paneRatio: $('paneRatio'), paneTime: $('paneTime'),
  goalRatio: $('goalRatio'), goalMin: $('goalMin'), goalSec: $('goalSec'),
  outRatio: $('outRatio'), outTime: $('outTime'),
  damage: $('damage'), damageNote: $('damageNote'), halfDmg: $('halfDmg'),
  bossSearch: $('bossSearch'), tierSeg: $('tierSeg'),
  presetForm: $('presetForm'), pName: $('pName'), pHp: $('pHp'), presetList: $('presetList'),
  source: $('source'), toast: $('toast'),
};

const STATE_KEY = 'bpc:state';
const PRESET_KEY = 'bpc:presets';

let mode = 'clear';
let goalTab = 'ratio';
let tier = '';
let ctrlOverride = false; // 기준 컨트롤을 직접 입력했는지
let custom = [];          // 직접 추가한 보스 {id, name, hp} (구버전은 {id, name, ratio})
let last = null;          // 마지막 기록 분석 결과

const num = e => { const v = parseFloat(e.value); return isFinite(v) ? v : 0; };
const f1 = v => v.toFixed(1);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 불가 환경 무시 */ }
}

/* ---------- 보스 데이터 ---------- */
function allBosses() {
  const list = BOSSES.map(b => ({ ...b, builtin: true }));
  for (const c of custom) list.push({ id: c.id, name: c.name, hp: c.hp, ratio: c.ratio, tier: '', half: 'y' });
  return list;
}
function findBoss(name) {
  const n = name.trim();
  return n ? allBosses().find(b => b.name === n) : undefined;
}
function damage() {
  const v = parseKoNum(el.damage.value);
  return v > 0 ? v : 0;
}
// 보스의 배율: 체력이 있으면 딜량으로 계산, 구버전 프리셋은 저장된 배율
function bossRatio(b) {
  if (b.hp) return ratioFor(damage(), b.hp, b.half === 'y', el.halfDmg.checked);
  return b.ratio || 0;
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
function setTier(t) {
  tier = t;
  for (const b of el.tierSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.tier === t);
  renderPresets();
  persist();
}

/* ---------- 입력 상태 ---------- */
function readState() {
  return {
    boss: el.boss.value.trim(), ratio: el.ratio.value, mode,
    min: el.min.value, sec: el.sec.value, hp: el.hp.value,
    goalRatio: el.goalRatio.value, goalMin: el.goalMin.value, goalSec: el.goalSec.value, goalTab,
    damage: el.damage.value, halfDmg: el.halfDmg.checked, tier,
  };
}
function persist() { save(STATE_KEY, readState()); }
function applyState(s) {
  if (!s) return;
  const map = { boss: el.boss, ratio: el.ratio, min: el.min, sec: el.sec, hp: el.hp,
    goalRatio: el.goalRatio, goalMin: el.goalMin, goalSec: el.goalSec, damage: el.damage };
  for (const [k, e] of Object.entries(map)) if (s[k] != null) e.value = s[k];
  if (s.halfDmg != null) el.halfDmg.checked = !!s.halfDmg;
  if (s.goalTab) goalTab = s.goalTab;
  if (s.tier === '' || s.tier === '은별' || s.tier === '금별') tier = s.tier;
  if (s.mode === 'clear' || s.mode === 'fail') mode = s.mode;
}

// 공유 링크: ?b=보스&r=184.6&t=13:00  또는  ?r=184.6&hp=24.7
function stateFromUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has('r')) return null;
  const s = { ratio: q.get('r'), boss: q.get('b') || '' };
  if (q.has('hp')) {
    s.mode = 'fail'; s.hp = q.get('hp');
  } else if (q.has('t')) {
    const [m, sec = '0'] = q.get('t').split(':');
    s.mode = 'clear'; s.min = m; s.sec = String(parseInt(sec, 10) || 0);
  }
  return s;
}
function shareUrl() {
  const q = new URLSearchParams();
  const boss = el.boss.value.trim();
  if (boss) q.set('b', boss);
  q.set('r', String(num(el.ratio)));
  if (mode === 'clear') q.set('t', fmtTime(num(el.min) + num(el.sec) / 60));
  else q.set('hp', String(num(el.hp)));
  return location.origin + location.pathname + '?' + q.toString();
}

/* ---------- 계산 & 렌더 ---------- */
function update() {
  const ratio = num(el.ratio);
  const timeMin = num(el.min) + clamp(num(el.sec), 0, 59) / 60;
  const hpLeft = clamp(num(el.hp), 0, 100);
  const a = analyze({ ratio, mode, timeMin, hpLeft });
  last = { ...a, ratio, timeMin, hpLeft, valid: ratio > 0 && a.c > 0 };

  renderRecord();
  if (!ctrlOverride) el.ctrlIn.value = last.valid ? f1(a.c * 100) : '';
  el.ctrlSync.hidden = !ctrlOverride;
  renderGoal();
  renderPresets();
  persist();
}

// 보스 이름이 목록과 일치하면 딜량 기준 배율을 채운다
function syncRatioFromBoss() {
  const b = findBoss(el.boss.value);
  const r = b ? bossRatio(b) : 0;
  if (r > 0) {
    el.ratio.value = f1(r);
    el.ratioNote.innerHTML = b.hp
      ? `${esc(b.name)} 체력 <b>${fmtKoShort(b.hp)}</b> · 딜량 <b>${fmtKoShort(damage())}</b>${el.halfDmg.checked && b.half === 'y' ? ' (반감 적용)' : ''} 기준`
      : `${esc(b.name)} 저장된 배율`;
    el.ratioNote.hidden = false;
  } else {
    el.ratioNote.hidden = true;
  }
}

function renderRecord() {
  const { ratio, ideal, actual, c, cleared, timeMin, hpLeft, valid } = last;
  const minR = minRatio(c);

  el.ctrlPct.innerHTML = valid ? f1(c * 100) + '<small>%</small>' : '—';
  el.minRatio.textContent = valid ? f1(minR) : '—';
  el.ctrlNote.textContent = valid
    ? `배율이 요구하는 분당 ${ideal.toFixed(2)}% 중 ${actual.toFixed(2)}%를 뽑음`
    : '';

  // 트랙: 20분 대비 위치
  const myPct = cleared ? clamp(timeMin / LIMIT_MIN * 100, 0, 100) : 100;
  const idealPct = ideal > 0 ? clamp(100 / ideal / LIMIT_MIN * 100, 0, 100) : 100;
  el.fill.style.width = myPct + '%';
  el.mark.style.left = `calc(${idealPct}% - 1px)`;
  el.fill.className = 'fill ' + (cleared ? 'done' : 'short');

  const v = el.verdict;
  if (ratio <= 0) { v.className = 'verdict'; v.textContent = '배율을 입력하면 결과가 나옵니다.'; return; }
  if (!valid) { v.className = 'verdict'; v.textContent = '기록을 입력하면 결과가 나옵니다.'; return; }
  if (cleared) {
    v.className = 'verdict ok';
    const over = timeMin > LIMIT_MIN ? ' (20분 초과 기록이라 참고용입니다)' : '';
    v.innerHTML = `배율 ${f1(ratio)}을 <b>${fmtTimeKo(timeMin)}</b>에 클리어. 이 컨트롤이면 배율 <b>${f1(minR)}</b>까지 20분 안에 잡힙니다.${over}`;
  } else {
    v.className = 'verdict no';
    v.innerHTML = `배율 ${f1(ratio)}에서 <b>${f1(hpLeft)}%</b> 남기고 종료. 20분 컷하려면 배율이 <b>${f1(minR)}</b> 이상이어야 합니다.`;
  }
}

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

  // 다른 배율이면?
  const gr = num(el.goalRatio);
  const p = predict(gr, c);
  if (!p) {
    el.outRatio.innerHTML = '<p class="empty">배율을 입력하세요.</p>';
  } else if (p.cleared) {
    el.outRatio.innerHTML =
      kv('예상 클리어 타임', fmtTime(p.timeMin), '', `20분보다 ${fmtTimeKo(LIMIT_MIN - p.timeMin)} 여유`, 'ok-text') +
      kv('필요 컨트롤 (20분 컷)', f1(requiredControl(gr, LIMIT_MIN) * 100), '%', `지금보다 ${f1((c - requiredControl(gr, LIMIT_MIN)) * 100)}%p 여유`);
  } else {
    const need = requiredControl(gr, LIMIT_MIN);
    el.outRatio.innerHTML =
      kv('20분 종료 시 남은 hp', f1(p.hpLeft), '%', `잡으려면 약 ${fmtTime(p.timeMin)} 필요`, 'no-text') +
      kv('필요 컨트롤 (20분 컷)', f1(need * 100), '%', `지금보다 ${f1((need - c) * 100)}%p 더 필요`);
  }

  // 목표 시간
  const t = num(el.goalMin) + clamp(num(el.goalSec), 0, 59) / 60;
  const ratio = num(el.ratio);
  if (!(t > 0)) {
    el.outTime.innerHTML = '<p class="empty">목표 시간을 입력하세요.</p>';
    return;
  }
  const minR = minRatio(c, t);
  let html = kv(`${fmtTime(t)} 컷 최소 배율`, f1(minR), '', '기준 컨트롤을 유지할 때');
  if (ratio > 0) {
    const need = requiredControl(ratio, t);
    const ok = c >= need;
    html += kv(`배율 ${f1(ratio)}에서 필요 컨트롤`, f1(need * 100), '%',
      ok ? `이미 달성 (${f1((c - need) * 100)}%p 여유)` : `${f1((need - c) * 100)}%p 더 필요`,
      ok ? 'ok-text' : 'no-text');
  }
  el.outTime.innerHTML = html;
}

/* ---------- 보스별 배율 ---------- */
function renderDamageNote() {
  const raw = el.damage.value.trim();
  const d = damage();
  if (!raw) { el.damageNote.hidden = true; return; }
  el.damageNote.hidden = false;
  el.damageNote.innerHTML = d > 0 ? `= <b>${fmtKoShort(d)}</b>` : '숫자와 경·조·억·만 단위로 입력하세요';
}

function renderPresets() {
  const c = baseControl();
  const d = damage();
  const boss = el.boss.value.trim();
  const q = el.bossSearch.value.trim().replace(/\s/g, '');

  const list = allBosses()
    .filter(b => !tier || b.tier.startsWith(tier))
    .filter(b => !q || b.name.replace(/\s/g, '').includes(q))
    .sort((a, b) => (a.hp || 0) - (b.hp || 0));

  if (!list.length) {
    el.presetList.innerHTML = '<li class="empty">일치하는 보스가 없습니다.</li>';
    return;
  }
  el.presetList.innerHTML = list.map(b => {
    const r = bossRatio(b);
    const p = r > 0 && c > 0 ? predict(r, c) : null;
    const pred = !p ? '<span class="p-dim">—</span>'
      : p.cleared ? `<span class="ok-text">${fmtTime(p.timeMin)}</span>`
      : `<span class="no-text">hp ${f1(p.hpLeft)}%</span>`;
    const tag = b.builtin ? `<span class="tag t-${b.tier.slice(0, 2)}">${b.tier}</span>` : '<span class="tag">직접</span>';
    const meta = [
      b.hp ? `체력 ${fmtKoShort(b.hp)}${b.half === 'n' ? ' 비반감' : b.half === 'm' ? ' 반감 혼합' : ''}` : '',
      r > 0 ? `배율 <b>${f1(r)}</b>` : d > 0 ? '' : '배율 —',
    ].filter(Boolean).join(' · ');
    const key = b.builtin ? `b:${b.name}` : `c:${b.id}`;
    return `<li${b.name === boss ? ' class="on"' : ''}>
      <button type="button" class="p-load" data-key="${esc(key)}" title="내 기록에 불러오기">
        <span class="p-name">${esc(b.name)}${tag}</span>
        <span class="p-meta">${meta}</span>
      </button>
      <span class="p-pred">${pred}</span>
      ${b.builtin ? '<span></span>' : `<button type="button" class="p-del" data-id="${b.id}" aria-label="${esc(b.name)} 삭제">×</button>`}
    </li>`;
  }).join('');
}

function renderBossNames() {
  el.bossNames.innerHTML = allBosses().map(b => `<option value="${esc(b.name)}"></option>`).join('');
}

function loadBoss(key) {
  const b = key.startsWith('b:')
    ? allBosses().find(x => x.builtin && x.name === key.slice(2))
    : allBosses().find(x => !x.builtin && x.id === key.slice(2));
  if (!b) return;
  el.boss.value = b.name;
  syncRatioFromBoss();
  if (b.hp && !(damage() > 0)) {
    toast('딜량을 넣으면 배율이 자동으로 채워집니다');
    el.damage.focus();
    update();
    return;
  }
  update();
  document.getElementById('recTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveCustom() { save(PRESET_KEY, custom); renderBossNames(); }

el.presetForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = el.pName.value.trim();
  const hp = parseKoNum(el.pHp.value);
  if (!name) return;
  if (!(hp > 0)) { toast('체력을 숫자와 단위로 입력하세요 (예: 327조)'); el.pHp.focus(); return; }
  if (BOSSES.some(b => b.name === name)) { toast('이미 목록에 있는 이름입니다'); return; }
  const same = custom.find(p => p.name === name);
  if (same) { same.hp = hp; delete same.ratio; }
  else custom.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, hp });
  saveCustom();
  el.pName.value = ''; el.pHp.value = '';
  renderPresets();
  toast(same ? `${name} 체력을 갱신했습니다` : `${name} 추가됨`);
});

el.presetList.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.classList.contains('p-load')) loadBoss(b.dataset.key);
  if (b.classList.contains('p-del')) {
    custom = custom.filter(p => p.id !== b.dataset.id);
    saveCustom();
    renderPresets();
  }
});
el.tierSeg.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) setTier(b.dataset.tier);
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
  const { ratio, c, cleared, timeMin, hpLeft, ideal } = last;
  const boss = el.boss.value.trim();
  const blob = await renderCard({
    title: boss || `배율 ${f1(ratio)}`,
    line: (boss ? `배율 ${f1(ratio)} · ` : '') +
      (cleared ? `${fmtTimeKo(timeMin)} 클리어` : `20분 종료 · hp ${f1(hpLeft)}% 남음`),
    cleared,
    myPct: cleared ? clamp(timeMin / LIMIT_MIN * 100, 0, 100) : 100,
    idealPct: clamp(100 / ideal / LIMIT_MIN * 100, 0, 100),
    ctrl: f1(c * 100),
    minRatio: f1(minRatio(c)),
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

/* ---------- 초기화 ---------- */
[25, 50, 75].forEach(p => {
  const t = document.createElement('div');
  t.className = 'tick'; t.style.left = p + '%';
  el.track.insertBefore(t, el.track.firstChild);
});

el.source.innerHTML = `보스 체력: <a href="${SOURCE.url}" target="_blank" rel="noopener">${SOURCE.name}</a> (${SOURCE.date} 조회). ` +
  '하드 스우 이상만 수록. 모두 유저 측정값이며, 오버드라이브 패치 이후 주간 보스 체력은 실제와 다를 수 있습니다.';

el.btnClear.onclick = () => setMode('clear');
el.btnFail.onclick = () => setMode('fail');
el.tabRatio.onclick = () => setTab('ratio');
el.tabTime.onclick = () => setTab('time');

[el.ratio, el.min, el.sec, el.hp, el.goalRatio, el.goalMin, el.goalSec]
  .forEach(e => e.addEventListener('input', update));
el.ratio.addEventListener('input', () => { el.ratioNote.hidden = true; });
el.boss.addEventListener('input', () => { syncRatioFromBoss(); update(); });
for (const e of [el.damage, el.halfDmg]) {
  e.addEventListener(e.type === 'checkbox' ? 'change' : 'input', () => {
    renderDamageNote();
    syncRatioFromBoss();
    update();
  });
}
el.bossSearch.addEventListener('input', renderPresets);
el.ctrlIn.addEventListener('input', () => {
  ctrlOverride = el.ctrlIn.value !== '';
  el.ctrlSync.hidden = !ctrlOverride;
  renderGoal();
  renderPresets();
});
el.ctrlSync.addEventListener('click', () => { ctrlOverride = false; update(); });

custom = load(PRESET_KEY, []).filter(p => p && typeof p.name === 'string' && (p.hp > 0 || p.ratio > 0));
renderBossNames();
const fromUrl = stateFromUrl();
applyState(load(STATE_KEY, null));
applyState(fromUrl);
renderDamageNote();
if (!fromUrl) syncRatioFromBoss();
setTab(goalTab);
setTier(tier);
setMode(mode);
