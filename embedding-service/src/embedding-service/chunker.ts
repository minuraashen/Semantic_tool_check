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
    api?: {
      name?: string;
      context?: string;
      xmlns?: string;
    };
    resource?: {
      method?: string;
      uriTemplate?: string;
    };
    sequence?: string | {
      name?: string;
      xmlns?: string;
    };
    localEntry?: {
      key?: string;
      xmlns?: string;
    };
    endpoint?: {
      name?: string;
      xmlns?: string;
    };
    template?: {
      name?: string;
      xmlns?: string;
    };
    // NEW: Support for additional artifact types
    proxyService?: {
      name?: string;
      transports?: string;
      xmlns?: string;
    };
    messageStore?: {
      name?: string;
      type?: string;
      xmlns?: string;
    };
    messageProcessor?: {
      name?: string;
      type?: string;
      messageStore?: string;
      xmlns?: string;
    };
    dataService?: {
      name?: string;
      enableBatchRequests?: boolean;
      xmlns?: string;
    };
    task?: {
      name?: string;
      trigger?: string;
      xmlns?: string;
    };
    references?: string[];
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
  api?: {
    name?: string;
    context?: string;
    xmlns?: string;
  };
  resource?: {
    method?: string;
    uriTemplate?: string;
  };
  sequence?: string | {
    name?: string;
    xmlns?: string;
  };
  localEntry?: {
    key?: string;
    xmlns?: string;
  };
  endpoint?: {
    name?: string;
    xmlns?: string;
  };
  template?: {
    name?: string;
    xmlns?: string;
  };
  // NEW: Support for Proxy Services (alternative to REST APIs)
  proxyService?: {
    name?: string;
    transports?: string;  // "http https jms"
    xmlns?: string;
  };
  // NEW: Support for Message Stores (async messaging)
  messageStore?: {
    name?: string;
    type?: string;  // "jms" | "jdbc" | "rabbitmq" | "resequence" | "wso2mb" | "in-memory" | "custom"
    xmlns?: string;
  };
  // NEW: Support for Message Processors (async delivery)
  messageProcessor?: {
    name?: string;
    type?: string;  // "sampling" | "scheduled-forwarding" | "scheduled-failover-forwarding"
    messageStore?: string;  // Reference to message store name
    xmlns?: string;
  };
  // NEW: Support for Data Services (database integration)
  dataService?: {
    name?: string;
    enableBatchRequests?: boolean;
    xmlns?: string;
  };
  // NEW: Support for Tasks (scheduled execution)
  task?: {
    name?: string;
    trigger?: string;  // "simple" | "cron"
    xmlns?: string;
  };
  references?: string[];  // What this chunk calls/uses
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
    const rootContext: SemanticContext = {};
    
    // Detect if this is a standalone artifact file (sequence, local-entry, endpoint, template, proxy, messageStore, messageProcessor, dataService, task)
    const isStandaloneArtifact = filePath.includes('/sequences/') || 
                                  filePath.includes('/local-entries/') ||
                                  filePath.includes('/endpoints/') ||
                                  filePath.includes('/templates/') ||
                                  filePath.includes('/proxy-services/') ||
                                  filePath.includes('/message-stores/') ||
                                  filePath.includes('/message-processors/') ||
                                  filePath.includes('/data-services/') ||
                                  filePath.includes('/tasks/');
    if (isStandaloneArtifact) {
      const artifactMeta = this.extractArtifactMetadata(parsed);
      
      // Use artifact-specific context structure
      if (artifactMeta.type === 'sequence') {
        rootContext.sequence = {
          name: artifactMeta.name,
          xmlns: artifactMeta.xmlns
        };
      } else if (artifactMeta.type === 'localEntry') {
        rootContext.localEntry = {
          key: artifactMeta.name,
          xmlns: artifactMeta.xmlns
        };
      } else if (artifactMeta.type === 'endpoint') {
        rootContext.endpoint = {
          name: artifactMeta.name,
          xmlns: artifactMeta.xmlns
        };
      } else if (artifactMeta.type === 'template') {
        rootContext.template = {
          name: artifactMeta.name,
          xmlns: artifactMeta.xmlns
        };
      } else if (artifactMeta.type === 'proxyService') {
        rootContext.proxyService = {
          name: artifactMeta.name,
          transports: artifactMeta.additionalInfo?.transports,
          xmlns: artifactMeta.xmlns
        };
      } else if (artifactMeta.type === 'messageStore') {
        rootContext.messageStore = {
          name: artifactMeta.name,
          type: artifactMeta.additionalInfo?.storeType,
          xmlns: artifactMeta.xmlns
        };
      } else if (artifactMeta.type === 'messageProcessor') {
        rootContext.messageProcessor = {
          name: artifactMeta.name,
          type: artifactMeta.additionalInfo?.processorType,
          messageStore: artifactMeta.additionalInfo?.messageStore,
          xmlns: artifactMeta.xmlns
        };
      } else if (artifactMeta.type === 'dataService') {
        rootContext.dataService = {
          name: artifactMeta.name,
          enableBatchRequests: artifactMeta.additionalInfo?.enableBatchRequests,
          xmlns: artifactMeta.xmlns
        };
      } else if (artifactMeta.type === 'task') {
        rootContext.task = {
          name: artifactMeta.name,
          trigger: artifactMeta.additionalInfo?.trigger,
          xmlns: artifactMeta.xmlns
        };
      }
    } else {
      // For API files, extract API name
      rootContext.api = {
        name: this.extractApiName(parsed),
      };
    }

    this.processNode(parsed, xmlContent, lines, filePath, chunks, null, rootContext);
    
    // Post-process: Extract sequence references from all chunks
    this.extractSequenceReferences(chunks, xmlContent);
    
    return chunks;
  }

  /**
   * Extract sequence/artifact metadata from standalone files
   * Handles: sequences, local-entries, endpoints, templates
   */
  private extractArtifactMetadata(parsed: any): { type: string; name: string; xmlns?: string; additionalInfo?: any } {
    if (!Array.isArray(parsed)) return { type: 'unknown', name: 'unknown' };
    
    for (const item of parsed) {
      const tagName = Object.keys(item)[0];
      const attrs = item[':@'];
      
      // Existing artifact types
      if (tagName === 'sequence' || tagName === 'localEntry' || 
          tagName === 'endpoint' || tagName === 'template') {
        return {
          type: tagName,
          name: attrs?.name || attrs?.key || 'unknown',
          xmlns: attrs?.['@_xmlns'] || attrs?.xmlns
        };
      }
      
      // NEW: Proxy Service detection
      if (tagName === 'proxy') {
        return {
          type: 'proxyService',
          name: attrs?.name || 'unknown',
          xmlns: attrs?.['@_xmlns'] || attrs?.xmlns,
          additionalInfo: {
            transports: attrs?.transports || 'http https'
          }
        };
      }
      
      // NEW: Message Store detection
      if (tagName === 'messageStore') {
        // Detect type from class name
        const className = attrs?.class || '';
        let storeType = 'custom';
        if (className.includes('JmsStore')) storeType = 'jms';
        else if (className.includes('JDBCMessageStore')) storeType = 'jdbc';
        else if (className.includes('RabbitMQStore')) storeType = 'rabbitmq';
        else if (className.includes('ResequenceMessageStore')) storeType = 'resequence';
        else if (className.includes('WSO2MBMessageStore')) storeType = 'wso2mb';
        else if (className.includes('InMemoryMessageStore')) storeType = 'in-memory';
        
        return {
          type: 'messageStore',
          name: attrs?.name || 'unknown',
          xmlns: attrs?.['@_xmlns'] || attrs?.xmlns,
          additionalInfo: { storeType }
        };
      }
      
      // NEW: Message Processor detection
      if (tagName === 'messageProcessor') {
        const className = attrs?.class || '';
        let processorType = 'custom';
        if (className.includes('MessageSamplingProcessor')) processorType = 'sampling';
        else if (className.includes('ScheduledMessageForwardingProcessor')) processorType = 'scheduled-forwarding';
        else if (className.includes('ScheduledFailoverMessageForwardingProcessor')) processorType = 'scheduled-failover-forwarding';
        
        // Extract message store reference from parameters
        let messageStoreName = '';
        if (Array.isArray(item.messageProcessor)) {
          for (const child of item.messageProcessor) {
            if (child.parameter && Array.isArray(child.parameter)) {
              const storeParam = child.parameter.find((p: any) => p[':@']?.name === 'message.store');
              if (storeParam) {
                messageStoreName = storeParam['#text'] || '';
              }
            }
          }
        }
        
        return {
          type: 'messageProcessor',
          name: attrs?.name || 'unknown',
          xmlns: attrs?.['@_xmlns'] || attrs?.xmlns,
          additionalInfo: {
            processorType,
            messageStore: messageStoreName
          }
        };
      }
      
      // NEW: Data Service detection
      if (tagName === 'data') {
        return {
          type: 'dataService',
          name: attrs?.name || 'unknown',
          xmlns: attrs?.['@_xmlns'] || attrs?.xmlns,
          additionalInfo: {
            enableBatchRequests: attrs?.enableBatchRequests === 'true'
          }
        };
      }
      
      // NEW: Task detection
      if (tagName === 'task') {
        return {
          type: 'task',
          name: attrs?.name || 'unknown',
          xmlns: attrs?.['@_xmlns'] || attrs?.xmlns,
          additionalInfo: {
            trigger: item.task?.find((child: any) => child.trigger) ? 'defined' : 'simple'
          }
        };
      }
    }
    return { type: 'unknown', name: 'unknown' };
  }

  /**
   * Extract references from a chunk's content
   */
  private extractReferencesFromContent(content: string): string[] {
    const refs = new Set<string>();
    
    // Pattern 1: <sequence key="SequenceName"/>
    const sequenceRefPattern = /<sequence\s+key=["']([^"']+)["']\s*\/>/g;
    let match;
    while ((match = sequenceRefPattern.exec(content)) !== null) {
      refs.add(`sequence:${match[1]}`);
    }
    
    // Pattern 2: configKey="LocalEntryName"
    const configKeyPattern = /configKey=["']([^"']+)["']/g;
    while ((match = configKeyPattern.exec(content)) !== null) {
      refs.add(`localEntry:${match[1]}`);
    }
    
    // Pattern 3: <endpoint key="EndpointName"/>
    const endpointRefPattern = /<endpoint\s+key=["']([^"']+)["']\s*\/>/g;
    while ((match = endpointRefPattern.exec(content)) !== null) {
      refs.add(`endpoint:${match[1]}`);
    }
    
    // Pattern 4: <call-template target="TemplateName"/>
    const templateRefPattern = /<call-template\s+target=["']([^"']+)["']/g;
    while ((match = templateRefPattern.exec(content)) !== null) {
      refs.add(`template:${match[1]}`);
    }
    
    return Array.from(refs);
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
      const tagName = Object.keys(item).find(key => key !== ':@') || '';
      if (!tagName) continue;
      
      const element = item[tagName];
      const nodeAttrs = item[':@'] || {};  // Attributes are at item level, not in element

      // Update context based on node type (pass nodeAttrs, not element)
      const updatedContext = this.updateContext(tagName, nodeAttrs, context);

      // Check if this is a chunkable node (resource, semantic boundary, or mediator)
      const isChunkable = this.isResourceType(tagName) || this.isSemanticBoundary(tagName) || this.isMediatorType(tagName);
      
      if (isChunkable) {
        // Token gating: Check if subtree fits within limit
        const range = this.findElementRange(tagName, this.getNodeName(tagName, element), lines);
        const content = this.extractContent(lines, range);
        const metadata = this.formatMetadata(updatedContext);
        const tokenCount = this.countTokens(content, metadata);
        
        if (tokenCount <= this.MAX_TOKENS) {
          // Subtree fits → Emit chunk and STOP traversal
          this.createChunk(tagName, nodeAttrs, content, range, filePath, chunks, parentChunkId, updatedContext);
          // HARD STOP: Do not descend into children
        } else {
          // Subtree too large → Do NOT chunk, descend to ALL children
          if (Array.isArray(element)) {
            this.processNode(element, xmlContent, lines, filePath, chunks, parentChunkId, updatedContext);
          }
        }
      } else if (Array.isArray(element)) {
        // Non-chunkable nodes → just traverse
        this.processNode(element, xmlContent, lines, filePath, chunks, parentChunkId, updatedContext);
      }
    }
  }

  /**
   * Update semantic context as we traverse the tree
   * This metadata is inherited by all child chunks
   */
  private updateContext(tagName: string, attrs: Record<string, string>, parentContext: SemanticContext): SemanticContext {
    const newContext = { ...parentContext };

    if (tagName === 'api' || tagName === 'proxy') {
      newContext.api = {
        name: attrs.name || attrs['@_name'],
        context: attrs.context || attrs['@_context'],
        xmlns: attrs.xmlns || attrs['@_xmlns'],
      };
    } else if (tagName === 'resource') {
      newContext.resource = {
        method: attrs.methods || attrs['@_methods'],
        uriTemplate: attrs['uri-template'] || attrs['@_uri-template'] || attrs.uri || attrs['@_uri'],
      };
    } else if (tagName === 'inSequence' || tagName === 'outSequence' || tagName === 'faultSequence') {
      newContext.sequence = tagName;
    } else if (tagName === 'sequence' && (attrs.key || attrs['@_key'])) {
      newContext.sequence = attrs.key || attrs['@_key'];
    }

    return newContext;
  }

  /**
   * Unified chunk creation (replaces chunkResource, chunkSemanticBoundary, chunkMediator)
   */
  private createChunk(
    tagName: string,
    attrs: Record<string, string>,  // Now receives attrs directly
    content: string,
    range: LineRange,
    filePath: string,
    chunks: XMLChunk[],
    parentChunkId: number | null,
    context: SemanticContext
  ): void {
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
    
    // Extract references from this chunk's content
    const chunkReferences = this.extractReferencesFromContent(content);
    if (chunkReferences.length > 0) {
      context.references = chunkReferences;
    }
    
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
    if (context.api?.name) parts.push(`API: ${context.api.name}`);
    if (context.api?.context) parts.push(`Context: ${context.api.context}`);
    if (context.resource?.method) parts.push(`Method: ${context.resource.method}`);
    if (context.resource?.uriTemplate) parts.push(`URI: ${context.resource.uriTemplate}`);
    if (context.sequence) parts.push(`Sequence: ${context.sequence}`);
    if (context.references && context.references.length > 0) {
      parts.push(`Uses: ${context.references.join(', ')}`);
    }
    return parts.join(' ');
  }

  private extractAttributes(element: any): Record<string, string> {
    const attrs: Record<string, string> = {};
    
    // Case 1: element is an array (preserveOrder format)
    if (Array.isArray(element)) {
      for (const item of element) {
        if (item[':@']) {
          Object.assign(attrs, item[':@']);
          break; // Only get attributes from first :@ marker
        }
      }
    }
    // Case 2: element is an object with :@ directly
    else if (element && element[':@']) {
      Object.assign(attrs, element[':@']);
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
