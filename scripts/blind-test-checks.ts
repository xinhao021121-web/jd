/**
 * 外部盲测的纯逻辑：判定门槛、汇总与结果解析（评审标准六）。
 * 与 CLI 脚本分开便于单测，与 packages/core 的 quality.ts 同一思路。
 */

export interface BlindTestRating {
  sample: string;
  /** 1–5：读起来像不像真人手写的 */
  humanLike: number;
  /** 1–5：敢不敢一个字不改直接发出去 */
  sendable: number;
  /** 1–5：有没有夸大或编造（5 = 完全没有） */
  truthful: number;
}

export interface BlindTestResult {
  tester: string;
  submittedAt?: string;
  ratings: BlindTestRating[];
}

export interface BlindTestSummary {
  testers: number;
  ratings: number;
  dimensions: { humanLike: number; sendable: number; truthful: number };
  overall: number;
  passed: boolean;
  reason: string;
  /** 评分者一致率：主观分数靠不靠得住，靠它判断 */
  agreement: BlindTestAgreement;
}

export interface BlindTestAgreement {
  /** 参与统计的单元格数：样本 × 维度，且该样本至少有 2 位评分者 */
  cells: number;
  /** 各评分者分数极差 ≤1 的单元格比例，0–1 */
  withinOneRate: number;
  /** 每个维度的平均极差（越小越一致） */
  avgRange: { humanLike: number; sendable: number; truthful: number };
}

export const BLIND_TEST_THRESHOLD = 3.5;
export const BLIND_TEST_MIN_TESTERS = 3;
export const BLIND_TEST_MAX_TESTERS = 5;

const round2 = (value: number): number => Math.round(value * 100) / 100;

const meanOrZero = (values: number[]): number =>
  values.length ? round2(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

const DIMENSIONS = ['humanLike', 'sendable', 'truthful'] as const;

/**
 * 评分者一致率。只统计同一样本上至少两位评分者的单元格——
 * 一个人打的分算不出分歧，把它算进去会把一致率虚高到 100%。
 */
export function computeAgreement(ratings: BlindTestRating[]): BlindTestAgreement {
  const bySample = new Map<string, BlindTestRating[]>();
  ratings.forEach((rating) => {
    const list = bySample.get(rating.sample) ?? [];
    list.push(rating);
    bySample.set(rating.sample, list);
  });

  const ranges: Record<(typeof DIMENSIONS)[number], number[]> = {
    humanLike: [],
    sendable: [],
    truthful: []
  };
  let cells = 0;
  let withinOne = 0;

  bySample.forEach((list) => {
    if (list.length < 2) return;
    DIMENSIONS.forEach((dimension) => {
      const scores = list.map((rating) => rating[dimension]);
      const range = Math.max(...scores) - Math.min(...scores);
      ranges[dimension].push(range);
      cells += 1;
      if (range <= 1) withinOne += 1;
    });
  });

  return {
    cells,
    withinOneRate: cells ? round2(withinOne / cells) : 0,
    avgRange: {
      humanLike: meanOrZero(ranges.humanLike),
      sendable: meanOrZero(ranges.sendable),
      truthful: meanOrZero(ranges.truthful)
    }
  };
}

/** 汇总评分：人数不足与均分不足都判不通过，理由写清是哪一条 */
export function summarize(results: BlindTestResult[]): BlindTestSummary {
  const ratings = results.flatMap((result) => result.ratings ?? []);
  const testers = new Set(results.map((result) => result.tester)).size;
  const dimensions = { humanLike: 0, sendable: 0, truthful: 0 };

  const emptyAgreement: BlindTestAgreement = {
    cells: 0,
    withinOneRate: 0,
    avgRange: { humanLike: 0, sendable: 0, truthful: 0 }
  };

  if (!ratings.length) {
    return {
      testers: 0,
      ratings: 0,
      dimensions,
      overall: 0,
      passed: false,
      reason: '还没有收到任何评分结果。',
      agreement: emptyAgreement
    };
  }

  const meanOf = (pick: (rating: BlindTestRating) => number): number =>
    ratings.reduce((sum, rating) => sum + pick(rating), 0) / ratings.length;

  // 总均分用未取整的维度均值计算，避免逐项取整后误差叠加
  const humanLike = meanOf((rating) => rating.humanLike);
  const sendable = meanOf((rating) => rating.sendable);
  const truthful = meanOf((rating) => rating.truthful);
  dimensions.humanLike = round2(humanLike);
  dimensions.sendable = round2(sendable);
  dimensions.truthful = round2(truthful);

  const overall = round2((humanLike + sendable + truthful) / 3);
  const base = {
    testers,
    ratings: ratings.length,
    dimensions,
    overall,
    agreement: computeAgreement(ratings)
  };

  if (testers < BLIND_TEST_MIN_TESTERS) {
    return {
      ...base,
      passed: false,
      reason: `只有 ${testers} 位测试者，评审标准要求 ${BLIND_TEST_MIN_TESTERS}–${BLIND_TEST_MAX_TESTERS} 人。`
    };
  }
  if (overall < BLIND_TEST_THRESHOLD) {
    return {
      ...base,
      passed: false,
      reason: `均分 ${overall} 低于门槛 ${BLIND_TEST_THRESHOLD}。`
    };
  }
  return {
    ...base,
    passed: true,
    reason: `${testers} 位测试者，均分 ${overall}，达到门槛 ${BLIND_TEST_THRESHOLD}。`
  };
}

const inScale = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;

/** 解析测试者导出的 JSON；缺项或超出 1–5 的评分一律丢弃，避免脏数据混进结论 */
export function parseResultJson(content: string, fallbackTester: string): BlindTestResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const raw = parsed as { tester?: unknown; submittedAt?: unknown; ratings?: unknown };
  const tester =
    typeof raw.tester === 'string' && raw.tester.trim() ? raw.tester.trim() : fallbackTester;

  const ratings = Array.isArray(raw.ratings)
    ? raw.ratings.flatMap((item): BlindTestRating[] => {
        const rating = item as Partial<BlindTestRating>;
        if (
          typeof rating.sample !== 'string' ||
          !inScale(rating.humanLike) ||
          !inScale(rating.sendable) ||
          !inScale(rating.truthful)
        ) {
          return [];
        }
        return [
          {
            sample: rating.sample,
            humanLike: rating.humanLike,
            sendable: rating.sendable,
            truthful: rating.truthful
          }
        ];
      })
    : [];

  if (!ratings.length) return null;
  return {
    tester,
    submittedAt: typeof raw.submittedAt === 'string' ? raw.submittedAt : undefined,
    ratings
  };
}
