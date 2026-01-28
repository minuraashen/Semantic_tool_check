import * as path from 'path';

export const config = {
  pollIntervalMs: 10000, // 10 seconds
  workspaceRoot: path.resolve(__dirname, '../../../'),
  projectFolders: ['BankIntegration', 'Hotelintegration'],
  artifactsSubPath: 'src/main/wso2mi/artifacts',
  dbPath: path.resolve(__dirname, '../../../data/embeddings.db'),
  modelPath: path.resolve(__dirname, '../../models/model_quantized.onnx'),
  embeddingDimension: 384, // all-MiniLM-L6-v2 output dimension
};

export function getProjectPaths(): string[] {
  return config.projectFolders.map(folder => 
    path.join(config.workspaceRoot, folder, config.artifactsSubPath)
  );
}
