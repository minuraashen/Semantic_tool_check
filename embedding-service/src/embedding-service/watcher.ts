import * as fs from 'fs';
import * as path from 'path';
import { computeHash } from '../utils/hash';

export interface FileChange {
  filePath: string;
  hash: string;
  exists: boolean;
}

export class Watcher {
  private fileHashes: Map<string, string> = new Map();

  async scanForChanges(directories: string[]): Promise<FileChange[]> {
    const currentFiles = new Map<string, string>();
    const changes: FileChange[] = [];

    for (const dir of directories) {
      if (!fs.existsSync(dir)) continue;
      
      const xmlFiles = await this.findXMLFiles(dir);
      
      for (const filePath of xmlFiles) {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const hash = computeHash(content);
        currentFiles.set(filePath, hash);

        const oldHash = this.fileHashes.get(filePath);
        
        if (!oldHash || oldHash !== hash) {
          changes.push({ filePath, hash, exists: true });
        }
      }
    }

    for (const [filePath, hash] of this.fileHashes.entries()) {
      if (!currentFiles.has(filePath)) {
        changes.push({ filePath, hash, exists: false });
      }
    }

    this.fileHashes = currentFiles;
    return changes;
  }

  private async findXMLFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    const walk = async (currentDir: string) => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.xml')) {
          files.push(fullPath);
        }
      }
    };
    
    await walk(dir);
    return files;
  }

  getFileHash(filePath: string): string | undefined {
    return this.fileHashes.get(filePath);
  }
}
