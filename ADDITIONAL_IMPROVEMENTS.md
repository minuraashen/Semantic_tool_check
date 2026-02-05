# Additional Improvements for Generalization & Efficiency

Beyond the artifact type coverage completed above, here are recommended improvements to make the code retrieval system more general and efficient.

---

## 1. 🎯 Connector Metadata Enhancement

**Current State:** Connectors are tracked via `references` array as strings like `"gmail.sendEmail"`.

**Improvement:** Add dedicated connector context with package and version tracking.

### Proposed Schema Extension
```typescript
interface SemanticContext {
  // ... existing fields
  connector?: {
    name?: string;         // "gmail" | "salesforce" | "kafka"
    operation?: string;    // "sendEmail" | "query" | "publish"
    package?: string;      // "org.wso2.carbon.connector"
    version?: string;      // "1.0.5"
  };
}
```

### Detection Logic
```typescript
// Detect connector operations in XML
private detectConnectorOperation(tagName: string): { name: string; operation: string } | null {
  // Pattern: <gmail.sendEmail> or <salesforce.query>
  const match = tagName.match(/^([a-z0-9]+)\.([a-zA-Z]+)$/);
  if (match) {
    return { name: match[1], operation: match[2] };
  }
  return null;
}
```

### Benefits
- ✅ Better search for connector-specific integrations
- ✅ Track connector usage statistics
- ✅ Version compatibility checking
- ✅ Generate connector dependency reports

---

## 2. 🔍 Mediator Context Enhancement

**Current State:** Mediators are chunked but have minimal context metadata.

**Improvement:** Add mediator-specific metadata (type, conditions, transformations).

### Proposed Schema Extension
```typescript
interface SemanticContext {
  // ... existing fields
  mediator?: {
    type?: string;          // "filter" | "switch" | "iterate" | "foreach" | "aggregate"
    condition?: string;     // XPath or JSONPath expression
    transformation?: string; // For PayloadFactory, DataMapper
    target?: string;        // For Enrich, Clone
  };
}
```

### Detection Logic
```typescript
private extractMediatorMetadata(tagName: string, attrs: any, content: string): MediatorMetadata | null {
  switch (tagName) {
    case 'filter':
      return {
        type: 'filter',
        condition: attrs?.xpath || attrs?.source,
        target: attrs?.regex
      };
    case 'switch':
      return {
        type: 'switch',
        condition: attrs?.source,
        target: 'case-analysis'
      };
    case 'payloadFactory':
      return {
        type: 'payloadFactory',
        transformation: 'template',
        target: attrs?.media_type || 'xml'
      };
    case 'iterate':
    case 'foreach':
      return {
        type: tagName,
        condition: attrs?.expression,
        target: attrs?.sequential === 'true' ? 'sequential' : 'parallel'
      };
    default:
      return null;
  }
}
```

### Benefits
- ✅ Search by mediator type ("find all filter mediators")
- ✅ Analyze conditional logic patterns
- ✅ Track transformation complexity
- ✅ Identify performance bottlenecks (iterate vs foreach)

---

## 3. 📊 Data Service Operation Context

**Current State:** Data services are chunked but operations (queries) lack metadata.

**Improvement:** Track data service operations (queries, updates, deletes).

### Proposed Schema Extension
```typescript
interface SemanticContext {
  // ... existing fields
  operation?: {
    name?: string;           // "getEmployee" | "insertOrder"
    type?: string;           // "query" | "insert" | "update" | "delete"
    datasource?: string;     // "MySQLDB" | "OracleDB"
    sql?: string;            // Actual SQL (truncated)
    hasInputMapping?: boolean;
    hasOutputMapping?: boolean;
  };
}
```

### Detection Logic
```typescript
private extractDataServiceOperation(queryNode: any): OperationMetadata {
  const attrs = queryNode[':@'];
  const sql = this.extractSQLFromQuery(queryNode);
  
  return {
    name: attrs?.id || 'unknown',
    type: this.detectQueryType(sql),  // SELECT → query, INSERT → insert, etc.
    datasource: attrs?.useConfig,
    sql: sql?.substring(0, 100),  // First 100 chars
    hasInputMapping: !!queryNode.param,
    hasOutputMapping: !!queryNode.result
  };
}
```

### Benefits
- ✅ Search for specific database operations
- ✅ Track CRUD operation distribution
- ✅ Identify complex SQL queries
- ✅ Analyze input/output mappings

---

## 4. 🔗 Dependency Graph Construction

**Current State:** References are tracked in flat array `["sequence:X", "localEntry:Y"]`.

**Improvement:** Build hierarchical dependency graph for visualization.

### Proposed Enhancement
```typescript
interface DependencyNode {
  artifact: string;           // "BankAPI"
  type: string;              // "api" | "sequence" | "localEntry"
  dependencies: DependencyNode[];
  dependents: DependencyNode[];
  depth: number;             // 0 = root, 1 = immediate child, etc.
}

class DependencyGraphBuilder {
  buildGraph(chunks: XMLChunk[]): DependencyNode {
    // 1. Extract all artifacts and their references
    // 2. Build bidirectional edges (X→Y and Y→X)
    // 3. Calculate depth (BFS from root)
    // 4. Return hierarchical tree
  }
  
  findCyclicDependencies(): string[][] {
    // Detect cycles (A→B→C→A)
  }
  
  findUnusedArtifacts(): string[] {
    // Find artifacts with no dependents
  }
}
```

### Use Cases
- 🔍 Impact analysis: "What breaks if I change this sequence?"
- 📊 Visualization: Generate Mermaid diagrams
- ⚠️ Cycle detection: Prevent infinite loops
- 🗑️ Dead code detection: Find unused artifacts

---

## 5. ⚡ Performance Optimizations

### A. Batch Embedding Generation
**Current State:** Embed one chunk at a time.

**Improvement:** Batch embed multiple chunks in single API call.

```typescript
async batchEmbed(chunks: XMLChunk[]): Promise<Float32Array[]> {
  const BATCH_SIZE = 32;
  const embeddings: Float32Array[] = [];
  
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchTexts = batch.map(c => c.embeddingText);
    
    // Single API call for batch
    const batchEmbeddings = await this.embedder.embedBatch(batchTexts);
    embeddings.push(...batchEmbeddings);
  }
  
  return embeddings;
}
```

**Benefit:** 10-30x faster embedding generation.

---

### B. Parallel File Processing
**Current State:** Process files sequentially.

**Improvement:** Process multiple files concurrently.

```typescript
async processDirectory(dirPath: string): Promise<void> {
  const files = await this.findXMLFiles(dirPath);
  
  // Process 4 files at a time
  const CONCURRENCY = 4;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(f => this.processFile(f)));
  }
}
```

**Benefit:** 3-4x faster directory processing.

---

### C. Embedding Cache
**Current State:** Re-embed unchanged chunks on every run (already mitigated by Merkle tree).

**Improvement:** Add in-memory LRU cache for frequently accessed embeddings.

```typescript
class EmbeddingCache {
  private cache = new Map<string, Float32Array>();
  private maxSize = 1000;
  
  get(contentHash: string): Float32Array | null {
    return this.cache.get(contentHash) || null;
  }
  
  set(contentHash: string, embedding: Float32Array): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(contentHash, embedding);
  }
}
```

**Benefit:** Instant retrieval for frequently searched chunks.

---

### D. Lazy Loading for Large Results
**Current State:** Load all search results into memory.

**Improvement:** Stream results incrementally.

```typescript
async *searchStream(query: string, topK: number = 5): AsyncGenerator<SearchResult> {
  const queryEmbedding = await this.embedder.embed(query);
  
  // Stream results from database
  const stmt = this.db.prepare(`
    SELECT id, context_json, embedding 
    FROM chunks 
    ORDER BY cosine_similarity(embedding, ?) DESC
    LIMIT ?
  `);
  
  for (const row of stmt.iterate(queryEmbedding, topK)) {
    yield {
      id: row.id,
      context: JSON.parse(row.context_json),
      similarity: this.cosineSimilarity(queryEmbedding, row.embedding)
    };
  }
}

// Usage
for await (const result of searcher.searchStream("bank deposit", 10)) {
  console.log(result);  // Process incrementally
}
```

**Benefit:** Constant memory usage regardless of result count.

---

## 6. 🧠 Semantic Enhancements

### A. Multi-Language Embeddings
**Current State:** English-only tokenizer.

**Improvement:** Support multilingual embeddings for international teams.

```typescript
// Use multilingual model
const model = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';

// Detect language in XML comments
const language = detectLanguage(xmlContent);  // "en" | "es" | "fr" | "de"
```

**Benefit:** Support non-English API documentation and comments.

---

### B. Code Clone Detection
**Improvement:** Find duplicate or similar integration patterns.

```typescript
async findSimilarChunks(chunkId: number, threshold: number = 0.9): Promise<ChunkRecord[]> {
  const chunk = await this.db.getChunk(chunkId);
  const results = await this.search(chunk.embeddingText, 50);
  
  // Filter by similarity threshold
  return results.filter(r => 
    r.id !== chunkId && 
    r.similarity >= threshold
  );
}
```

**Use Case:** Identify copy-pasted code for refactoring opportunities.

---

### C. Smart Chunking Based on Semantic Boundaries
**Current Improvement:** Already implemented (exclusive top-down chunking).

**Future Enhancement:** Use ML to predict optimal chunk boundaries.

```typescript
class SemanticChunkPredictor {
  // Train ML model on labeled chunks
  async predictBoundary(node: XMLNode): Promise<boolean> {
    const features = this.extractFeatures(node);  // Tag, depth, siblings, content
    return await this.model.predict(features) > 0.5;  // Should this be a chunk?
  }
}
```

**Benefit:** Better chunk granularity for complex mediators.

---

## 7. 📈 Analytics & Insights

### A. Integration Complexity Metrics
```typescript
interface ComplexityMetrics {
  totalArtifacts: number;
  artifactsByType: Record<string, number>;
  avgChunksPerArtifact: number;
  maxDependencyDepth: number;
  cyclicDependencies: number;
  unusedArtifacts: string[];
  topConnectors: Array<{ name: string; count: number }>;
}

async calculateMetrics(): Promise<ComplexityMetrics> {
  // Analyze entire codebase
}
```

**Use Case:** Generate integration health reports.

---

### B. Search Analytics
```typescript
interface SearchAnalytics {
  query: string;
  timestamp: number;
  resultCount: number;
  topResult: string;
  avgSimilarity: number;
  executionTime: number;
}

// Track search patterns
async logSearch(analytics: SearchAnalytics): Promise<void> {
  await this.db.insertSearchLog(analytics);
}

// Generate insights
async getMostSearchedPatterns(): Promise<string[]> {
  // What are users searching for most?
}
```

**Use Case:** Improve documentation based on search patterns.

---

## 8. 🔧 Developer Experience Improvements

### A. Interactive Search CLI
```bash
$ npm run search-interactive

🔍 WSO2 MI Code Retrieval
Enter search query (or 'quit' to exit): bank deposit

🎯 Found 5 results:
  1. BankAPI > POST /deposit > inSequence (similarity: 0.92)
  2. BankAPI > POST /deposit > log mediator (similarity: 0.87)
  ...

Enter result number to view details (or new query): 1

📄 Chunk #4 - BankAPI > POST /deposit > inSequence
📊 Similarity: 0.92
📍 Location: BankAPI.xml:45-62
🔗 References: localEntry:CurrencyConverter

<payloadFactory media-type="json">
  <format>{"status":"success"}</format>
</payloadFactory>

Press Enter to continue...
```

---

### B. VS Code Extension
```typescript
// Provide inline search directly in VS Code
vscode.commands.registerCommand('wso2-search', async () => {
  const query = await vscode.window.showInputBox({
    prompt: 'Search WSO2 MI integrations'
  });
  
  const results = await searcher.search(query);
  
  // Show results in Quick Pick
  const selected = await vscode.window.showQuickPick(
    results.map(r => ({
      label: r.context.api?.name || 'Unknown',
      description: `Similarity: ${r.similarity.toFixed(2)}`,
      detail: r.filePath
    }))
  );
  
  // Jump to file
  if (selected) {
    vscode.workspace.openTextDocument(selected.detail);
  }
});
```

---

### C. Web UI Dashboard
```typescript
// Express.js server for web interface
app.get('/search', async (req, res) => {
  const { q, limit = 10 } = req.query;
  const results = await searcher.search(q, limit);
  
  res.json({
    query: q,
    results: results.map(r => ({
      artifact: r.context.api?.name || r.context.sequence?.name,
      type: r.resourceType,
      similarity: r.similarity,
      snippet: r.content.substring(0, 200),
      path: r.filePath
    }))
  });
});
```

---

## 9. 🎨 Visualization Improvements

### A. Mermaid Diagram Generation
```typescript
function generateMermaidDiagram(api: string): string {
  const chunks = getChunksByAPI(api);
  
  let diagram = `graph TD\n`;
  diagram += `  API[${api}]\n`;
  
  for (const chunk of chunks) {
    const resource = chunk.context.resource;
    if (resource) {
      diagram += `  API --> R${chunk.id}["${resource.method} ${resource.uriTemplate}"]\n`;
      
      for (const ref of chunk.context.references || []) {
        diagram += `  R${chunk.id} --> ${ref}\n`;
      }
    }
  }
  
  return diagram;
}

// Output:
// graph TD
//   API[BankAPI]
//   API --> R1["POST /deposit"]
//   R1 --> localEntry:CurrencyConverter
//   API --> R2["GET /balance"]
```

---

### B. Force-Directed Graph
Use D3.js to visualize artifact dependencies:
```typescript
const graph = {
  nodes: [
    { id: 'BankAPI', type: 'api' },
    { id: 'CurrencyConverter', type: 'localEntry' },
    { id: 'CreateBookingSequence', type: 'sequence' }
  ],
  links: [
    { source: 'BankAPI', target: 'CurrencyConverter' },
    { source: 'BankAPI', target: 'CreateBookingSequence' }
  ]
};

// Render with D3.js force layout
```

---

## 10. 🔐 Security & Governance

### A. Sensitive Data Detection
```typescript
function detectSensitiveData(content: string): string[] {
  const patterns = {
    apiKey: /api[_-]?key["\s:=]+([a-zA-Z0-9]{32,})/i,
    password: /password["\s:=]+([^\s"<>]+)/i,
    token: /token["\s:=]+([a-zA-Z0-9._-]{20,})/i,
    creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/
  };
  
  const findings: string[] = [];
  for (const [type, regex] of Object.entries(patterns)) {
    if (regex.test(content)) {
      findings.push(type);
    }
  }
  
  return findings;
}

// Flag chunks with sensitive data
chunk.hasSensitiveData = detectSensitiveData(chunk.content).length > 0;
```

---

### B. Compliance Scanning
```typescript
interface ComplianceRule {
  id: string;
  description: string;
  check: (chunk: XMLChunk) => boolean;
  severity: 'error' | 'warning' | 'info';
}

const rules: ComplianceRule[] = [
  {
    id: 'NO_HARDCODED_URLS',
    description: 'Endpoints should use registry entries, not hardcoded URLs',
    check: (chunk) => /<address\s+uri=["']http/.test(chunk.content),
    severity: 'warning'
  },
  {
    id: 'REQUIRE_ERROR_HANDLING',
    description: 'All APIs must have fault sequences',
    check: (chunk) => chunk.context.api && !chunk.content.includes('faultSequence'),
    severity: 'error'
  }
];
```

---

## Summary of Improvements

### High Priority (Immediate Value)
1. ✅ **Artifact Type Coverage** (COMPLETED) - 5 new artifact types
2. ⏳ **Batch Embedding** - 10-30x performance boost
3. ⏳ **Parallel Processing** - 3-4x faster indexing
4. ⏳ **Dependency Graph** - Impact analysis & visualization

### Medium Priority (Nice to Have)
5. ⏳ **Connector Metadata** - Better connector tracking
6. ⏳ **Mediator Context** - Richer search capabilities
7. ⏳ **Interactive CLI** - Better developer experience
8. ⏳ **Embedding Cache** - Faster repeated searches

### Low Priority (Future Enhancements)
9. ⏳ **Multi-language Support** - International teams
10. ⏳ **Code Clone Detection** - Refactoring opportunities
11. ⏳ **ML-based Chunking** - Smarter boundaries
12. ⏳ **Security Scanning** - Compliance & governance

---

## Implementation Order

**Phase 1: Performance (Week 1-2)**
- Batch embedding generation
- Parallel file processing
- Embedding cache

**Phase 2: Enrichment (Week 3-4)**
- Dependency graph construction
- Connector metadata
- Mediator context

**Phase 3: UX (Week 5-6)**
- Interactive CLI
- Web dashboard
- VS Code extension

**Phase 4: Advanced (Week 7-8)**
- Code clone detection
- Security scanning
- Analytics dashboard

---

## Conclusion

The schema extensions completed above address the **critical gap** in artifact type coverage (54% → 100%). The improvements listed here provide a roadmap for making the system **more general, efficient, and developer-friendly** without changing the core architecture.

**Key Takeaway:** Start with performance optimizations (batch embedding, parallel processing) as they provide immediate value with minimal code changes.
