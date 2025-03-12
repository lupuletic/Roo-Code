import * as vscode from "vscode"
import * as path from "path"
import { EventEmitter } from "events"
import * as fs from "fs"
import { logger } from "../../utils/logging"
import { createFileChange, FileChange, FileStatus } from "./file-tracker"
import { CodeIndexerConfig, shouldExcludeFile, normalizePath } from "./config"

/**
 * Events emitted by the workspace watcher
 */
export enum WatcherEvent {
	FILE_CREATED = "file_created",
	FILE_CHANGED = "file_changed",
	FILE_DELETED = "file_deleted",
}

/**
 * Priority levels for file change events
 */
export enum EventPriority {
	/** High priority events (deletions) */
	HIGH = 3,
	/** Medium priority events (new files) */
	MEDIUM = 2,
	/** Low priority events (modifications) */
	LOW = 1,
}

/**
 * Class to watch for workspace file changes
 */
export class WorkspaceWatcher {
	private fileSystemWatcher?: vscode.FileSystemWatcher
	private emitter = new EventEmitter()
	private changeQueue: Map<string, FileChange> = new Map()
	private isWatching = false
	private processingTimer?: NodeJS.Timeout
	private debounceTimer?: NodeJS.Timeout
	private debounceDelayMs = 300
	private queueProcessingIntervalMs = 1000

	/**
	 * @param config Configuration object
	 */
	constructor(private readonly config: CodeIndexerConfig) {}

	/**
	 * Start watching for file changes
	 */
	public startWatching(): void {
		if (this.isWatching) {
			return
		}

		logger.debug("Starting workspace watcher")

		// Create a watcher for all files
		this.fileSystemWatcher = vscode.workspace.createFileSystemWatcher("**/*")

		// Set up event handlers
		this.fileSystemWatcher.onDidCreate(this.handleFileCreated.bind(this))
		this.fileSystemWatcher.onDidChange(this.handleFileChanged.bind(this))
		this.fileSystemWatcher.onDidDelete(this.handleFileDeleted.bind(this))

		// Start queue processing
		this.processingTimer = setInterval(() => this.processQueue(), this.queueProcessingIntervalMs)

		this.isWatching = true
		logger.debug("Workspace watcher started")
	}

	/**
	 * Stop watching for file changes
	 */
	public stopWatching(): void {
		if (!this.isWatching) {
			return
		}

		logger.debug("Stopping workspace watcher")

		// Dispose the watcher
		this.fileSystemWatcher?.dispose()
		this.fileSystemWatcher = undefined

		// Clear queue processing timers
		if (this.processingTimer) {
			clearInterval(this.processingTimer)
		}

		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
		}
		this.isWatching = false
		logger.debug("Workspace watcher stopped")
	}

	/**
	 * Check if a file should be skipped (not indexed)
	 * @param filePath Path to the file
	 * @returns True if the file should be skipped
	 */
	public shouldSkipFile(filePath: string): boolean {
		// Check file size first if available
		try {
			// Use Node's fs for a synchronous stat check
			// This is more efficient than using vscode.workspace.fs.stat which is async
			const stats = fs.statSync(filePath)

			// Skip if file is too large
			if (stats.size > this.config.maxFileSizeBytes) {
				logger.debug(`Skipping file ${filePath} - exceeds size limit (${stats.size} bytes)`)
				return true
			}
		} catch (error) {
			// Ignore errors, just continue with pattern checking
		}

		// Check against exclude patterns
		return shouldExcludeFile(filePath, this.config.excludePatterns)
	}

	/**
	 * Add a file change to the queue
	 * @param filePath Path to the file
	 * @param status Status of the file
	 * @param priority Priority of the change
	 */
	private enqueueChange(filePath: string, status: FileStatus, priority: EventPriority): void {
		// Normalize path for consistent keys
		const normalizedPath = normalizePath(filePath)

		// Create a file change object
		const change = createFileChange(normalizedPath, status, undefined, priority)

		// Check if we already have a higher priority change for this file
		const existingChange = this.changeQueue.get(normalizedPath)
		if (
			existingChange &&
			existingChange.priority !== undefined &&
			change.priority !== undefined &&
			existingChange.priority > change.priority
		) {
			logger.debug(`Skipping lower priority change for ${normalizedPath}`)
			return
		}

		// Add to queue
		this.changeQueue.set(normalizedPath, change)
		logger.debug(`Enqueued ${status} change for ${normalizedPath} (priority: ${priority})`)

		// Schedule debounced processing
		this.scheduleQueueProcessing()
	}

	/**
	 * Schedule queue processing with debounce to prevent excessive processing
	 */
	private scheduleQueueProcessing(): void {
		// If a timer is already set up, clear it
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
		}

		// Schedule processing after debounce delay
		this.debounceTimer = setTimeout(() => {
			this.processQueue()
		}, this.debounceDelayMs)
	}

	/**
	 * Process pending changes in the queue
	 */
	private processQueue(): void {
		if (this.changeQueue.size === 0) {
			return
		}

		logger.debug(`Processing ${this.changeQueue.size} file changes`)

		// Get all changes
		const changes = Array.from(this.changeQueue.values())

		// Sort by priority (highest first)
		changes.sort((a, b) => {
			const priorityA = a.priority || 0
			const priorityB = b.priority || 0

			// Sort by priority first
			if (priorityB !== priorityA) {
				return priorityB - priorityA
			}

			// Then by detection time
			return a.detectedAt - b.detectedAt
		})

		// Process changes in batches with throttling
		const batchSize = 10
		const changesForThisRun = changes.slice(0, batchSize)

		// Process each change
		for (const change of changesForThisRun) {
			try {
				// Remove from queue
				this.changeQueue.delete(change.path)

				// Emit appropriate event based on status
				switch (change.status) {
					case FileStatus.NEW:
						this.emitter.emit(WatcherEvent.FILE_CREATED, change.path)
						break
					case FileStatus.MODIFIED:
						this.emitter.emit(WatcherEvent.FILE_CHANGED, change.path)
						break
					case FileStatus.DELETED:
						this.emitter.emit(WatcherEvent.FILE_DELETED, change.path)
						break
					default:
						// Skip other statuses
						break
				}
			} catch (error) {
				logger.error(`Error processing change for ${change.path}:`, error)
			}
		}

		if (this.changeQueue.size > 0) {
			logger.debug(`${this.changeQueue.size} changes remaining in queue`)
		}
	}

	/**
	 * Register a listener for file created events
	 * @param listener Function to call when a file is created
	 * @returns Disposable that can be used to unregister the listener
	 */
	public onFileCreated(listener: (filePath: string) => void): vscode.Disposable {
		this.emitter.on(WatcherEvent.FILE_CREATED, listener)
		return {
			dispose: () => {
				this.emitter.removeListener(WatcherEvent.FILE_CREATED, listener)
			},
		}
	}

	/**
	 * Register a listener for file changed events
	 * @param listener Function to call when a file is changed
	 * @returns Disposable that can be used to unregister the listener
	 */
	public onFileChanged(listener: (filePath: string) => void): vscode.Disposable {
		this.emitter.on(WatcherEvent.FILE_CHANGED, listener)
		return {
			dispose: () => {
				this.emitter.removeListener(WatcherEvent.FILE_CHANGED, listener)
			},
		}
	}

	/**
	 * Register a listener for file deleted events
	 * @param listener Function to call when a file is deleted
	 * @returns Disposable that can be used to unregister the listener
	 */
	public onFileDeleted(listener: (filePath: string) => void): vscode.Disposable {
		this.emitter.on(WatcherEvent.FILE_DELETED, listener)
		return {
			dispose: () => {
				this.emitter.removeListener(WatcherEvent.FILE_DELETED, listener)
			},
		}
	}

	/**
	 * Handle file created event
	 * @param uri URI of the created file
	 */
	private handleFileCreated(uri: vscode.Uri): void {
		const filePath = normalizePath(uri.fsPath)

		// Skip files that should not be indexed
		if (this.shouldSkipFile(filePath)) {
			return
		}

		logger.debug(`File creation detected: ${filePath}`)

		// Add to queue with medium priority
		this.enqueueChange(filePath, FileStatus.NEW, EventPriority.MEDIUM)
	}

	/**
	 * Handle file changed event
	 * @param uri URI of the changed file
	 */
	private handleFileChanged(uri: vscode.Uri): void {
		const filePath = normalizePath(uri.fsPath)

		// Skip files that should not be indexed
		if (this.shouldSkipFile(filePath)) {
			return
		}

		logger.debug(`File change detected: ${filePath}`)

		// Add to queue with low priority
		this.enqueueChange(filePath, FileStatus.MODIFIED, EventPriority.LOW)
	}

	/**
	 * Handle file deleted event
	 * @param uri URI of the deleted file
	 */
	private handleFileDeleted(uri: vscode.Uri): void {
		const filePath = normalizePath(uri.fsPath)

		// Skip files that should not be indexed
		if (this.shouldSkipFile(filePath)) {
			return
		}

		logger.debug(`File deletion detected: ${filePath}`)

		// Add to queue with high priority
		this.enqueueChange(filePath, FileStatus.DELETED, EventPriority.HIGH)
	}
}
