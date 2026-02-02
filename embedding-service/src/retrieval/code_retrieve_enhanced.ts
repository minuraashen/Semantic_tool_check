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
  // NEW: Semantic metadata
  semanticType: string;
  semanticIntent: string;
  context: any;
  // NEW: Cross-file relationships
  sequenceKey?: string;
  isSequenceDefinition?: boolean;
  referencedSequences?: string[];
  relatedSequences?: RetrievalResult[];  // Expanded sequence definitions
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
      semanticType: chunk.semanticType,
      semanticIntent: chunk.semanticIntent,
      context: chunk.context,
      sequenceKey: chunk.sequenceKey,
      isSequenceDefinition: chunk.isSequenceDefinition,
      referencedSequences: chunk.referencedSequences,
    }));
  }

  /**
   * Enhanced search with relationship traversal
   * Expands results to include all referenced artifacts (sequences, local-entries, endpoints, templates)
   */
  async searchWithContext(query: string, topK: number = 5): Promise<RetrievalResult[]> {
    const results = await this.search(query, topK);

    // Expand each result with referenced artifacts
    for (const result of results) {
      if (result.referencedSequences && result.referencedSequences.length > 0) {
        result.relatedSequences = [];
        
        for (const artifactRef of result.referencedSequences) {
          const artifactDef = this.db.getSequenceDefinition(artifactRef);
          if (artifactDef) {
            result.relatedSequences.push({
              id: artifactDef.id,
              filePath: artifactDef.filePath,
              resourceName: artifactDef.resourceName,
              resourceType: artifactDef.resourceType,
              chunkType: artifactDef.chunkType,
              startLine: artifactDef.startLine,
              endLine: artifactDef.endLine,
              similarity: 0.99, // High similarity (direct reference)
              parentChunkId: artifactDef.parentChunkId,
              semanticType: artifactDef.semanticType,
              semanticIntent: artifactDef.semanticIntent,
              context: artifactDef.context,
              sequenceKey: artifactDef.sequenceKey,
              isSequenceDefinition: artifactDef.isSequenceDefinition,
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Filter search by semantic type
   */
  async searchByType(
    query: string,
    semanticType: string,
    topK: number = 5
  ): Promise<RetrievalResult[]> {
    const allResults = await this.search(query, 50);
    const filtered = allResults.filter(r => r.semanticType === semanticType);
    return filtered.slice(0, topK);
  }

  /**
   * Filter search by semantic intent
   */
  async searchByIntent(
    query: string,
    semanticIntent: string,
    topK: number = 5
  ): Promise<RetrievalResult[]> {
    const allResults = await this.search(query, 50);
    const filtered = allResults.filter(r => r.semanticIntent === semanticIntent);
    return filtered.slice(0, topK);
  }

  /**
   * Find all APIs that use a specific artifact (sequence, local-entry, endpoint, template)
   */
  async findApisUsingSequence(artifactRef: string): Promise<RetrievalResult[]> {
    const chunks = this.db.getChunksReferencingSequence(artifactRef);
    return chunks.map(chunk => ({
      id: chunk.id,
      filePath: chunk.filePath,
      resourceName: chunk.resourceName,
      resourceType: chunk.resourceType,
      chunkType: chunk.chunkType,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      similarity: 1.0,
      parentChunkId: chunk.parentChunkId,
      semanticType: chunk.semanticType,
      semanticIntent: chunk.semanticIntent,
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
    console.log('Usage: ts-node code_retrieve_enhanced.ts "<your query>" [--type <type>] [--intent <intent>] [--with-context]');
    console.log('Examples:');
    console.log('  ts-node code_retrieve_enhanced.ts "hotel booking creation"');
    console.log('  ts-node code_retrieve_enhanced.ts "validation logic" --type filter');
    console.log('  ts-node code_retrieve_enhanced.ts "error handling" --intent error-handling');
    console.log('  ts-node code_retrieve_enhanced.ts "create booking" --with-context');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const query = args.filter(a => !a.startsWith('--'))[0];
  const withContext = args.includes('--with-context');
  const typeIndex = args.indexOf('--type');
  const intentIndex = args.indexOf('--intent');
  const semanticType = typeIndex >= 0 ? args[typeIndex + 1] : null;
  const semanticIntent = intentIndex >= 0 ? args[intentIndex + 1] : null;

  console.log(`Query: "${query}"`);
  if (semanticType) console.log(`Filter by type: ${semanticType}`);
  if (semanticIntent) console.log(`Filter by intent: ${semanticIntent}`);
  if (withContext) console.log(`With context: Yes`);
  console.log();

  const retrieval = new CodeRetrieval();
  await retrieval.initialize();

  let results: RetrievalResult[];
  
  if (withContext) {
    results = await retrieval.searchWithContext(query, 10);
  } else if (semanticType) {
    results = await retrieval.searchByType(query, semanticType, 10);
  } else if (semanticIntent) {
    results = await retrieval.searchByIntent(query, semanticIntent, 10);
  } else {
    results = await retrieval.search(query, 10);
  }

  if (results.length === 0) {
    console.log('No results found');
  } else {
    console.log(`Top ${results.length} results:\n`);
    results.forEach((result, idx) => {
      console.log(`${idx + 1}. [${result.similarity.toFixed(4)}] ${result.semanticType} | ${result.semanticIntent}`);
      console.log(`   ${result.resourceType}:${result.chunkType} - ${result.resourceName}`);
      console.log(`   File: ${result.filePath}`);
      console.log(`   Lines: ${result.startLine}-${result.endLine}`);
      console.log(`   Context: ${JSON.stringify(result.context)}`);
      
      if (result.referencedSequences && result.referencedSequences.length > 0) {
        console.log(`   📎 References: ${result.referencedSequences.join(', ')}`);
      }
      
      if (result.relatedSequences && result.relatedSequences.length > 0) {
        console.log(`   🔗 Related Artifacts:`);
        result.relatedSequences.forEach(artifact => {
          const artifactLabel = artifact.sequenceKey || artifact.resourceName;
          const artifactType = artifact.chunkType;
          console.log(`      - [${artifactType}] ${artifactLabel} (${artifact.filePath}:${artifact.startLine}-${artifact.endLine})`);
        });
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
