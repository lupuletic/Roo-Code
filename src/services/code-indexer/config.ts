import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { logger } from "../../utils/logging"
import { minimatch } from "minimatch"
import {
	getDatabasePath,
	ensureDatabaseDirectory as ensureDbDir,
	normalizePath as normalizeFilePath,
} from "./path-utils"

/**
 * Configuration options for the code indexer
 */
export interface CodeIndexerConfig {
	/** Path to the database directory */
	databasePath: string

	/** Maximum file size to index in bytes */
	maxFileSizeBytes: number

	/** Patterns to exclude from indexing */
	excludePatterns: string[]

	/** OpenAI embedding model to use */
	embeddingModel: string

	/** Whether to auto-index on workspace open */
	autoIndexOnWorkspaceOpen: boolean

	/** Whether to watch for file changes */
	watchForFileChanges: boolean

	/** Chunk size limit in characters */
	maxChunkSize: number

	/** Overlap between chunks in characters */
	chunkOverlap: number

	/** Whether to show notifications for indexing progress */
	showNotifications: boolean
}

/**
 * Default config values
 */
const defaults: CodeIndexerConfig = {
	databasePath: "./lancedb",
	maxFileSizeBytes: 1024 * 1024, // 1MB
	excludePatterns: [
		"**/node_modules/**",
		"**/dist/**",
		"**/build/**",
		"**/.git/**",
		"**/coverage/**",
		"**/package-lock.json",
		"**/yarn.lock",
		"**/*.log",
		"**/*.map",
		"**/*.o",
		"**/*.obj",
		"**/*.bin",
		"**/*.exe",
		"**/*.dll",
		"**/*.so",
		"**/.DS_Store",
	],
	embeddingModel: "text-embedding-ada-002",
	autoIndexOnWorkspaceOpen: true,
	watchForFileChanges: true,
	maxChunkSize: 1000,
	chunkOverlap: 100,
	showNotifications: true,
}

/**
 * Get default config with user settings applied
 * @param context VSCode extension context
 * @returns Configuration options
 */
export function getDefaultConfig(context: vscode.ExtensionContext): CodeIndexerConfig {
	// Get user settings
	const config = vscode.workspace.getConfiguration("cline.codeIndexer")

	// Get database path from path utilities
	const dbPath = getDatabasePath(context, "lancedb")

	return {
		databasePath: dbPath,
		maxFileSizeBytes: config.get<number>("maxFileSizeBytes") ?? defaults.maxFileSizeBytes,
		excludePatterns: config.get<string[]>("excludePatterns") ?? defaults.excludePatterns,
		embeddingModel: config.get<string>("embeddingModel") ?? defaults.embeddingModel,
		autoIndexOnWorkspaceOpen: config.get<boolean>("autoIndexOnWorkspaceOpen") ?? defaults.autoIndexOnWorkspaceOpen,
		watchForFileChanges: config.get<boolean>("watchForFileChanges") ?? defaults.watchForFileChanges,
		maxChunkSize: config.get<number>("maxChunkSize") ?? defaults.maxChunkSize,
		chunkOverlap: config.get<number>("chunkOverlap") ?? defaults.chunkOverlap,
		showNotifications: config.get<boolean>("showNotifications") ?? defaults.showNotifications,
	}
}

/**
 * Ensure the database directory exists
 * @param dbPath Path to the database directory
 */
export async function ensureDatabaseDirectory(dbPath: string): Promise<void> {
	return ensureDbDir(dbPath)
}

/**
 * Check if a file should be excluded from indexing
 * @param filePath Path to the file
 * @param excludePatterns Patterns to exclude
 * @returns True if the file should be excluded
 */
export function shouldExcludeFile(filePath: string, excludePatterns: string[]): boolean {
	return excludePatterns.some((pattern) => minimatch(filePath, pattern))
}

/**
 * Normalize a file path
 * @param filePath Path to normalize
 * @returns Normalized path
 */
export function normalizePath(filePath: string): string {
	return normalizeFilePath(filePath)
}
