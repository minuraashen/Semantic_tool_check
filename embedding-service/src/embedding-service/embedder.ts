import { pipeline, env } from '@xenova/transformers';
import * as path from 'path';

export class Embedder {
  private extractor: any = null;

  async initialize(modelPath: string): Promise<void> {
    // Extract the directory containing the model files
    const modelDir = path.dirname(modelPath);
    
    // Set the cache directory to our local models folder
    env.cacheDir = modelDir;
    env.localModelPath = modelDir;
    
    // Use sentence-transformers/all-MiniLM-L6-v2 but it will load from local cache
    this.extractor = await pipeline(
      'feature-extraction', 
      'sentence-transformers/all-MiniLM-L6-v2',
      { 
        quantized: true // Use model_quantized.onnx
      }
    );
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) {
      throw new Error('Embedder not initialized');
    }

    // Use the pipeline with mean pooling and normalization
    const result = await this.extractor(text, { 
      pooling: 'mean', 
      normalize: true 
    });

    // Convert to Float32Array for consistency with our database
    return new Float32Array(Array.from(result.data));
  }

  async close(): Promise<void> {
    this.extractor = null;
  }
}
