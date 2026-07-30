// 모델별 1M 토큰 단가 (USD). 2026-07-30 기준.
//   구독제 사용자에게 이 값은 실청구액이 아니라 「정가로 샀으면 얼마」 — 본전 계산용이다.
//   모델이 추가/변경되면 여기만 고치면 된다.

export const PRICES = {
  "claude-fable-5": { in: 10, out: 50 },
  "claude-mythos-5": { in: 10, out: 50 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-opus-4-7": { in: 5, out: 25 },
  "claude-opus-4-6": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 }
};

// 캐시 배수 — 읽기는 입력가의 0.1배, 쓰기는 TTL 에 따라 1.25배(5분) 또는 2.0배(1시간).
export const CACHE_READ_MULT = 0.1;
export const CACHE_WRITE_MULT = { "5m": 1.25, "1h": 2.0 };

/**
 * 모델 ID 를 단가표 키로 정규화한다.
 * 실 로그에는 `claude-opus-5[1m]` 처럼 컨텍스트 접미사나 날짜 접미사가 붙어 오는 경우가 있다.
 */
export function normalizeModel(raw) {
  if (!raw) return null;
  const id = String(raw).trim().toLowerCase();
  if (PRICES[id]) return id;
  // `claude-opus-5[1m]` → `claude-opus-5`
  const stripped = id.replace(/\[[^\]]*\]$/, "");
  if (PRICES[stripped]) return stripped;
  // `claude-haiku-4-5-20251001` → 가장 긴 접두사 일치
  const hit = Object.keys(PRICES)
    .filter((k) => stripped.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return hit ?? null;
}

/**
 * usage 합계를 달러로 환산.
 * @param {{input:number,output:number,cacheRead:number,cacheWrite:number}} u
 * @param {string} model  정규화된 모델 키
 * @param {"5m"|"1h"} ttl 캐시 TTL (기본 5m)
 * @returns {number|null} 단가를 모르는 모델이면 null
 */
export function priceUsage(u, model, ttl = "5m") {
  const p = PRICES[model];
  if (!p) return null;
  const writeMult = CACHE_WRITE_MULT[ttl] ?? CACHE_WRITE_MULT["5m"];
  const dollars =
    (u.input * p.in +
      u.cacheRead * p.in * CACHE_READ_MULT +
      u.cacheWrite * p.in * writeMult +
      u.output * p.out) /
    1_000_000;
  return dollars;
}
