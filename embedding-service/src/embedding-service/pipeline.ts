import { Watcher, FileChange } from './watcher';
import { XMLChunker } from './chunker';
import { Embedder } from './embedder';
import { SQLiteDB, ChunkMetadata } from '../db/sqlite';
import { MerkleLeaf, buildMerkleTree, findChangedLeaves } from '../db/merkle';

/**
 * PHASE 6: Updated Pipeline with Incremental Embedding
 * 
 * Key changes:
 * - Build Merkle tree from new chunks
 * - Compare with existing chunks by content hash
 * - Only re-embed chunks with changed content hashes
 * - Reuse embeddings from unchanged chunks
 */

export class Pipeline {
  private watcher: Watcher;
  private chunker: XMLChunker;
  private embedder: Embedder;
  private db: SQLiteDB;

  constructor(db: SQLiteDB, embedder: Embedder) {
    this.watcher = new Watcher();
    this.chunker = new XMLChunker(embedder); // Pass embedder for token counting
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
    
    // Build map of existing chunks by content hash
    const existingByHash = new Map<string, typeof existingChunks[0]>();
    for (const chunk of existingChunks) {
      existingByHash.set(chunk.contentHash, chunk);
    }

    // If file hash changed, delete all old chunks to avoid conflicts
    if (existingChunks.length > 0) {
      const existingHash = existingChunks[0].fileHash;
      if (existingHash !== fileHash) {
        console.log(`  File modified, deleting ${existingChunks.length} old chunks`);
        this.db.deleteChunksByFile(filePath);
        existingByHash.clear(); // Clear map since we deleted everything
      }
    }

    const chunkIndexToDbId = new Map<number, number>();
    let reusedCount = 0;
    let embeddedCount = 0;

    for (const chunk of chunks) {
      let parentDbId: number | null = null;
      if (chunk.parentChunkId !== null && chunkIndexToDbId.has(chunk.parentChunkId)) {
        parentDbId = chunkIndexToDbId.get(chunk.parentChunkId)!;
      }

      const metadata: ChunkMetadata = {
        filePath: chunk.filePath,
        fileHash,
        resourceName: chunk.resourceName,
        resourceType: chunk.resourceType,
        chunkType: chunk.chunkType,
        chunkIndex: chunk.chunkIndex,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        parentChunkId: parentDbId,
        timestamp: Date.now(),
        contentHash: chunk.contentHash,
        semanticType: chunk.semanticType,
        semanticIntent: chunk.semanticIntent,
        context: chunk.context,
        sequenceKey: chunk.sequenceKey,
        isSequenceDefinition: chunk.isSequenceDefinition,
        referencedSequences: chunk.referencedSequences,
      };

      // Check if we have an existing chunk with same content hash
      const existingChunk = existingByHash.get(chunk.contentHash);
      
      let embedding: Float32Array;
      if (existingChunk) {
        // Reuse existing embedding (content hasn't changed)
        embedding = new Float32Array(existingChunk.embedding.buffer);
        reusedCount++;
      } else {
        // Generate new embedding
        embedding = await this.embedder.embed(chunk.embeddingText);
        embeddedCount++;
      }

      const newId = this.db.insertChunk(metadata, embedding);
      chunkIndexToDbId.set(chunk.chunkIndex, newId);
      
      // Link all artifact references (sequences, local-entries, endpoints, templates)
      if (chunk.referencedSequences && chunk.referencedSequences.length > 0) {
        for (const artifactRef of chunk.referencedSequences) {
          const artifactDef = this.db.getSequenceDefinition(artifactRef);
          if (artifactDef) {
            // Extract artifact name from "type:name" format
            const artifactName = artifactRef.includes(':') 
              ? artifactRef.split(':', 2)[1] 
              : artifactRef;
            this.db.linkSequenceReference(newId, artifactDef.id, artifactName);
          }
        }
      }
    }
    
    if (reusedCount > 0) {
      console.log(`  ♻️  Reused ${reusedCount} embeddings (unchanged content)`);
    }
    if (embeddedCount > 0) {
      console.log(`  ✨ Generated ${embeddedCount} new embeddings`);
    }
  }
}
