import { config } from '../config/paths';
import { SQLiteDB, ChunkRecord } from '../db/sqlite';
import { Embedder } from '../embedding-service/embedder';

export interface RetrievalResult {
  id: number;
  filePath: string;
  resourceName: string;
  resourceType: string;
  chunkType: string;
  startLine: number;
  endLine: number;
  similarity: number;
  parentChunkId: number | null;
}

export class CodeRetrieval {
  private db: SQLiteDB;
  private embedder: Embedder;

  constructor() {
    this.db = new SQLiteDB(config.dbPath);
    this.embedder = new Embedder();
  }

  async initialize(): Promise<void> {
    await this.embedder.initialize(config.modelPath);
  }

  async search(query: string, topK: number = 5): Promise<RetrievalResult[]> {
    const queryEmbedding = await this.embedder.embed(query);
    const results = this.db.cosineSimilarity(queryEmbedding);

    return results.slice(0, topK).map(chunk => ({
      id: chunk.id,
      filePath: chunk.filePath,
      resourceName: chunk.resourceName,
      resourceType: chunk.resourceType,
      chunkType: chunk.chunkType,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      similarity: (chunk as any).similarity,
      parentChunkId: chunk.parentChunkId,
    }));
  }

  close(): void {
    this.embedder.close();
    this.db.close();
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: ts-node code_retrieve.ts "<your query>"');
    console.log('Example: ts-node code_retrieve.ts "hotel booking creation"');
    process.exit(1);
  }

  const query = process.argv.slice(2).join(' ');
  
  console.log(`Query: "${query}"\n`);

  const retrieval = new CodeRetrieval();
  await retrieval.initialize();

  const results = await retrieval.search(query, 10);

  if (results.length === 0) {
    console.log('No results found');
  } else {
    console.log(`Top ${results.length} results:\n`);
    results.forEach((result, idx) => {
      console.log(`${idx + 1}. [${result.similarity.toFixed(4)}] ${result.resourceType}:${result.chunkType} - ${result.resourceName}`);
      console.log(`   File: ${result.filePath}`);
      console.log(`   Lines: ${result.startLine}-${result.endLine}`);
      if (result.parentChunkId) {
        console.log(`   Parent Chunk ID: ${result.parentChunkId}`);
      }
      console.log();
    });
  }

  retrieval.close();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}
