#!/usr/bin/env node

/**
 * CLI: Compare Vector Search vs BM25 Search
 *
 * Usage:
 *   npx ts-node src/retrieval/search-compare.ts "your search query"
 *   npx ts-node src/retrieval/search-compare.ts "your search query" 20
 *   npm run search:compare "your search query"
 */

import { SearchComparison, printComparison } from './compare-search';

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
    console.error('Usage: npm run search:compare "your search query" [--topK 10]');
    process.exit(1);
  }

  const comparison = new SearchComparison();
  await comparison.initialize();

  const result = await comparison.compareSearchMethods(query, topK);

  printComparison(result);

  // Also output machine-readable JSON to stderr for scripting
  console.error(JSON.stringify({
    query: result.query,
    topK: result.topK,
    vectorCount: result.vector_results.length,
    bm25Count: result.bm25_results.length,
    overlapCount: result.overlap.count,
    jaccardSimilarity: result.overlap.jaccardSimilarity,
  }));

  await comparison.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
