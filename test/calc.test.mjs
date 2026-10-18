import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMIT_MIN, REC_MAX, analyze, predict, requiredControl, minRatio, clamp, fmtTime, fmtTimeKo, parseTime,
  partyRatio, partyShares, partyNeedRatio, sanitizeRecords, mergeRecords, summarizeRecords,
} from '../calc.js';
import { BOSS_NAMES } from '../data.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('analyze(clear): 배율 200을 10분에 잡으면 컨트롤 1.0 (이상 속도 10%/분)', () => {
  const a = analyze({ ratio: 200, mode: 'clear', timeMin: 10, hpLeft: 0 });
  near(a.ideal, 10);
  near(a.actual, 10);
  near(a.c, 1);
  assert.equal(a.cleared, true);
  assert.equal(a.progress, 100);
  assert.equal(a.elapsed, 10);
});

test('analyze(clear): 배율 100을 정확히 20분에 잡으면 컨트롤 1.0, 더 빠르면 1 초과', () => {
  near(analyze({ ratio: 100, mode: 'clear', timeMin: 20 }).c, 1);
  near(analyze({ ratio: 100, mode: 'clear', timeMin: 10 }).c, 2);
  near(analyze({ ratio: 184.6, mode: 'clear', timeMin: 13 }).c, 100 / 13 / (184.6 / 20));
});

test('analyze(fail): 20분 종료 시 남은 hp로 진행률을 잡는다', () => {
  const a = analyze({ ratio: 150, mode: 'fail', timeMin: 0, hpLeft: 25 });
  assert.equal(a.progress, 75);
  assert.equal(a.elapsed, LIMIT_MIN);
  near(a.actual, 75 / 20);
  near(a.c, (75 / 20) / (150 / 20)); // = 0.5
  assert.equal(a.cleared, false);
  assert.equal(analyze({ ratio: 150, mode: 'fail', hpLeft: 120 }).progress, 0, 'hp는 0~100으로 잘라낸다');
});

test('analyze: 배율 0이나 시간 0이면 컨트롤 0 (NaN/Infinity 없음)', () => {
  assert.equal(analyze({ ratio: 0, mode: 'clear', timeMin: 10 }).c, 0);
  assert.equal(analyze({ ratio: 100, mode: 'clear', timeMin: 0 }).c, 0);
  assert.equal(analyze({ ratio: 100, mode: 'clear', timeMin: 0 }).actual, 0);
});

test('predict: 기록을 다시 넣으면 같은 결과가 나온다 (왕복)', () => {
  const a = analyze({ ratio: 184.6, mode: 'clear', timeMin: 13.5 });
  const p = predict(184.6, a.c);
  assert.equal(p.cleared, true);
  near(p.timeMin, 13.5);
  assert.equal(p.hpLeft, 0);
  const f = analyze({ ratio: 150, mode: 'fail', hpLeft: 24.7 });
  const q = predict(150, f.c);
  assert.equal(q.cleared, false);
  near(q.hpLeft, 24.7);
});

test('predict: 체감 배율 100이 20분 컷 경계', () => {
  const c = 0.5;
  assert.equal(predict(200, c).cleared, true);   // 체감 100
  near(predict(200, c).timeMin, 20);
  assert.equal(predict(199, c).cleared, false);  // 체감 99.5
  assert.ok(predict(199, c).hpLeft > 0 && predict(199, c).hpLeft < 1);
  assert.equal(predict(0, c), null);
  assert.equal(predict(100, 0), null);
});

test('requiredControl / minRatio 는 서로 역함수', () => {
  const ratio = 184.6, t = 15;
  const need = requiredControl(ratio, t);
  near(minRatio(need, t), ratio);
  near(requiredControl(minRatio(0.8, 12), 12), 0.8);
  near(minRatio(1), 100, 1e-9);          // 컨트롤 100% → 배율 100이면 20분 컷
  near(minRatio(0.5), 200);
  near(requiredControl(100, LIMIT_MIN), 1);
  assert.equal(requiredControl(0, 10), 0);
  assert.equal(minRatio(0), 0);
});

test('예상 시간 = 2000 ÷ (배율 × 컨트롤) 과 일치', () => {
  for (const [r, c] of [[150, 0.9], [300, 1.2], [80, 0.6]]) {
    const p = predict(r, c);
    near(p.timeMin, 2000 / (r * c));
  }
});

test('clamp / fmtTime / fmtTimeKo', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(fmtTime(13), '13:00');
  assert.equal(fmtTime(13.5), '13:30');
  assert.equal(fmtTime(0.999), '1:00', '반올림으로 60초가 되면 분이 올라간다');
  assert.equal(fmtTimeKo(13.5), '13분 30초');
  assert.equal(fmtTimeKo(13), '13분');
});

/* ---------- 딜 불가 시간 ---------- */
test('analyze(deadMin): 딜 불가 시간을 빼면 실제 속도가 올라간다, 0이면 기존과 같다', () => {
  const base = analyze({ ratio: 200, mode: 'clear', timeMin: 12 });
  const same = analyze({ ratio: 200, mode: 'clear', timeMin: 12, deadMin: 0 });
  near(base.c, same.c);
  assert.equal(same.dead, 0);
  assert.equal(same.active, 12);
  // 12분 중 2분이 무적이면 10분에 100%를 뽑은 것 → 컨트롤 1.0
  const a = analyze({ ratio: 200, mode: 'clear', timeMin: 12, deadMin: 2 });
  near(a.c, 1);
  assert.equal(a.active, 10);
  assert.equal(a.dead, 2);
  assert.equal(a.elapsed, 12, 'elapsed 는 걸린 시간 그대로');
  // 못 잡음: 20분 중 5분 무적, hp 25% 남음 → 15분에 75% = 5%/분, 이상 7.5 → 2/3
  const f = analyze({ ratio: 150, mode: 'fail', hpLeft: 25, deadMin: 5 });
  near(f.c, (75 / 15) / (150 / 20));
});

test('analyze(deadMin): 딜 불가가 걸린 시간 이상이거나 음수·NaN 이면 안전하게 처리', () => {
  assert.equal(analyze({ ratio: 200, mode: 'clear', timeMin: 10, deadMin: 10 }).c, 0);
  assert.equal(analyze({ ratio: 200, mode: 'clear', timeMin: 10, deadMin: 15 }).active, 0);
  near(analyze({ ratio: 200, mode: 'clear', timeMin: 10, deadMin: -3 }).c, 1);
  near(analyze({ ratio: 200, mode: 'clear', timeMin: 10, deadMin: NaN }).c, 1);
});

test('predict(deadMin): 예상 시간에 딜 불가 시간이 더해지고 20분 컷 판정은 (20 − dead) 기준', () => {
  const c = 1; // 배율 100 → 5%/분 → 20분에 100%
  const p0 = predict(100, c);
  near(p0.timeMin, 20);
  assert.equal(p0.cleared, true);
  const p2 = predict(100, c, 2);
  near(p2.timeMin, 22);
  assert.equal(p2.cleared, false);
  near(p2.hpLeft, 100 - 5 * 18); // 18분만 딜 → 90% → hp 10%
  // 배율 125 → 6.25%/분 → 16분, +2 = 18분 → 컷
  const q = predict(125, c, 2);
  assert.equal(q.cleared, true);
  near(q.timeMin, 18);
  assert.equal(q.hpLeft, 0);
  // 딜 불가가 20분 이상이면 아무것도 못 뽑는다
  assert.equal(predict(300, 2, 20).cleared, false);
  assert.equal(predict(300, 2, 25).hpLeft, 100);
});

test('predict(deadMin): 기록을 다시 넣으면 같은 결과 (왕복)', () => {
  const a = analyze({ ratio: 184.6, mode: 'clear', timeMin: 13.5, deadMin: 1.5 });
  const p = predict(184.6, a.c, 1.5);
  assert.equal(p.cleared, true);
  near(p.timeMin, 13.5);
  const f = analyze({ ratio: 150, mode: 'fail', hpLeft: 24.7, deadMin: 3 });
  const q = predict(150, f.c, 3);
  assert.equal(q.cleared, false);
  near(q.hpLeft, 24.7);
});

test('requiredControl / minRatio (deadMin): 딜 가능 시간 기준, 불가능하면 Infinity', () => {
  // 배율 200, 15분 목표, 5분 딜 불가 → 10분에 100% → 10%/분, 이상 10 → c=1
  near(requiredControl(200, 15, 5), 1);
  near(requiredControl(200, 15), 2000 / (200 * 15));
  near(minRatio(1, 15, 5), 200);
  near(minRatio(1, 20, 0), minRatio(1));
  assert.equal(requiredControl(200, 5, 5), Infinity);
  assert.equal(minRatio(1, 5, 7), Infinity);
  // 역함수 관계 유지
  near(minRatio(requiredControl(184.6, 15, 2), 15, 2), 184.6);
});

/* ---------- 파티 ---------- */
test('partyRatio: 배율 단순 합산, 잘못된 값은 0 취급', () => {
  assert.equal(partyRatio([{ ratio: 60 }, { ratio: 40 }]), 100);
  assert.equal(partyRatio([{ ratio: 60 }, { ratio: -5 }, { ratio: NaN }, null, { ratio: '12' }]), 60);
  assert.equal(partyRatio([]), 0);
});

test('partyShares: 기여 비율 합은 1, 합산 0이면 모두 0', () => {
  const s = partyShares([{ name: 'a', ratio: 60 }, { name: 'b', ratio: 40 }]);
  near(s[0].share, 0.6);
  near(s[1].share, 0.4);
  near(s.reduce((t, m) => t + m.share, 0), 1);
  assert.equal(s[0].name, 'a');
  assert.deepEqual(partyShares([{ ratio: 0 }, { ratio: NaN }]).map(m => m.share), [0, 0]);
});

test('partyNeedRatio: 20분 컷에 더 필요한 배율, 충분하면 0', () => {
  // 컨트롤 0.8 → 20분 컷 최소 배율 125
  near(partyNeedRatio([{ ratio: 60 }, { ratio: 40 }], 0.8), 25);
  assert.equal(partyNeedRatio([{ ratio: 100 }, { ratio: 50 }], 0.8), 0);
  near(partyNeedRatio([{ ratio: 100 }], 0.8, 10), 250 - 100);
  near(partyNeedRatio([{ ratio: 100 }], 1, 20, 4), 125 - 100); // 16분에 뽑아야 → 125
  assert.equal(partyNeedRatio([{ ratio: 100 }], 1, 3, 5), Infinity);
  // 합산 배율로 predict 하면 파티 전체 결과
  const total = partyRatio([{ ratio: 60 }, { ratio: 40 }]);
  near(predict(total, 0.8).hpLeft, 20);
});

/* ---------- 기록 유틸 ---------- */
const rec = (ts, c, extra = {}) => ({ ts, boss: '하드 세렌', ratio: 184.6, cleared: true, timeMin: 13, hpLeft: null, c, ...extra });

test('sanitizeRecords: 배열이 아니면 null, 깨진 항목은 버린다', () => {
  assert.equal(sanitizeRecords(null), null);
  assert.equal(sanitizeRecords({ records: [] }), null);
  assert.equal(sanitizeRecords('x'), null);
  const out = sanitizeRecords([rec(1, 0.9), null, 'a', { ts: 2 }, rec(3, 0), rec(4, 1.1, { ratio: NaN }), rec(5, 1)]);
  assert.deepEqual(out.map(r => r.ts), [1, 5]);
});

test('mergeRecords: ts 중복 제거, 시간순, 최대 개수 유지', () => {
  const a = [rec(3, 0.9), rec(1, 0.8)];
  const b = [rec(2, 0.85), rec(3, 0.95)];
  const m = mergeRecords(a, b);
  assert.deepEqual(m.map(r => r.ts), [1, 2, 3]);
  near(m[2].c, 0.9, 1e-9, '기존(a) 항목이 우선');
  const many = Array.from({ length: REC_MAX + 10 }, (_, i) => rec(i + 1, 1));
  const capped = mergeRecords(many, []);
  assert.equal(capped.length, REC_MAX);
  assert.equal(capped[0].ts, 11, '오래된 것부터 잘린다');
  assert.equal(mergeRecords([], [rec(1, 1), rec(2, 1)], 1).length, 1);
});

test('summarizeRecords: 최고 컨트롤과 최근 기록', () => {
  assert.deepEqual(summarizeRecords([]), { count: 0, best: null, latest: null });
  const s = summarizeRecords([rec(10, 0.9), rec(30, 0.8), rec(20, 1.2)]);
  assert.equal(s.count, 3);
  assert.equal(s.best.ts, 20);
  assert.equal(s.latest.ts, 30);
});

test('parseTime: "m:ss" 왕복, 잘못된 값은 0', () => {
  near(parseTime('13:30'), 13.5);
  near(parseTime('2'), 2);
  near(parseTime(fmtTime(7.25)), 7.25);
  assert.equal(parseTime(''), 0);
  assert.equal(parseTime(undefined), 0);
  assert.equal(parseTime('a:b'), 0);
  near(parseTime('1:99'), 1 + 59 / 60, 1e-9, '초는 59로 잘라낸다');
});

test('BOSS_NAMES: 중복 없는 문자열 목록', () => {
  assert.ok(BOSS_NAMES.length >= 10);
  assert.equal(new Set(BOSS_NAMES).size, BOSS_NAMES.length);
  assert.ok(BOSS_NAMES.every(n => typeof n === 'string' && n.trim() === n && n));
  assert.ok(BOSS_NAMES.includes('하드 세렌'));
});
