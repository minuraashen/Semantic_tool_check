#!/usr/bin/env node

import { CodeRetrieval } from './code_retrieve_enhanced';
import * as fs from 'fs';

async function main() {
  const query = process.argv[2];

  if (!query) {
    console.error('Usage: npm run search "your search query"');
    process.exit(1);
  }

  console.log(`\n🔍 Searching for: "${query}"\n`);

  const retrieval = new CodeRetrieval();
  await retrieval.initialize();

  // Basic search with top 60 results
  const results = await retrieval.search(query, 10);

  console.log(`Found ${results.length} results:\n`);

  for (let idx = 0; idx < results.length; idx++) {
    const result = results[idx];

    // Read XML content from file
    let xmlContent = '[Content unavailable]';
    try {
      const fileContent = fs.readFileSync(result.filePath, 'utf-8');
      const lines = fileContent.split('\n');
      const chunkLines = lines.slice(result.startLine - 1, result.endLine);
      xmlContent = chunkLines.join('\n').substring(0, 300);
    } catch (error) {
      // File reading failed
    }

    console.log(`${idx + 1}. [Score: ${result.similarity.toFixed(4)}]`);
    console.log(`   📄 File: ${result.filePath}`);
    console.log(`   📍 Lines: ${result.startLine}-${result.endLine}`);
    console.log(`   🏷️  Type: ${result.semanticType || 'N/A'} | Intent: ${result.semanticIntent || 'N/A'}`);
    console.log(`   🔗 Context: ${JSON.stringify(result.context)}`);

    if (result.referencedSequences && result.referencedSequences.length > 0) {
      console.log(`   📎 References: ${result.referencedSequences.join(', ')}`);
    }

    console.log(`   📋 XML Preview:\n${xmlContent}${xmlContent.length >= 300 ? '...' : ''}`);
    console.log('');
  }

  process.exit(0);
}

main().catch(console.error);
