// ADR-041: idle minutes - alive, out of base, nothing that pays.
import assert from "node:assert/strict";
import { test } from "node:test";
import { idleRuns, idleTime, type IdleInput } from "../src/review-idle.js";

const M = 20; // a 20-minute match
const zeros = () => Array(M).fill(0);
/** walk from the fountain (70,70) to the middle and stay there; enemies far away. */
function base(position: number): IdleInput {
  const me = [{ time: -60, x: 70, y: 70 }, ...Array.from({ length: M * 12 }, (_, i) => ({ time: i * 5, x: 130, y: 130 }))];
  const far = [{ time: -60, x: 190, y: 190 }];
  const lastHits = zeros();
  const networth = Array.from({ length: M + 1 }, (_, m) => 600 + m * 400);
  for (let m = 0; m < M; m++) lastHits[m] = 6; // farming every minute...
  return {
    lastHits,
    denies: zeros(),
    networth,
    xp: Array(M).fill(300),
    heroDamage: zeros(),
    damageReceived: zeros(),
    campStack: zeros(),
    actions: [],
    me,
    enemies: [far, far, far, far, far],
    dead: [],
    duration: M * 60,
    position,
  };
}
const idleAt = (d: IdleInput, ms: number[]) => {
  for (const m of ms) {
    d.lastHits![m] = 0;
    d.xp![m] = 0;
  }
  return d;
};

test("idle: a farming core is not idle; minutes with nothing are, priced at the farming pace", () => {
  assert.deepEqual(idleTime(base(1))!.minutes, []);
  const r = idleTime(idleAt(base(1), [8, 9, 10, 15]))!;
  assert.deepEqual(r.minutes, [8, 9, 10, 15]);
  assert.equal(r.checked, M - 4, "from minute 4");
  assert.equal(r.pace, 400, "median networth per farming minute");
  assert.equal(r.goldLost, 1600);
  assert.deepEqual(idleRuns(r.minutes), [[8, 10], [15, 15]]);
});

test("idle: base, death, a cast, a stack, a fight or an enemy nearby are not idle", () => {
  const d = idleAt(base(5), [6, 7, 8, 9, 10, 11]);
  // 6: in base
  for (const p of d.me) if (p.time >= 360 && p.time < 420) Object.assign(p, { x: 72, y: 72 });
  d.dead.push([430, 470]); // 7: dead part of it
  d.actions.push(500); // 8: a cast / ward / rune
  d.campStack = zeros().map((_, m) => (m >= 9 ? 1 : 0)); // 9: a stack
  d.heroDamage![10] = 150; // 10: hit a hero
  d.enemies[0] = [{ time: -60, x: 190, y: 190 }, { time: 660, x: 135, y: 132 }, { time: 720, x: 190, y: 190 }]; // 11: enemy close
  const r = idleTime(d)!;
  assert.deepEqual(r.minutes, [], "every one of them had a reason");
  assert.equal(r.checked, M - 4 - 2, "base and dead minutes are not checked");
});

test("idle: supports get stack / ward chances instead of gold", () => {
  const r = idleTime(idleAt(base(4), [12, 13]))!;
  assert.deepEqual(r.minutes, [12, 13]);
  assert.equal(r.stackChances, 2);
  assert.equal(r.goldLost, undefined);
});
