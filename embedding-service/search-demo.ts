import { embeddingService } from './embedding-service';
import * as path from 'path';

async function searchDemo() {
  try {
    const dbPath = path.join(__dirname, 'dist', 'hotel-embeddings.db');
    const workspacePath = path.resolve(__dirname, '../Hotelintegration');
    
    console.log('Initializing service...');
    await embeddingService.start(workspacePath, dbPath);
    
    const queries = [
      'hotel booking',
      'create booking',
      'error handling',
      'delete operation',
    ];
    
    for (const query of queries) {
      console.log(`\nQuery: "${query}"`);
      const results = await embeddingService.searchSimilar(query, 3);
      
      results.forEach((result, idx) => {
        console.log(`  ${idx + 1}. ${result.elementName} (${result.elementType})`);
        console.log(`     Score: ${result.similarityScore.toFixed(4)}`);
      });
    }
    
    await embeddingService.stop();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

searchDemo();
