import { createHash } from 'crypto';

/**
 * Merkle Tree Implementation for Embedding Storage
 * 
 * Purpose:
 * - Detect chunk changes efficiently without re-embedding unchanged content
 * - Enable incremental updates by comparing content hashes
 * - Maintain semantic grouping at API/Resource/Sequence levels
 */

export interface MerkleLeaf {
  chunkId: string;        // Unique identifier (filePath:chunkIndex)
  contentHash: string;    // SHA-256 hash of (xml + metadata)
  embedding: Float32Array | null;
  metadata: {
    type: string;         // filter | payloadFactory | sequence | resource | api
    intent: string;       // validation | transformation | delegation | response
    context: {
      api: {
        name?: string;
        context?: string;
        xmlns?: string;
      };
      resource?: {
        method?: string;
        uriTemplate?: string;
      };
      sequence?: string;
    };
  };
}

export interface MerkleNode {
  hash: string;           // Hash of children hashes
  level: string;          // 'api' | 'resource' | 'sequence' | 'leaf'
  children: (MerkleNode | MerkleLeaf)[];
  label: string;          // Human-readable label (API name, resource path, etc.)
}

/**
 * Compute content hash for a chunk
 * Includes XML content + semantic metadata to detect meaningful changes
 */
export function computeChunkHash(
  xmlContent: string,
  metadata: MerkleLeaf['metadata']
): string {
  const hashInput = JSON.stringify({
    xml: xmlContent,
    type: metadata.type,
    intent: metadata.intent,
    context: metadata.context,
  });
  return createHash('sha256').update(hashInput).digest('hex');
}

/**
 * Compute hash for a Merkle node based on its children
 * This allows efficient change detection at any level of the tree
 */
export function computeNodeHash(children: (MerkleNode | MerkleLeaf)[]): string {
  const childHashes = children.map(child => 
    'hash' in child ? child.hash : child.contentHash
  );
  const combined = childHashes.join('|');
  return createHash('sha256').update(combined).digest('hex');
}

/**
 * Build Merkle tree from flat list of chunks
 * Groups chunks hierarchically: API → Resource → Sequence → Leaf
 */
export function buildMerkleTree(leaves: MerkleLeaf[]): MerkleNode {
  // Group by API
  const apiGroups = groupBy(leaves, leaf => leaf.metadata.context.api.name || 'unknown');
  
  const apiNodes: MerkleNode[] = [];
  
  for (const [apiName, apiLeaves] of Object.entries(apiGroups)) {
    // Group by resource within API
    const resourceGroups = groupBy(apiLeaves, leaf => {
      const resource = leaf.metadata.context.resource;
      return resource ? `${resource.method} ${resource.uriTemplate}` : 'root';
    });
    
    const resourceNodes: MerkleNode[] = [];
    
    for (const [resourceName, resourceLeaves] of Object.entries(resourceGroups)) {
      // Group by sequence within resource
      const sequenceGroups = groupBy(resourceLeaves, leaf =>
        leaf.metadata.context.sequence || 'direct'
      );
      
      const sequenceNodes: (MerkleNode | MerkleLeaf)[] = [];
      
      for (const [sequenceName, sequenceLeaves] of Object.entries(sequenceGroups)) {
        if (sequenceLeaves.length === 1) {
          // Single leaf - add directly
          sequenceNodes.push(sequenceLeaves[0]);
        } else {
          // Multiple leaves - create sequence node
          const sequenceNode: MerkleNode = {
            hash: computeNodeHash(sequenceLeaves),
            level: 'sequence',
            children: sequenceLeaves,
            label: sequenceName,
          };
          sequenceNodes.push(sequenceNode);
        }
      }
      
      const resourceNode: MerkleNode = {
        hash: computeNodeHash(sequenceNodes),
        level: 'resource',
        children: sequenceNodes,
        label: resourceName,
      };
      resourceNodes.push(resourceNode);
    }
    
    const apiNode: MerkleNode = {
      hash: computeNodeHash(resourceNodes),
      level: 'api',
      children: resourceNodes,
      label: apiName,
    };
    apiNodes.push(apiNode);
  }
  
  // Root node
  return {
    hash: computeNodeHash(apiNodes),
    level: 'root',
    children: apiNodes,
    label: 'root',
  };
}

/**
 * Compare two Merkle trees and return changed leaf nodes
 * Only leaves with different contentHash need re-embedding
 */
export function findChangedLeaves(
  oldTree: MerkleNode | MerkleLeaf | null,
  newTree: MerkleNode | MerkleLeaf
): MerkleLeaf[] {
  if (!oldTree) {
    // No old tree - all leaves are new
    return collectAllLeaves(newTree);
  }
  
  // Both are leaves
  if ('chunkId' in oldTree && 'chunkId' in newTree) {
    return oldTree.contentHash !== newTree.contentHash ? [newTree] : [];
  }
  
  // Type mismatch - treat as changed
  if ('chunkId' in oldTree !== 'chunkId' in newTree) {
    return collectAllLeaves(newTree);
  }
  
  // Both are nodes
  const oldNode = oldTree as MerkleNode;
  const newNode = newTree as MerkleNode;
  
  // Same hash - no changes
  if (oldNode.hash === newNode.hash) {
    return [];
  }
  
  // Different hash - recurse into children
  const changed: MerkleLeaf[] = [];
  
  // Build map of old children by label
  const oldChildMap = new Map<string, MerkleNode | MerkleLeaf>();
  for (const child of oldNode.children) {
    const label = 'label' in child ? child.label : child.chunkId;
    oldChildMap.set(label, child);
  }
  
  // Compare each new child with old
  for (const newChild of newNode.children) {
    const label = 'label' in newChild ? newChild.label : newChild.chunkId;
    const oldChild = oldChildMap.get(label);
    changed.push(...findChangedLeaves(oldChild || null, newChild));
  }
  
  return changed;
}

/**
 * Collect all leaf nodes from a tree
 */
function collectAllLeaves(tree: MerkleNode | MerkleLeaf): MerkleLeaf[] {
  if ('chunkId' in tree) {
    return [tree];
  }
  
  const leaves: MerkleLeaf[] = [];
  for (const child of tree.children) {
    leaves.push(...collectAllLeaves(child));
  }
  return leaves;
}

/**
 * Group array by key function
 */
function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const item of array) {
    const key = keyFn(item);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
  }
  return groups;
}
