# WSO2 MI Artifact Schema Extensions

## Overview
This document describes the schema extensions made to support all WSO2 MI 4.5.0 artifact types based on the official documentation at https://mi.docs.wso2.com/en/latest/.

## Previously Supported Artifacts (v1.0)
- ✅ REST APIs
- ✅ Sequences (reusable)
- ✅ Local Entries
- ✅ Endpoints
- ✅ Templates (Endpoint & Sequence)
- ⚠️ Inbound Endpoints (partial support)

## Newly Added Artifacts (v2.0)

### 1. **Proxy Services** (`proxyService`)
Alternative to REST APIs for SOAP/WS-* services.

**Context Structure:**
```typescript
proxyService?: {
  name?: string;        // Proxy service name
  transports?: string;  // "http https jms" etc.
  xmlns?: string;       // XML namespace
}
```

**File Path Detection:** `/proxy-services/`

**Example:**
```xml
<proxy name="StockQuoteProxy" transports="https http" xmlns="http://ws.apache.org/ns/synapse">
  <target>
    <inSequence>...</inSequence>
  </target>
</proxy>
```

**Context JSON:**
```json
{
  "proxyService": {
    "name": "StockQuoteProxy",
    "transports": "https http",
    "xmlns": "http://ws.apache.org/ns/synapse"
  }
}
```

---

### 2. **Message Stores** (`messageStore`)
Temporary storage for asynchronous message processing (7 types).

**Context Structure:**
```typescript
messageStore?: {
  name?: string;   // Message store name
  type?: string;   // "jms" | "jdbc" | "rabbitmq" | "resequence" | "wso2mb" | "in-memory" | "custom"
  xmlns?: string;
}
```

**File Path Detection:** `/message-stores/`

**Type Detection Logic:**
- Class contains `JmsStore` → `type: "jms"`
- Class contains `JDBCMessageStore` → `type: "jdbc"`
- Class contains `RabbitMQStore` → `type: "rabbitmq"`
- Class contains `ResequenceMessageStore` → `type: "resequence"`
- Class contains `WSO2MBMessageStore` → `type: "wso2mb"`
- Class contains `InMemoryMessageStore` → `type: "in-memory"`
- Otherwise → `type: "custom"`

**Example:**
```xml
<messageStore name="MyJMSStore" 
              class="org.apache.synapse.message.store.impl.jms.JmsStore" 
              xmlns="http://ws.apache.org/ns/synapse">
  <parameter name="java.naming.factory.initial">...</parameter>
</messageStore>
```

**Context JSON:**
```json
{
  "messageStore": {
    "name": "MyJMSStore",
    "type": "jms",
    "xmlns": "http://ws.apache.org/ns/synapse"
  }
}
```

---

### 3. **Message Processors** (`messageProcessor`)
Process messages from message stores (3 types).

**Context Structure:**
```typescript
messageProcessor?: {
  name?: string;           // Processor name
  type?: string;           // "sampling" | "scheduled-forwarding" | "scheduled-failover-forwarding"
  messageStore?: string;   // Reference to message store name
  xmlns?: string;
}
```

**File Path Detection:** `/message-processors/`

**Type Detection Logic:**
- Class contains `MessageSamplingProcessor` → `type: "sampling"`
- Class contains `ScheduledMessageForwardingProcessor` → `type: "scheduled-forwarding"`
- Class contains `ScheduledFailoverMessageForwardingProcessor` → `type: "scheduled-failover-forwarding"`
- Otherwise → `type: "custom"`

**Message Store Reference Extraction:**
Looks for parameter with `name="message.store"` in XML.

**Example:**
```xml
<messageProcessor name="MyForwardingProcessor"
                  class="org.apache.synapse.message.processor.impl.forwarder.ScheduledMessageForwardingProcessor"
                  xmlns="http://ws.apache.org/ns/synapse">
  <parameter name="message.store">MyJMSStore</parameter>
  <parameter name="endpoint">MyEndpoint</parameter>
</messageProcessor>
```

**Context JSON:**
```json
{
  "messageProcessor": {
    "name": "MyForwardingProcessor",
    "type": "scheduled-forwarding",
    "messageStore": "MyJMSStore",
    "xmlns": "http://ws.apache.org/ns/synapse"
  }
}
```

---

### 4. **Data Services** (`dataService`)
Expose datasources as web services (SOAP/REST).

**Context Structure:**
```typescript
dataService?: {
  name?: string;                   // Data service name
  enableBatchRequests?: boolean;   // Batch request support
  xmlns?: string;
}
```

**File Path Detection:** `/data-services/`

**Root Element:** `<data>`

**Example:**
```xml
<data name="EmployeeDataService" enableBatchRequests="true" xmlns="http://ws.wso2.org/dataservice">
  <config id="default">
    <property name="driverClassName">com.mysql.jdbc.Driver</property>
  </config>
  <query id="GetEmployees" useConfig="default">...</query>
</data>
```

**Context JSON:**
```json
{
  "dataService": {
    "name": "EmployeeDataService",
    "enableBatchRequests": true,
    "xmlns": "http://ws.wso2.org/dataservice"
  }
}
```

---

### 5. **Tasks** (`task`)
Scheduled job execution.

**Context Structure:**
```typescript
task?: {
  name?: string;      // Task name
  trigger?: string;   // "simple" | "defined" (cron)
  xmlns?: string;
}
```

**File Path Detection:** `/tasks/`

**Trigger Detection:**
- If `<trigger>` element exists → `trigger: "defined"`
- Otherwise → `trigger: "simple"`

**Example:**
```xml
<task name="MyScheduledTask" class="org.apache.synapse.startup.tasks.MessageInjector" 
      xmlns="http://ws.apache.org/ns/synapse">
  <trigger interval="5000"/>
  <property name="message" value="..."/>
</task>
```

**Context JSON:**
```json
{
  "task": {
    "name": "MyScheduledTask",
    "trigger": "defined",
    "xmlns": "http://ws.apache.org/ns/synapse"
  }
}
```

---

## Artifacts NOT Requiring Schema Changes

### 1. **Mediators**
Already handled implicitly through chunking. Mediators are chunked as part of sequences/APIs/proxies. No dedicated context field needed since they're always child elements.

**Examples:** Filter, Switch, Log, PayloadFactory, Enrich, Call, Send, etc.

### 2. **Connectors**
Already tracked via `references` array. Connector operations appear as mediators within sequences.

**Example:**
```xml
<gmail.sendEmail>
  <to>user@example.com</to>
</gmail.sendEmail>
```

This is already chunked and tracked in the `references` array.

### 3. **Data Sources**
Configuration files (YAML/XML) that define database connections. These are referenced by Data Services but don't need separate context since they're configuration, not integration logic.

---

## Files Modified

### 1. `src/embedding-service/chunker.ts`
- **SemanticContext interface** (Lines 60-135): Added 5 new optional fields
- **XMLChunk interface** (Lines 16-59): Added 5 new optional context fields
- **extractArtifactMetadata()** (Lines 236-354): Added detection logic for 5 new artifact types
- **chunkFile()** (Lines 187-256): Extended standalone artifact detection to include new types

### 2. `src/db/merkle.ts`
- **MerkleLeaf interface** (Lines 12-63): Added 5 new optional context fields
- **buildMerkleTree()** (Lines 93-109): Extended grouping logic to handle new artifact types

### 3. `src/db/sqlite.ts`
- **ChunkMetadata interface** (Lines 3-65): Added 5 new optional context fields

---

## Backward Compatibility

✅ **Fully backward compatible** with existing chunks:
- All new fields are **optional** (`?`)
- Existing 34 chunks remain unchanged
- Search functionality unaffected
- Merkle tree continues working with old and new artifacts

---

## Testing Recommendations

### 1. **Create Sample Artifacts**
Create sample files for each new artifact type:
- `BankIntegration/src/main/wso2mi/artifacts/proxy-services/StockQuoteProxy.xml`
- `BankIntegration/src/main/wso2mi/artifacts/message-stores/MyJMSStore.xml`
- `BankIntegration/src/main/wso2mi/artifacts/message-processors/MyForwardingProcessor.xml`
- `BankIntegration/src/main/wso2mi/artifacts/data-services/EmployeeDataService.dbs`
- `BankIntegration/src/main/wso2mi/artifacts/tasks/MyScheduledTask.xml`

### 2. **Run Chunking**
```bash
cd embedding-service
npm run build
npm start
```

### 3. **Verify Context Structure**
```bash
npm run search "message store"
npm run search "proxy service"
npm run search "data service"
npm run search "scheduled task"
```

### 4. **Check Database**
```bash
sqlite3 data/embeddings.db
SELECT context_json FROM chunks WHERE context_json LIKE '%proxyService%';
SELECT context_json FROM chunks WHERE context_json LIKE '%messageStore%';
SELECT context_json FROM chunks WHERE context_json LIKE '%messageProcessor%';
SELECT context_json FROM chunks WHERE context_json LIKE '%dataService%';
SELECT context_json FROM chunks WHERE context_json LIKE '%task%';
```

---

## Summary of Changes

### What Changed?
Extended schema to support 5 additional WSO2 MI artifact types:
1. Proxy Services (SOAP alternative to REST APIs)
2. Message Stores (async message storage - 7 types)
3. Message Processors (async message delivery - 3 types)
4. Data Services (database-to-service exposure)
5. Tasks (scheduled job execution)

### What Didn't Change?
- **Architecture:** Same exclusive top-down chunking, Merkle tree, embedding pipeline
- **Token limits:** Still 300 tokens per chunk max
- **Embedding model:** Still all-MiniLM-L6-v2
- **Search functionality:** Still semantic search with similarity scores
- **Existing chunks:** All 34 existing chunks remain valid

### Why These Changes?
Based on WSO2 MI 4.5.0 official documentation review, these are the major artifact types commonly used in real-world integration projects that were missing from the schema.

### What's Still Not Covered?
- **Inbound Endpoints:** Partially supported, could be extended with type-specific fields (HTTP, JMS, Kafka, etc.)
- **Custom Artifacts:** Custom mediators, handlers - likely don't need schema changes
- **Registry Resources:** Configuration files - may not need semantic chunking

---

## Next Steps

1. ✅ **Schema extended** - Interfaces updated in chunker.ts, merkle.ts, sqlite.ts
2. ✅ **Build verified** - TypeScript compilation successful
3. ⏳ **Testing needed** - Create sample artifacts and run pipeline
4. ⏳ **Validation** - Verify context_json structure in database
5. ⏳ **Documentation** - Update README.md with new artifact types

---

## Additional Improvements for Generalization

Beyond artifact type coverage, consider these enhancements:

### 1. **Connector Metadata**
Track connector package and version in context:
```typescript
connector?: {
  name?: string;      // "gmail"
  operation?: string; // "sendEmail"
  package?: string;   // "org.wso2.carbon.connector"
}
```

### 2. **Mediator Context**
For complex mediators (Filter, Switch), track conditions:
```typescript
mediator?: {
  type?: string;      // "filter" | "switch" | "iterate"
  condition?: string; // XPath or JSONPath expression
}
```

### 3. **Resource-Level Operations**
Track data service operations:
```typescript
operation?: {
  name?: string;      // "getEmployee"
  type?: string;      // "query" | "insert" | "update" | "delete"
}
```

### 4. **Cross-Artifact Dependency Graph**
Build a graph of artifact dependencies:
- Message Processor → Message Store
- Proxy Service → Endpoint
- API Resource → Sequence → Local Entry

### 5. **Performance Optimizations**
- **Batch embedding:** Embed multiple chunks in one API call
- **Caching:** Cache frequently accessed embeddings
- **Parallel processing:** Process multiple files concurrently
- **Incremental updates:** Only re-embed changed chunks (already implemented via Merkle tree)

---

## References

- **WSO2 MI Documentation:** https://mi.docs.wso2.com/en/latest/
- **Integration Artifacts Overview:** https://mi.docs.wso2.com/en/latest/develop/creating-artifacts/creating-artifacts-overview/
- **Proxy Services:** https://mi.docs.wso2.com/en/latest/develop/creating-artifacts/creating-a-proxy-service/
- **Message Stores:** https://mi.docs.wso2.com/en/latest/develop/creating-artifacts/creating-a-message-store/
- **Message Processors:** https://mi.docs.wso2.com/en/latest/develop/creating-artifacts/creating-a-message-processor/
- **Data Services:** https://mi.docs.wso2.com/en/latest/develop/creating-artifacts/data-services/creating-data-services/
- **Tasks:** https://mi.docs.wso2.com/en/latest/develop/creating-artifacts/creating-scheduled-task/
