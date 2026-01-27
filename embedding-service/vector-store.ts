/**
 * Vector Store Operations
 * Manages SQLite database for storing and retrieving code chunk embeddings
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Metadata for a code chunk without the actual code content
 */
export interface ChunkMetadata {
  filePath: string;
  startLine: number;
  endLine: number;
  elementType: string;
  elementName: string;
  lastModified: number; // timestamp in milliseconds
}

/**
 * Result from similarity search
 */
export interface SimilaritySearchResult {
  id: number;
  similarity: number;
  metadata: ChunkMetadata;
}

/**
 * VectorStore class for managing SQLite database operations
 * Handles storage and retrieval of code chunk metadata and embeddings
 */
export class VectorStore {
  private db: Database.Database;
  private dbPath: string;

  /**
   * Creates a new VectorStore instance
   * @param dbPath - Absolute path to the SQLite database file
   */
  constructor(dbPath: string) {
    this.dbPath = dbPath;
    
    // Create directory if it doesn't exist
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Initialize database connection
    this.db = new Database(dbPath);
    this.initialize();
  }

  /**
   * Initializes the database schema
   * Creates tables and indexes if they don't exist
   */
  initialize(): void {
    try {
      // Create code_chunks table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS code_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_path TEXT NOT NULL,
          start_line INTEGER NOT NULL,
          end_line INTEGER NOT NULL,
          xml_element_type TEXT NOT NULL,
          xml_element_name TEXT NOT NULL,
          embedding BLOB NOT NULL,
          last_modified INTEGER NOT NULL,
          UNIQUE(file_path, start_line, end_line)
        );
      `);

      // Create indexes for faster queries
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_path ON code_chunks(file_path);
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_element_type ON code_chunks(xml_element_type);
      `);

      console.log(`VectorStore initialized at: ${this.dbPath}`);
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw new Error(`Database initialization failed: ${error}`);
    }
  }

  /**
   * Inserts or replaces a code chunk with its embedding
   * Uses INSERT OR REPLACE to handle updates automatically
   * @param metadata - Chunk metadata (file path, line numbers, element info)
   * @param embedding - Float32Array embedding vector
   */
  insertChunk(metadata: ChunkMetadata, embedding: Float32Array): void {
    try {
      // Convert Float32Array to Buffer for storage
      const embeddingBuffer = Buffer.from(embedding.buffer);

      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO code_chunks 
        (file_path, start_line, end_line, xml_element_type, xml_element_name, embedding, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        metadata.filePath,
        metadata.startLine,
        metadata.endLine,
        metadata.elementType,
        metadata.elementName,
        embeddingBuffer,
        metadata.lastModified
      );
    } catch (error) {
      console.error(`Failed to insert chunk for ${metadata.filePath}:${metadata.startLine}-${metadata.endLine}`, error);
      throw error;
    }
  }

  /**
   * Deletes all chunks associated with a specific file
   * @param filePath - Path of the file whose chunks should be deleted
   */
  deleteChunksByFile(filePath: string): void {
    try {
      const stmt = this.db.prepare('DELETE FROM code_chunks WHERE file_path = ?');
      const result = stmt.run(filePath);
      console.log(`Deleted ${result.changes} chunks for file: ${filePath}`);
    } catch (error) {
      console.error(`Failed to delete chunks for file ${filePath}`, error);
      throw error;
    }
  }

  /**
   * Retrieves all embeddings with their metadata from the database
   * @returns Array of objects containing id, embedding, and metadata
   */
  getAllEmbeddings(): Array<{ id: number; embedding: Float32Array; metadata: ChunkMetadata }> {
    try {
      const stmt = this.db.prepare(`
        SELECT id, file_path, start_line, end_line, xml_element_type, xml_element_name, 
               embedding, last_modified
        FROM code_chunks
      `);

      const rows = stmt.all() as Array<{
        id: number;
        file_path: string;
        start_line: number;
        end_line: number;
        xml_element_type: string;
        xml_element_name: string;
        embedding: Buffer;
        last_modified: number;
      }>;

      return rows.map(row => ({
        id: row.id,
        embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
        metadata: {
          filePath: row.file_path,
          startLine: row.start_line,
          endLine: row.end_line,
          elementType: row.xml_element_type,
          elementName: row.xml_element_name,
          lastModified: row.last_modified,
        },
      }));
    } catch (error) {
      console.error('Failed to retrieve all embeddings', error);
      throw error;
    }
  }

  /**
   * Retrieves a specific chunk's metadata by its ID
   * @param id - Database ID of the chunk
   * @returns ChunkMetadata or null if not found
   */
  getChunkById(id: number): ChunkMetadata | null {
    try {
      const stmt = this.db.prepare(`
        SELECT file_path, start_line, end_line, xml_element_type, xml_element_name, last_modified
        FROM code_chunks
        WHERE id = ?
      `);

      const row = stmt.get(id) as
        | {
            file_path: string;
            start_line: number;
            end_line: number;
            xml_element_type: string;
            xml_element_name: string;
            last_modified: number;
          }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        elementType: row.xml_element_type,
        elementName: row.xml_element_name,
        lastModified: row.last_modified,
      };
    } catch (error) {
      console.error(`Failed to retrieve chunk by id ${id}`, error);
      throw error;
    }
  }

  /**
   * Performs similarity search using cosine similarity
   * @param queryEmbedding - Query embedding vector
   * @param topK - Number of top similar results to return
   * @returns Array of similarity search results sorted by similarity (highest first)
   */
  searchSimilar(queryEmbedding: Float32Array, topK: number = 10): SimilaritySearchResult[] {
    try {
      const allEmbeddings = this.getAllEmbeddings();
      
      // Calculate cosine similarity for each embedding
      const results = allEmbeddings.map(item => {
        const similarity = this.cosineSimilarity(queryEmbedding, item.embedding);
        return {
          id: item.id,
          similarity,
          metadata: item.metadata,
        };
      });

      // Sort by similarity (descending) and return top K
      return results
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);
    } catch (error) {
      console.error('Failed to perform similarity search', error);
      throw error;
    }
  }

  /**
   * Calculates cosine similarity between two vectors
   * @param vecA - First vector
   * @param vecB - Second vector
   * @returns Cosine similarity score between -1 and 1
   */
  private cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    if (vecA.length !== vecB.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      magnitudeA += vecA[i] * vecA[i];
      magnitudeB += vecB[i] * vecB[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    // Avoid division by zero
    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Closes the database connection
   * Should be called when the VectorStore is no longer needed
   */
  close(): void {
    try {
      this.db.close();
      console.log('VectorStore database connection closed');
    } catch (error) {
      console.error('Failed to close database connection', error);
      throw error;
    }
  }
}