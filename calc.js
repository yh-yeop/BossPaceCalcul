// 순수 계산 로직. 배율 = 20분 동안 뽑아야 할 이상적인 딜량(%).
export const LIMIT_MIN = 20;

// 기록 → 컨트롤 비율(c, 1 = 배율과 정확히 같은 페이스)
export function analyze({ ratio, mode, timeMin, hpLeft }) {
  const ideal = ratio / LIMIT_MIN; // %/분
  let progress, elapsed;
  if (mode === 'clear') {
    progress = 100;
    elapsed = timeMin;
  } else {
    progress = clamp(100 - hpLeft, 0, 100);
    elapsed = LIMIT_MIN;
  }
  const actual = elapsed > 0 ? progress / elapsed : 0;
  const c = ideal > 0 ? actual / ideal : 0;
  return { ideal, actual, progress, elapsed, c, cleared: mode === 'clear' };
}

// 컨트롤 c로 배율 ratio 보스를 상대했을 때 결과
export function predict(ratio, c) {
  const rate = (ratio / LIMIT_MIN) * c; // %/분
  if (!(rate > 0)) return null;
  const timeMin = 100 / rate;
  if (timeMin <= LIMIT_MIN + 1e-9) return { cleared: true, timeMin, hpLeft: 0 };
  return { cleared: false, timeMin, hpLeft: 100 - rate * LIMIT_MIN };
}

// 배율 ratio 보스를 targetMin 안에 잡는 데 필요한 컨트롤
export function requiredControl(ratio, targetMin) {
  return ratio > 0 && targetMin > 0 ? (100 * LIMIT_MIN) / (ratio * targetMin) : 0;
}

// 컨트롤 c로 targetMin 안에 잡으려면 필요한 최소 배율
export function minRatio(c, targetMin = LIMIT_MIN) {
  return c > 0 && targetMin > 0 ? (100 * LIMIT_MIN) / (c * targetMin) : 0;
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
