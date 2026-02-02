# Embedding Service

Background service for generating and managing code embeddings from WSO2 MI XML configuration files with semantic chunking and cross-artifact tracking.

## Features

- **Semantic XML Chunking**: Chunks at semantic boundaries (resource, inSequence, filter, switch, sequence, payloadFactory)
- **Merkle Tree Change Detection**: SHA-256 content hashing for efficient incremental updates (80-95% embedding reuse)
- **Cross-Artifact Tracking**: Automatically tracks references between sequences, local-entries, endpoints, and templates
- **Periodic Watching**: Monitors file changes every 10 seconds
- **SQLite Storage**: Stores embeddings with rich metadata (semantic type, intent, context, references)
- **ONNX Runtime**: Uses all-MiniLM-L6-v2 model (384 dimensions)
- **Semantic Search**: CLI tool for querying with similarity scoring

## Architecture

```
src/
├── embedding-service/       # Core embedding daemon
│   ├── index.ts            # Entry point & service lifecycle
│   ├── watcher.ts          # File system monitoring
│   ├── chunker.ts          # Semantic XML chunking
│   ├── embedder.ts         # ONNX model interface
│   └── pipeline.ts         # Orchestration with Merkle tree
├── retrieval/              # Search functionality
│   ├── code_retrieve_enhanced.ts  # Advanced search with relationships
│   └── search.ts           # CLI search interface
└── db/                     # Database layer
    ├── sqlite.ts           # SQLite operations
    ├── schema.sql          # Database schema
    └── merkle.ts           # Merkle tree implementation
```

## Setup

### Prerequisites

- Node.js 18+
- TypeScript 5+
- ONNX model: `models/model_quantized.onnx` (all-MiniLM-L6-v2)

### Installation

```bash
npm install
```

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
2. Process all XML files on first run (chunks at semantic boundaries)
3. Track cross-artifact references (sequences, local-entries, endpoints, templates)
4. Watch for changes every 10 seconds
5. Update only modified chunks (Merkle tree detects changes)

### Search Code

```bash
# Find hotel booking creation logic
npm run search "create hotel booking"

# Find error handling patterns
npm run search "error handling"

# Find currency conversion
npm run search "currency conversion"
```

Results show:
- **Similarity Score** (0-1, higher = more relevant)
- **File Path** and **Line Numbers**
- **Semantic Type** (resource, mediator, sequence, filter, payloadFactory)
- **Semantic Intent** (processing, validation, transformation, delegation, error-handling)
- **Context** (API name, resource path, sequence name)
- **References** (related sequences, local-entries, endpoints, templates)
- **XML Preview**

Example output:
```
🔍 Searching for: "create hotel booking"

1. [Score: 0.5183]
   📄 File: .../CreateBookingSequence.xml
   📍 Lines: 3-5
   🏷️  Type: mediator | Intent: processing
   🔗 Context: {"api":"HTTP_SC"}
   📋 XML Preview:
   <log category="INFO">
       <message>Creating booking for ${vars.guestName}</message>
   </log>
```

## Database Schema

### chunks table

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| file_path | TEXT | Full file path |
| resource_name | TEXT | Name of the resource |
| chunk_type | TEXT | Type of chunk |
| start_line | INTEGER | Starting line number |
| end_line | INTEGER | Ending line number |
| parent_chunk_id | INTEGER | Foreign key to parent chunk |
| embedding | BLOB | Float32Array (384 dimensions) |
| **content_hash** | TEXT | SHA-256 for change detection |
| **semantic_type** | TEXT | filter \| payloadFactory \| sequence \| resource |
| **semantic_intent** | TEXT | validation \| transformation \| delegation \| response |
| **context_json** | TEXT | {api, method, uri, resource, sequence} |
| **sequence_key** | TEXT | Artifact name if definition |
| **is_sequence_definition** | INTEGER | 1 if standalone artifact |
| **referenced_sequences** | TEXT | JSON array of referenced artifacts |

### sequence_references table

Tracks caller → callee relationships:
- `caller_chunk_id`: Chunk that references artifact
- `callee_chunk_id`: Referenced artifact definition
- `sequence_key`: Name of referenced artifact

## Chunking Strategy

Semantic boundaries:
- **resource**: API resources (`/bookings`, `/balance/{id}`)
- **inSequence**: Request processing flow
- **filter**: Conditional logic (switch/case)
- **sequence**: Reusable sequence definitions
- **payloadFactory**: Response transformations
- **respond**: Terminal response actions

Each chunk maintains parent references for hierarchical navigation.

## Configuration

Edit inline constants in `src/embedding-service/index.ts`:
- `pollIntervalMs`: 10000 (10 seconds)
- `projectFolders`: ['BankIntegration', 'Hotelintegration']
- `artifactsSubPath`: 'src/main/wso2mi/artifacts'

## Development

```bash
# Build TypeScript
npm run build

# Run tests (after implementing)
npm test

# Development mode with auto-reload
npm run dev
```
- Graph traversal queries

## License

MIT

## Methods

- `start(workspacePath, dbPath)` - Initialize service
- `indexWorkspace()` - Index all XML files
- `indexFile(filePath)` - Index single file
- `searchSimilar(query, topK)` - Search similar chunks
- `stop()` - Cleanup resources
