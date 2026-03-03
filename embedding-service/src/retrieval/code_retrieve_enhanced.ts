import * as path from 'path';
import { SQLiteDB, ChunkRecord } from '../db/sqlite';
import { Embedder } from '../embedding-service/embedder';

const rootDir = path.resolve(__dirname, '../../');
const config = {
  dbPath: path.resolve(rootDir, 'data/embeddings.db'),
  modelPath: path.resolve(rootDir, 'models/model_quantized.onnx'),
};

export interface RetrievalResult {
  id: number;
  filePath: string;
  chunkType: string;
  startLine: number;
  endLine: number;
  similarity: number;
  context: any;
  // Cross-file relationships
  sequenceKey?: string;
  isSequenceDefinition?: boolean;
  referencedSequences?: string[];
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

  /**
   * Basic semantic search (cosine similarity)
   */
  async search(query: string, topK: number = 60): Promise<RetrievalResult[]> {
    const queryEmbedding = await this.embedder.embed(query);
    const results = this.db.cosineSimilarity(queryEmbedding);

    return results.slice(0, topK).map(chunk => ({
      id: chunk.id,
      filePath: chunk.filePath,
      chunkType: chunk.chunkType,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      similarity: (chunk as any).similarity,
      context: chunk.context,
      sequenceKey: chunk.sequenceKey,
      isSequenceDefinition: chunk.isSequenceDefinition,
      referencedSequences: chunk.referencedSequences,
    }));
  }

  async close(): Promise<void> {
    await this.embedder.close();
    this.db.close();
  }
}

async function main() {
  if (process.argv.length < 3) {
    console.log('Usage: ts-node code_retrieve_enhanced.ts "<your query>" [topK]');
    console.log('Example:');
    console.log('  ts-node code_retrieve_enhanced.ts "hotel booking creation"');
    process.exit(1);
  }

  const query = process.argv[2];
  const topK = parseInt(process.argv[3] || '60', 10);

  console.log(`Query: "${query}"`);
  console.log();

  const retrieval = new CodeRetrieval();
  await retrieval.initialize();

  const results = await retrieval.search(query, topK);

  if (results.length === 0) {
    console.log('No results found');
  } else {
    console.log(`Top ${results.length} results:\n`);
    results.forEach((result, idx) => {
      console.log(`${idx + 1}. [${result.similarity.toFixed(4)}] ${result.chunkType}`);
      console.log(`   File: ${result.filePath}`);
      console.log(`   Lines: ${result.startLine}-${result.endLine}`);
      console.log(`   Context: ${JSON.stringify(result.context)}`);

      if (result.referencedSequences && result.referencedSequences.length > 0) {
        console.log(`   📎 References: ${result.referencedSequences.join(', ')}`);
      }

      console.log();
    });
  }

  await retrieval.close();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
}
