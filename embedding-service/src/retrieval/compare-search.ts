import * as path from 'path';
import { CodeRetrieval, RetrievalResult } from './code_retrieve_enhanced';
import { BM25SearchService, BM25Result } from './bm25-search';

const rootDir = path.resolve(__dirname, '../../');
const defaultDbPath = path.resolve(rootDir, 'data/embeddings.db');

// ── Unified result type for comparison ──────────────────────────

export interface RankedChunk {
  chunkId: number;
  rank: number;                     // 1-based position in result list
  score: number;                    // similarity (vector) or bm25Score (BM25)
  filePath: string;
}

export interface ComparisonResult {
  query: string;
  topK: number;
  vector_results: RankedChunk[];
  bm25_results: RankedChunk[];
  // Overlap metrics
  overlap: {
    /** Number of chunk_ids appearing in BOTH result sets */
    count: number;
    /** Jaccard similarity = |A ∩ B| / |A ∪ B| */
    jaccardSimilarity: number;
    /** Chunk IDs present in both */
    commonChunkIds: number[];
    /**
     * For each common chunk, the signed rank difference (vector_rank − bm25_rank).
     * Negative means vector ranked it higher; positive means BM25 ranked it higher.
     */
    rankDifferences: { chunkId: number; vectorRank: number; bm25Rank: number; diff: number }[];
  };
}

// ── Comparison utility ──────────────────────────────────────────

export class SearchComparison {
  private vectorSearch: CodeRetrieval;
  private bm25Search: BM25SearchService;
  private initialized = false;

  constructor(dbPath?: string, modelPath?: string) {
    this.vectorSearch = new CodeRetrieval();
    this.bm25Search = new BM25SearchService(dbPath || defaultDbPath);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.vectorSearch.initialize();
    this.initialized = true;
  }

  /**
   * Run the same query against both vector search and BM25,
   * then compute overlap / ranking metrics.
   */
  async compareSearchMethods(query: string, topK: number = 10): Promise<ComparisonResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    // 1. Vector search
    const vectorRaw = await this.vectorSearch.search(query, topK);
    const vectorResults = vectorRaw.map((r, idx) => toRankedChunk(r, idx + 1, r.similarity));

    // 2. BM25 search
    const bm25Raw = this.bm25Search.searchBM25(query, topK);
    const bm25Results = bm25Raw.map((r, idx) => toRankedChunk(r, idx + 1, r.bm25Score));

    // 3. Compute overlap metrics
    const vectorIds = new Set(vectorResults.map(r => r.chunkId));
    const bm25Ids = new Set(bm25Results.map(r => r.chunkId));

    const commonIds = [...vectorIds].filter(id => bm25Ids.has(id));
    const unionSize = new Set([...vectorIds, ...bm25Ids]).size;
    const jaccardSimilarity = unionSize === 0 ? 0 : commonIds.length / unionSize;

    // Rank lookup maps
    const vectorRankMap = new Map(vectorResults.map(r => [r.chunkId, r.rank]));
    const bm25RankMap = new Map(bm25Results.map(r => [r.chunkId, r.rank]));

    const rankDifferences = commonIds.map(id => {
      const vr = vectorRankMap.get(id)!;
      const br = bm25RankMap.get(id)!;
      return { chunkId: id, vectorRank: vr, bm25Rank: br, diff: vr - br };
    });

    return {
      query,
      topK,
      vector_results: vectorResults,
      bm25_results: bm25Results,
      overlap: {
        count: commonIds.length,
        jaccardSimilarity,
        commonChunkIds: commonIds,
        rankDifferences,
      },
    };
  }

  async close(): Promise<void> {
    await this.vectorSearch.close();
    this.bm25Search.close();
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function toRankedChunk(
  r: RetrievalResult | BM25Result,
  rank: number,
  score: number
): RankedChunk {
  return {
    chunkId: r.id,
    rank,
    score,
    filePath: r.filePath,
  };
}

// ── Pretty-print helper (for CLI) ──────────────────────────────

export function printComparison(result: ComparisonResult): void {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  SEARCH COMPARISON — "${result.query}" (top ${result.topK})`);
  console.log(`${'═'.repeat(70)}\n`);

  // Vector results
  console.log('📐  VECTOR SEARCH RESULTS');
  console.log('─'.repeat(50));
  for (const r of result.vector_results) {
    console.log(
      `  #${r.rank}  [score: ${r.score.toFixed(4)}]  ${r.filePath}`
    );
  }

  console.log('');

  // BM25 results
  console.log('📝  BM25 SEARCH RESULTS');
  console.log('─'.repeat(50));
  for (const r of result.bm25_results) {
    console.log(
      `  #${r.rank}  [score: ${r.score.toFixed(4)}]  ${r.filePath}`
    );
  }

  console.log('');

  // Overlap metrics
  console.log('📊  OVERLAP METRICS');
  console.log('─'.repeat(50));
  console.log(`  Overlap count:       ${result.overlap.count} / ${result.topK}`);
  console.log(`  Jaccard similarity:  ${result.overlap.jaccardSimilarity.toFixed(4)}`);

  if (result.overlap.rankDifferences.length > 0) {
    console.log(`  Rank differences (vector − BM25):`);
    for (const rd of result.overlap.rankDifferences) {
      const arrow = rd.diff < 0 ? '↑ vector higher' : rd.diff > 0 ? '↑ BM25 higher' : '= same';
      console.log(
        `    chunk ${rd.chunkId}: vector=#${rd.vectorRank} bm25=#${rd.bm25Rank}  (diff ${rd.diff > 0 ? '+' : ''}${rd.diff} ${arrow})`
      );
    }
  }

  console.log(`\n${'═'.repeat(70)}\n`);
}
