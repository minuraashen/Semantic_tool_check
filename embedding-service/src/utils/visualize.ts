import { config } from '../config/paths';
import { SQLiteDB } from '../db/sqlite';

async function visualizeChunks(filePath?: string) {
  const db = new SQLiteDB(config.dbPath);

  const chunks = filePath 
    ? db.getChunksByFile(filePath)
    : db.getAllChunks();

  if (chunks.length === 0) {
    console.log('No chunks found');
    db.close();
    return;
  }

  console.log(`\nChunk Hierarchy (${chunks.length} chunks)\n`);

  const chunkMap = new Map(chunks.map(c => [c.id, c]));
  const printed = new Set<number>();

  const printChunk = (chunkId: number, indent: number = 0) => {
    if (printed.has(chunkId)) return;
    
    const chunk = chunkMap.get(chunkId);
    if (!chunk) return;

    const prefix = '  '.repeat(indent) + (indent > 0 ? '└─ ' : '');
    console.log(`${prefix}[${chunk.id}] ${chunk.chunkType}: ${chunk.resourceName} (L${chunk.startLine}-${chunk.endLine})`);
    
    printed.add(chunkId);

    const children = chunks.filter(c => c.parentChunkId === chunkId);
    children.forEach(child => printChunk(child.id, indent + 1));
  };

  const roots = chunks.filter(c => c.parentChunkId === null);
  roots.forEach(root => printChunk(root.id));

  console.log(`\nTotal: ${chunks.length} chunks`);
  console.log(`Root chunks: ${roots.length}`);
  console.log(`Max depth: ${findMaxDepth(chunks)}`);

  db.close();
}

function findMaxDepth(chunks: any[]): number {
  const chunkMap = new Map(chunks.map(c => [c.id, c]));
  let maxDepth = 0;

  const getDepth = (chunkId: number): number => {
    const chunk = chunkMap.get(chunkId);
    if (!chunk || chunk.parentChunkId === null) return 0;
    return 1 + getDepth(chunk.parentChunkId);
  };

  chunks.forEach(chunk => {
    maxDepth = Math.max(maxDepth, getDepth(chunk.id));
  });

  return maxDepth;
}

const filePath = process.argv[2];
visualizeChunks(filePath).catch(console.error);
