#!/usr/bin/env node

/**
 * One-time migration: Backfill FTS5 index from existing chunks.
 *
 * Since embeddingText is NOT stored in the chunks table, this script
 * re-runs the chunker on all known files to regenerate embeddingText,
 * then inserts into chunks_fts for each existing chunk.
 *
 * Safe to run multiple times — skips already-indexed chunks.
 *
 * Usage:
 *   npx ts-node src/retrieval/backfill-fts.ts
 *   npm run bm25:backfill
 */

import * as path from 'path';
import * as fs from 'fs';
import { SQLiteDB } from '../db/sqlite';
import { XMLChunker } from '../embedding-service/chunker';
import { Embedder } from '../embedding-service/embedder';
import { config } from '../config';
import { artifactRegistry } from '../embedding-service/artifact-registry';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  FTS5 Backfill Migration');
  console.log('═══════════════════════════════════════════════════════════\n');

  const db = new SQLiteDB(config.dbPath);

  // Get unique file paths from existing chunks
  const handle = db.getHandle();
  const files = handle
    .prepare(`SELECT DISTINCT file_path FROM chunks`)
    .all() as { file_path: string }[];

  console.log(`Found ${files.length} files in database\n`);

  if (files.length === 0) {
    console.log('No chunks to backfill. Run the embedding pipeline first.');
    db.close();
    return;
  }

  // Initialize embedder (needed by chunker for token counting)
  const embedder = new Embedder();
  await embedder.initialize(config.modelPath);

  const chunker = new XMLChunker(embedder, artifactRegistry);
  const entries: { chunkId: number; embeddingText: string }[] = [];
  let skippedFiles = 0;

  for (const { file_path } of files) {
    if (!fs.existsSync(file_path)) {
      console.log(`  ⚠️  File not found (skipping): ${file_path}`);
      skippedFiles++;
      continue;
    }

    try {
      const chunks = await chunker.chunkFile(file_path);
      const existingChunks = db.getChunksByFile(file_path);

      // Match regenerated chunks to existing DB chunks by location
      for (const chunk of chunks) {
        const match = existingChunks.find(
          ec =>
            ec.chunkIndex === chunk.chunkIndex &&
            ec.startLine === chunk.startLine &&
            ec.endLine === chunk.endLine
        );
        if (match) {
          entries.push({
            chunkId: match.id,
            embeddingText: chunk.embeddingText,
          });
        }
      }

      console.log(`  ✅ ${path.basename(file_path)}: matched ${chunks.length} chunks`);
    } catch (err) {
      console.error(`  ❌ Failed to process ${file_path}:`, err);
    }
  }

  console.log(`\nBackfilling FTS5 index with ${entries.length} entries...`);
  const inserted = db.backfillFts(entries);
  console.log(`  Inserted ${inserted} new FTS5 entries (${entries.length - inserted} already existed)\n`);

  // Verify
  const ftsCount = handle
    .prepare(`SELECT COUNT(*) AS cnt FROM chunks_fts`)
    .get() as { cnt: number };
  const chunkCount = handle
    .prepare(`SELECT COUNT(*) AS cnt FROM chunks`)
    .get() as { cnt: number };
  console.log(`FTS5 index: ${ftsCount.cnt} entries / ${chunkCount.cnt} total chunks`);

  if (skippedFiles > 0) {
    console.log(`\n⚠️  ${skippedFiles} files were not found on disk. Their chunks are in the DB but not in FTS5.`);
  }

  await embedder.close();
  db.close();

  console.log('\n✨ Backfill complete. You can now use BM25 search.\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
