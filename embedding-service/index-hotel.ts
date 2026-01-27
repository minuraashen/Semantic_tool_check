import { embeddingService } from './embedding-service';
import * as path from 'path';

async function indexHotelIntegration() {
  try {
    const workspacePath = path.resolve(__dirname, '../Hotelintegration');
    const dbPath = path.join(__dirname, 'dist', 'hotel-embeddings.db');
    
    console.log('Initializing service...');
    await embeddingService.start(workspacePath, dbPath);
    
    console.log('Indexing workspace...');
    await embeddingService.indexWorkspace();
    
    console.log('Stopping service...');
    await embeddingService.stop();
    
    console.log('Complete!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

indexHotelIntegration();
