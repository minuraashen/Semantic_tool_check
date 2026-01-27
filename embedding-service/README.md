# Embedding Service

A TypeScript-based embedding service for semantic search of WSO2 Micro Integrator XML configuration files.

## Features

- **ONNX Model Integration**: Uses quantized all-MiniLM-L6-v2 model for generating embeddings
- **XML Chunking**: Semantic chunking of WSO2 MI configuration files
- **Vector Storage**: SQLite-based vector store for embeddings
- **Similarity Search**: Cosine similarity-based semantic search
- **Incremental Indexing**: Smart file change detection and re-indexing

## Installation

```bash
npm install
```

## Dependencies

- `onnxruntime-node`: ONNX Runtime for Node.js
- `fast-xml-parser`: XML parsing
- `better-sqlite3`: SQLite database
- `@types/node`: TypeScript Node.js types

## Usage

```typescript
import { embeddingService } from './embedding-service';

// Initialize the service
await embeddingService.start(
  '/path/to/workspace',
  '/path/to/embeddings.db'
);

// Index all XML files in workspace
await embeddingService.indexWorkspace();

// Index a specific file
await embeddingService.indexFile('/path/to/file.xml');

// Search for similar code
const results = await embeddingService.searchSimilar('hotel booking', 10);
results.forEach(result => {
  console.log(`${result.elementName} (${result.elementType})`);
  console.log(`  File: ${result.filePath}:${result.startLine}-${result.endLine}`);
  console.log(`  Score: ${result.similarityScore.toFixed(4)}`);
});

// Clean up
await embeddingService.stop();
```

## API Reference

### `start(workspacePath: string, dbPath: string): Promise<void>`

Initializes the embedding service with workspace path and database location.

**Parameters:**
- `workspacePath`: Root directory containing XML files to index
- `dbPath`: Path to SQLite database file (will be created if doesn't exist)

**Throws:** Error if model loading or initialization fails

### `indexWorkspace(): Promise<void>`

Indexes all XML files in the workspace recursively. Skips unchanged files based on modification time.

**Features:**
- Recursive directory traversal
- Progress logging
- Error handling (continues on individual file failures)

### `indexFile(filePath: string): Promise<number>`

Indexes a single XML file.

**Parameters:**
- `filePath`: Absolute path to XML file

**Returns:** Number of chunks created

**Features:**
- Modification time checking
- Automatic chunk deletion for updated files
- Embedding generation and storage

### `deleteFileChunks(filePath: string): Promise<void>`

Deletes all chunks associated with a file.

**Parameters:**
- `filePath`: Absolute path to file

### `generateEmbedding(text: string): Promise<Float32Array>`

Generates a 384-dimensional embedding vector for text.

**Parameters:**
- `text`: Input text to embed

**Returns:** Float32Array of size 384

**Note:** Currently uses simplified tokenization. For production, integrate a proper tokenizer like `transformers.js`.

### `searchSimilar(query: string, topK?: number): Promise<SearchResult[]>`

Searches for semantically similar code chunks.

**Parameters:**
- `query`: Search query text
- `topK`: Number of results to return (default: 10)

**Returns:** Array of SearchResult objects sorted by similarity score

**SearchResult Interface:**
```typescript
interface SearchResult {
  id: number;
  filePath: string;
  startLine: number;
  endLine: number;
  elementType: string;
  elementName: string;
  similarityScore: number; // Range: -1 to 1
}
```

### `stop(): Promise<void>`

Stops the service and releases resources.

## Architecture

```
EmbeddingService (Singleton)
├── ONNX Model (model_quantized.onnx)
├── XMLCodeChunker (xml-chunker.ts)
│   └── Extracts semantic chunks from XML
├── VectorStore (vector-store.ts)
│   └── SQLite database for embeddings
└── Search Engine
    └── Cosine similarity calculation
```

## Model

The service uses the `all-MiniLM-L6-v2` model (quantized version):
- **Embedding Dimension**: 384
- **Location**: `./models/model_quantized.onnx`
- **Input**: Tokenized text (max length: 128)
- **Output**: 384-dimensional dense vector

## Database Schema

```sql
CREATE TABLE code_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  xml_element_type TEXT NOT NULL,
  xml_element_name TEXT NOT NULL,
  embedding BLOB NOT NULL,
  last_modified INTEGER NOT NULL,
  UNIQUE(file_path, start_line, end_line)
);
```

## Error Handling

The service implements comprehensive error handling:

- **Model Loading**: Throws exception if model file not found
- **File Operations**: Logs warnings and skips problematic files
- **Database Operations**: Logs errors and re-throws
- **Chunking Errors**: Logs warnings and continues with other files

## Performance Considerations

- **Incremental Updates**: Only re-indexes modified files
- **Batch Processing**: Processes all files in workspace sequentially
- **Memory Efficient**: Streams file operations where possible
- **SQLite Indexes**: Optimized queries with proper indexes

## Limitations

1. **Tokenization**: Currently uses simplified whitespace tokenization. For production use, integrate a proper tokenizer.
2. **Model Format**: Requires ONNX format model file.
3. **Synchronous Search**: All embeddings loaded into memory for search. Consider pagination for large datasets.

## Future Enhancements

- [ ] Proper tokenizer integration (transformers.js)
- [ ] Batch embedding generation
- [ ] Approximate nearest neighbor search (FAISS/HNSW)
- [ ] File watcher for automatic re-indexing
- [ ] Multi-threaded indexing
- [ ] Embedding caching
- [ ] Query expansion and filtering

## License

MIT
