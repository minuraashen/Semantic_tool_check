import { config, getProjectPaths } from '../config/paths';
import { SQLiteDB } from '../db/sqlite';
import { Embedder } from './embedder';
import { Pipeline } from './pipeline';

export class EmbeddingService {
  private db: SQLiteDB;
  private embedder: Embedder;
  private pipeline: Pipeline;
  private intervalId: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor() {
    this.db = new SQLiteDB(config.dbPath);
    this.embedder = new Embedder();
    this.pipeline = new Pipeline(this.db, this.embedder);
  }

  async start(): Promise<void> {
    if (this.isInitialized) {
      console.log('Service already running');
      return;
    }

    console.log('Starting Embedding Service...');
    console.log(`Model: ${config.modelPath}`);
    console.log(`Database: ${config.dbPath}`);
    console.log(`Poll interval: ${config.pollIntervalMs}ms`);

    await this.embedder.initialize(config.modelPath);
    console.log('Embedder initialized');

    const directories = getProjectPaths();
    console.log(`Watching directories: ${directories.join(', ')}`);

    await this.pipeline.processInitial(directories);

    this.intervalId = setInterval(async () => {
      try {
        await this.pipeline.processIncremental(directories);
      } catch (error) {
        console.error('Error during incremental processing:', error);
      }
    }, config.pollIntervalMs);

    this.isInitialized = true;
    console.log('Embedding Service is running');
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.embedder.close();
    this.db.close();
    this.isInitialized = false;
    console.log('Embedding Service stopped');
  }

  isRunning(): boolean {
    return this.isInitialized;
  }
}

let service: EmbeddingService | null = null;

export async function startService(): Promise<void> {
  if (service) {
    console.log('Service already exists');
    return;
  }

  service = new EmbeddingService();
  await service.start();

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    if (service) {
      await service.stop();
    }
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    if (service) {
      await service.stop();
    }
    process.exit(0);
  });
}

if (require.main === module) {
  startService().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
