# WSO2 MI Code Retrieval System

Semantic code search system for WSO2 Micro Integrator (MI) XML configuration files using embeddings and vector similarity.

## Overview

This project provides an intelligent code retrieval system that understands the semantic meaning of WSO2 MI integration configurations. It automatically indexes XML artifacts (APIs, sequences, mediators) and enables natural language search across your integration codebase.

## Project Structure

```
Code_retrieval/
├── embedding-service/          # Background embedding service
│   ├── src/                   # TypeScript source code
│   ├── models/                # ONNX model files
│   ├── data/                  # SQLite database
│   └── README.md              # Detailed service documentation
│
├── BankIntegration/           # Sample WSO2 MI project
│   └── src/main/wso2mi/artifacts/
│       ├── apis/              # REST APIs
│       ├── sequences/         # Integration sequences
│       └── local-entries/     # Local entries
│
└── Hotelintegration/          # Sample WSO2 MI project
    └── src/main/wso2mi/artifacts/
        ├── apis/              # REST APIs
        └── sequences/         # Integration sequences
```

## Key Features

### 🔍 Semantic Search
Search your integration code using natural language:
```bash
"hotel booking creation"
"error handling in API"
"currency conversion logic"
```

### 🔄 Real-time Monitoring
- Automatically detects XML file changes every 10 seconds
- Incrementally updates only modified chunks
- Hash-based change detection (no unnecessary re-processing)

### 🌳 Hierarchical Chunking
Understands WSO2 MI structure:
- **Resource level**: APIs, proxies, sequences, endpoints
- **Sequence level**: inSequence, outSequence, faultSequence
- **Mediator level**: log, payloadFactory, filter, property, etc.

### 📊 Graph Structure
Maintains parent-child relationships:
```
API
└── Resource
    └── inSequence
        ├── variable (mediator)
        ├── http.post (mediator)
        └── property (mediator)
```

### ⚡ Efficient Storage
- Only stores embeddings and metadata (not raw XML)
- SQLite for fast queries
- 384-dimensional vectors using all-MiniLM-L6-v2 model

## Quick Start

### Prerequisites

- Node.js 18+
- TypeScript 5.3+
- Git

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd Code_retrieval
```

2. **Install dependencies**
```bash
cd embedding-service
npm install
```

3. **Verify model files exist**
```bash
ls -la models/sentence-transformers/all-MiniLM-L6-v2/
# Should show: tokenizer.json, config.json, vocab.txt, onnx/model_quantized.onnx
```

### Running the Service

**Option 1: Development Mode**
```bash
cd embedding-service
npm run dev
```

**Option 2: Production Mode**
```bash
cd embedding-service
npm run build
npm start
```

**Option 3: Helper Script**
```bash
cd embedding-service
./run.sh
```

### Searching Code

While the service is running (or after indexing is complete):

```bash
cd embedding-service

# Search for hotel-related code
npm run search:dev "hotel booking"

# Search for error handling
npm run search:dev "error handling"

# Search for currency conversion
npm run search:dev "currency conversion"
```

## How It Works

### 1. Initialization
- Loads the ONNX model (all-MiniLM-L6-v2) using @xenova/transformers
- Creates SQLite database with schema for chunks and embeddings
- Scans all XML files in BankIntegration and Hotelintegration projects

### 2. Chunking Process
```
XML File → Parse → Extract Structure → Create Chunks
                                         ↓
                            [Resource, Sequence, Mediator]
                                         ↓
                            Store in hierarchy with parent IDs
```

### 3. Embedding Generation
```
Chunk Text → Tokenizer → BERT Model → 384-dim Vector
                                         ↓
                            Store in SQLite as BLOB
```

### 4. Search Process
```
Query → Tokenizer → BERT Model → Query Vector
                                    ↓
          Compare with all chunk vectors using cosine similarity
                                    ↓
                    Return top K most similar chunks
```

### 5. Incremental Updates
```
File Change Detected → Calculate SHA-256 Hash
                            ↓
                  Compare with stored hash
                            ↓
            If different → Re-chunk → Re-embed → Update DB
```

## Architecture

### Embedding Service Components

| Component | Purpose | Key Files |
|-----------|---------|-----------|
| **Watcher** | Monitor file changes | `src/embedding-service/watcher.ts` |
| **Chunker** | Parse and chunk XML | `src/embedding-service/chunker.ts` |
| **Embedder** | Generate embeddings | `src/embedding-service/embedder.ts` |
| **Pipeline** | Orchestrate workflow | `src/embedding-service/pipeline.ts` |
| **Database** | Store and query | `src/db/sqlite.ts` |
| **Retrieval** | Search interface | `src/retrieval/code_retrieve.ts` |

### Data Flow

```
┌─────────────┐
│  XML Files  │
└──────┬──────┘
       │
       ▼
┌─────────────┐      ┌──────────────┐
│   Watcher   │─────▶│   Pipeline   │
└─────────────┘      └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │ Chunker  │  │ Embedder │  │ Database │
       └──────────┘  └──────────┘  └──────────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │   Retrieval  │
                                   └──────────────┘
```

## Configuration

Edit `embedding-service/src/config/paths.ts`:

```typescript
export const config = {
  pollIntervalMs: 10000,        // Check for changes every 10 seconds
  projectFolders: [
    'BankIntegration',
    'Hotelintegration'
  ],
  dbPath: './data/embeddings.db',
  modelPath: './models/model_quantized.onnx'
};
```

## Database Schema

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  parent_chunk_id INTEGER,
  embedding BLOB NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX idx_file_hash ON chunks(file_hash);
CREATE INDEX idx_chunk_type ON chunks(chunk_type);
CREATE INDEX idx_parent_chunk_id ON chunks(parent_chunk_id);
```

## Sample Projects

### BankIntegration
WSO2 MI integration for banking operations:
- Currency conversion API
- Deposit/withdrawal endpoints
- Local entry for currency converter configuration

### Hotelintegration
WSO2 MI integration for hotel booking system:
- CRUD operations for bookings
- Error handling sequences
- RESTful API design

## Advanced Usage

### Stop the Service

**If running in terminal:**
```bash
Ctrl+C
```

**If running in background:**
```bash
pkill -f "embedding-service/index.ts"
```

### Restart the Service
```bash
pkill -f "embedding-service/index.ts"
sleep 2
cd embedding-service
npm run dev
```

### Reset Database
```bash
cd embedding-service
rm -f data/embeddings.db
npm run dev  # Will re-index everything
```

### View Database Contents
```bash
cd embedding-service
sqlite3 data/embeddings.db

# List all chunks
SELECT file_path, chunk_type, resource_name, start_line, end_line 
FROM chunks 
LIMIT 10;

# Count chunks by type
SELECT chunk_type, COUNT(*) 
FROM chunks 
GROUP BY chunk_type;
```

## Troubleshooting

### Service won't start
- Check if Node.js 18+ is installed: `node --version`
- Verify model files exist: `ls models/sentence-transformers/all-MiniLM-L6-v2/onnx/`
- Check for port conflicts or running instances: `ps aux | grep embedding-service`

### No search results
- Ensure the service has completed initial indexing (wait ~30 seconds)
- Check database exists: `ls -la data/embeddings.db`
- Verify XML files exist in BankIntegration/Hotelintegration folders

### Duplicate search results
- This issue has been fixed in the latest version
- If you still see duplicates, delete the database and re-index:
  ```bash
  rm -f data/embeddings.db
  npm run dev
  ```

### Model loading errors
- Ensure all model files are in the correct directory structure
- The path should be: `models/sentence-transformers/all-MiniLM-L6-v2/onnx/model_quantized.onnx`

## Performance

- **Initial indexing**: ~30-60 seconds for 9 XML files
- **Incremental updates**: ~1-5 seconds per modified file
- **Search latency**: ~100-500ms per query
- **Database size**: ~2-5 MB for typical projects
- **Memory usage**: ~200-400 MB (mostly ONNX model)

## Technology Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.3+
- **ML Framework**: @xenova/transformers (ONNX Runtime)
- **Model**: sentence-transformers/all-MiniLM-L6-v2 (quantized)
- **Database**: better-sqlite3
- **XML Parser**: fast-xml-parser
- **Embedding Dimension**: 384
- **Similarity Metric**: Cosine similarity

## Documentation

- **Embedding Service**: [embedding-service/README.md](embedding-service/README.md)
- **Quick Start Guide**: [embedding-service/QUICKSTART.md](embedding-service/QUICKSTART.md)
- **Architecture Details**: [embedding-service/ARCHITECTURE.md](embedding-service/ARCHITECTURE.md)

## Contributing

When adding new WSO2 MI projects to monitor:

1. Place the project folder in `Code_retrieval/`
2. Update `embedding-service/src/config/paths.ts`:
   ```typescript
   projectFolders: [
     'BankIntegration',
     'Hotelintegration',
     'YourNewProject'  // Add here
   ]
   ```
3. Restart the embedding service

## License

MIT

## Author

Built for semantic code search across WSO2 Micro Integrator projects.

---

**Need Help?** Check the detailed documentation in [embedding-service/README.md](embedding-service/README.md)
