/**
 * Main entry point for the code indexer service
 */
import * as vscode from "vscode"
import { logger } from "../../utils/logging"
import { IndexingStatus } from "./codebase-indexer"
import { CodeSearchResult } from "./code-search"
import { CodeIndexerService, ServiceStatus } from "./code-indexer-service"

let indexerService: CodeIndexerService | undefined

/**
 * Initialize the code indexer service
 * @param context VSCode extension context
 */
export async function initializeCodeIndexer(context: vscode.ExtensionContext): Promise<void> {
	try {
		indexerService = await CodeIndexerService.getInstance(context)

		// Initialize with auto-start if configured
		// Start indexing in the background
		const config = vscode.workspace.getConfiguration("cline.codeIndexer")
		if (config.get<boolean>("autoIndexOnWorkspaceOpen", true)) {
			indexerService.initialize(true)
		}

		logger.debug("Code indexer service initialized")
	} catch (error) {
		logger.error("Failed to initialize code indexer:", error)
	}
}

/**
 * Start the code indexer manually
 * @param skipIfExists Skip indexing if files already exist in the index
 */
export async function startCodeIndexing(skipIfExists: boolean = false): Promise<void> {
	if (!indexerService) {
		logger.warn("Code indexer not initialized, cannot start indexing")
		return
	}

	await indexerService.initialize(skipIfExists)
}

/**
 * Search the code index
 * @param query Search query
 * @param limit Maximum number of results
 * @param distanceThreshold Maximum distance threshold
 * @returns Search results
 */
export async function searchCodeIndex(
	query: string,
	limit: number = 5,
	distanceThreshold?: number,
): Promise<CodeSearchResult[]> {
	if (!indexerService) {
		logger.warn("Code indexer not initialized, cannot search")
		return []
	}

	return await indexerService.search(query, limit, distanceThreshold)
}

/**
 * Convert internal service status to external indexing status
 * @param serviceStatus Service status
 * @returns Indexing status
 */
function mapServiceStatusToIndexingStatus(serviceStatus: ServiceStatus): IndexingStatus {
	switch (serviceStatus) {
		case ServiceStatus.SCANNING:
		case ServiceStatus.PROCESSING:
			return IndexingStatus.INDEXING

		case ServiceStatus.ERROR:
			return IndexingStatus.ERROR

		default:
			return IndexingStatus.IDLE
	}
}

/**
 * Get the current indexing status
 * @returns Current status
 */
export function getIndexingStatus(): IndexingStatus {
	if (!indexerService) {
		return IndexingStatus.IDLE
	}

	return mapServiceStatusToIndexingStatus(indexerService.status)
}

/**
 * Get detailed index status information
 * @returns Status and statistics about the index
 */
export async function getIndexStatus(): Promise<{
	status: IndexingStatus
	stats: { fileCount: number; chunkCount: number }
}> {
	if (!indexerService) {
		logger.warn("Code indexer not initialized, cannot get status")
		return {
			status: IndexingStatus.IDLE,
			stats: { fileCount: 0, chunkCount: 0 },
		}
	}

	const status = mapServiceStatusToIndexingStatus(indexerService.status)
	const stats = await indexerService.getIndexStats()

	return {
		status,
		stats,
	}
}

/**
 * Rebuild the code index
 */
export async function rebuildCodeIndex(): Promise<void> {
	if (!indexerService) {
		logger.warn("Code indexer not initialized, cannot rebuild")
		return
	}

	await indexerService.rebuildIndex()
}

/**
 * Clear the code index
 */
export async function clearCodeIndex(): Promise<void> {
	if (!indexerService) {
		logger.warn("Code indexer not initialized, cannot clear index")
		return
	}

	await indexerService.clearIndex()
}

/**
 * Pause the code indexer
 */
export function pauseCodeIndexer(): void {
	if (!indexerService) {
		return
	}

	indexerService.pauseProcessing()
}

/**
 * Resume the code indexer
 */
export function resumeCodeIndexer(): void {
	if (!indexerService) {
		return
	}

	indexerService.resumeProcessing()
}

/**
 * Register the code indexer service with the extension
 * @param context VSCode extension context
 */
export function registerCodeIndexer(context: vscode.ExtensionContext): void {
	// Initialize the code indexer
	initializeCodeIndexer(context).then(() => {
		// Register commands using the service's method
		indexerService?.registerCommands(context)
	})
}

/**
 * Dispose of the code indexer service
 */
export function disposeCodeIndexer(): void {
	if (indexerService) {
		indexerService.dispose()
		indexerService = undefined
	}
}
