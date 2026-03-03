import { Watcher, FileChange } from './watcher';
import { XMLChunker } from './chunker';
import { Embedder } from './embedder';
import { SQLiteDB, ChunkMetadata } from '../db/sqlite';
import { ArtifactRegistry, artifactRegistry } from './artifact-registry';


/**
 * Pipeline with Incremental Embedding and Plugin Support
 * 
 * Key features:
 * - Build Merkle tree from new chunks
 * - Compare with existing chunks by content hash
 * - Only re-embed chunks with changed content hashes
 * - Reuse embeddings from unchanged chunks
 * - Uses ArtifactRegistry for extensible artifact detection
 */

export class Pipeline {
  private watcher: Watcher;
  private chunker: XMLChunker;
  private embedder: Embedder;
  private db: SQLiteDB;
  private registry: ArtifactRegistry;

  constructor(db: SQLiteDB, embedder: Embedder, registry?: ArtifactRegistry) {
    this.watcher = new Watcher();
    this.registry = registry || artifactRegistry;
    this.chunker = new XMLChunker(embedder, this.registry);
    this.embedder = embedder;
    this.db = db;
  }

  async processInitial(directories: string[]): Promise<void> {
    console.log('Initial processing started...');
    const changes = await this.watcher.scanForChanges(directories);

    console.log(`Found ${changes.length} files to process`);
    await this.processChanges(changes);
    console.log('Initial processing completed');
  }

  async processIncremental(directories: string[]): Promise<void> {
    const changes = await this.watcher.scanForChanges(directories);

    if (changes.length === 0) {
      return;
    }

    console.log(`Detected ${changes.length} changed files`);
    await this.processChanges(changes);
  }

  private async processChanges(changes: FileChange[]): Promise<void> {
    for (const change of changes) {
      if (!change.exists) {
        console.log(`Deleting chunks for removed file: ${change.filePath}`);
        this.db.deleteChunksByFile(change.filePath);
        continue;
      }

      try {
        await this.processFile(change.filePath, change.hash);
      } catch (error) {
        console.error(`Failed to process ${change.filePath}:`, error);
      }
    }
  }

  private async processFile(filePath: string, fileHash: string): Promise<void> {
    console.log(`Processing: ${filePath}`);

    const chunks = await this.chunker.chunkFile(filePath);
    console.log(`  Extracted ${chunks.length} chunks`);

    // Get existing chunks for this file
    const existingChunks = this.db.getChunksByFile(filePath);

    // Build map of existing chunks by their unique key (file_path, chunk_index, start_line, end_line)
    const existingByLocation = new Map<string, typeof existingChunks[0]>();
    for (const chunk of existingChunks) {
      const key = `${chunk.chunkIndex}:${chunk.startLine}:${chunk.endLine}`;
      existingByLocation.set(key, chunk);
    }

    // Track which existing chunks were matched (for cleanup of removed chunks)
    const matchedChunkIds = new Set<number>();

    let reusedCount = 0;
    let embeddedCount = 0;

    for (const chunk of chunks) {
      const metadata: ChunkMetadata = {
        filePath: chunk.filePath,
        fileHash,
        chunkType: chunk.chunkType,
        chunkIndex: chunk.chunkIndex,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        timestamp: Date.now(),
        contentHash: chunk.contentHash,
        context: chunk.context,
        sequenceKey: chunk.sequenceKey,
        isSequenceDefinition: chunk.isSequenceDefinition,
        referencedSequences: chunk.referencedSequences,
      };

      // Check if we have an existing chunk at this location
      const locationKey = `${chunk.chunkIndex}:${chunk.startLine}:${chunk.endLine}`;
      const existingChunk = existingByLocation.get(locationKey);

      let embedding: Float32Array;
      let dbId: number;
      if (existingChunk && existingChunk.contentHash === chunk.contentHash) {
        embedding = new Float32Array(existingChunk.embedding.buffer);
        this.db.updateChunk(existingChunk.id, metadata, embedding, chunk.embeddingText);
        dbId = existingChunk.id;
        matchedChunkIds.add(dbId);
        reusedCount++;
      } else if (existingChunk) {
        embedding = await this.embedder.embed(chunk.embeddingText);
        this.db.updateChunk(existingChunk.id, metadata, embedding, chunk.embeddingText);
        dbId = existingChunk.id;
        matchedChunkIds.add(dbId);
        embeddedCount++;
      } else {
        embedding = await this.embedder.embed(chunk.embeddingText);
        dbId = this.db.insertChunk(metadata, embedding, chunk.embeddingText);
        embeddedCount++;
      }

      // Link all artifact references
      if (chunk.referencedSequences && chunk.referencedSequences.length > 0) {
        for (const artifactRef of chunk.referencedSequences) {
          const artifactDef = this.db.getSequenceDefinition(artifactRef);
          if (artifactDef) {
            const artifactName = artifactRef.includes(':')
              ? artifactRef.split(':', 2)[1]
              : artifactRef;
            this.db.linkSequenceReference(dbId, artifactDef.id, artifactName);
          }
        }
      }
    }

    // Delete chunks that no longer exist in the file (chunks that weren't matched)
    let deletedCount = 0;
    for (const existingChunk of existingChunks) {
      if (!matchedChunkIds.has(existingChunk.id)) {
        this.db.deleteChunk(existingChunk.id);
        deletedCount++;
      }
    }

    if (reusedCount > 0) {
      console.log(`  ♻️  Reused ${reusedCount} embeddings (unchanged content)`);
    }
    if (embeddedCount > 0) {
      console.log(`  ✨ Generated ${embeddedCount} new embeddings`);
    }
    if (deletedCount > 0) {
      console.log(`  🗑️  Deleted ${deletedCount} removed chunks`);
    }
  }
}
