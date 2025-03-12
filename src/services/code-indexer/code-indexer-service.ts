import * as vscode from "vscode"
import { logger } from "../../utils/logging"
import { CodebaseIndexer, IndexingStatus } from "./codebase-indexer"
import { CodeIndexerConfig, getDefaultConfig } from "./config"
import { CodeSearchResult } from "./code-search"
import { WorkspaceWatcher } from "./workspace-watcher"
import { FileTracker, FileStatus, FileChange } from "./file-tracker"

/**
 * Progress reporting data structure
 */
interface IndexingProgress {
	totalFiles: number
	processedFiles: number
	skippedFiles: number
	percentage: number
}

/**
 * Queue processing options
 */
interface QueueProcessingOptions {
	maxConcurrent: number
	maxBatchSize: number
	maxProcessingTimeMs: number
}

/**
 * Service status values
 */
export enum ServiceStatus {
	STOPPED = "stopped",
	STARTING = "starting",
	RUNNING = "running",
	SCANNING = "scanning",
	PROCESSING = "processing",
	PAUSED = "paused",
	ERROR = "error",
}

/**
 * Main service class for the code indexing functionality.
 * Provides high-level APIs for controlling the indexer, monitors workspace
 * changes and manages the background processing queue.
 */
export class CodeIndexerService implements vscode.Disposable {
	// Core components
	private indexer: CodebaseIndexer
	private config: CodeIndexerConfig
	private workspaceWatcher?: WorkspaceWatcher

	// Service state
	private _status: ServiceStatus = ServiceStatus.STOPPED
	private disposables: vscode.Disposable[] = []
	private progressReporter?: vscode.Progress<{ message: string; increment?: number }>
	private progressCancelToken?: vscode.CancellationTokenSource

	// File processing queue
	private processingQueue: FileChange[] = []
	private isProcessingQueue: boolean = false
	private processingTimer?: NodeJS.Timeout
	private processingInterval: number = 1000
	private workerCount: number = 0
	private maxWorkers: number = 3
	private paused: boolean = false

	// Progress tracking
	private scanProgress?: IndexingProgress

	/**
	 * Creates a new instance of the CodeIndexerService
	 * @param context VSCode extension context
	 */
	constructor(private readonly context: vscode.ExtensionContext) {
		this.config = getDefaultConfig(context)
		this.indexer = new CodebaseIndexer(context)

		logger.debug("CodeIndexerService created")
	}

	/**
	 * Register commands for VSCode Command Palette
	 * @param context The extension context
	 */
	public registerCommands(context: vscode.ExtensionContext): void {
		// Register the commands for index management
		const commands = [
			vscode.commands.registerCommand("roo-code.triggerCodeIndexing", async () => {
				await this.rebuildIndex()
			}),
			vscode.commands.registerCommand("roo-code.getIndexingStatus", async () => {
				const stats = await this.getIndexStats()
				vscode.window.showInformationMessage(
					`Code Index Status: ${stats.fileCount} files indexed (${stats.chunkCount} chunks)`,
				)
			}),
			vscode.commands.registerCommand("roo-code.clearCodeIndex", () => this.clearIndex()),
			vscode.commands.registerCommand("roo-code.rebuildCodeIndex", () => this.rebuildIndex()),
			vscode.commands.registerCommand("roo-code.pauseCodeIndexing", () => {
				this.pauseProcessing()
				vscode.window.showInformationMessage("Code indexing paused")
			}),
			vscode.commands.registerCommand("roo-code.resumeCodeIndexing", () => {
				this.resumeProcessing()
				vscode.window.showInformationMessage("Code indexing resumed")
			}),
		]
		context.subscriptions.push(...commands)
		logger.info("Code indexer commands registered")
	}

	/**
	 * Get the current status of the service
	 * @returns Current status
	 */
	public get status(): ServiceStatus {
		return this._status
	}

	/**
	 * Initialize the service and start the indexer
	 * @param skipIfExists Skip initialization if files are already indexed
	 */
	public async initialize(skipIfExists: boolean = false): Promise<void> {
		if (this._status !== ServiceStatus.STOPPED && this._status !== ServiceStatus.ERROR) {
			logger.debug(`Cannot initialize service in current status: ${this._status}`)
			return
		}

		try {
			this._status = ServiceStatus.STARTING
			logger.debug("Initializing codebase indexer service")

			// Create and initialize the workspace watcher
			this.workspaceWatcher = new WorkspaceWatcher(this.config)

			// Set up the event handlers for file system events
			this.registerEventHandlers()

			// Start the indexer
			await this.startInitialScan(skipIfExists)

			// Set up the processing timer
			this.processingTimer = setInterval(() => this.processQueue(), this.processingInterval)

			this._status = ServiceStatus.RUNNING
			logger.debug("CodeIndexerService initialized and running")
		} catch (error) {
			logger.error("Failed to initialize CodeIndexerService:", error)
			this._status = ServiceStatus.ERROR
			throw error
		}
	}

	/**
	 * Register event handlers for workspace events
	 */
	private registerEventHandlers(): void {
		if (!this.workspaceWatcher) {
			return
		}

		// Register handlers for file system events
		this.disposables.push(
			this.workspaceWatcher.onFileCreated((filePath: string) => {
				this.queueFileChange(filePath, FileStatus.NEW)
			}),
		)

		this.disposables.push(
			this.workspaceWatcher.onFileChanged((filePath: string) => {
				this.queueFileChange(filePath, FileStatus.MODIFIED)
			}),
		)

		this.disposables.push(
			this.workspaceWatcher.onFileDeleted((filePath: string) => {
				this.queueFileChange(filePath, FileStatus.DELETED)
			}),
		)

		// Register configuration change handler
		this.disposables.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration("cline.codeIndexer")) {
					this.handleConfigurationChange()
				}
			}),
		)
	}

	/**
	 * Start the initial workspace scan
	 * @param skipIfExists Skip the scan if files are already indexed
	 */
	private async startInitialScan(skipIfExists: boolean): Promise<void> {
		// Start in scanning status
		this._status = ServiceStatus.SCANNING

		try {
			// Start a progress notification if configured
			if (this.config.showNotifications) {
				this.startProgressNotification("Scanning workspace files...")
			}

			// Start the indexer with progress reporting
			await this.indexWorkspace(skipIfExists)

			// Start the file watcher if configured
			if (this.config.watchForFileChanges) {
				this.workspaceWatcher?.startWatching()
			}

			// Close progress notification
			this.endProgressNotification()

			// Reset progress tracking
			this.scanProgress = undefined

			this._status = ServiceStatus.RUNNING
			logger.debug("Initial workspace scan completed")
		} catch (error) {
			this.endProgressNotification()
			this._status = ServiceStatus.ERROR
			logger.error("Error during initial workspace scan:", error)
			throw error
		}
	}

	/**
	 * Index the workspace with progress reporting
	 * @param skipIfExists Skip indexing if files are already indexed
	 */
	private async indexWorkspace(skipIfExists: boolean): Promise<void> {
		// Get workspace folders
		const workspaceFolders = vscode.workspace.workspaceFolders

		if (!workspaceFolders || workspaceFolders.length === 0) {
			logger.debug("No workspace folders to index")
			return
		}

		// Initialize progress tracking
		this.initializeProgressTracking()

		// Use the indexer to start indexing
		await this.indexer.startIndexing(skipIfExists)
	}

	/**
	 * Initialize progress tracking data structure
	 */
	private initializeProgressTracking(): void {
		this.scanProgress = {
			totalFiles: 0,
			processedFiles: 0,
			skippedFiles: 0,
			percentage: 0,
		}
	}

	/**
	 * Update progress for indexing
	 * @param processed Number of processed files
	 * @param skipped Number of skipped files
	 * @param total Total files
	 */
	private updateScanProgress(processed: number, skipped: number, total: number): void {
		if (!this.scanProgress) {
			return
		}

		this.scanProgress.processedFiles = processed
		this.scanProgress.skippedFiles = skipped
		this.scanProgress.totalFiles = total

		if (total > 0) {
			this.scanProgress.percentage = Math.floor((processed / total) * 100)
		}

		// Update the progress notification
		this.updateProgressNotification()
	}

	/**
	 * Start the progress notification UI
	 * @param title Title for the notification
	 */
	private startProgressNotification(title: string): void {
		// Cancel any existing progress first
		this.endProgressNotification()

		// Create a new cancellation token
		this.progressCancelToken = new vscode.CancellationTokenSource()

		// Show progress in VS Code
		void vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title,
				cancellable: true,
			},
			(progress, token) => {
				// Store the progress reporter
				this.progressReporter = progress

				// Handle cancellation
				token.onCancellationRequested(() => {
					this.pauseProcessing()
				})

				// Return a promise that resolves when the progress is done
				return new Promise<void>((resolve) => {
					this.progressCancelToken!.token.onCancellationRequested(() => {
						resolve()
					})
				})
			},
		)
	}

	/**
	 * Update the progress notification with current status
	 */
	private updateProgressNotification(): void {
		if (!this.progressReporter || !this.scanProgress) {
			return
		}

		const { processedFiles, totalFiles, percentage, skippedFiles } = this.scanProgress

		this.progressReporter.report({
			message: `Processed ${processedFiles}/${totalFiles} files (${skippedFiles} skipped) - ${percentage}%`,
			increment: 1,
		})
	}

	/**
	 * End the progress notification
	 */
	private endProgressNotification(): void {
		if (this.progressCancelToken) {
			this.progressCancelToken.cancel()
			this.progressCancelToken.dispose()
			this.progressCancelToken = undefined
		}

		this.progressReporter = undefined
	}

	/**
	 * Handle configuration changes
	 */
	private handleConfigurationChange(): void {
		logger.debug("Configuration changed, updating settings")

		// Get the updated configuration
		const newConfig = getDefaultConfig(this.context)

		// Update the local config
		this.config = newConfig

		// Check if we need to restart the watcher based on config changes
		const watchingChanged = newConfig.watchForFileChanges !== this.config.watchForFileChanges

		if (watchingChanged) {
			if (newConfig.watchForFileChanges) {
				logger.debug("File watching enabled, starting watcher")
				this.workspaceWatcher?.startWatching()
			} else {
				logger.debug("File watching disabled, stopping watcher")
				this.workspaceWatcher?.stopWatching()
			}
		}
	}

	/**
	 * Queue a file change for processing
	 * @param filePath Path to the file
	 * @param status Status of the file
	 * @param priority Optional priority
	 */
	private queueFileChange(filePath: string, status: FileStatus, priority?: number): void {
		// Skip if we're not in running state or paused
		if (this._status !== ServiceStatus.RUNNING || this.paused) {
			return
		}

		// Initialize priority based on status if not provided
		if (priority === undefined) {
			switch (status) {
				case FileStatus.DELETED:
					priority = 3 // High priority
					break
				case FileStatus.NEW:
					priority = 2 // Medium priority
					break
				default:
					priority = 1 // Low priority
					break
			}
		}

		// Create change object
		const change: FileChange = {
			path: filePath,
			status,
			priority,
			detectedAt: Date.now(),
		}

		// Add to queue
		this.processingQueue.push(change)

		logger.debug(`Queued ${status} change for ${filePath} (queue size: ${this.processingQueue.length})`)
	}

	/**
	 * Process the file change queue
	 */
	private async processQueue(): Promise<void> {
		// Skip if we're already processing or no changes to process or paused
		if (this.isProcessingQueue || this.processingQueue.length === 0 || this.paused) {
			return
		}

		// Skip if we've reached maximum workers (back-pressure)
		if (this.workerCount >= this.maxWorkers) {
			logger.debug(`Deferring queue processing - ${this.workerCount}/${this.maxWorkers} workers active`)
			return
		}

		// Mark as processing
		this.isProcessingQueue = true
		this._status = ServiceStatus.PROCESSING

		try {
			// Process changes
			await this.processNextBatch()
		} catch (error) {
			logger.error("Error processing change queue:", error)
		} finally {
			// Mark as done processing
			this.isProcessingQueue = false

			// Restore status to running if no more changes
			if (this.processingQueue.length === 0 && this.workerCount === 0) {
				this._status = ServiceStatus.RUNNING
			}
		}
	}

	/**
	 * Process the next batch of file changes
	 */
	private async processNextBatch(): Promise<void> {
		// Sort changes by priority (highest first)
		this.processingQueue.sort((a, b) => {
			const priorityA = a.priority || 0
			const priorityB = b.priority || 0

			// Sort by priority first
			if (priorityB !== priorityA) {
				return priorityB - priorityA
			}

			// Then by detection time (oldest first)
			return a.detectedAt - b.detectedAt
		})

		// Get a reasonable batch size
		const options: QueueProcessingOptions = {
			maxConcurrent: Math.max(1, this.maxWorkers - this.workerCount),
			maxBatchSize: 10,
			maxProcessingTimeMs: 5000,
		}

		// Calculate batch size based on available workers
		const batchSize = Math.min(options.maxConcurrent, options.maxBatchSize, this.processingQueue.length)

		if (batchSize <= 0) {
			return
		}

		// Get a batch of changes
		const batch = this.processingQueue.splice(0, batchSize)
		logger.debug(`Processing batch of ${batch.length} file changes`)

		// Increment worker count
		this.workerCount += batch.length

		// Process each change in parallel but with controlled concurrency
		try {
			await Promise.all(batch.map((change) => this.processFileChange(change)))
		} finally {
			// Decrement worker count
			this.workerCount -= batch.length
		}
	}

	/**
	 * Process a single file change
	 * @param change File change to process
	 */
	private async processFileChange(change: FileChange): Promise<void> {
		try {
			logger.debug(`Processing ${change.status} change for ${change.path}`)

			// Handle based on file status
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
					logger.debug(`Ignoring change with unknown status: ${change.status}`)
					break
			}
		} catch (error) {
			logger.error(`Error processing change for ${change.path}:`, error)
		}
	}

	/**
	 * Handle new file creation
	 * @param filePath Path to the file
	 */
	private async handleFileCreated(filePath: string): Promise<void> {
		try {
			logger.debug(`Processing new file: ${filePath}`)
			await this.indexer.search(`file:${filePath}`, 0) // Force indexing of the file
		} catch (error) {
			logger.error(`Error handling new file: ${filePath}`, error)
		}
	}

	/**
	 * Handle file modification
	 * @param filePath Path to the file
	 */
	private async handleFileChanged(filePath: string): Promise<void> {
		try {
			logger.debug(`Processing modified file: ${filePath}`)

			// For modified files, we need to re-index, which is easiest by rebuilding
			// just for this specific file - search does this implicitly
			await this.indexer.search(`file:${filePath}`, 0) // Force re-indexing
		} catch (error) {
			logger.error(`Error handling file change: ${filePath}`, error)
		}
	}

	/**
	 * Handle file deletion
	 * @param filePath Path to the file
	 */
	private async handleFileDeleted(filePath: string): Promise<void> {
		try {
			logger.debug(`Processing deleted file: ${filePath}`)
			// We need to extend the CodebaseIndexer class to provide a public method for removing files
			// For now, we can rebuild the index which will remove deleted files
			await this.indexer.rebuildIndex()
		} catch (error) {
			logger.error(`Error handling file deletion: ${filePath}`, error)
		}
	}

	/**
	 * Pause file processing
	 */
	public pauseProcessing(): void {
		if (this._status !== ServiceStatus.RUNNING && this._status !== ServiceStatus.PROCESSING) {
			return
		}

		logger.debug("Pausing file processing")
		this.paused = true
		this._status = ServiceStatus.PAUSED
	}

	/**
	 * Resume file processing
	 */
	public resumeProcessing(): void {
		if (this._status !== ServiceStatus.PAUSED) {
			return
		}

		logger.debug("Resuming file processing")
		this.paused = false
		this._status = ServiceStatus.RUNNING

		// Kick start queue processing
		void this.processQueue()
	}

	/**
	 * Stop the service and clean up resources
	 */
	public async stop(): Promise<void> {
		// Skip if already stopped
		if (this._status === ServiceStatus.STOPPED) {
			return
		}

		logger.debug("Stopping code indexer service")

		// End any progress reporting
		this.endProgressNotification()

		// Stop the workspace watcher
		this.workspaceWatcher?.stopWatching()

		// Clear processing timer
		if (this.processingTimer) {
			clearInterval(this.processingTimer)
			this.processingTimer = undefined
		}

		// Dispose all event handlers
		for (const disposable of this.disposables) {
			disposable.dispose()
		}
		this.disposables = []

		// Set status to stopped
		this._status = ServiceStatus.STOPPED
		logger.debug("Code indexer service stopped")
	}

	/**
	 * Search the code index
	 * @param query Search query
	 * @param limit Maximum number of results
	 * @param distanceThreshold Maximum distance threshold
	 * @returns Search results
	 */
	public async search(query: string, limit: number = 5, distanceThreshold?: number): Promise<CodeSearchResult[]> {
		return this.indexer.search(query, limit, distanceThreshold)
	}

	/**
	 * Get statistics about the code index
	 * @returns Object containing statistics about the index
	 */
	public async getIndexStats(): Promise<{ fileCount: number; chunkCount: number }> {
		// For the initial implementation, we'll just return placeholder stats
		// In a future update, we can implement a more sophisticated stat tracking system
		logger.debug("Getting index stats")
		return { fileCount: 0, chunkCount: 0 }
	}

	/**
	 * Clear the code index completely
	 * This removes all indexed data but keeps the database structure
	 */
	public async clearIndex(): Promise<void> {
		// Skip if not in running state
		if (this._status !== ServiceStatus.RUNNING) {
			logger.debug(`Cannot clear index in current status: ${this._status}`)
			return
		}

		try {
			// Start progress notification
			if (this.config.showNotifications) {
				this.startProgressNotification("Clearing code index...")
			}

			this._status = ServiceStatus.SCANNING

			// Clear the processing queue
			this.processingQueue = []

			// Clear the index
			await this.indexer.clearIndex()

			// End progress notification
			this.endProgressNotification()

			this._status = ServiceStatus.RUNNING
			logger.debug("Code index cleared successfully")
		} catch (error) {
			this.endProgressNotification()
			this._status = ServiceStatus.ERROR
			logger.error("Error clearing code index:", error)
			throw error
		}
	}

	/**
	 * Rebuild the entire code index
	 */
	public async rebuildIndex(): Promise<void> {
		// Skip if not in running state
		if (this._status !== ServiceStatus.RUNNING) {
			logger.debug(`Cannot rebuild index in current status: ${this._status}`)
			return
		}

		try {
			// Start progress notification
			if (this.config.showNotifications) {
				this.startProgressNotification("Rebuilding code index...")
			}

			this._status = ServiceStatus.SCANNING

			// Clear the processing queue
			this.processingQueue = []

			// Rebuild the index
			await this.indexer.rebuildIndex()

			// End progress notification
			this.endProgressNotification()

			this._status = ServiceStatus.RUNNING
			logger.debug("Code index rebuilt successfully")
		} catch (error) {
			this.endProgressNotification()
			this._status = ServiceStatus.ERROR
			logger.error("Error rebuilding code index:", error)
			throw error
		}
	}

	/**
	 * Clean up resources when disposed
	 */
	public dispose(): void {
		this.stop().catch((error) => {
			logger.error("Error stopping code indexer service:", error)
		})
	}

	// Singleton instance
	private static instance?: CodeIndexerService

	/**
	 * Get the singleton instance
	 * @param context VSCode extension context
	 * @returns CodeIndexerService instance
	 */
	public static async getInstance(context: vscode.ExtensionContext): Promise<CodeIndexerService> {
		if (!this.instance) {
			this.instance = new CodeIndexerService(context)
		}

		return this.instance
	}
}
