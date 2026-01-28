import * as ort from 'onnxruntime-node';
import * as fs from 'fs';

export class Embedder {
  private session: ort.InferenceSession | null = null;
  private vocab: Map<string, number> = new Map();
  private readonly maxLength = 128;

  async initialize(modelPath: string): Promise<void> {
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model not found: ${modelPath}`);
    }

    this.session = await ort.InferenceSession.create(modelPath);
    this.buildVocab();
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.session) {
      throw new Error('Embedder not initialized');
    }

    const tokens = this.tokenize(text);
    const inputIds = this.tokensToIds(tokens);
    const attentionMask = new Array(inputIds.length).fill(1);

    const inputIdsTensor = new ort.Tensor('int64', BigInt64Array.from(inputIds.map(id => BigInt(id))), [1, inputIds.length]);
    const attentionMaskTensor = new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(m => BigInt(m))), [1, attentionMask.length]);

    const feeds = {
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor,
    };

    const results = await this.session.run(feeds);
    const output = results.last_hidden_state || results.logits || results[Object.keys(results)[0]];
    
    const embeddings = output.data as Float32Array;
    return this.meanPooling(embeddings, attentionMask);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0)
      .slice(0, this.maxLength - 2);
  }

  private tokensToIds(tokens: string[]): number[] {
    const ids = [101]; // [CLS]
    
    for (const token of tokens) {
      const id = this.vocab.get(token) || 100; // [UNK]
      ids.push(id);
    }
    
    ids.push(102); // [SEP]
    
    while (ids.length < this.maxLength) {
      ids.push(0); // [PAD]
    }
    
    return ids.slice(0, this.maxLength);
  }

  private buildVocab(): void {
    for (let i = 0; i < 30000; i++) {
      this.vocab.set(`token_${i}`, i);
    }
  }

  private meanPooling(embeddings: Float32Array, attentionMask: number[]): Float32Array {
    const seqLength = attentionMask.length;
    const hiddenSize = embeddings.length / seqLength;
    
    const result = new Float32Array(hiddenSize);
    let totalMask = 0;

    for (let i = 0; i < seqLength; i++) {
      if (attentionMask[i] === 1) {
        for (let j = 0; j < hiddenSize; j++) {
          result[j] += embeddings[i * hiddenSize + j];
        }
        totalMask++;
      }
    }

    for (let j = 0; j < hiddenSize; j++) {
      result[j] /= totalMask;
    }

    return result;
  }

  close(): void {
    this.session = null;
  }
}
