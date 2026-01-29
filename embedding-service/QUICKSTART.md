# Quick Start Guide

## Project Structure

```
embedding-service/
├── src/
│   ├── config/
│   │   └── paths.ts              # Configuration (poll interval, project folders, paths)
│   ├── db/
│   │   ├── schema.sql            # SQLite schema
│   │   └── sqlite.ts             # Database operations
│   ├── embedding-service/
│   │   ├── index.ts              # Main entry point & daemon lifecycle
│   │   ├── watcher.ts            # File system monitoring
│   │   ├── chunker.ts            # Hierarchical XML chunking
│   │   ├── embedder.ts           # ONNX embedding generation
│   │   └── pipeline.ts           # Orchestration logic
│   ├── retrieval/
│   │   └── code_retrieve.ts      # Semantic search CLI
│   └── utils/
│       └── hash.ts               # SHA-256 hashing for change detection
├── models/
│   └── model_quantized.onnx      # all-MiniLM-L6-v2 ONNX model
├── data/
│   └── embeddings.db             # SQLite database (auto-created)
├── package.json
├── tsconfig.json
└── README.md
```

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Build the project**:
   ```bash
   npm run build
   ```

## Running the Service

### Start the background service:

**Development mode** (with auto-reload):
```bash
npm run dev
```

**Production mode**:
```bash
npm start
```

The service will:
- Load the ONNX model
- Initialize SQLite database
- Process all XML files in `BankIntegration` and `Hotelintegration` folders
- Watch for changes every 10 seconds
- Update only modified chunks

### Stop the service:
Press `Ctrl+C` to gracefully shutdown

## Searching Code

After the service has indexed your files, you can search:

```bash
npm run search:dev "hotel booking creation"
npm run search:dev "error handling"
npm run search:dev "currency conversion"
```

Or in production:
```bash
npm run search "your query here"
```

## Configuration

Edit `src/config/paths.ts` to customize:

```typescript
export const config = {
  pollIntervalMs: 10000,  // Check for changes every 10 seconds
  projectFolders: ['BankIntegration', 'Hotelintegration'],  // Add more projects
  artifactsSubPath: 'src/main/wso2mi/artifacts',
  dbPath: path.resolve(__dirname, '../../../data/embeddings.db'),
  modelPath: path.resolve(__dirname, '../../models/model_quantized.onnx'),
  embeddingDimension: 384,
};
```

## How It Works

### 1. Initial Processing
- Scans all XML files in configured project folders
- Chunks each file hierarchically (resource → sequence → mediator)
- Generates embeddings using ONNX model
- Stores embeddings + metadata in SQLite

### 2. Incremental Updates (every 10s)
- Computes SHA-256 hash of each XML file
- Compares with stored hashes
- Only re-processes changed files
- Only updates modified chunks (not entire file)

### 3. Hierarchical Chunking
Given this XML:
```xml
<api name="HotelAPI">
  <resource methods="POST" uri-template="/bookings">
    <inSequence>
      <log><message>Creating booking</message></log>
      <payloadFactory media-type="json">...</payloadFactory>
    </inSequence>
  </resource>
</api>
```

Creates chunks:
1. `api` chunk (parent: null)
2. `resource` chunk (parent: api)
3. `inSequence` chunk (parent: resource)
4. `log` mediator chunk (parent: inSequence)
5. `payloadFactory` mediator chunk (parent: inSequence)

### 4. Semantic Search
- User enters query (e.g., "hotel booking")
- Query is embedded using same ONNX model
- Cosine similarity computed against all chunks
- Top K results returned with metadata

## Database Schema

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,              -- SHA-256 for change detection
  resource_name TEXT NOT NULL,          -- e.g., "HotelAPI"
  resource_type TEXT NOT NULL,          -- e.g., "api", "sequence"
  chunk_type TEXT NOT NULL,             -- e.g., "resource", "log", "inSequence"
  chunk_index INTEGER NOT NULL,         -- Sequential chunk number
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  parent_chunk_id INTEGER,              -- Foreign key to parent chunk
  embedding BLOB NOT NULL,              -- 384-dim Float32Array
  timestamp INTEGER NOT NULL
);
```

## Example Output

### Service Running:
```
Starting Embedding Service...
Model: /path/to/models/model_quantized.onnx
Database: /path/to/data/embeddings.db
Poll interval: 10000ms
Watching directories: .../BankIntegration/src/main/wso2mi/artifacts, ...
Embedder initialized
Initial processing started...
Found 15 files to process
Processing: .../BankAPI.xml
  Extracted 25 chunks
  Inserted chunk at lines 2-10
  Inserted chunk at lines 11-30
  ...
Initial processing completed
Embedding Service is running
```

### Search Results:
```
Query: "hotel booking creation"

Top 5 results:

1. [0.8523] api:resource - CreateBooking
   File: .../HotelBookingAPI.xml
   Lines: 15-45
   Parent Chunk ID: 1

2. [0.7891] sequence:inSequence - CreateBookingSequence
   File: .../CreateBookingSequence.xml
   Lines: 2-28

3. [0.7234] api:log - CreateBooking
   File: .../HotelBookingAPI.xml
   Lines: 18-20
   Parent Chunk ID: 2
```

## Troubleshooting

**"Model not found"**: Ensure `models/model_quantized.onnx` exists

**"No files detected"**: Check `projectFolders` in `src/config/paths.ts`

**Build errors**: Run `npm install` and ensure TypeScript 5+ is installed

**Database locked**: Only one service instance can run at a time

## Next Steps

1. Start the service: `npm run dev`
2. Wait for initial indexing to complete
3. Test search: `npm run search:dev "your query"`
4. Modify an XML file and watch it auto-update
5. Add more projects to `projectFolders` in config

