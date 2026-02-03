import * as fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { computeChunkHash } from '../db/merkle';

/**
 * PHASE 2: Semantic, Hierarchical, Size-Aware XML Chunker
 * 
 * This chunker replaces token-agnostic splitting with semantic boundary detection.
 * Key improvements:
 * - Respects semantic boundaries (filter, switch, sequence, payloadFactory, etc.)
 * - Token-aware (≈300 token limit) but doesn't break semantic units
 * - Inherits context metadata (API name, method, URI, parent info)
 * - Allows overlapping for large atomic nodes
 */

export interface XMLChunk {
  filePath: string;
  resourceName: string;
  resourceType: string;
  chunkType: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  content: string;
  parentChunkId: number | null;
  embeddingText: string;
  // NEW: Semantic metadata for Merkle tree
  semanticType: string;   // filter | payloadFactory | sequence | resource | api
  semanticIntent: string; // validation | transformation | delegation | response
  contentHash: string;    // Hash of content + metadata
  context: {
    api: string;
    method?: string;
    uri?: string;
    resource?: string;
    sequence?: string;
  };
  // NEW: Cross-file sequence tracking
  sequenceKey?: string;              // "CreateBookingSequence" (if this IS a sequence definition)
  isSequenceDefinition?: boolean;    // true if standalone sequence file
  referencedSequences?: string[];    // ["CreateBookingSequence", "ErrorHandler"] (if this calls sequences)
}

interface LineRange {
  start: number;
  end: number;
}

interface SemanticContext {
  api: string;
  method?: string;
  uri?: string;
  resource?: string;
  sequence?: string;
}

export class XMLChunker {
  private chunkCounter = 0;
  private lastSearchPosition: number = 0;
  private readonly MAX_TOKENS = 300; // Token limit constraint
  private embedder: any; // Embedder instance for token counting

  constructor(embedder?: any) {
    this.embedder = embedder;
  }

  async chunkFile(filePath: string): Promise<XMLChunk[]> {
    this.chunkCounter = 0;
    this.lastSearchPosition = 0;
    const xmlContent = await fs.promises.readFile(filePath, 'utf-8');
    const lines = xmlContent.split('\n');
    
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '',
      removeNSPrefix: true,
      preserveOrder: true,
      alwaysCreateTextNode: false,
    });

    const parsed = parser.parse(xmlContent);
    const chunks: XMLChunk[] = [];
    
    // Extract top-level context (API name or Sequence name)
    const rootContext: SemanticContext = {
      api: this.extractApiName(parsed),
    };
    
    // Detect if this is a standalone artifact file (sequence, local-entry, endpoint, template)
    const isStandaloneSequence = filePath.includes('/sequences/') || 
                                  filePath.includes('/local-entries/') ||
                                  filePath.includes('/endpoints/') ||
                                  filePath.includes('/templates/');
    if (isStandaloneSequence) {
      rootContext.api = this.extractSequenceName(parsed);
    }

    this.processNode(parsed, xmlContent, lines, filePath, chunks, null, rootContext);
    
    // Post-process: Extract sequence references from all chunks
    this.extractSequenceReferences(chunks, xmlContent);
    
    return chunks;
  }

  /**
   * Extract sequence/artifact name from standalone files
   * Handles: sequences, local-entries, endpoints, templates
   */
  private extractSequenceName(parsed: any): string {
    if (!Array.isArray(parsed)) return 'unknown';
    
    for (const item of parsed) {
      const tagName = Object.keys(item)[0];
      if (tagName === 'sequence' || tagName === 'localEntry' || 
          tagName === 'endpoint' || tagName === 'template') {
        const attrs = this.extractAttributes(item[tagName]);
        return attrs.name || attrs.key || 'unknown';
      }
    }
    return 'unknown';
  }

  /**
   * Extract all cross-artifact references from XML content
   * Tracks:
   * - <sequence key="..."/> - Sequence references
   * - configKey="..." - Local entry references (e.g., http connectors)
   * - <endpoint key="..."/> - Endpoint references
   * - <call-template target="..."/> - Template references
   * This enables comprehensive cross-artifact relationship tracking
   */
  private extractSequenceReferences(chunks: XMLChunk[], xmlContent: string): void {
    const allReferences = new Set<string>();
    
    // Pattern 1: <sequence key="SequenceName"/>
    const sequenceRefPattern = /<sequence\s+key=["']([^"']+)["']\s*\/>/g;
    let match;
    while ((match = sequenceRefPattern.exec(xmlContent)) !== null) {
      allReferences.add(`sequence:${match[1]}`);
    }
    
    // Pattern 2: configKey="LocalEntryName" (for http.init, endpoints, etc.)
    const configKeyPattern = /configKey=["']([^"']+)["']/g;
    while ((match = configKeyPattern.exec(xmlContent)) !== null) {
      allReferences.add(`localEntry:${match[1]}`);
    }
    
    // Pattern 3: <endpoint key="EndpointName"/>
    const endpointRefPattern = /<endpoint\s+key=["']([^"']+)["']\s*\/>/g;
    while ((match = endpointRefPattern.exec(xmlContent)) !== null) {
      allReferences.add(`endpoint:${match[1]}`);
    }
    
    // Pattern 4: <call-template target="TemplateName"/>
    const templateRefPattern = /<call-template\s+target=["']([^"']+)["']/g;
    while ((match = templateRefPattern.exec(xmlContent)) !== null) {
      allReferences.add(`template:${match[1]}`);
    }
    
    // Attach references to all chunks in this file
    if (allReferences.size > 0) {
      const referencesArray = Array.from(allReferences);
      for (const chunk of chunks) {
        chunk.referencedSequences = referencesArray;
      }
    }
  }


  /**
   * SEMANTIC BOUNDARY DETECTION
   * 
   * Nodes that represent semantic boundaries (not just structural):
   * - resource: Defines an API endpoint with specific intent
   * - inSequence/outSequence/faultSequence: Flow control boundaries
   * - filter/switch: Conditional logic (decision points)
   * - sequence (key-based): Reusable logic units
   * - payloadFactory: Data transformation
   * - respond: Response generation (terminal node)
   * 
   * These boundaries define "one primary intention" per chunk.
   */
  private isSemanticBoundary(tagName: string): boolean {
    return [
      'resource', 'inSequence', 'outSequence', 'faultSequence',
      'filter', 'switch', 'sequence', 'payloadFactory', 'respond'
    ].includes(tagName);
  }

  /**
   * Extract API name from parsed XML structure
   */
  private extractApiName(parsed: any): string {
    if (!Array.isArray(parsed)) return 'unknown';
    
    for (const item of parsed) {
      const tagName = Object.keys(item)[0];
      if (tagName === 'api' || tagName === 'proxy') {
        const attrs = this.extractAttributes(item[tagName]);
        return attrs.name || attrs.context || tagName;
      }
    }
    return 'unknown';
  }

  /**
   * EXCLUSIVE TOP-DOWN CHUNKING with token gating
   * 
   * Decision logic:
   * 1. Compute token count of entire subtree + metadata
   * 2. If tokenCount ≤ MAX_TOKENS: Emit ONE chunk, STOP (no descendants)
   * 3. If tokenCount > MAX_TOKENS: Do NOT chunk, descend to children
   * 4. Once a node becomes a chunk, traversal stops for that subtree
   */
  private processNode(
    node: any,
    xmlContent: string,
    lines: string[],
    filePath: string,
    chunks: XMLChunk[],
    parentChunkId: number | null,
    context: SemanticContext
  ): void {
    if (!Array.isArray(node)) return;

    for (const item of node) {
      const tagName = Object.keys(item)[0];
      const element = item[tagName];

      // Update context based on node type
      const updatedContext = this.updateContext(tagName, element, context);

      // Only process semantic boundaries and resource types
      if (this.isResourceType(tagName) || this.isSemanticBoundary(tagName)) {
        // Token gating: Check if subtree fits within limit
        const range = this.findElementRange(tagName, this.getNodeName(tagName, element), lines);
        const content = this.extractContent(lines, range);
        const metadata = this.formatMetadata(updatedContext);
        const tokenCount = this.countTokens(content, metadata);
        
        if (tokenCount <= this.MAX_TOKENS) {
          // Subtree fits → Emit chunk and STOP traversal
          this.createChunk(tagName, element, content, range, filePath, chunks, parentChunkId, updatedContext);
          // HARD STOP: Do not descend into children
        } else {
          // Subtree too large → Do NOT chunk, descend to children
          if (Array.isArray(element)) {
            this.processNode(element, xmlContent, lines, filePath, chunks, parentChunkId, updatedContext);
          }
        }
      } else if (Array.isArray(element)) {
        // Non-semantic nodes → just traverse
        this.processNode(element, xmlContent, lines, filePath, chunks, parentChunkId, updatedContext);
      }
    }
  }

  /**
   * Update semantic context as we traverse the tree
   * This metadata is inherited by all child chunks
   */
  private updateContext(tagName: string, element: any, parentContext: SemanticContext): SemanticContext {
    const attrs = this.extractAttributes(element);
    const newContext = { ...parentContext };

    if (tagName === 'api' || tagName === 'proxy') {
      newContext.api = attrs.name || attrs.context || tagName;
    } else if (tagName === 'resource') {
      newContext.method = attrs.methods;
      newContext.uri = attrs['uri-template'] || attrs.uri;
      newContext.resource = `${attrs.methods} ${attrs['uri-template'] || attrs.uri}`;
    } else if (tagName === 'inSequence' || tagName === 'outSequence' || tagName === 'faultSequence') {
      newContext.sequence = tagName;
    } else if (tagName === 'sequence' && attrs.key) {
      newContext.sequence = attrs.key;
    }

    return newContext;
  }

  /**
   * Unified chunk creation (replaces chunkResource, chunkSemanticBoundary, chunkMediator)
   */
  private createChunk(
    tagName: string,
    element: any,
    content: string,
    range: LineRange,
    filePath: string,
    chunks: XMLChunk[],
    parentChunkId: number | null,
    context: SemanticContext
  ): void {
    const attrs = this.extractAttributes(element);
    const resourceName = attrs.name || attrs.key || attrs.context || tagName;
    const chunkIndex = this.chunkCounter++;
    
    const embeddingText = this.createEmbeddingText(tagName, resourceName, content, attrs);
    const semanticType = this.mapToSemanticType(tagName);
    const semanticIntent = this.inferIntent(tagName, attrs, content);
    const contentHash = computeChunkHash(content, {
      type: semanticType,
      intent: semanticIntent,
      context,
    });
    
    // Check if this is a standalone artifact definition
    const isStandaloneArtifact = filePath.includes('/sequences/') || 
                                  filePath.includes('/local-entries/') ||
                                  filePath.includes('/endpoints/') ||
                                  filePath.includes('/templates/');
    const sequenceKey = isStandaloneArtifact && 
                       (tagName === 'sequence' || tagName === 'localEntry' || 
                        tagName === 'endpoint' || tagName === 'template') 
                       ? (attrs.name || attrs.key) : undefined;
    
    chunks.push({
      filePath,
      resourceName,
      resourceType: this.isResourceType(tagName) ? tagName : this.getResourceType(filePath),
      chunkType: tagName,
      chunkIndex,
      startLine: range.start,
      endLine: range.end,
      content,
      parentChunkId,
      embeddingText,
      semanticType,
      semanticIntent,
      contentHash,
      context,
      sequenceKey,
      isSequenceDefinition: isStandaloneArtifact && 
                           (tagName === 'sequence' || tagName === 'localEntry' || 
                            tagName === 'endpoint' || tagName === 'template'),
      referencedSequences: [],
    });
  }

  private chunkResource(
    tagName: string,
    element: any,
    xmlContent: string,
    lines: string[],
    filePath: string,
    chunks: XMLChunk[],
    parentChunkId: number | null,
    context: SemanticContext
  ): void {
    const attrs = this.extractAttributes(element);
    const resourceName = attrs.name || attrs.context || tagName;
    const range = this.findElementRange(tagName, resourceName, lines);
    
    const chunkIndex = this.chunkCounter++;
    const content = this.extractContent(lines, range);
    const embeddingText = this.createEmbeddingText(tagName, resourceName, content, attrs);
    
    // Determine semantic type and intent
    const semanticType = 'resource';
    const semanticIntent = this.inferIntent(tagName, attrs, content);
    const contentHash = computeChunkHash(content, {
      type: semanticType,
      intent: semanticIntent,
      context,
    });
    
    // Check if this is a sequence/artifact definition (standalone file)
    const isStandaloneArtifact = filePath.includes('/sequences/') || 
                                  filePath.includes('/local-entries/') ||
                                  filePath.includes('/endpoints/') ||
                                  filePath.includes('/templates/');
    const sequenceKey = isStandaloneArtifact && 
                       (tagName === 'sequence' || tagName === 'localEntry' || 
                        tagName === 'endpoint' || tagName === 'template') 
                       ? (attrs.name || attrs.key) : undefined;
    
    chunks.push({
      filePath,
      resourceName,
      resourceType: tagName,
      chunkType: tagName,
      chunkIndex,
      startLine: range.start,
      endLine: range.end,
      content,
      parentChunkId,
      embeddingText,
      semanticType,
      semanticIntent,
      contentHash,
      context,
      sequenceKey,
      isSequenceDefinition: isStandaloneArtifact && 
                           (tagName === 'sequence' || tagName === 'localEntry' || 
                            tagName === 'endpoint' || tagName === 'template'),
      referencedSequences: [], // Will be filled by extractSequenceReferences()
    });

    const currentChunkId = chunkIndex;

    if (Array.isArray(element)) {
      this.processNode(element, xmlContent, lines, filePath, chunks, currentChunkId, context);
    }
  }

  /**
   * Determine if a node is atomic (should not be split)
   * Atomic nodes: payloadFactory, respond, log, property
   */
  private isAtomicNode(tagName: string): boolean {
    return ['payloadFactory', 'respond', 'log', 'property', 'variable'].includes(tagName);
  }

  /**
   * Map XML tag to semantic type for Merkle tree
   */
  private mapToSemanticType(tagName: string): string {
    const typeMap: Record<string, string> = {
      'filter': 'filter',
      'switch': 'filter',
      'payloadFactory': 'payloadFactory',
      'respond': 'response',
      'inSequence': 'sequence',
      'outSequence': 'sequence',
      'faultSequence': 'sequence',
      'sequence': 'sequence',
      'resource': 'resource',
      'api': 'api',
      'proxy': 'api',
    };
    return typeMap[tagName] || 'mediator';
  }

  /**
   * Infer semantic intent from tag name and content
   * 
   * Intent categories:
   * - validation: filter, switch with conditions
   * - transformation: payloadFactory, enrich
   * - delegation: call, send, http.*
   * - response: respond, payloadFactory in final position
   * - error-handling: faultSequence
   */
  private inferIntent(tagName: string, attrs: Record<string, string>, content: string): string {
    // Validation: filter/switch with conditions
    if (tagName === 'filter' || tagName === 'switch') {
      return 'validation';
    }
    
    // Transformation: payloadFactory, enrich
    if (tagName === 'payloadFactory' || tagName === 'enrich') {
      return 'transformation';
    }
    
    // Delegation: call, send, http.*
    if (tagName === 'call' || tagName === 'send' || tagName.startsWith('http.')) {
      return 'delegation';
    }
    
    // Response: respond
    if (tagName === 'respond') {
      return 'response';
    }
    
    // Error handling: faultSequence
    if (tagName === 'faultSequence') {
      return 'error-handling';
    }
    
    // Default: processing
    return 'processing';
  }

  /**
   * Count tokens using the model's actual tokenizer
   * Includes both XML subtree content AND metadata text
   */
  private countTokens(content: string, metadata: string = ''): number {
    const fullText = content + ' ' + metadata;
    
    if (this.embedder && this.embedder.countTokens) {
      return this.embedder.countTokens(fullText);
    }
    
    // Fallback to character approximation if embedder not available
    return Math.ceil(fullText.length / 4);
  }

  private isResourceType(tagName: string): boolean {
    return ['api', 'proxy', 'endpoint', 'localEntry', 'template', 'sequence'].includes(tagName);
  }

  private isMediatorType(tagName: string): boolean {
    const mediators = [
      'log', 'property', 'variable', 'call', 'send', 'drop', 
      'enrich', 'clone', 'iterate', 'aggregate', 'cache', 
      'throttle', 'validate', 'xslt', 'script',
      'http.post', 'http.get', 'http.put', 'http.delete', 'http.patch'
    ];
    // Exclude semantic boundaries from mediators
    return mediators.includes(tagName) && !this.isSemanticBoundary(tagName);
  }

  /**
   * Extract node name from element attributes
   */
  private getNodeName(tagName: string, element: any): string {
    const attrs = this.extractAttributes(element);
    return attrs.name || attrs.key || attrs.context || tagName;
  }

  /**
   * Format context metadata into text for token counting
   */
  private formatMetadata(context: SemanticContext): string {
    const parts: string[] = [];
    if (context.api) parts.push(`API: ${context.api}`);
    if (context.method) parts.push(`Method: ${context.method}`);
    if (context.uri) parts.push(`URI: ${context.uri}`);
    if (context.resource) parts.push(`Resource: ${context.resource}`);
    if (context.sequence) parts.push(`Sequence: ${context.sequence}`);
    return parts.join(' ');
  }

  private extractAttributes(element: any): Record<string, string> {
    const attrs: Record<string, string> = {};
    
    if (!Array.isArray(element)) return attrs;
    
    for (const item of element) {
      if (item[':@']) {
        Object.assign(attrs, item[':@']);
      }
    }
    
    return attrs;
  }

  private findElementRange(tagName: string, resourceName: string, lines: string[]): LineRange {
    let startLine = -1;
    let endLine = -1;
    let depth = 0;

    // Start searching from the last found position to avoid duplicates
    for (let i = this.lastSearchPosition; i < lines.length; i++) {
      const line = lines[i];
      
      if (startLine === -1) {
        const openPattern = new RegExp(`<${tagName}[\\s>]`);
        if (openPattern.test(line)) {
          startLine = i + 1;
          this.lastSearchPosition = i + 1; // Update last position
          
          if (line.includes('/>')) {
            endLine = i + 1;
            break;
          }
          depth = 1;
        }
      } else {
        const openPattern = new RegExp(`<${tagName}[\\s>]`);
        const closePattern = new RegExp(`</${tagName}>`);
        
        if (openPattern.test(line) && !line.includes('/>')) {
          depth++;
        }
        if (closePattern.test(line)) {
          depth--;
          if (depth === 0) {
            endLine = i + 1;
            break;
          }
        }
      }
    }

    if (startLine === -1) startLine = 1;
    if (endLine === -1) endLine = startLine;

    return { start: startLine, end: endLine };
  }

  private extractContent(lines: string[], range: LineRange): string {
    return lines.slice(range.start - 1, range.end).join('\n');
  }

  private getResourceType(filePath: string): string {
    if (filePath.includes('/apis/')) return 'api';
    if (filePath.includes('/sequences/')) return 'sequence';
    if (filePath.includes('/proxy-services/')) return 'proxy';
    if (filePath.includes('/endpoints/')) return 'endpoint';
    if (filePath.includes('/local-entries/')) return 'localEntry';
    return 'unknown';
  }

  private createEmbeddingText(
    tagName: string,
    resourceName: string,
    content: string,
    attrs: Record<string, string>
  ): string {
    const tokens: string[] = [tagName, resourceName];

    for (const [key, value] of Object.entries(attrs)) {
      if (key !== 'xmlns' && !key.startsWith('xmlns:')) {
        tokens.push(key, value);
      }
    }

    const contentTokens = content
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && t.length < 50);

    tokens.push(...contentTokens);

    return tokens.slice(0, 150).join(' ');
  }
}
