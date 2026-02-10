import { pipeline, env, AutoTokenizer } from '@xenova/transformers';
import * as path from 'path';

export class Embedder {
  private extractor: any = null;
  private tokenizer: any = null;

  async initialize(modelPath: string): Promise<void> {
    // Extract the directory containing the model files
    const modelDir = path.dirname(modelPath);

    // Set the cache directory to our local models folder
    env.cacheDir = modelDir;
    env.localModelPath = modelDir;

    // Use sentence-transformers/all-MiniLM-L6-v2 but it will load from local cache
    this.extractor = await pipeline(
      'feature-extraction',
      'isuruwijesiri/all-MiniLM-L6-v2-code-search-512',
      {
        quantized: false // Use model_quantized.onnx
      }
    );

    // Initialize tokenizer for accurate token counting
    this.tokenizer = await AutoTokenizer.from_pretrained('isuruwijesiri/all-MiniLM-L6-v2-code-search-512');
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

  /**
   * Count tokens using the actual model's tokenizer
   * @param text Text to tokenize (XML content + metadata)
   * @returns Accurate token count
   */
  countTokens(text: string): number {
    if (!this.tokenizer) {
      throw new Error('Tokenizer not initialized');
    }
    const tokens = this.tokenizer.encode(text);
    return tokens.length;
  }

  async close(): Promise<void> {
    this.extractor = null;
    this.tokenizer = null;
  }
}
