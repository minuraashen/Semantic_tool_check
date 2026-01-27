# Tokenization Upgrade Guide

The current implementation uses **simplified tokenization** (whitespace splitting + hashing). For production use, you should integrate a proper tokenizer.

## Current Limitation

```typescript
// Current simplified tokenization
const tokens = text.toLowerCase().split(/\s+/).filter(t => t.length > 0);
const tokenIds = tokens.map(token => this.hashString(token) % 30000);
```

**Issues**:
- No proper vocabulary mapping
- No subword tokenization
- No special token handling ([CLS], [SEP], [PAD])
- Hash collisions possible

## Recommended Solution

Use **@xenova/transformers** (Transformers.js) for proper tokenization:

### 1. Install Transformers.js

```bash
npm install @xenova/transformers
```

### 2. Update embedding-service.ts

```typescript
import { AutoTokenizer } from '@xenova/transformers';

class EmbeddingService {
  private tokenizer: any = null;

  async start(workspacePath: string, dbPath: string): Promise<void> {
    // ... existing code ...
    
    // Load tokenizer
    console.log('Loading tokenizer...');
    this.tokenizer = await AutoTokenizer.from_pretrained(
      'Xenova/all-MiniLM-L6-v2'
    );
    console.log('Tokenizer loaded successfully');
    
    // ... rest of initialization ...
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    this.ensureInitialized();
    
    try {
      // Proper tokenization
      const encoded = await this.tokenizer(text, {
        padding: true,
        truncation: true,
        max_length: 128,
        return_tensors: 'pt',
      });

      // Create ONNX input tensors
      const inputIds = new ort.Tensor(
        'int64',
        BigInt64Array.from(encoded.input_ids.data.map(id => BigInt(id))),
        [1, encoded.input_ids.dims[1]]
      );
      
      const attentionMask = new ort.Tensor(
        'int64',
        BigInt64Array.from(encoded.attention_mask.data.map(id => BigInt(id))),
        [1, encoded.attention_mask.dims[1]]
      );

      // Run inference
      const feeds = {
        input_ids: inputIds,
        attention_mask: attentionMask,
      };
      
      const results = await this.session!.run(feeds);
      
      // Extract embedding
      const output = results[Object.keys(results)[0]];
      const embeddingData = output.data as Float32Array;
      
      return new Float32Array(embeddingData.slice(0, 384));
    } catch (error) {
      console.error('Failed to generate embedding:', error);
      throw new Error(`Embedding generation failed: ${error}`);
    }
  }
  
  async stop(): Promise<void> {
    // ... existing code ...
    
    // Release tokenizer
    if (this.tokenizer) {
      this.tokenizer = null;
    }
    
    // ... rest of cleanup ...
  }
}
```

### 3. Update package.json

```json
{
  "dependencies": {
    "@xenova/transformers": "^2.6.0",
    "onnxruntime-node": "^1.17.0",
    "fast-xml-parser": "^4.3.2",
    "better-sqlite3": "^9.2.2"
  }
}
```

## Alternative: Pre-computed Vocabulary

If you want to avoid the Transformers.js dependency, you can:

1. **Download the tokenizer vocab**:
   - Get `vocab.txt` from Hugging Face model repo
   - Load it into a Map<string, number>

2. **Implement BPE tokenization**:
   ```typescript
   class SimpleTokenizer {
     private vocab: Map<string, number>;
     
     constructor(vocabPath: string) {
       // Load vocab.txt
       const vocabText = fs.readFileSync(vocabPath, 'utf-8');
       this.vocab = new Map();
       vocabText.split('\n').forEach((token, idx) => {
         this.vocab.set(token, idx);
       });
     }
     
     encode(text: string, maxLength: number = 128): number[] {
       // Lowercase and split
       const tokens = text.toLowerCase().split(/\s+/);
       
       // Convert to IDs
       const ids = [101]; // [CLS] token
       for (const token of tokens.slice(0, maxLength - 2)) {
         ids.push(this.vocab.get(token) || 100); // 100 = [UNK]
       }
       ids.push(102); // [SEP] token
       
       // Pad to maxLength
       while (ids.length < maxLength) {
         ids.push(0); // [PAD]
       }
       
       return ids.slice(0, maxLength);
     }
   }
   ```

## Why Proper Tokenization Matters

### Impact on Embedding Quality

**With Simplified Tokenization**:
- ❌ Poor handling of compound words
- ❌ No subword understanding
- ❌ Hash collisions create noise
- ❌ Out-of-vocabulary terms lost
- ⚠️ Similarity scores less reliable

**With Proper Tokenization**:
- ✅ Accurate word piece splitting
- ✅ Handles rare words via subwords
- ✅ Proper vocabulary mapping
- ✅ Special tokens handled correctly
- ✅ Better embedding quality

### Example Comparison

**Input**: "HotelBookingAPI endpoint configuration"

**Simplified**:
```
["hotelbookingapi", "endpoint", "configuration"]
→ [hash1, hash2, hash3]
→ Potential collisions, no semantic structure
```

**Proper (WordPiece)**:
```
["hotel", "##booking", "##api", "endpoint", "configuration"]
→ [2534, 8665, 8124, 7120, 9876]
→ Accurate representation, preserves meaning
```

## Testing Tokenization

Create a test to verify tokenization quality:

```typescript
async function testTokenization() {
  const testCases = [
    "HotelBookingAPI endpoint",
    "createBooking sequence",
    "database connection pool",
  ];
  
  for (const text of testCases) {
    const embedding = await embeddingService.generateEmbedding(text);
    console.log(`"${text}" → [${embedding.slice(0, 5).join(', ')}...]`);
  }
}
```

## Performance Considerations

- **Transformers.js**: +50-100ms first tokenization (model download)
- **Runtime**: +5-10ms per tokenization
- **Memory**: +50-100MB for tokenizer model
- **Worth it**: ✅ Significantly better embedding quality

## Migration Steps

1. ✅ Current: Use simplified tokenization (works, but suboptimal)
2. 🔄 Next: Add Transformers.js dependency
3. 🔄 Update `generateEmbedding()` method
4. 🔄 Re-index workspace with new embeddings
5. ✅ Improved: Better search quality

## Backward Compatibility

If you need to support both:

```typescript
class EmbeddingService {
  private useProperTokenization: boolean = false;

  async generateEmbedding(text: string): Promise<Float32Array> {
    if (this.useProperTokenization && this.tokenizer) {
      return this.generateEmbeddingProper(text);
    } else {
      return this.generateEmbeddingSimple(text);
    }
  }

  private async generateEmbeddingProper(text: string): Promise<Float32Array> {
    // Transformers.js implementation
  }

  private async generateEmbeddingSimple(text: string): Promise<Float32Array> {
    // Current implementation
  }
}
```

## Conclusion

The current implementation **works for demonstration and development**. For production:

1. **Highly Recommended**: Integrate Transformers.js
2. **Alternative**: Implement proper vocabulary mapping
3. **Last Resort**: Keep simple tokenization (if accuracy isn't critical)

Choose based on your quality requirements and deployment constraints.
