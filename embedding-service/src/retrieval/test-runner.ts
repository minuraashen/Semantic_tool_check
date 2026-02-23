#!/usr/bin/env node

/**
 * test-runner.ts
 *
 * Automated search comparison runner.
 * Loads ground-truth.json, runs both vector and BM25 searches,
 * calculates metrics, and outputs:
 *   - results-automated.csv  (spreadsheet-friendly)
 *   - results-automated.json (full data for programmatic use)
 *
 * Usage:
 *   npm run test:compare
 */

import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { CodeRetrieval } from './code_retrieve_enhanced';
import { BM25SearchService } from './bm25-search';
import { computeMetrics, computeAverageMetrics, MetricsResult } from './metrics';

// ── Paths ──────────────────────────────────────────────────────
const rootDir = path.resolve(__dirname, '../../');
const groundTruthPath = path.resolve(rootDir, '../final-ground-truth.json');
const dbPath = path.resolve(rootDir, 'data/embeddings.db');
const csvOutputPath = path.resolve(rootDir, '../all-results-final.csv');
const jsonOutputPath = path.resolve(rootDir, '../all-results-final.json');

// ── K values to test at ────────────────────────────────────────
const K_VALUES = [10, 15, 20];

// ── Types ──────────────────────────────────────────────────────

interface GroundTruthQuery {
    id: string;
    text: string;
    complexity: string;
    files: { fileName: string; lineRange: string; chunkIds: number[] }[];
    totalRelevantChunks: number;
    allRelevantChunkIds: number[];
}

interface GroundTruthDataset {
    generatedAt: string;
    totalQueries: number;
    totalChunksInDb: number;
    queries: GroundTruthQuery[];
}

interface QueryTestResult {
    queryId: string;
    queryText: string;
    complexity: string;
    totalRelevantChunks: number;
    vector: {
        [k: number]: {
            metrics: MetricsResult;
            latencyMs: number;
            retrievedChunkIds: number[];
        };
    };
    bm25: {
        [k: number]: {
            metrics: MetricsResult;
            latencyMs: number;
            retrievedChunkIds: number[];
        };
    };
    winner: { [k: number]: string }; // 'vector' | 'bm25' | 'tie'
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
    console.log('🧪 Search Comparison Test Runner');
    console.log('═'.repeat(60));

    // 1. Load ground truth
    if (!fs.existsSync(groundTruthPath)) {
        console.error(`❌ Ground truth not found: ${groundTruthPath}`);
        console.error('   Run "npm run ground-truth:build" first.');
        process.exit(1);
    }
    const groundTruth: GroundTruthDataset = JSON.parse(
        fs.readFileSync(groundTruthPath, 'utf-8')
    );
    console.log(`📄 Loaded ${groundTruth.totalQueries} queries from ground truth`);
    console.log(`💾 Database has ${groundTruth.totalChunksInDb} total chunks\n`);

    // 2. Initialize search services
    console.log('⏳ Initializing search services...');
    const vectorSearch = new CodeRetrieval();
    const bm25Search = new BM25SearchService(dbPath);
    await vectorSearch.initialize();
    console.log('✅ Search services ready\n');

    // 3. Run tests
    const allResults: QueryTestResult[] = [];
    const maxK = Math.max(...K_VALUES);

    for (const query of groundTruth.queries) {
        console.log(`  ${query.id}: "${query.text}" (${query.complexity})`);
        console.log(`    Ground truth: ${query.totalRelevantChunks} relevant chunks`);

        const relevantSet = new Set(query.allRelevantChunkIds);
        const result: QueryTestResult = {
            queryId: query.id,
            queryText: query.text,
            complexity: query.complexity,
            totalRelevantChunks: query.totalRelevantChunks,
            vector: {},
            bm25: {},
            winner: {},
        };

        // ── Vector search (run once at max K, slice for lower K values) ──
        const vecStart = performance.now();
        const vectorResults = await vectorSearch.search(query.text, maxK);
        const vecTotalMs = performance.now() - vecStart;
        const vectorChunkIds = vectorResults.map(r => r.id);

        for (const k of K_VALUES) {
            const topKIds = vectorChunkIds.slice(0, k);
            const metrics = computeMetrics(topKIds, relevantSet);
            result.vector[k] = {
                metrics,
                latencyMs: Math.round(vecTotalMs * 100) / 100,
                retrievedChunkIds: topKIds,
            };
        }

        // ── BM25 search (run once at max K, slice for lower K values) ──
        const bm25Start = performance.now();
        const bm25Results = bm25Search.searchBM25(query.text, maxK);
        const bm25TotalMs = performance.now() - bm25Start;
        const bm25ChunkIds = bm25Results.map(r => r.chunkId);

        for (const k of K_VALUES) {
            const topKIds = bm25ChunkIds.slice(0, k);
            const metrics = computeMetrics(topKIds, relevantSet);
            result.bm25[k] = {
                metrics,
                latencyMs: Math.round(bm25TotalMs * 100) / 100,
                retrievedChunkIds: topKIds,
            };
        }

        // ── Determine winner at each K ──
        for (const k of K_VALUES) {
            const vRecall = result.vector[k].metrics.recall;
            const bRecall = result.bm25[k].metrics.recall;

            if (vRecall > bRecall) {
                result.winner[k] = 'vector';
            } else if (bRecall > vRecall) {
                result.winner[k] = 'bm25';
            } else {
                // Tie on recall → break by MRR
                const vMRR = result.vector[k].metrics.mrr;
                const bMRR = result.bm25[k].metrics.mrr;
                if (vMRR > bMRR) result.winner[k] = 'vector';
                else if (bMRR > vMRR) result.winner[k] = 'bm25';
                else {
                    // Still tied → break by latency
                    const vLat = result.vector[k].latencyMs;
                    const bLat = result.bm25[k].latencyMs;
                    if (bLat < vLat) result.winner[k] = 'bm25';
                    else if (vLat < bLat) result.winner[k] = 'vector';
                    else result.winner[k] = 'tie';
                }
            }
        }

        // Print quick summary for this query
        const v10 = result.vector[10].metrics;
        const b10 = result.bm25[10].metrics;
        console.log(
            `    Vector@10: P=${v10.precision.toFixed(2)} R=${v10.recall.toFixed(2)} MRR=${v10.mrr.toFixed(2)} (${result.vector[10].latencyMs.toFixed(0)}ms)`
        );
        console.log(
            `    BM25@10:   P=${b10.precision.toFixed(2)} R=${b10.recall.toFixed(2)} MRR=${b10.mrr.toFixed(2)} (${result.bm25[10].latencyMs.toFixed(0)}ms)`
        );
        console.log(`    Winner@10: ${result.winner[10]}\n`);

        allResults.push(result);
    }

    // ── Close services ──
    await vectorSearch.close();
    bm25Search.close();

    // 4. Generate CSV
    generateCSV(allResults);

    // 5. Generate JSON
    generateJSON(allResults, groundTruth);

    // 6. Print aggregate summary
    printSummary(allResults);

    process.exit(0);
}

// ── CSV Generation ─────────────────────────────────────────────

function generateCSV(results: QueryTestResult[]) {
    const headers = [
        'Query ID',
        'Query',
        'Complexity',
        'Total Relevant Chunks',
    ];

    // Add metric columns for each K
    for (const k of K_VALUES) {
        headers.push(
            `Vector P@${k}`,
            `Vector R@${k}`,
            `Vector F1@${k}`,
        );
    }
    headers.push('Vector MRR', 'Vector Latency(ms)');

    for (const k of K_VALUES) {
        headers.push(
            `BM25 P@${k}`,
            `BM25 R@${k}`,
            `BM25 F1@${k}`,
        );
    }
    headers.push('BM25 MRR', 'BM25 Latency(ms)');

    for (const k of K_VALUES) {
        headers.push(`Winner@${k}`);
    }

    const rows: string[][] = [];

    for (const r of results) {
        const row: string[] = [
            r.queryId,
            `"${r.queryText}"`,
            r.complexity,
            String(r.totalRelevantChunks),
        ];

        for (const k of K_VALUES) {
            const m = r.vector[k].metrics;
            row.push(m.precision.toFixed(4), m.recall.toFixed(4), m.f1.toFixed(4));
        }
        row.push(
            r.vector[10].metrics.mrr.toFixed(4),
            r.vector[10].latencyMs.toFixed(2)
        );

        for (const k of K_VALUES) {
            const m = r.bm25[k].metrics;
            row.push(m.precision.toFixed(4), m.recall.toFixed(4), m.f1.toFixed(4));
        }
        row.push(
            r.bm25[10].metrics.mrr.toFixed(4),
            r.bm25[10].latencyMs.toFixed(2)
        );

        for (const k of K_VALUES) {
            row.push(r.winner[k]);
        }

        rows.push(row);
    }

    // Aggregate row
    const avgRow: string[] = ['AVERAGE', '', '', ''];

    for (const k of K_VALUES) {
        const vectorMetricsAtK = results.map(r => r.vector[k].metrics);
        const avgVec = computeAverageMetrics(vectorMetricsAtK);
        avgRow.push(
            avgVec.avgPrecision.toFixed(4),
            avgVec.avgRecall.toFixed(4),
            avgVec.avgF1.toFixed(4)
        );
    }
    const avgVecMRR =
        results.reduce((s, r) => s + r.vector[10].metrics.mrr, 0) / results.length;
    const avgVecLat =
        results.reduce((s, r) => s + r.vector[10].latencyMs, 0) / results.length;
    avgRow.push(avgVecMRR.toFixed(4), avgVecLat.toFixed(2));

    for (const k of K_VALUES) {
        const bm25MetricsAtK = results.map(r => r.bm25[k].metrics);
        const avgBm = computeAverageMetrics(bm25MetricsAtK);
        avgRow.push(
            avgBm.avgPrecision.toFixed(4),
            avgBm.avgRecall.toFixed(4),
            avgBm.avgF1.toFixed(4)
        );
    }
    const avgBm25MRR =
        results.reduce((s, r) => s + r.bm25[10].metrics.mrr, 0) / results.length;
    const avgBm25Lat =
        results.reduce((s, r) => s + r.bm25[10].latencyMs, 0) / results.length;
    avgRow.push(avgBm25MRR.toFixed(4), avgBm25Lat.toFixed(2));

    // Count winners at each K for AVERAGE row
    for (const k of K_VALUES) {
        const vectorWins = results.filter(r => r.winner[k] === 'vector').length;
        const bm25Wins = results.filter(r => r.winner[k] === 'bm25').length;
        const ties = results.filter(r => r.winner[k] === 'tie').length;
        avgRow.push(`V:${vectorWins} B:${bm25Wins} T:${ties}`);
    }

    rows.push(avgRow);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join(
        '\n'
    );

    fs.writeFileSync(csvOutputPath, csvContent, 'utf-8');
    console.log(`\n📊 CSV written to: ${csvOutputPath}`);
}

// ── JSON Generation ────────────────────────────────────────────

function generateJSON(results: QueryTestResult[], groundTruth: GroundTruthDataset) {
    const output = {
        generatedAt: new Date().toISOString(),
        groundTruthGeneratedAt: groundTruth.generatedAt,
        totalQueries: results.length,
        kValues: K_VALUES,
        results,
        aggregates: {
            vector: {} as any,
            bm25: {} as any,
        },
        overallWinner: {} as any,
    };

    for (const k of K_VALUES) {
        const vecMetrics = computeAverageMetrics(results.map(r => r.vector[k].metrics));
        const bm25Metrics = computeAverageMetrics(results.map(r => r.bm25[k].metrics));
        output.aggregates.vector[`@${k}`] = vecMetrics;
        output.aggregates.bm25[`@${k}`] = bm25Metrics;

        const vectorWins = results.filter(r => r.winner[k] === 'vector').length;
        const bm25Wins = results.filter(r => r.winner[k] === 'bm25').length;
        output.overallWinner[`@${k}`] = {
            vectorWins,
            bm25Wins,
            ties: results.length - vectorWins - bm25Wins,
            winner: vectorWins > bm25Wins ? 'vector' : bm25Wins > vectorWins ? 'bm25' : 'tie',
        };
    }

    fs.writeFileSync(jsonOutputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`📋 JSON written to: ${jsonOutputPath}`);
}

// ── Summary ────────────────────────────────────────────────────

function printSummary(results: QueryTestResult[]) {
    console.log('\n' + '═'.repeat(60));
    console.log('  AGGREGATE RESULTS');
    console.log('═'.repeat(60));

    for (const k of K_VALUES) {
        const vecMetrics = computeAverageMetrics(
            results.map(r => r.vector[k].metrics)
        );
        const bm25Metrics = computeAverageMetrics(
            results.map(r => r.bm25[k].metrics)
        );

        console.log(`\n  @${k} results:`);
        console.log(
            `    Vector: P=${vecMetrics.avgPrecision.toFixed(3)} R=${vecMetrics.avgRecall.toFixed(3)} F1=${vecMetrics.avgF1.toFixed(3)} MRR=${vecMetrics.avgMRR.toFixed(3)}`
        );
        console.log(
            `    BM25:   P=${bm25Metrics.avgPrecision.toFixed(3)} R=${bm25Metrics.avgRecall.toFixed(3)} F1=${bm25Metrics.avgF1.toFixed(3)} MRR=${bm25Metrics.avgMRR.toFixed(3)}`
        );

        const vectorWins = results.filter(r => r.winner[k] === 'vector').length;
        const bm25Wins = results.filter(r => r.winner[k] === 'bm25').length;
        const ties = results.length - vectorWins - bm25Wins;
        console.log(`    Wins: Vector=${vectorWins} BM25=${bm25Wins} Tie=${ties}`);
    }

    // Latency comparison
    const avgVecLatency =
        results.reduce((s, r) => s + r.vector[10].latencyMs, 0) / results.length;
    const avgBm25Latency =
        results.reduce((s, r) => s + r.bm25[10].latencyMs, 0) / results.length;

    console.log('\n  Latency:');
    console.log(`    Vector: ${avgVecLatency.toFixed(1)}ms avg`);
    console.log(`    BM25:   ${avgBm25Latency.toFixed(1)}ms avg`);
    console.log(
        `    BM25 is ${(avgVecLatency / avgBm25Latency).toFixed(1)}x ${avgBm25Latency < avgVecLatency ? 'faster' : 'slower'}`
    );

    // Complexity breakdown
    console.log('\n  By Complexity (Recall@10):');
    for (const complexity of ['simple', 'medium', 'confusion']) {
        const subset = results.filter(r => r.complexity === complexity);
        if (subset.length === 0) continue;
        const vecR = subset.reduce((s, r) => s + r.vector[10].metrics.recall, 0) / subset.length;
        const bmR = subset.reduce((s, r) => s + r.bm25[10].metrics.recall, 0) / subset.length;
        console.log(
            `    ${complexity.padEnd(10)} (${subset.length} queries): Vector R=${vecR.toFixed(3)} | BM25 R=${bmR.toFixed(3)}`
        );
    }

    console.log('\n' + '═'.repeat(60));
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
