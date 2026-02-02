# CRITICAL ANALYSIS: Cross-File Sequence References

## Problem Statement

The current implementation has **3 critical gaps**:

### 1. ❌ Standalone Sequence Files NOT Chunked

**Example:**
```xml
<!-- HotelBookingAPI.xml -->
<sequence key="CreateBookingSequence"/>  <!-- Reference -->

<!-- sequences/CreateBookingSequence.xml -->
<sequence name="CreateBookingSequence">  <!-- Definition -->
  <payloadFactory>...</payloadFactory>
  <respond/>
</sequence>
```

**Current Behavior:**
- ✅ API file is chunked and embedded
- ❌ Sequence file is **NOT** chunked (only scanned, not processed semantically)
- ❌ No link between reference and definition

**Impact:**
- Search for "create booking logic" won't find the actual sequence implementation
- Embeddings are incomplete (missing reusable sequences)

### 2. ❌ Cross-File Relationships NOT Tracked

**Current Schema:**
```sql
parent_chunk_id INTEGER  -- Only tracks parent within SAME file
```

**Missing:**
- No `referenced_sequence` column
- No `defines_sequence` column  
- No `sequence_key_to_file_mapping` table

**Impact:**
- Cannot trace from API → Sequence definition
- Cannot find "which APIs use this sequence?"
- Merkle tree doesn't capture cross-file dependencies

### 3. ⚠️ Retrieval Doesn't Use Relationships

**Current Retrieval:**
```typescript
async search(query: string) {
  const embedding = await embed(query);
  return cosineSimilarity(embedding, allChunks);  // Flat search
}
```

**Missing:**
- No semantic type filtering
- No relationship traversal (follow sequence references)
- No context-aware ranking

---

## Solution: Enhanced Cross-File Tracking

### Phase 1: Extend Chunker to Process Sequence Files

**File:** `src/embedding-service/chunker.ts`

**Changes:**
1. Detect `<sequence key="..."/>` references in APIs
2. Process standalone sequence files in `sequences/` folder
3. Link references to definitions via `sequence_key` metadata

### Phase 2: Extend Database Schema

**File:** `src/db/schema.sql`

**Add columns:**
```sql
ALTER TABLE chunks ADD COLUMN sequence_key TEXT;           -- "CreateBookingSequence"
ALTER TABLE chunks ADD COLUMN is_sequence_definition BOOLEAN DEFAULT 0;
ALTER TABLE chunks ADD COLUMN referenced_sequences TEXT;   -- JSON array of keys
```

**Add table:**
```sql
CREATE TABLE sequence_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_chunk_id INTEGER NOT NULL,      -- API chunk that calls sequence
  callee_chunk_id INTEGER NOT NULL,      -- Sequence definition chunk
  sequence_key TEXT NOT NULL,
  FOREIGN KEY (caller_chunk_id) REFERENCES chunks(id),
  FOREIGN KEY (callee_chunk_id) REFERENCES chunks(id)
);
```

### Phase 3: Enhance Retrieval with Relationship Traversal

**File:** `src/retrieval/code_retrieve.ts`

**Add methods:**
```typescript
async searchWithContext(query: string) {
  const results = await search(query);
  
  // For each result, expand with related sequences
  for (const result of results) {
    if (result.referencedSequences) {
      result.relatedChunks = await findSequenceDefinitions(result.referencedSequences);
    }
  }
  
  return results;
}
```

---

## Immediate Actions Required

### ✅ What Works Now

1. **Auto-Update:** Changes to ANY XML file trigger re-processing (10s poll)
2. **Incremental Embedding:** Only changed chunks re-embedded
3. **Merkle Tree:** Detects content changes efficiently
4. **Basic Retrieval:** Semantic search via cosine similarity

### ❌ What's Missing

1. **Sequence File Processing:** Standalone sequences NOT chunked
2. **Cross-File Links:** No relationship tracking
3. **Smart Retrieval:** No context-aware search

### 🔧 Fix Priority

**HIGH (Critical):**
- [ ] Process standalone sequence files
- [ ] Track sequence references (caller → callee)
- [ ] Update Merkle tree to include cross-file dependencies

**MEDIUM (Important):**
- [ ] Enhanced retrieval with relationship traversal
- [ ] Semantic type filtering in search

**LOW (Nice-to-have):**
- [ ] Visualize sequence call graph
- [ ] Dead sequence detection (unreferenced sequences)

---

## Implementation Plan

I will now implement the fix in 3 steps:

1. **Extend Chunker:** Detect and resolve sequence references
2. **Update Schema:** Add relationship tracking
3. **Enhance Retrieval:** Use relationships in search

Estimated Time: 30 minutes

**Proceed with implementation?**
