# Search Examples

The embedding service is now fully operational with semantic search capabilities. Here are examples of how to use it:

## Basic Usage

```bash
npm run search "your query here"
```

## Example Queries

### 1. Find Hotel Booking Creation Logic

```bash
npm run search "create hotel booking"
```

**Results:**
- ✅ **Score: 0.5183** - `CreateBookingSequence.xml` (Lines 3-5)
  - Type: mediator | Intent: processing
  - Found the exact log message for booking creation
  
- ✅ **Score: 0.4801** - `HotelBookingAPI.xml` (Lines 2-79) 
  - Type: resource | Intent: processing
  - References: CreateBookingSequence, ErrorHandlerSequence, etc.
  
- ✅ **Score: 0.4738** - `HotelBookingAPI.xml` POST /bookings resource
  - The actual API endpoint that handles booking creation

### 2. Find Error Handling Patterns

```bash
npm run search "error handling"
```

**Results:**
- ✅ **Score: 0.5025** - Multiple `faultSequence` blocks in HotelBookingAPI.xml
  - Type: sequence | Intent: error-handling
  - All reference `ErrorHandlerSequence`
  - Shows consistent error handling pattern across all resources

### 3. Find Currency Conversion Logic

```bash
npm run search "currency conversion"
```

**Results:**
- ✅ **Score: 0.5361** - `BankAPI.xml` deposit flow with currency conversion
  - References: `localEntry:CurrencyConverter`
  
- ✅ **Score: 0.5166** - HTTP POST to CurrencyConverter endpoint
  - Shows actual API call with payload structure
  
- ✅ **Score: 0.3541** - `CurrencyConverter.xml` local-entry definition
  - Base URL: https://dev-tools.wso2.com/gs/helpers/v1.0

## Key Features

### 1. **Semantic Understanding**
- Searches understand intent, not just keywords
- "create hotel booking" matches both API endpoints and sequence definitions
- Ranked by relevance using cosine similarity

### 2. **Cross-Artifact Tracking**
- Results show `📎 References:` for related artifacts
- Example: API resources reference sequences, local-entries, endpoints, templates
- Enables understanding of data flow across files

### 3. **Rich Metadata**
- **Semantic Type**: resource | mediator | sequence | filter | payloadFactory
- **Semantic Intent**: processing | validation | transformation | delegation | error-handling
- **Context**: API name, resource path, sequence name
- **Line Numbers**: Precise location in source file

### 4. **Auto-Updates**
- Service polls for changes every 10 seconds
- Only re-embeds modified chunks (Merkle tree optimization)
- Cross-artifact relationships automatically updated

## Search Output Format

```
🔍 Searching for: "your query"

Found 5 results:

1. [Score: 0.5183]
   📄 File: /path/to/file.xml
   📍 Lines: 3-5
   🏷️  Type: mediator | Intent: processing
   🔗 Context: {"api":"HTTP_SC"}
   📎 References: sequence:CreateBookingSequence
   📋 XML Preview:
   <log category="INFO">
       <message>Creating booking for ${vars.guestName}</message>
   </log>
```

## Advanced Usage (Future)

The codebase supports advanced retrieval modes (see `code_retrieve_enhanced.ts`):

1. **Context-Aware Search**: `searchWithContext()` - expands results with related artifacts
2. **Type Filtering**: `searchByType('filter')` - find specific mediator types
3. **Intent Filtering**: `searchByIntent('error-handling')` - find error handling logic
4. **Reverse Lookup**: `findApisUsingSequence('CreateBookingSequence')` - find callers

To use these, you can create custom search scripts or extend the existing `search.ts`.

## Troubleshooting

### Service Not Running

```bash
# Start the service in background
npm run dev
```

### Database Missing/Outdated

```bash
# Delete and recreate
rm -f data/embeddings.db
npm run dev
```

The service will automatically process all XML files and generate embeddings.

### No Results Found

- Check if files are in the watched directories:
  - `BankIntegration/src/main/wso2mi/artifacts`
  - `Hotelintegration/src/main/wso2mi/artifacts`
- Verify service has completed initial processing (look for "Initial processing completed")
- Try broader queries (e.g., "booking" instead of "create hotel booking reservation")

## Technical Details

- **Model**: all-MiniLM-L6-v2 (384-dimensional embeddings)
- **Database**: SQLite with 110 embeddings from 9 XML files
- **Chunking**: Semantic boundaries (resource, inSequence, filter, switch, sequence)
- **Update Frequency**: 10-second polling
- **Change Detection**: Merkle tree with SHA-256 content hashing
