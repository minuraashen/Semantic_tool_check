/**
 * metrics.ts
 *
 * Pure IR metric calculation functions for evaluating search quality.
 * No side effects — takes arrays of chunk IDs and returns numbers.
 */

export interface MetricsResult {
    precision: number;
    recall: number;
    f1: number;
    mrr: number;                       // Mean Reciprocal Rank
    rankOfFirstRelevant: number | null; // null if no relevant result found
    relevantFound: number;             // how many relevant chunks appeared in retrieved set
    totalRelevant: number;             // total ground-truth relevant chunks
    retrievedCount: number;            // how many results were retrieved (≤ K)
}

/**
 * Compute all metrics for a single query at a given K.
 *
 * @param retrieved  Ordered list of chunk IDs returned by the search method (rank order)
 * @param relevant   Set of ground-truth relevant chunk IDs
 * @returns          MetricsResult with precision, recall, F1, MRR
 */
export function computeMetrics(
    retrieved: number[],
    relevant: Set<number>
): MetricsResult {
    const totalRelevant = relevant.size;
    const retrievedCount = retrieved.length;

    if (retrievedCount === 0 || totalRelevant === 0) {
        return {
            precision: 0,
            recall: 0,
            f1: 0,
            mrr: 0,
            rankOfFirstRelevant: null,
            relevantFound: 0,
            totalRelevant,
            retrievedCount,
        };
    }

    // Count relevant results found and find rank of first relevant
    let relevantFound = 0;
    let rankOfFirstRelevant: number | null = null;

    for (let i = 0; i < retrieved.length; i++) {
        if (relevant.has(retrieved[i])) {
            relevantFound++;
            if (rankOfFirstRelevant === null) {
                rankOfFirstRelevant = i + 1; // 1-based rank
            }
        }
    }

    const precision = relevantFound / retrievedCount;
    const recall = relevantFound / totalRelevant;
    const f1 =
        precision + recall > 0
            ? (2 * precision * recall) / (precision + recall)
            : 0;

    const mrr = rankOfFirstRelevant !== null ? 1 / rankOfFirstRelevant : 0;

    return {
        precision,
        recall,
        f1,
        mrr,
        rankOfFirstRelevant,
        relevantFound,
        totalRelevant,
        retrievedCount,
    };
}

/**
 * Compute aggregate (mean) metrics across multiple queries.
 */
export function computeAverageMetrics(results: MetricsResult[]): {
    avgPrecision: number;
    avgRecall: number;
    avgF1: number;
    avgMRR: number;
    totalQueries: number;
    queriesWithHits: number; // queries where at least 1 relevant chunk was found
} {
    const n = results.length;
    if (n === 0) {
        return {
            avgPrecision: 0,
            avgRecall: 0,
            avgF1: 0,
            avgMRR: 0,
            totalQueries: 0,
            queriesWithHits: 0,
        };
    }

    let sumPrecision = 0;
    let sumRecall = 0;
    let sumF1 = 0;
    let sumMRR = 0;
    let queriesWithHits = 0;

    for (const r of results) {
        sumPrecision += r.precision;
        sumRecall += r.recall;
        sumF1 += r.f1;
        sumMRR += r.mrr;
        if (r.relevantFound > 0) queriesWithHits++;
    }

    return {
        avgPrecision: sumPrecision / n,
        avgRecall: sumRecall / n,
        avgF1: sumF1 / n,
        avgMRR: sumMRR / n,
        totalQueries: n,
        queriesWithHits,
    };
}
