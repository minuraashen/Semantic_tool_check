import * as path from 'path';

const isCompiled = __dirname.includes('/dist/');
const rootDir = isCompiled 
  ? path.resolve(__dirname, '../../../')
  : path.resolve(__dirname, '../../');

export const config = {
  pollIntervalMs: 10000, // 10 seconds
  workspaceRoot: path.resolve(rootDir, '../'),
  projectFolders: ['BankIntegration', 'Hotelintegration'],
  artifactsSubPath: 'src/main/wso2mi/artifacts',
  dbPath: path.resolve(rootDir, 'data/embeddings.db'),
  modelPath: path.resolve(rootDir, 'models/model_quantized.onnx'),
  embeddingDimension: 384, // all-MiniLM-L6-v2 output dimension
};

export function getProjectPaths(): string[] {
  return config.projectFolders.map(folder => 
    path.join(config.workspaceRoot, folder, config.artifactsSubPath)
  );
}
