import * as vscode from "vscode"
import * as path from "path"
import { logger } from "../../utils/logging"
import { CodeSearch, CodeSearchResult } from "./code-search"
import { CodeIndexerConfig, getDefaultConfig, normalizePath } from "./config"
import { FileTracker, FileChange, FileStatus, createFileChange } from "./file-tracker"
import { MetadataManager } from "./metadata"
import { ChangeDetector, ChangeDetectionOptions } from "./change-detector"
import { WorkspaceWatcher } from "./workspace-watcher"

/**
 * Enum representing the status of indexing
 */
export enum IndexingStatus {
	IDLE = "idle",
	INDEXING = "indexing",
	ERROR = "error",
}

/**
 * Options for batch processing
 */
interface BatchProcessingOptions {
	/** Maximum number of files to process in a batch */
	batchSize: number
	/** Maximum time (ms) to spend processing a batch */
	maxProcessingTime: number
}

/**
 * Main class that manages codebase indexing
 */
export class CodebaseIndexer implements vscode.Disposable {
	private config: CodeIndexerConfig
	private codeSearch: CodeSearch
	private fileTracker: FileTracker
	private workspaceWatcher: WorkspaceWatcher
	private metadataManager: MetadataManager
	private changeDetector: ChangeDetector

	private status: IndexingStatus = IndexingStatus.IDLE
	private indexingPromise?: Promise<void>
	private isProcessingChanges: boolean = false
	private processingTimer?: NodeJS.Timeout
	private pendingChanges: FileChange[] = []
	private processingIntervalMs: number = 1000
	private disposed: boolean = false

	/**
	 * @param context VSCode extension context
	 */
	constructor(private readonly context: vscode.ExtensionContext) {
		this.config = getDefaultConfig(context)
		this.codeSearch = new CodeSearch(context)
		this.fileTracker = new FileTracker(this.config)
		this.metadataManager = new MetadataManager(this.config)
		this.changeDetector = new ChangeDetector(this.fileTracker, this.metadataManager, this.config)
		this.workspaceWatcher = new WorkspaceWatcher(this.config)

		// Set up file watcher events - files will go through the change queue
		this.workspaceWatcher.onFileCreated((filePath: string) => this.queueFileChange(filePath, FileStatus.NEW))
		this.workspaceWatcher.onFileChanged((filePath: string) => this.queueFileChange(filePath, FileStatus.MODIFIED))
		this.workspaceWatcher.onFileDeleted((filePath: string) => this.handleFileDeleted(filePath))

		logger.debug("CodebaseIndexer initialized")
	}

	/**
	 * Get the current status of indexing
	 * @returns Current status
	 */
	public getStatus(): IndexingStatus {
		return this.status
	}

	/**
	 * Clear the code index completely
	 * This removes all indexed data but keeps the database structure
	 */
	public async clearIndex(): Promise<void> {
		logger.debug("Clearing code index")

		if (this.status === IndexingStatus.INDEXING) {
			logger.debug("Indexing in progress, cannot clear index")
			throw new Error("Cannot clear index while indexing is in progress")
		}

		this.status = IndexingStatus.INDEXING

		try {
			// Clear the index in CodeSearch
			await this.codeSearch.clear()

			// Reset file tracking state
			this.fileTracker.clear()
			await this.fileTracker.save()

			logger.debug("Code index cleared successfully")
			this.status = IndexingStatus.IDLE
		} catch (error) {
			logger.error("Error clearing code index:", error)
			this.status = IndexingStatus.ERROR
			throw error
		}
	}

	/**
	 * Queue a file change for processing
	 * @param filePath Path to the file
	 * @param status Status of the file
	 */
	private queueFileChange(filePath: string, status: FileStatus): void {
		// Create a file change object
		const change = createFileChange(filePath, status, undefined, status === FileStatus.NEW ? 2 : 1)

		// Add to pending changes
		this.pendingChanges.push(change)

		// Start processing changes if not already processing
		if (!this.isProcessingChanges && !this.processingTimer) {
			logger.debug("Starting change queue processing")
			this.processingTimer = setInterval(() => this.processChangeQueue(), this.processingIntervalMs)
		}
	}

	/**
	 * Start indexing the workspace
	 * @param skipIfExists Skip indexing if files are already indexed
	 */
	public async startIndexing(skipIfExists: boolean = false): Promise<void> {
		if (this.status === IndexingStatus.INDEXING) {
			logger.debug("Indexing already in progress, skipping")
			return
		}

		// Don't allow starting indexing if we're disposed
		if (this.disposed) {
			logger.debug("CodebaseIndexer is disposed, cannot start indexing")
			return
		}

		this.status = IndexingStatus.INDEXING

		try {
			// Initialize components
			await this.codeSearch.initialize()
			await this.metadataManager.initialize()
			await this.fileTracker.load()

			// If we already have indexed files and skipIfExists is true, skip
			if (skipIfExists) {
				const stats = await this.codeSearch.getStats()
				if (stats.fileCount > 0) {
					logger.debug(`Skipping indexing as ${stats.fileCount} files are already indexed`)
					this.status = IndexingStatus.IDLE
					return
				}
			}

			// Get all workspace files
			const workspaceFolders = vscode.workspace.workspaceFolders

			if (!workspaceFolders || workspaceFolders.length === 0) {
				logger.debug("No workspace folders to index")
				this.status = IndexingStatus.IDLE
				return
			}

			// Process all workspace folders
			for (const folder of workspaceFolders) {
				await this.indexWorkspaceFolder(folder)
			}

			// Start the file watcher if enabled in config
			if (this.config.watchForFileChanges) {
				this.workspaceWatcher.startWatching()
			}

			logger.debug("Indexing completed successfully")
			this.status = IndexingStatus.IDLE
		} catch (error) {
			logger.error("Error during indexing:", error)
			this.status = IndexingStatus.ERROR
		}
	}

	/**
	 * Index a workspace folder
	 * @param folder Workspace folder to index
	 */
	private async indexWorkspaceFolder(folder: vscode.WorkspaceFolder): Promise<void> {
		logger.debug(`Indexing workspace folder: ${folder.name}`)

		try {
			// Get all files in the workspace folder
			const pattern = new vscode.RelativePattern(folder, "**/*")
			const files = await vscode.workspace.findFiles(pattern, null)

			logger.debug(`Found ${files.length} files in workspace folder ${folder.name}`)

			// Filter files to only include those that need indexing
			let filesToIndex: string[] = []

			for (const file of files) {
				const filePath = file.fsPath

				// Skip excluded files
				if (this.workspaceWatcher.shouldSkipFile(filePath)) {
					continue
				}

				// Add file to tracker
				await this.fileTracker.addFile(filePath)
				filesToIndex.push(filePath)
			}

			// Use change detector to determine which files need indexing
			if (filesToIndex.length > 0) {
				logger.debug(`Using change detector to filter ${filesToIndex.length} files`)

				const changeDetectionOptions: ChangeDetectionOptions = {
					useHashComparison: true,
				}

				const changes = await this.changeDetector.detectChanges(filesToIndex, changeDetectionOptions)

				// Update filesToIndex with only the files that need indexing
				filesToIndex = changes.filesToIndex
				logger.debug(`Change detector identified ${filesToIndex.length} files to index`)
			}

			logger.debug(`Indexing ${filesToIndex.length} files`)

			// Index the files in batches to avoid overwhelming the system
			const batchSize = 50

			for (let i = 0; i < filesToIndex.length; i += batchSize) {
				const batch = filesToIndex.slice(i, i + batchSize)
				await this.codeSearch.indexFiles(batch)

				// Mark files as indexed
				for (const filePath of batch) {
					// Get file content hash
					const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath))
					const content = Buffer.from(fileContent).toString("utf8")
					const hash = require("crypto").createHash("sha256").update(content).digest("hex")

					// Update both file tracker and metadata
					await this.fileTracker.markAsIndexed(filePath, hash)
					await this.metadataManager.updateFileMetadata(filePath, {
						hash,
						indexedAt: Date.now(),
					})
				}
			}

			// Save the tracker state
			await this.fileTracker.save()

			logger.debug(`Completed indexing workspace folder: ${folder.name}`)
		} catch (error) {
			logger.error(`Error indexing workspace folder ${folder.name}:`, error)
			throw error
		}
	}

	/**
	 * Process the change queue
	 */
	private async processChangeQueue(): Promise<void> {
		// Skip if already processing or no changes
		if (this.isProcessingChanges || this.pendingChanges.length === 0) {
			return
		}

		// Mark as processing
		this.isProcessingChanges = true

		try {
			logger.debug(`Processing ${this.pendingChanges.length} queued file changes`)

			// Sort changes by priority (highest first)
			this.pendingChanges.sort((a, b) => {
				const priorityA = a.priority || 0
				const priorityB = b.priority || 0

				// Sort by priority first
				if (priorityB !== priorityA) {
					return priorityB - priorityA
				}

				// Then by detection time (oldest first)
				return a.detectedAt - b.detectedAt
			})

			// Process in batches to avoid blocking
			while (this.pendingChanges.length > 0) {
				// Get a batch of changes to process
				const batchSize = Math.min(20, this.pendingChanges.length)
				const batch = this.pendingChanges.slice(0, batchSize)

				// Process this batch
				await this.processBatchChanges(batch)

				// Remove processed items
				this.pendingChanges.splice(0, batch.length)

				// If we still have pending changes, log the count
				if (this.pendingChanges.length > 0) {
					logger.debug(`${this.pendingChanges.length} changes remaining in queue`)
				}
			}

			logger.debug("Finished processing change queue")

			// Clear the timer if the queue is empty
			if (this.pendingChanges.length === 0 && this.processingTimer) {
				clearInterval(this.processingTimer)
				this.processingTimer = undefined
			}
		} catch (error) {
			logger.error("Error processing change queue:", error)
		} finally {
			// Mark as not processing anymore
			this.isProcessingChanges = false

			// Save the file tracker state
			await this.fileTracker.save()
			await this.metadataManager.save()
		}
	}

	/**
	 * Process a batch of file changes
	 * @param changes Array of file changes to process
	 * @param options Batch processing options
	 */
	private async processBatchChanges(
		changes: FileChange[],
		options: BatchProcessingOptions = {
			batchSize: 20,
			maxProcessingTime: 5000,
		},
	): Promise<void> {
		if (changes.length === 0) {
			return
		}

		// Track processing time
		const startTime = Date.now()
		const timeLimit = startTime + options.maxProcessingTime

		// Process up to batchSize files or until we hit the time limit
		const batch = changes.slice(0, options.batchSize)
		logger.debug(`Processing batch of ${batch.length} file changes`)

		for (let i = 0; i < batch.length; i++) {
			try {
				// Check if we've hit the time limit
				if (Date.now() > timeLimit) {
					logger.debug("Processing time limit reached, deferring remaining changes")
					break
				}

				const change = batch[i]

				// Process based on status
				switch (change.status) {
					case FileStatus.NEW:
						await this.handleFileCreated(change.path)
						break

					case FileStatus.MODIFIED:
						await this.handleFileChanged(change.path)
						break

					case FileStatus.DELETED:
						await this.handleFileDeleted(change.path)
						break

					default:
						break
				}
			} catch (error) {
				const changePath = batch[i]?.path || "unknown"
				logger.error(`Error processing change for ${changePath}:`, error)
			}
		}

		// Remove processed items
		for (let i = batch.length - 1; i >= 0; i--) {
			changes.shift()
		}
	}

	/**
	 * Rebuild the entire index
	 */
	public async rebuildIndex(): Promise<void> {
		logger.debug("Rebuilding code index")

		// Stop the file watcher if it's running
		this.workspaceWatcher.stopWatching()

		// Clear the index
		await this.codeSearch.clear()

		// Start indexing again
		await this.startIndexing(false)

		logger.debug("Code index rebuilt")
	}

	/**
	 * Handle file created event
	 * @param filePath Path to the created file
	 */
	private async handleFileCreated(filePath: string): Promise<void> {
		logger.debug(`File created: ${filePath}`)

		try {
			// Check if the file should be indexed
			await this.fileTracker.addFile(filePath)

			// Use change detector to determine if file needs indexing
			const fileStatus = await this.fileTracker.getFileStatus(filePath)
			const fileStatusMap = new Map<string, FileStatus>()
			fileStatusMap.set(normalizePath(filePath), fileStatus)

			const changes = await this.changeDetector.detectChanges([filePath], { useHashComparison: true })

			const needsIndexing = changes.filesToIndex.includes(filePath)

			if (needsIndexing) {
				// Log when starting indexing
				logger.debug(`Indexing new file: ${filePath}`)

				// Index the file
				const chunks = await this.codeSearch.indexFile(filePath)

				// Update metadata
				const chunkCount = chunks ? chunks.length : 0
				await this.metadataManager.updateFileMetadata(filePath, {
					indexedAt: Date.now(),
					chunkCount,
				})
				await this.fileTracker.save()
				await this.metadataManager.save()
			}
		} catch (error) {
			logger.error(`Error handling file creation for ${filePath}:`, error)
		}
	}

	/**
	 * Handle file changed event
	 * @param filePath Path to the changed file
	 */
	private async handleFileChanged(filePath: string): Promise<void> {
		logger.debug(`File changed: ${filePath}`)

		try {
			// Check if the file should be indexed
			await this.fileTracker.addFile(filePath)

			// Use change detector to determine if file needs indexing
			const fileStatus = await this.fileTracker.getFileStatus(filePath)
			const fileStatusMap = new Map<string, FileStatus>()
			fileStatusMap.set(normalizePath(filePath), fileStatus)

			const changes = await this.changeDetector.detectChanges([filePath], { useHashComparison: true })

			const needsIndexing = changes.filesToIndex.includes(filePath)

			if (needsIndexing) {
				// Remove existing chunks and reindex
				logger.debug(`Re-indexing modified file: ${filePath}`)

				// Remove and re-index
				await this.codeSearch.removeFile(filePath)
				const chunks = await this.codeSearch.indexFile(filePath)

				// Update metadata
				const chunkCount = chunks ? chunks.length : 0
				await this.metadataManager.updateFileMetadata(filePath, {
					indexedAt: Date.now(),
					chunkCount,
				})
				await this.fileTracker.save()
				await this.metadataManager.save()
			}
		} catch (error) {
			logger.error(`Error handling file change for ${filePath}:`, error)
		}
	}

	/**
	 * Handle file deleted event
	 * @param filePath Path to the deleted file
	 */
	private async handleFileDeleted(filePath: string): Promise<void> {
		logger.debug(`File deleted: ${filePath}`)

		try {
			const normalizedPath = normalizePath(filePath)
			logger.debug(`Removing deleted file from index: ${normalizedPath}`)
			// Remove from index
			await this.codeSearch.removeFile(filePath)
			await this.fileTracker.removeFile(filePath)
			await this.metadataManager.removeFileMetadata(filePath)

			await this.fileTracker.save()
			await this.metadataManager.save()
		} catch (error) {
			logger.error(`Error handling file deletion for ${filePath}:`, error)
		}
	}

	/**
	 * Search the code index
	 * @param query Query string
	 * @param limit Maximum number of results to return
	 * @param distanceThreshold Maximum distance threshold
	 * @returns Search results
	 */
	public async search(query: string, limit: number = 5, distanceThreshold?: number): Promise<CodeSearchResult[]> {
		try {
			return await this.codeSearch.search({
				query,
				limit,
				distanceThreshold,
			})
		} catch (error) {
			logger.error("Error searching code index:", error)
			return []
		}
	}

	/**
	 * Clean up resources
	 */
	public dispose(): void {
		if (this.disposed) {
			return
		}

		logger.debug("Disposing CodebaseIndexer")

		// Stop watching for file changes
		this.workspaceWatcher.stopWatching()

		// Clear queue processing timer
		if (this.processingTimer) {
			clearInterval(this.processingTimer)
		}

		// Save file tracker state
		this.fileTracker.save().catch((error) => {
			logger.error("Error saving file tracker state during disposal:", error)
		})

		// Save metadata state
		this.metadataManager.save().catch((error) => {
			logger.error("Error saving metadata state during disposal:", error)
		})

		this.disposed = true
	}

	// Singleton instance
	private static instance?: CodebaseIndexer

	/**
	 * Get the singleton instance
	 * @param context VSCode extension context
	 * @returns CodebaseIndexer instance
	 */
	public static async getInstance(context: vscode.ExtensionContext): Promise<CodebaseIndexer> {
		if (!this.instance) {
			this.instance = new CodebaseIndexer(context)
		}

		return this.instance
	}
}
