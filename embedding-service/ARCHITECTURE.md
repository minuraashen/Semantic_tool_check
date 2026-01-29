# Embedding Service Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Embedding Service Daemon                   │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Watcher    │───▶│   Pipeline   │───▶│   Embedder   │       │
│  │ (10s poll)   │    │ (Orchestrate)│    │ (ONNX model) │       │ 
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                    │                    │             │
│         │                    │                    │             │
│         ▼                    ▼                    ▼             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │ File System  │    │   Chunker    │    │   SQLite DB  │       │
│  │  (XMLs)      │    │(Hierarchical)│    │  (Embeddings)│       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │ Query Interface
                                ▼
                     ┌──────────────────────┐
                     │  CodeRetrieval CLI   │
                     │  (Semantic Search)   │
                     └──────────────────────┘
```

## Component Details

### 1. Watcher (watcher.ts)
**Responsibility**: Monitor XML files for changes

**Flow**:
```
Every 10 seconds:
  1. Scan all XML files in watched directories
  2. Compute SHA-256 hash of each file
  3. Compare with stored hashes
  4. Return list of changed files
  5. Update internal hash map
```

**Key Functions**:
- `scanForChanges(directories: string[]): Promise<FileChange[]>`
- `findXMLFiles(dir: string): Promise<string[]>`
- `getFileHash(filePath: string): string | undefined`

### 2. Chunker (chunker.ts)
**Responsibility**: Break XML files into hierarchical chunks

**Chunking Strategy**:
```
XML File
  └─ Resource (API, Proxy, Sequence)
      └─ Sub-Resource (Resource, Endpoint)
          └─ Sequence (inSequence, outSequence, faultSequence)
              └─ Mediator (log, payloadFactory, filter, etc.)
```

**Key Functions**:
- `chunkFile(filePath: string): Promise<XMLChunk[]>`
- `processNode(node, xmlContent, lines, filePath, chunks, parentChunkId)`
- `findElementRange(tagName, resourceName, lines): LineRange`
- `createEmbeddingText(tagName, resourceName, content, attrs): string`

**Chunk Types**:
- **Resources**: `api`, `proxy`, `sequence`, `endpoint`, `localEntry`, `resource`
- **Sequences**: `inSequence`, `outSequence`, `faultSequence`
- **Mediators**: `log`, `payloadFactory`, `filter`, `respond`, `call`, `http.post`, etc.

### 3. Embedder (embedder.ts)
**Responsibility**: Generate embeddings using ONNX model

**Model**: all-MiniLM-L6-v2 (384 dimensions)

**Flow**:
```
Text Input
  ↓
Tokenize (simple word-based)
  ↓
Convert to IDs + Add [CLS], [SEP], [PAD]
  ↓
Create input_ids & attention_mask tensors
  ↓
Run ONNX inference
  ↓
Mean pooling over sequence
  ↓
Float32Array[384]
```

**Key Functions**:
- `initialize(modelPath: string): Promise<void>`
- `embed(text: string): Promise<Float32Array>`
- `tokenize(text: string): string[]`
- `meanPooling(embeddings, attentionMask): Float32Array`

### 4. Pipeline (pipeline.ts)
**Responsibility**: Orchestrate the entire embedding process

**Initial Processing**:
```
1. Scan all XML files
2. For each file:
   a. Chunk into hierarchy
   b. Generate embeddings for each chunk
   c. Store in database with metadata
```

**Incremental Processing** (every 10s):
```
1. Get changed files from Watcher
2. For each changed file:
   a. Re-chunk file
   b. Compare with existing chunks
   c. Update/Insert only modified chunks
   d. Delete removed chunks
```

**Key Functions**:
- `processInitial(directories: string[]): Promise<void>`
- `processIncremental(directories: string[]): Promise<void>`
- `processFile(filePath: string, fileHash: string): Promise<void>`

### 5. Database (sqlite.ts)
**Responsibility**: Store and retrieve embeddings + metadata

**Schema**:
```sql
chunks (
  id                 INTEGER PRIMARY KEY,
  file_path          TEXT,
  file_hash          TEXT,      -- For change detection
  resource_name      TEXT,      -- e.g., "HotelAPI"
  resource_type      TEXT,      -- e.g., "api"
  chunk_type         TEXT,      -- e.g., "resource", "log"
  chunk_index        INTEGER,   -- Sequential ID
  start_line         INTEGER,
  end_line           INTEGER,
  parent_chunk_id    INTEGER,   -- Foreign key (graph)
  embedding          BLOB,      -- Float32Array (384 dims)
  timestamp          INTEGER
)
```

**Key Functions**:
- `insertChunk(metadata, embedding): number`
- `updateChunk(id, metadata, embedding): void`
- `getChunksByFile(filePath): ChunkRecord[]`
- `cosineSimilarity(embedding): ChunkRecord[]`

### 6. EmbeddingService (index.ts)
**Responsibility**: Main daemon lifecycle management

**Lifecycle**:
```
start()
  ↓
Initialize ONNX model
  ↓
Initialize SQLite DB
  ↓
Process all files (initial indexing)
  ↓
Start 10s interval timer
  ↓
[Every 10s: Process incremental changes]
  ↓
Listen for SIGINT/SIGTERM
  ↓
stop() → Cleanup & Exit
```

**Key Functions**:
- `start(): Promise<void>`
- `stop(): Promise<void>`
- `isRunning(): boolean`

### 7. CodeRetrieval (code_retrieve.ts)
**Responsibility**: Semantic search CLI

**Flow**:
```
User Query
  ↓
Generate embedding
  ↓
Compute cosine similarity with all chunks
  ↓
Sort by similarity (descending)
  ↓
Return top K results with metadata
```

**Key Functions**:
- `initialize(): Promise<void>`
- `search(query: string, topK: number): Promise<RetrievalResult[]>`

## Data Flow

### Initial Indexing
```
1. User starts service: npm run dev

2. Watcher scans directories:
   BankIntegration/src/main/wso2mi/artifacts/**/*.xml
   Hotelintegration/src/main/wso2mi/artifacts/**/*.xml

3. For each XML file:
   - Chunker extracts hierarchical chunks
   - Embedder generates 384-dim vectors
   - Database stores chunks + embeddings

4. Service enters polling mode (10s interval)
```

### Incremental Update
```
1. [After 10 seconds]

2. Watcher detects changed file:
   Hotelintegration/.../HotelBookingAPI.xml

3. Pipeline re-chunks file:
   - 5 new chunks, 3 modified, 2 deleted

4. For each chunk:
   - If new: generate embedding + insert
   - If modified: regenerate embedding + update
   - If deleted: remove from DB

5. Only 8 embeddings generated (not entire file)
```

### Search Query
```
1. User runs: npm run search:dev "hotel booking"

2. CodeRetrieval:
   - Embeds query: "hotel booking" → Float32Array[384]
   - Loads all chunks from DB
   - Computes cosine similarity for each
   - Sorts by similarity
   - Returns top 5 results

3. Output:
   [0.8523] api:resource - CreateBooking
   [0.7891] sequence:inSequence - CreateBookingSequence
   ...
```

## Performance Characteristics

### Time Complexity
- **Initial Indexing**: O(F × C × E) where F=files, C=chunks/file, E=embedding time
- **Incremental Update**: O(Δ × C × E) where Δ=changed files only
- **Search**: O(N × D) where N=total chunks, D=embedding dimension (384)

### Space Complexity
- **Database**: ~1.5KB per chunk (metadata + 384×4 bytes for embedding)
- **Memory**: Only active chunks in memory during processing

### Optimizations
1. **Hash-based change detection** - Avoid re-processing unchanged files
2. **Chunk-level updates** - Only update modified chunks, not entire file
3. **SQLite indexes** - Fast lookups by file_path, file_hash, resource_type
4. **Quantized ONNX model** - Smaller, faster inference

## Configuration Options

```typescript
// src/config/paths.ts
export const config = {
  pollIntervalMs: 10000,           // Poll every 10 seconds
  projectFolders: [                // Projects to watch
    'BankIntegration',
    'Hotelintegration'
  ],
  artifactsSubPath: 'src/main/wso2mi/artifacts',
  dbPath: '../../../data/embeddings.db',
  modelPath: '../../models/model_quantized.onnx',
  embeddingDimension: 384,         // all-MiniLM-L6-v2
};
```

## Extension Points

### Add New Mediator Types
Edit `chunker.ts`:
```typescript
private isMediatorType(tagName: string): boolean {
  const mediators = [
    'log', 'payloadFactory', /* add new types here */
  ];
  return mediators.includes(tagName);
}
```

### Add New Resource Types
Edit `chunker.ts`:
```typescript
private isResourceType(tagName: string): boolean {
  return ['api', 'proxy', /* add new types */].includes(tagName);
}
```

### Change Polling Interval
Edit `src/config/paths.ts`:
```typescript
pollIntervalMs: 5000,  // 5 seconds instead of 10
```

### Watch Additional Projects
Edit `src/config/paths.ts`:
```typescript
projectFolders: [
  'BankIntegration',
  'Hotelintegration',
  'NewProject',  // Add here
],
```
