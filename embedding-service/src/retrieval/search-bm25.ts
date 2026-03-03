#!/usr/bin/env node

/**
 * CLI: BM25 Search
 *
 * Usage:
 *   npx ts-node src/retrieval/search-bm25.ts "your search query"
 *   npm run search:bm25 "your search query"
 */

import * as fs from 'fs';
import { BM25SearchService } from './bm25-search';

async function main() {
  const args = process.argv.slice(2);
  const topKIndex = args.indexOf('--topK');
  let topK = 10;
  if (topKIndex !== -1 && args[topKIndex + 1]) {
    topK = parseInt(args[topKIndex + 1], 10);
    args.splice(topKIndex, 2);
  }

  const query = args.join(' ').trim();

  if (!query) {
    console.error('Usage: npm run search:bm25 "your search query" [--topK 10]');
    process.exit(1);
  }

  console.log(`\n🔍 BM25 Search for: "${query}" (top ${topK})\n`);

  const service = new BM25SearchService();
  const indexSize = service.getIndexSize();
  console.log(`FTS5 index contains ${indexSize} documents\n`);

  if (indexSize === 0) {
    console.log('⚠️  FTS5 index is empty. Run the embedding pipeline first, or');
    console.log('   run the backfill migration: npm run bm25:backfill\n');
    service.close();
    process.exit(1);
  }

  const results = service.searchBM25(query, topK);
  console.log(`Found ${results.length} results:\n`);

  for (let idx = 0; idx < results.length; idx++) {
    const result = results[idx];

    // Attempt to read XML content from file
    let xmlContent = '[Content unavailable]';
    try {
      const fileContent = fs.readFileSync(result.filePath, 'utf-8');
      const lines = fileContent.split('\n');
      const chunkLines = lines.slice(result.startLine - 1, result.endLine);
      xmlContent = chunkLines.join('\n').substring(0, 300);
    } catch {
      // File reading failed
    }

    console.log(`${idx + 1}. [BM25 Score: ${result.bm25Score.toFixed(4)}]`);
    console.log(`   📄 File: ${result.filePath}`);
    console.log(`   📍 Lines: ${result.startLine}-${result.endLine}`);
    console.log(`   🔗 Context: ${JSON.stringify(result.context)}`);

    if (result.referencedSequences && result.referencedSequences.length > 0) {
      console.log(`   📎 References: ${result.referencedSequences.join(', ')}`);
    }

    console.log(`   📋 XML Preview:\n${xmlContent}${xmlContent.length >= 300 ? '...' : ''}`);
    console.log('');
  }

  service.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
