import * as path from 'path';

/**
 * Centralized Configuration Module
 * 
 * Supports environment variable overrides for all settings.
 * Enables easy configuration without code changes.
 */

export interface ServiceConfig {
    // Polling and indexing
    pollIntervalMs: number;
    maxTokens: number;

    // Project discovery
    workspaceRoot: string;
    projectFolders: string[];
    artifactsSubPath: string;

    // Storage paths
    dbPath: string;
    modelPath: string;
    pluginsPath: string;
}

/**
 * Load configuration from environment variables with defaults
 */
export function loadConfig(): ServiceConfig {
    const rootDir = path.resolve(__dirname, '../');
    const workspaceRoot = process.env.EMBEDDING_WORKSPACE_ROOT || path.resolve(rootDir, '../');

    // Project folders can be comma-separated in env
    const projectFoldersEnv = process.env.EMBEDDING_PROJECT_FOLDERS;
    const projectFolders = projectFoldersEnv
        ? projectFoldersEnv.split(',').map(f => f.trim())
        : ['BankIntegration', 'Hotelintegration', 'life-delivery-papi'];

    return {
        pollIntervalMs: parseInt(process.env.EMBEDDING_POLL_INTERVAL_MS || '10000', 10),
        maxTokens: parseInt(process.env.EMBEDDING_MAX_TOKENS || '256', 10),

        workspaceRoot,
        projectFolders,
        artifactsSubPath: process.env.EMBEDDING_ARTIFACTS_SUBPATH || 'src/main/wso2mi/artifacts',

        dbPath: process.env.EMBEDDING_DB_PATH || path.resolve(rootDir, 'data/embeddings.db'),
        modelPath: process.env.EMBEDDING_MODEL_PATH || path.resolve(rootDir, 'models/model_quantized.onnx'),
        pluginsPath: process.env.EMBEDDING_PLUGINS_PATH || path.resolve(rootDir, 'plugins'),
    };
}

/**
 * Get full artifact directory paths for all configured projects
 */
export function getProjectPaths(config: ServiceConfig): string[] {
    return config.projectFolders.map(folder =>
        path.join(config.workspaceRoot, folder, config.artifactsSubPath)
    );
}

// Default exported config instance
export const config = loadConfig();
