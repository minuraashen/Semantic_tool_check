/**
 * Example usage of EmbeddingService
 * Demonstrates initialization, indexing, and search operations
 */

import { embeddingService } from './embedding-service';
import * as path from 'path';

async function main() {
  try {
    console.log('=== EmbeddingService Example ===\n');

    // 1. Initialize the service
    console.log('1. Initializing EmbeddingService...');
    const workspacePath = path.join(__dirname, '../Hotelintegration');
    const dbPath = path.join(__dirname, 'embeddings.db');
    
    await embeddingService.start(workspacePath, dbPath);
    console.log('✓ Service initialized\n');

    // 2. Index the workspace
    console.log('2. Indexing workspace...');
    await embeddingService.indexWorkspace();
    console.log('✓ Workspace indexed\n');

    // 3. Perform similarity searches
    console.log('3. Performing similarity searches...\n');

    const queries = [
      'hotel booking API',
      'create booking sequence',
      'error handler',
      'database connection',
      'REST endpoint'
    ];

    for (const query of queries) {
      console.log(`Query: "${query}"`);
      const results = await embeddingService.searchSimilar(query, 3);
      
      if (results.length === 0) {
        console.log('  No results found\n');
        continue;
      }

      results.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.elementName} (${result.elementType})`);
        console.log(`     File: ${path.basename(result.filePath)}:${result.startLine}-${result.endLine}`);
        console.log(`     Score: ${result.similarityScore.toFixed(4)}`);
      });
      console.log();
    }

    // 4. Index a specific file (demonstration)
    console.log('4. Re-indexing a specific file...');
    const apiFile = path.join(workspacePath, 'src/wso2mi/artifacts/apis/HotelBookingAPI.xml');
    const chunks = await embeddingService.indexFile(apiFile);
    console.log(`✓ Re-indexed file: ${chunks} chunks\n`);

    // 5. Clean up
    console.log('5. Stopping service...');
    await embeddingService.stop();
    console.log('✓ Service stopped\n');

    console.log('=== Example Complete ===');
  } catch (error) {
    console.error('Error in example:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { main };
