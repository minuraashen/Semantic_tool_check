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

  insertChunk(metadata: ChunkMetadata, embedding: Float32Array): number {
    const stmt = this.db.prepare(`
      INSERT INTO chunks (
        file_path, file_hash, resource_name, resource_type, chunk_type,
        chunk_index, start_line, end_line, parent_chunk_id, embedding, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      metadata.timestamp
    );

    return result.lastInsertRowid as number;
  }

  updateChunk(id: number, metadata: ChunkMetadata, embedding: Float32Array): void {
    const stmt = this.db.prepare(`
      UPDATE chunks SET
        file_hash = ?, resource_name = ?, resource_type = ?, chunk_type = ?,
        chunk_index = ?, start_line = ?, end_line = ?, parent_chunk_id = ?,
        embedding = ?, timestamp = ?
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
      id
    );
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

  deleteChunksByFile(filePath: string): void {
    const stmt = this.db.prepare(`DELETE FROM chunks WHERE file_path = ?`);
    stmt.run(filePath);
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

  close(): void {
    this.db.close();
  }
}
