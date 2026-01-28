import { Watcher, FileChange } from './watcher';
import { XMLChunker } from './chunker';
import { Embedder } from './embedder';
import { SQLiteDB, ChunkMetadata } from '../db/sqlite';

export class Pipeline {
  private watcher: Watcher;
  private chunker: XMLChunker;
  private embedder: Embedder;
  private db: SQLiteDB;

  constructor(db: SQLiteDB, embedder: Embedder) {
    this.watcher = new Watcher();
    this.chunker = new XMLChunker();
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

    const existingChunks = this.db.getChunksByFile(filePath);
    const existingMap = new Map(
      existingChunks.map(c => [`${c.startLine}-${c.endLine}`, c])
    );

    for (const chunk of chunks) {
      const key = `${chunk.startLine}-${chunk.endLine}`;
      const existing = existingMap.get(key);

      const metadata: ChunkMetadata = {
        filePath: chunk.filePath,
        fileHash,
        resourceName: chunk.resourceName,
        resourceType: chunk.resourceType,
        chunkType: chunk.chunkType,
        chunkIndex: chunk.chunkIndex,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        parentChunkId: chunk.parentChunkId,
        timestamp: Date.now(),
      };

      if (!existing || existing.fileHash !== fileHash) {
        const embedding = await this.embedder.embed(chunk.embeddingText);
        
        if (existing) {
          this.db.updateChunk(existing.id, metadata, embedding);
          console.log(`  Updated chunk at lines ${chunk.startLine}-${chunk.endLine}`);
        } else {
          this.db.insertChunk(metadata, embedding);
          console.log(`  Inserted chunk at lines ${chunk.startLine}-${chunk.endLine}`);
        }
      }

      existingMap.delete(key);
    }

    for (const [_, chunk] of existingMap) {
      console.log(`  Deleted obsolete chunk at lines ${chunk.startLine}-${chunk.endLine}`);
    }
  }
}
