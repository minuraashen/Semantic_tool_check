import * as path from 'path';
import { SQLiteDB, ChunkRecord } from '../db/sqlite';

const rootDir = path.resolve(__dirname, '../../');
const defaultDbPath = path.resolve(rootDir, 'data/embeddings.db');

/**
 * Result returned by the BM25 search service.
 * Mirrors RetrievalResult from vector search but uses bm25Score instead of similarity.
 */
export interface BM25Result {
  id: number;
  chunkId: number;
  filePath: string;
  resourceName: string;
  resourceType: string;
  chunkType: string;
  startLine: number;
  endLine: number;
  bm25Score: number;
  parentChunkId: number | null;
  semanticType: string;
  semanticIntent: string;
  context: any;
  sequenceKey?: string;
  isSequenceDefinition?: boolean;
  referencedSequences?: string[];
}

/**
 * BM25SearchService — sparse term-based search over embeddingText using SQLite FTS5.
 *
 * Design constraints:
 *  - Operates on the SAME embeddingText that the vector pipeline uses.
 *  - Does NOT re-chunk or re-embed anything.
 *  - The FTS5 table (chunks_fts) is populated by the existing pipeline
 *    via SQLiteDB.insertChunk / updateChunk / deleteChunk.
 *  - This service is read-only; it only queries the index.
 */
export class BM25SearchService {
  private db: SQLiteDB;

  constructor(dbPath?: string) {
    this.db = new SQLiteDB(dbPath || defaultDbPath);
  }

  /**
   * Search the FTS5 index using BM25 ranking.
   *
   * @param query  Natural-language or keyword query.
   * @param topK   Maximum number of results to return (default 10).
   * @returns      Ranked list of BM25Result objects (lower bm25 = better match
   *               because SQLite's bm25() returns negative values where more
   *               negative = better; we negate so higher = better).
   */
  searchBM25(query: string, topK: number = 10): BM25Result[] {
    const sanitized = this.sanitizeQuery(query);
    if (!sanitized) {
      return [];
    }

    const handle = this.db.getHandle();

    // FTS5 MATCH with bm25() ranking.
    // bm25() returns negative values (more negative = better match).
    // We ORDER BY score ASC so best matches come first, then negate in output.
    const stmt = handle.prepare(`
      SELECT
        f.chunk_id,
        bm25(chunks_fts) AS score
      FROM chunks_fts f
      WHERE chunks_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `);

    const ftsRows = stmt.all(sanitized, topK) as { chunk_id: number; score: number }[];

    if (ftsRows.length === 0) {
      return [];
    }

    // Batch-fetch chunk metadata for matched chunk_ids
    const chunkIds = ftsRows.map(r => r.chunk_id);
    const scoreMap = new Map(ftsRows.map(r => [r.chunk_id, r.score]));

    const placeholders = chunkIds.map(() => '?').join(',');
    const chunkStmt = handle.prepare(
      `SELECT * FROM chunks WHERE id IN (${placeholders})`
    );
    const chunkRows = chunkStmt.all(...chunkIds) as any[];

    // Map rows to results, preserving BM25 rank order
    const chunkMap = new Map<number, any>();
    for (const row of chunkRows) {
      chunkMap.set(row.id, row);
    }

    const results: BM25Result[] = [];
    for (const ftsRow of ftsRows) {
      const row = chunkMap.get(ftsRow.chunk_id);
      if (!row) continue; // orphan FTS entry — skip

      results.push({
        id: row.id,
        chunkId: ftsRow.chunk_id,
        filePath: row.file_path,
        resourceName: row.resource_name,
        resourceType: row.resource_type,
        chunkType: row.chunk_type,
        startLine: row.start_line,
        endLine: row.end_line,
        bm25Score: -ftsRow.score, // negate so higher = better
        parentChunkId: row.parent_chunk_id,
        semanticType: row.semantic_type,
        semanticIntent: row.semantic_intent,
        context: JSON.parse(row.context_json),
        sequenceKey: row.sequence_key,
        isSequenceDefinition: row.is_sequence_definition === 1,
        referencedSequences: row.referenced_sequences
          ? JSON.parse(row.referenced_sequences)
          : undefined,
      });
    }

    return results;
  }

  /**
   * Get total number of documents in the FTS5 index.
   * Useful for diagnostics.
   */
  getIndexSize(): number {
    const handle = this.db.getHandle();
    const row = handle.prepare(`SELECT COUNT(*) AS cnt FROM chunks_fts`).get() as { cnt: number };
    return row.cnt;
  }

  /**
   * Sanitize a user query for FTS5 MATCH.
   *
   * Strategy:
   *  - Strip characters that are FTS5 operators/special  (^  *  "  :  {  }  (  )  NEAR  OR  AND  NOT)
   *  - Collapse whitespace
   *  - Filter out single-char tokens (noise)
   *  - Join with OR for better recall on natural-language queries
   *    (FTS5 default is AND which is too restrictive)
   *  - Return empty string if nothing useful remains
   */
  private sanitizeQuery(raw: string): string {
    // 1. Remove all non-alphanumeric characters (keeps spaces)
    let q = raw
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      // 2. Remove FTS5 boolean operators when they appear as whole words
      .replace(/\b(NEAR|OR|AND|NOT)\b/gi, ' ')
      // 3. Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim();

    // 4. Filter out single-char tokens (noise for BM25)
    const tokens = q.split(' ').filter(t => t.length > 1);

    if (tokens.length === 0) return '';

    // 5. Join with OR for better recall; BM25 ranking still
    //    rewards documents matching more terms.
    return tokens.join(' OR ');
  }

  close(): void {
    this.db.close();
  }
}
