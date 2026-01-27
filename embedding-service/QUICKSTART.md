# Quick Start Guide

Get up and running with EmbeddingService in 5 minutes!

## Prerequisites

- Node.js 18+ and npm
- ONNX model file: `all-minilm-l6-v2-quantized.onnx`

## Setup

```bash
# Navigate to embedding-service directory
cd embedding-service

# Run setup script
./setup.sh
```

The setup script will:
1. ✓ Verify Node.js and npm installation
2. ✓ Install all dependencies
3. ✓ Check for ONNX model file
4. ✓ Build TypeScript project

## Model Setup

If you don't have the model file:

1. Download the quantized all-MiniLM-L6-v2 model in ONNX format
2. Place it at: `./models/model_quantized.onnx`

```bash
mkdir -p models
# Copy your model file here
cp /path/to/your/model.onnx ./models/model_quantized.onnx
```

## Run Example

```bash
# Run the example to verify everything works
node dist/example.js
```

Expected output:
```
=== EmbeddingService Example ===

1. Initializing EmbeddingService...
Loading ONNX model from: .../models/model_quantized.onnx
ONNX model loaded successfully
VectorStore initialized
✓ Service initialized

2. Indexing workspace...
Found X XML files to index
Extracted Y chunks from ...
...
✓ Workspace indexed

3. Performing similarity searches...
Query: "hotel booking API"
  1. HotelBookingAPI (api)
     File: HotelBookingAPI.xml:1-50
     Score: 0.8523
...
```

## Use in Your Code

```typescript
import { embeddingService } from './embedding-service';

async function example() {
  // 1. Start service
  await embeddingService.start(
    '/path/to/workspace',
    './embeddings.db'
  );

  // 2. Index workspace
  await embeddingService.indexWorkspace();

  // 3. Search
  const results = await embeddingService.searchSimilar('your query', 5);
  console.log(results);

  // 4. Clean up
  await embeddingService.stop();
}
```

## Common Issues

### Issue: "Cannot find module 'onnxruntime-node'"
**Solution**: Run `npm install` in the embedding-service directory

### Issue: "Model file not found"
**Solution**: Ensure model file exists at `./models/model_quantized.onnx`

### Issue: "Cannot find name '__dirname'"
**Solution**: This error will resolve after running `npm install` to get @types/node

### Issue: Database locked
**Solution**: Ensure no other process is accessing the database file, or delete the .db file and re-index

## What's Next?

1. **Explore the API**: See [README.md](README.md) for complete API documentation
2. **Customize**: Modify search parameters, adjust tokenization, add filters
3. **Integrate**: Add to your existing application
4. **Optimize**: Consider upgrading tokenization for better results

## Project Structure

```
embedding-service/
├── embedding-service.ts   # Main service (you are here!)
├── xml-chunker.ts         # XML parsing and chunking
├── vector-store.ts        # SQLite vector storage
├── example.ts             # Example usage
├── models/
│   └── model_quantized.onnx  # ONNX embedding model
├── dist/                  # Compiled JavaScript
└── embeddings.db          # Generated database
```

## Support

- Read [README.md](README.md) for detailed documentation
- Check [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) for technical details
- Review example.ts for usage patterns

Happy coding! 🚀
