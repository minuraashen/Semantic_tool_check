# Embedding Service

Background service for generating and managing code embeddings from WSO2 MI XML configuration files.

## Features

- **Hierarchical XML Chunking**: Recursively chunks XML files by resources, sequences, and mediators
- **Graph-based Structure**: Maintains parent-child relationships between chunks
- **Incremental Updates**: Only re-processes modified chunks, not entire files
- **Periodic Watching**: Monitors file changes every 10 seconds (configurable)
- **Hash-based Change Detection**: Uses SHA-256 hashing to detect content changes
- **SQLite Storage**: Stores embeddings and metadata without raw XML content
- **ONNX Runtime**: Uses all-MiniLM-L6-v2 model for embedding generation
- **Semantic Search**: CLI tool for querying the embedding database

## Architecture

```
src/
├── embedding-service/       # Core embedding daemon
│   ├── index.ts            # Entry point & service lifecycle
│   ├── watcher.ts          # File system monitoring
│   ├── chunker.ts          # Hierarchical XML chunking
│   ├── embedder.ts         # ONNX model interface
│   └── pipeline.ts         # Orchestration logic
├── retrieval/              # Search functionality
│   └── code_retrieve.ts    # Semantic search CLI
├── db/                     # Database layer
│   ├── sqlite.ts           # SQLite operations
│   └── schema.sql          # Database schema
├── config/                 # Configuration
│   └── paths.ts            # Paths & settings
└── utils/                  # Utilities
    └── hash.ts             # Content hashing
```

## Setup

### Prerequisites

- Node.js 18+
- TypeScript 5+
- ONNX model file: `models/model_quantized.onnx`

### Installation

```bash
npm install
```

### Configuration

Edit `src/config/paths.ts` to customize:

- `pollIntervalMs`: Polling interval (default: 10000ms)
- `projectFolders`: Folders to watch (default: BankIntegration, Hotelintegration)
- `dbPath`: SQLite database location
- `modelPath`: ONNX model location

## Usage

### Start the Service

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm run build
npm start
```

The service will:
1. Initialize the ONNX model and database
2. Process all XML files on first run
3. Watch for changes every 10 seconds
4. Update only modified chunks incrementally

### Search Code

```bash
npm run search:dev "hotel booking creation"
```

Or after building:
```bash
npm run search "error handling in API"
```

## Database Schema

### chunks table

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| file_path | TEXT | Full file path |
| file_hash | TEXT | SHA-256 hash of file content |
| resource_name | TEXT | Name of the resource (API, sequence, etc.) |
| resource_type | TEXT | Type of resource (api, sequence, proxy, etc.) |
| chunk_type | TEXT | Type of chunk (resource, inSequence, log, etc.) |
| chunk_index | INTEGER | Sequential chunk number |
| start_line | INTEGER | Starting line number |
| end_line | INTEGER | Ending line number |
| parent_chunk_id | INTEGER | Foreign key to parent chunk |
| embedding | BLOB | Float32Array embedding vector (384 dimensions) |
| timestamp | INTEGER | Last update timestamp |

### Example Chunk Table (First 10 chunks)
id  resource_name   resource_type  chunk_type      start_line  end_line  parent_chunk_id
--  --------------  -------------  --------------  ----------  --------  ---------------
1   api             api            api             2           150                      
2   resource        resource       resource        3           12        1              
3   inSequence      api            inSequence      4           9         2              
4   payloadFactory  api            payloadFactory  5           7         3              
5   respond         api            respond         1           1         3              
6   faultSequence   api            faultSequence   10          11        2              
7   resource        resource       resource        14          60        1              
8   amountInUSD     api            inSequence      15          47        7              
9   variable        api            variable        16          16        8              
10  variable        api            variable        17          17        8              

## Chunking Strategy

The service creates a hierarchical chunk graph:

1. **Resource Level**: APIs, proxies, sequences, endpoints
2. **Sequence Level**: inSequence, outSequence, faultSequence
3. **Mediator Level**: log, payloadFactory, filter, respond, etc.

Each chunk maintains a reference to its parent, enabling:
- Context-aware retrieval
- Hierarchical navigation
- Graph traversal queries

## License

MIT

## Methods

- `start(workspacePath, dbPath)` - Initialize service
- `indexWorkspace()` - Index all XML files
- `indexFile(filePath)` - Index single file
- `searchSimilar(query, topK)` - Search similar chunks
- `stop()` - Cleanup resources
