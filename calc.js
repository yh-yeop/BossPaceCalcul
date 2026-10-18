// 순수 계산 로직. 배율 = 20분 동안 뽑아야 할 이상적인 딜량(%).
export const LIMIT_MIN = 20;

// 딜 불가 시간(분)을 0 이상, 상한 이하로 정리한다. 숫자가 아니면 0.
function deadOf(deadMin, max = Infinity) {
  return isFinite(deadMin) && deadMin > 0 ? Math.min(deadMin, max) : 0;
}

// 기록 → 컨트롤 비율(c, 1 = 배율과 정확히 같은 페이스)
// deadMin: 무적·컷신 등 딜을 못 넣은 시간(분). 걸린 시간에서 빼고 실제 속도를 구한다.
export function analyze({ ratio, mode, timeMin, hpLeft, deadMin = 0 }) {
  const ideal = ratio / LIMIT_MIN; // %/분
  let progress, elapsed;
  if (mode === 'clear') {
    progress = 100;
    elapsed = timeMin;
  } else {
    progress = clamp(100 - hpLeft, 0, 100);
    elapsed = LIMIT_MIN;
  }
  const dead = deadOf(deadMin);
  const active = Math.max(0, elapsed - dead); // 실제로 딜을 넣은 시간
  const actual = active > 0 ? progress / active : 0;
  const c = ideal > 0 ? actual / ideal : 0;
  return { ideal, actual, progress, elapsed, active, dead, c, cleared: mode === 'clear' };
}

// 컨트롤 c로 배율 ratio 보스를 상대했을 때 결과.
// deadMin 이 있으면 예상 시간에 더하고, 20분 컷 판정은 (20 − dead)분 안에 뽑는지로 본다.
export function predict(ratio, c, deadMin = 0) {
  const rate = (ratio / LIMIT_MIN) * c; // %/분
  if (!(rate > 0)) return null;
  const dead = deadOf(deadMin);
  const activeMin = 100 / rate;
  const timeMin = activeMin + dead;
  const window = Math.max(0, LIMIT_MIN - dead); // 20분 중 딜을 넣을 수 있는 시간
  if (activeMin <= window + 1e-9) return { cleared: true, timeMin, hpLeft: 0 };
  return { cleared: false, timeMin, hpLeft: clamp(100 - rate * window, 0, 100) };
}

// 배율 ratio 보스를 targetMin 안에 잡는 데 필요한 컨트롤.
// targetMin 이 딜 불가 시간보다 짧으면 불가능 → Infinity
export function requiredControl(ratio, targetMin, deadMin = 0) {
  if (!(ratio > 0 && targetMin > 0)) return 0;
  const active = targetMin - deadOf(deadMin);
  return active > 0 ? (100 * LIMIT_MIN) / (ratio * active) : Infinity;
}

// 컨트롤 c로 targetMin 안에 잡으려면 필요한 최소 배율
export function minRatio(c, targetMin = LIMIT_MIN, deadMin = 0) {
  if (!(c > 0 && targetMin > 0)) return 0;
  const active = targetMin - deadOf(deadMin);
  return active > 0 ? (100 * LIMIT_MIN) / (c * active) : Infinity;
}

/* ---------- 파티 ---------- */
// 배율은 20분 기준 보스 HP 대비 %라 파티원 배율을 그대로 더한 것이 합산 배율이다.
const ratioOf = m => (m && Number.isFinite(m.ratio) && m.ratio > 0 ? m.ratio : 0);
export function partyRatio(members) {
  return members.reduce((s, m) => s + ratioOf(m), 0);
}

// 각 파티원의 기여 비율(0~1). 합산 배율이 0이면 모두 0.
export function partyShares(members) {
  const total = partyRatio(members);
  return members.map(m => {
    const r = ratioOf(m);
    return { ...m, ratio: r, share: total > 0 ? r / total : 0 };
  });
}

// 컨트롤 c로 targetMin 안에 잡으려면 합산 배율에 더 필요한 배율. 이미 충분하면 0.
export function partyNeedRatio(members, c, targetMin = LIMIT_MIN, deadMin = 0) {
  const need = minRatio(c, targetMin, deadMin);
  if (!isFinite(need)) return Infinity;
  return Math.max(0, need - partyRatio(members));
}

/* ---------- 기록 유틸 (저장 형식: {ts, boss, ratio, cleared, timeMin, hpLeft, c, dead?}) ---------- */
export const REC_MAX = 60;

// 올바른 기록만 남긴다. 배열이 아니면 null.
export function sanitizeRecords(input) {
  if (!Array.isArray(input)) return null;
  return input.filter(r => r && typeof r === 'object'
    && Number.isFinite(r.ts) && Number.isFinite(r.c) && r.c > 0 && Number.isFinite(r.ratio));
}

// 두 목록을 ts 기준으로 중복 없이 합치고 시간순 정렬, 최근 REC_MAX개만 남긴다.
export function mergeRecords(a, b, max = REC_MAX) {
  const seen = new Map();
  for (const r of [...a, ...b]) if (!seen.has(r.ts)) seen.set(r.ts, r);
  const out = [...seen.values()].sort((x, y) => x.ts - y.ts);
  return out.length > max ? out.slice(out.length - max) : out;
}

// 기록 목록의 최고(컨트롤)·최근 기록
export function summarizeRecords(rs) {
  if (!rs.length) return { count: 0, best: null, latest: null };
  let best = rs[0], latest = rs[0];
  for (const r of rs) {
    if (r.c > best.c) best = r;
    if (r.ts > latest.ts) latest = r;
  }
  return { count: rs.length, best, latest };
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// 분(소수) → "m:ss"
export function fmtTime(min) {
  const total = Math.round(min * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// 분(소수) → "m분 s초"
export function fmtTimeKo(min) {
  const total = Math.round(min * 60);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m}분 ${s}초` : `${m}분`;
}

// "m:ss" 또는 "m" → 분(소수). 형식이 아니면 0.
export function parseTime(str) {
  const [m, s = '0'] = String(str ?? '').split(':');
  const mm = parseInt(m, 10), ss = parseInt(s, 10);
  return (isFinite(mm) ? mm : 0) + (isFinite(ss) ? clamp(ss, 0, 59) : 0) / 60;
}
