import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export interface ChunkMetadata {
  filePath: string;
  fileHash: string;
  resourceName: string;
  resourceType: string;
  chunkType: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  parentChunkId: number | null;
  timestamp: number;
  // NEW: Merkle tree and semantic metadata
  contentHash: string;
  semanticType: string;
  semanticIntent: string;
  context: {
    api?: {
      name?: string;
      context?: string;
      xmlns?: string;
    };
    resource?: {
      method?: string;
      uriTemplate?: string;
    };
    sequence?: string | {
      name?: string;
      xmlns?: string;
    };
    localEntry?: {
      key?: string;
      xmlns?: string;
    };
    endpoint?: {
      name?: string;
      xmlns?: string;
    };
    template?: {
      name?: string;
      xmlns?: string;
    };
    // NEW: Support for additional artifact types
    proxyService?: {
      name?: string;
      transports?: string;
      xmlns?: string;
    };
    messageStore?: {
      name?: string;
      type?: string;
      xmlns?: string;
    };
    messageProcessor?: {
      name?: string;
      type?: string;
      messageStore?: string;
      xmlns?: string;
    };
    dataService?: {
      name?: string;
      enableBatchRequests?: boolean;
      xmlns?: string;
    };
    query?: {
      id?: string;
      useConfig?: string;
    };
    operation?: {
      name?: string;
      callsQuery?: string;
    };
    task?: {
      name?: string;
      trigger?: string;
      xmlns?: string;
    };
    references?: string[];
  };
  // NEW: Cross-file sequence tracking
  sequenceKey?: string;
  isSequenceDefinition?: boolean;
  referencedSequences?: string[];
}

export interface ChunkRecord extends ChunkMetadata {
  id: number;
  embedding: Buffer;
}

export class SQLiteDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initialize();
  }

  private initialize(): void {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  // ── FTS5 helpers (keep in sync with chunks table) ──────────────────

  private insertFts(chunkId: number, embeddingText: string): void {
    const stmt = this.db.prepare(
      `INSERT INTO chunks_fts (chunk_id, embedding_text) VALUES (?, ?)`
    );
    stmt.run(chunkId, embeddingText);
  }

  private updateFts(chunkId: number, embeddingText: string): void {
    // FTS5 does not support UPDATE — delete then re-insert
    this.deleteFts(chunkId);
    this.insertFts(chunkId, embeddingText);
  }

  private deleteFts(chunkId: number): void {
    const stmt = this.db.prepare(
      `DELETE FROM chunks_fts WHERE chunk_id = ?`
    );
    stmt.run(chunkId);
  }

  // ── Chunk CRUD ────────────────────────────────────────────────────

  insertChunk(metadata: ChunkMetadata, embedding: Float32Array, embeddingText?: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (
        file_path, file_hash, resource_name, resource_type, chunk_type,
        chunk_index, start_line, end_line, parent_chunk_id, embedding, timestamp,
        content_hash, semantic_type, semantic_intent, context_json,
        sequence_key, is_sequence_definition, referenced_sequences
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      metadata.filePath,
      metadata.fileHash,
      metadata.resourceName,
      metadata.resourceType,
      metadata.chunkType,
      metadata.chunkIndex,
      metadata.startLine,
      metadata.endLine,
      metadata.parentChunkId,
      Buffer.from(embedding.buffer),
      metadata.timestamp,
      metadata.contentHash,
      metadata.semanticType,
      metadata.semanticIntent,
      JSON.stringify(metadata.context),
      metadata.sequenceKey || null,
      metadata.isSequenceDefinition ? 1 : 0,
      metadata.referencedSequences ? JSON.stringify(metadata.referencedSequences) : null
    );

    const id = result.lastInsertRowid as number;

    // Sync FTS5 index
    if (embeddingText) {
      this.insertFts(id, embeddingText);
    }

    return id;
  }

  updateChunk(id: number, metadata: ChunkMetadata, embedding: Float32Array, embeddingText?: string): void {
    const stmt = this.db.prepare(`
      UPDATE chunks SET
        file_hash = ?, resource_name = ?, resource_type = ?, chunk_type = ?,
        chunk_index = ?, start_line = ?, end_line = ?, parent_chunk_id = ?,
        embedding = ?, timestamp = ?,
        content_hash = ?, semantic_type = ?, semantic_intent = ?, context_json = ?,
        sequence_key = ?, is_sequence_definition = ?, referenced_sequences = ?
      WHERE id = ?
    `);

    stmt.run(
      metadata.fileHash,
      metadata.resourceName,
      metadata.resourceType,
      metadata.chunkType,
      metadata.chunkIndex,
      metadata.startLine,
      metadata.endLine,
      metadata.parentChunkId,
      Buffer.from(embedding.buffer),
      metadata.timestamp,
      metadata.contentHash,
      metadata.semanticType,
      metadata.semanticIntent,
      JSON.stringify(metadata.context),
      metadata.sequenceKey || null,
      metadata.isSequenceDefinition ? 1 : 0,
      metadata.referencedSequences ? JSON.stringify(metadata.referencedSequences) : null,
      id
    );

    // Sync FTS5 index
    if (embeddingText) {
      this.updateFts(id, embeddingText);
    }
  }

  getChunksByFile(filePath: string): ChunkRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM chunks WHERE file_path = ?
    `);
    const rows = stmt.all(filePath) as any[];
    return rows.map(this.mapRowToRecord);
  }

  getChunkByLocation(filePath: string, startLine: number, endLine: number): ChunkRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM chunks WHERE file_path = ? AND start_line = ? AND end_line = ?
    `);
    const row = stmt.get(filePath, startLine, endLine) as any;
    return row ? this.mapRowToRecord(row) : null;
  }

  /**
   * Get chunk by content hash (for Merkle tree comparison)
   * Used to check if a chunk with the same content already exists
   */
  getChunkByContentHash(contentHash: string): ChunkRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM chunks WHERE content_hash = ? LIMIT 1
    `);
    const row = stmt.get(contentHash) as any;
    return row ? this.mapRowToRecord(row) : null;
  }

  /**
   * Find artifact definition by key (sequence, local-entry, endpoint, template)
   * Handles references like:
   * - sequence:CreateBookingSequence
   * - localEntry:CurrencyConverter
   * - endpoint:BankEndpoint
   * - template:LogTemplate
   */
  getSequenceDefinition(artifactRef: string): ChunkRecord | null {
    // Parse reference format: "type:name" or just "name" (assume sequence)
    let artifactType = 'sequence';
    let artifactName = artifactRef;

    if (artifactRef.includes(':')) {
      [artifactType, artifactName] = artifactRef.split(':', 2);
    }

    const stmt = this.db.prepare(`
      SELECT * FROM chunks 
      WHERE sequence_key = ? AND is_sequence_definition = 1 
      LIMIT 1
    `);
    const row = stmt.get(artifactName) as any;
    return row ? this.mapRowToRecord(row) : null;
  }

  /**
   * Find all chunks that reference a specific artifact
   * Handles all artifact types (sequences, local-entries, endpoints, templates)
   */
  getChunksReferencingSequence(artifactRef: string): ChunkRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM chunks 
      WHERE referenced_sequences LIKE ?
    `);
    const pattern = `%"${artifactRef}"%`;
    const rows = stmt.all(pattern) as any[];
    return rows.map(this.mapRowToRecord);
  }

  /**
   * Link caller chunk to callee sequence definition
   */
  linkSequenceReference(callerChunkId: number, calleeChunkId: number, sequenceKey: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO sequence_references (caller_chunk_id, callee_chunk_id, sequence_key, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(callerChunkId, calleeChunkId, sequenceKey, Date.now());
  }

  /**
   * Get all sequence definitions called by a chunk
   */
  getReferencedSequences(chunkId: number): ChunkRecord[] {
    const stmt = this.db.prepare(`
      SELECT c.* FROM chunks c
      INNER JOIN sequence_references sr ON c.id = sr.callee_chunk_id
      WHERE sr.caller_chunk_id = ?
    `);
    const rows = stmt.all(chunkId) as any[];
    return rows.map(this.mapRowToRecord);
  }

  deleteChunksByFile(filePath: string): void {
    // Delete FTS5 entries for all chunks in this file first
    const idsStmt = this.db.prepare(`SELECT id FROM chunks WHERE file_path = ?`);
    const rows = idsStmt.all(filePath) as { id: number }[];
    for (const row of rows) {
      this.deleteFts(row.id);
    }

    const stmt = this.db.prepare(`DELETE FROM chunks WHERE file_path = ?`);
    stmt.run(filePath);
  }

  deleteChunk(id: number): void {
    this.deleteFts(id);
    const stmt = this.db.prepare(`DELETE FROM chunks WHERE id = ?`);
    stmt.run(id);
  }

  getAllChunks(): ChunkRecord[] {
    const stmt = this.db.prepare(`SELECT * FROM chunks`);
    const rows = stmt.all() as any[];
    return rows.map(this.mapRowToRecord);
  }

  cosineSimilarity(embedding: Float32Array): ChunkRecord[] {
    const allChunks = this.getAllChunks();
    const results = allChunks.map(chunk => {
      const chunkEmbedding = new Float32Array(chunk.embedding.buffer);
      const similarity = this.computeCosineSimilarity(embedding, chunkEmbedding);
      return { ...chunk, similarity };
    });

    return results.sort((a, b) => b.similarity - a.similarity);
  }

  private mapRowToRecord(row: any): ChunkRecord {
    return {
      id: row.id,
      filePath: row.file_path,
      fileHash: row.file_hash,
      resourceName: row.resource_name,
      resourceType: row.resource_type,
      chunkType: row.chunk_type,
      chunkIndex: row.chunk_index,
      startLine: row.start_line,
      endLine: row.end_line,
      parentChunkId: row.parent_chunk_id,
      timestamp: row.timestamp,
      embedding: row.embedding,
      contentHash: row.content_hash,
      semanticType: row.semantic_type,
      semanticIntent: row.semantic_intent,
      context: JSON.parse(row.context_json),
      sequenceKey: row.sequence_key,
      isSequenceDefinition: row.is_sequence_definition === 1,
      referencedSequences: row.referenced_sequences ? JSON.parse(row.referenced_sequences) : undefined,
    };
  }

  private computeCosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Expose the underlying better-sqlite3 handle for advanced queries (e.g. FTS5 BM25).
   * Use responsibly — prefer dedicated methods for common operations.
   */
  getHandle(): Database.Database {
    return this.db;
  }

  /**
   * One-time migration: backfill the FTS5 index from an existing chunks table.
   * Safe to call multiple times — skips chunks already indexed.
   * Requires the pipeline to supply embeddingText; since raw embeddingText is
   * NOT stored in the chunks table, this rebuilds it from the pipeline.
   *
   * For a simpler approach (re-index from stored data), pass a map of
   * chunkId → embeddingText built during a pipeline re-scan.
   */
  backfillFts(entries: { chunkId: number; embeddingText: string }[]): number {
    const existing = new Set<number>(
      (this.db.prepare(`SELECT chunk_id FROM chunks_fts`).all() as { chunk_id: number }[])
        .map(r => r.chunk_id)
    );

    const insert = this.db.prepare(
      `INSERT INTO chunks_fts (chunk_id, embedding_text) VALUES (?, ?)`
    );

    let inserted = 0;
    const runBatch = this.db.transaction(() => {
      for (const entry of entries) {
        if (!existing.has(entry.chunkId)) {
          insert.run(entry.chunkId, entry.embeddingText);
          inserted++;
        }
      }
    });
    runBatch();
    return inserted;
  }

  close(): void {
    this.db.close();
  }
}
