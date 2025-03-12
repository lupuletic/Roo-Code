import * as path from "path"
import * as fs from "fs/promises"
import { Stats } from "fs"
import * as crypto from "crypto"
import { logger } from "../../utils/logging"
import { CodeIndexerConfig, shouldExcludeFile, normalizePath } from "./config"
import { fileExistsAtPath } from "../../utils/fs"

/**
 * Enum representing file status
 */
export enum FileStatus {
	/** File is new and hasn't been indexed yet */
	NEW = "new",
	/** File exists and has been modified since last indexing */
	MODIFIED = "modified",
	/** File exists and has not changed since last indexing */
	UNCHANGED = "unchanged",
	/** File has been deleted */
	DELETED = "deleted",
	/** File status cannot be determined due to error */
	ERROR = "error",
	/** File should be excluded from indexing */
	EXCLUDED = "excluded",
}

/**
 * Information about a tracked file
 */
export interface FileInfo {
	/** Path to the file */
	path: string

	/** Last modification time */
	mtime: number

	/** Size of the file in bytes */
	size: number

	/** Hash of the file content (if computed) */
	hash?: string

	/** Previous hash of the file content */
	previousHash?: string

	/** Last time the file was indexed */
	indexedAt?: number
}

/**
 * Calculate a hash of file content
 * @param content File content
 * @returns Hash of the content
 */
export function calculateFileHash(content: string): string {
	try {
		return crypto.createHash("sha256").update(content).digest("hex")
	} catch (error) {
		logger.error("Error calculating file hash:", error)
		return ""
	}
}

/**
 * Compare a file's current state with its tracked state to determine its status
 * @param filePath Path to the file
 * @param fileInfo Current tracked information about the file
 * @param config Configuration settings
 * @returns File status
 */
export async function determineFileStatus(
	filePath: string,
	fileInfo: FileInfo | undefined,
	config: CodeIndexerConfig,
): Promise<FileStatus> {
	try {
		// Check if the file exists
		const exists = await fileExistsAtPath(filePath)

		// If the file doesn't exist
		if (!exists) {
			return fileInfo ? FileStatus.DELETED : FileStatus.ERROR
		}

		// Check if the file should be excluded
		if (shouldExcludeFile(filePath, config.excludePatterns)) {
			return FileStatus.EXCLUDED
		}

		// Get file stats
		const stats = await fs.stat(filePath)

		// Skip directories
		if (stats.isDirectory()) {
			return FileStatus.EXCLUDED
		}

		// Skip files that are too large
		if (stats.size > config.maxFileSizeBytes) {
			return FileStatus.EXCLUDED
		}

		// If we have no tracked info, the file is new
		if (!fileInfo) {
			return FileStatus.NEW
		}

		// If no indexedAt timestamp, the file is new
		if (!fileInfo.indexedAt) {
			return FileStatus.NEW
		}

		// Check if file has been modified by comparing timestamps and size
		if (stats.mtimeMs > fileInfo.mtime || stats.size !== fileInfo.size) {
			return FileStatus.MODIFIED
		}

		// If we have a hash, we can do a more precise check by reading the file and comparing hashes
		if (fileInfo.hash) {
			try {
				const content = await fs.readFile(filePath, "utf-8")
				const currentHash = calculateFileHash(content)

				if (currentHash && currentHash !== fileInfo.hash) {
					return FileStatus.MODIFIED
				}
			} catch (error) {
				logger.error(`Error reading file to compare hash: ${filePath}`, error)
				// Fall back to the timestamp comparison we already did
			}
		}

		// If we get this far, the file is unchanged
		return FileStatus.UNCHANGED
	} catch (error) {
		logger.error(`Error determining file status for ${filePath}:`, error)
		return FileStatus.ERROR
	}
}

/**
 * A file change that needs to be processed
 */
export interface FileChange {
	/** Path to the file */
	path: string

	/** Status of the file */
	status: FileStatus

	/** Time the change was detected */
	detectedAt: number

	/** File size in bytes (if available) */
	size?: number

	/** File modification time (if available) */
	mtime?: number

	/** Priority for processing (higher = processed first) */
	priority?: number
}

/**
 * Create a file change object
 * @param filePath Path to the file
 * @param status Status of the file
 * @param stats File stats (if available)
 * @param priority Processing priority
 * @returns File change object
 */
export function createFileChange(
	filePath: string,
	status: FileStatus,
	stats?: Stats,
	priority: number = 1,
): FileChange {
	return {
		path: filePath,
		status,
		detectedAt: Date.now(),
		size: stats?.size,
		mtime: stats?.mtimeMs,
		priority,
	}
}

/**
 * Options for querying files
 */
export interface FileQueryOptions {
	/** Whether to include files with errors */
	includeErrors?: boolean

	/** Whether to include excluded files */
	includeExcluded?: boolean
}

/**
 * Class to track indexed files and their status
 */
export class FileTracker {
	/** Map of file paths to their info */
	private fileMap: Map<string, FileInfo> = new Map()

	/** Path to the state file */
	private statePath: string

	/** Whether the state has been loaded */
	private isLoaded: boolean = false

	/** Queue of files that need processing */
	private changeQueue: Map<string, FileChange> = new Map()

	/**
	 * @param config Configuration object
	 */
	constructor(private readonly config: CodeIndexerConfig) {
		this.statePath = path.join(path.dirname(config.databasePath), "file-tracker.json")
	}

	/**
	 * Load the state from disk
	 */
	public async load(): Promise<void> {
		if (this.isLoaded) {
			return
		}

		try {
			const exists = await fileExistsAtPath(this.statePath)
			if (!exists) {
				logger.debug("File tracker state does not exist, starting fresh")
				this.isLoaded = true
				return
			}

			const content = await fs.readFile(this.statePath, "utf-8")
			const data = JSON.parse(content) as Record<string, FileInfo>

			this.fileMap.clear()
			Object.entries(data).forEach(([path, info]) => {
				this.fileMap.set(path, info)
			})

			logger.debug(`Loaded ${this.fileMap.size} tracked files from state`)
			this.isLoaded = true
		} catch (error) {
			logger.error("Failed to load file tracker state:", error)
			// Start fresh
			this.fileMap.clear()
			this.isLoaded = true
		}
	}

	/**
	 * Save the state to disk
	 */
	public async save(): Promise<void> {
		try {
			// Convert map to object
			const data: Record<string, FileInfo> = {}
			this.fileMap.forEach((info, path) => {
				data[path] = info
			})

			// Create directory if it doesn't exist
			const dir = path.dirname(this.statePath)
			await fs.mkdir(dir, { recursive: true })

			// Write to file
			await fs.writeFile(this.statePath, JSON.stringify(data, null, 2))
			logger.debug(`Saved ${this.fileMap.size} tracked files to state`)
		} catch (error) {
			logger.error("Failed to save file tracker state:", error)
		}
	}

	/**
	 * Add or update a file in the tracker
	 * @param filePath Path to the file
	 * @returns True if the file needs indexing
	 */
	public async addFile(filePath: string): Promise<boolean> {
		// Ensure state is loaded
		if (!this.isLoaded) {
			await this.load()
		}

		// Normalize path
		const normalizedPath = normalizePath(filePath)

		// Check if the file should be excluded
		const status = await this.getFileStatus(normalizedPath)
		if (status === FileStatus.EXCLUDED) {
			return false
		}

		try {
			// Get file stats
			const stats = await fs.stat(normalizedPath)

			// Skip directories
			if (stats.isDirectory()) {
				return false
			}

			// Skip files that are too large
			if (stats.size > this.config.maxFileSizeBytes) {
				logger.debug(`Skipping file exceeding size limit: ${normalizedPath} (${stats.size} bytes)`)
				return false
			}

			// Get existing info
			const existingInfo = this.fileMap.get(normalizedPath)

			const oldHash = existingInfo?.hash

			// Create new info
			const newInfo: FileInfo = {
				path: normalizedPath,
				mtime: stats.mtimeMs,
				size: stats.size,
				// If file exists and hasn't changed, keep the same hash and indexedAt
				hash: existingInfo?.hash,
				previousHash: oldHash, // Store previous hash for change tracking
				indexedAt: existingInfo?.indexedAt,
			}

			// Update the map
			this.fileMap.set(normalizedPath, newInfo)

			// Create a change record if the file is new or modified
			if (status === FileStatus.NEW || status === FileStatus.MODIFIED) {
				return true
			}
			return false
		} catch (error) {
			logger.error(`Error adding file ${normalizedPath}:`, error)
			return false
		}
	}

	/**
	 * Remove a file from the tracker
	 * @param filePath Path to the file
	 * @returns True if the file was removed
	 */
	public async removeFile(filePath: string): Promise<boolean> {
		// Ensure state is loaded
		if (!this.isLoaded) {
			await this.load()
		}

		// Normalize path
		const normalizedPath = normalizePath(filePath)

		// Remove from map
		const deleted = this.fileMap.delete(normalizedPath)

		if (deleted) {
			logger.debug(`Removed file from tracker: ${normalizedPath}`)
		}

		// Add a change record
		this.changeQueue.set(
			normalizedPath,
			createFileChange(
				normalizedPath,
				FileStatus.DELETED,
				undefined,
				3, // Higher priority for deletions
			),
		)

		return deleted
	}

	/**
	 * Check if a file needs to be indexed
	 * @param filePath Path to the file
	 * @returns True if the file needs indexing
	 */
	public async needsIndexing(filePath: string): Promise<boolean> {
		// Ensure state is loaded
		if (!this.isLoaded) {
			await this.load()
		}

		// Normalize path
		const normalizedPath = normalizePath(filePath)

		// Get file info
		const fileInfo = this.fileMap.get(normalizedPath)

		// If not in the map, it needs indexing
		if (!fileInfo) {
			return true
		}

		try {
			// Check if the file exists
			const exists = await fileExistsAtPath(normalizedPath)
			if (!exists) {
				// Remove from tracker
				this.fileMap.delete(normalizedPath)
				return false
			}

			// Get file stats
			const stats = await fs.stat(normalizedPath)

			// Skip directories
			if (stats.isDirectory()) {
				return false
			}

			// Compare modification time
			if (stats.mtimeMs > fileInfo.mtime) {
				logger.debug(`File has been modified: ${normalizedPath}`)
				return true
			}

			// Compare file size
			if (stats.size !== fileInfo.size) {
				logger.debug(`File size has changed: ${normalizedPath}`)
				return true
			}

			// If file has never been indexed, it needs indexing
			if (!fileInfo.indexedAt) {
				logger.debug(`File has never been indexed: ${normalizedPath}`)
				return true
			}

			// File doesn't need indexing
			return false
		} catch (error) {
			logger.error(`Error checking if file needs indexing ${normalizedPath}:`, error)
			return false
		}
	}

	/**
	 * Get the status of a file
	 * @param filePath Path to the file
	 * @returns File status
	 */
	public async getFileStatus(filePath: string): Promise<FileStatus> {
		// Ensure state is loaded
		if (!this.isLoaded) {
			await this.load()
		}

		// Normalize path
		const normalizedPath = normalizePath(filePath)

		// Get existing info
		const fileInfo = this.fileMap.get(normalizedPath)

		// Determine status
		return await determineFileStatus(normalizedPath, fileInfo, this.config)
	}

	/**
	 * Get files that need processing
	 * @returns Map of file paths to changes
	 */
	public getChanges(): Map<string, FileChange> {
		return new Map(this.changeQueue)
	}

	/**
	 * Add a file change to the queue
	 * @param change File change
	 */
	public addChange(change: FileChange): void {
		// If there's already a change for this file, use the one with higher priority
		const existing = this.changeQueue.get(change.path)
		if (
			existing &&
			existing.priority !== undefined &&
			change.priority !== undefined &&
			existing.priority > change.priority
		) {
			return
		}

		this.changeQueue.set(change.path, change)
	}

	/**
	 * Remove a change from the queue
	 * @param filePath Path to the file
	 */
	public removeChange(filePath: string): void {
		// Normalize path
		const normalizedPath = normalizePath(filePath)
		this.changeQueue.delete(normalizedPath)
	}

	/**
	 * Check if a file has hash differences from its last indexed state
	 * @param filePath Path to the file
	 * @returns True if hash has changed
	 */
	public async hasHashChanged(filePath: string): Promise<boolean> {
		// Ensure state is loaded
		if (!this.isLoaded) {
			await this.load()
		}

		// Normalize path
		const normalizedPath = normalizePath(filePath)

		// Get file info
		const fileInfo = this.fileMap.get(normalizedPath)

		// If not in the map, or no hash, we can't compare
		if (!fileInfo || !fileInfo.hash) {
			return true
		}

		try {
			// Check if the file exists
			const exists = await fileExistsAtPath(normalizedPath)
			if (!exists) {
				return true
			}

			const content = await fs.readFile(normalizedPath, "utf-8")
			const currentHash = calculateFileHash(content)
			return currentHash !== fileInfo.hash
		} catch (error) {
			logger.error(`Error checking hash for ${normalizedPath}:`, error)
			return true
		}
	}

	/**
	 * Mark a file as indexed
	 * @param filePath Path to the file
	 * @param hash Optional hash of the file content
	 */
	public async markAsIndexed(filePath: string, hash?: string): Promise<void> {
		// Ensure state is loaded
		if (!this.isLoaded) {
			await this.load()
		}

		// Normalize path
		const normalizedPath = normalizePath(filePath)

		// Get file info
		const fileInfo = this.fileMap.get(normalizedPath)

		if (fileInfo) {
			// Update index time and hash
			fileInfo.indexedAt = Date.now()
			if (hash) {
				// Store the old hash before updating
				if (fileInfo.hash && fileInfo.hash !== hash) {
					fileInfo.previousHash = fileInfo.hash
				}
				fileInfo.hash = hash
			}

			this.fileMap.set(normalizedPath, fileInfo)
		}
	}

	/**
	 * Update the hash of a file (alias for markAsIndexed)
	 * @param filePath Path to the file
	 * @param hash Hash of the file content
	 */
	public async updateFileHash(filePath: string, hash: string): Promise<void> {
		// This is just an alias for markAsIndexed for compatibility
		await this.markAsIndexed(filePath, hash)

		// Remove from change queue if present
		this.removeChange(filePath)
	}

	/**
	 * Get files with a specific status
	 * @param status Status to filter by
	 * @param options Query options
	 * @returns Map of file paths to their info
	 */
	public async getFilesByStatus(status: FileStatus, options: FileQueryOptions = {}): Promise<Map<string, FileInfo>> {
		// Ensure state is loaded
		if (!this.isLoaded) {
			await this.load()
		}

		const allFiles = await this.getAllFiles()
		const result = new Map<string, FileInfo>()

		// For each file, check its status and add to result if it matches
		for (const [filePath, fileInfo] of allFiles.entries()) {
			try {
				const fileStatus = await this.getFileStatus(filePath)

				// Skip errors and excluded files unless explicitly included
				if (fileStatus === FileStatus.ERROR && !options.includeErrors) {
					continue
				}

				if (fileStatus === FileStatus.EXCLUDED && !options.includeExcluded) {
					continue
				}

				// Add files with matching status
				if (fileStatus === status) {
					result.set(filePath, fileInfo)
				}
			} catch (error) {
				logger.error(`Error getting status for file: ${filePath}`, error)
				// Skip files with errors
			}
		}

		// Will populate and return in future implementation
		return result
	}

	/**
	 * Get information about a file
	 * @param filePath Path to the file
	 * @returns File information or undefined if not found
	 */
	public async getFileInfo(filePath: string): Promise<FileInfo | undefined> {
		// Ensure state is loaded
		if (!this.isLoaded) {
			await this.load()
		}

		// Normalize path
		const normalizedPath = normalizePath(filePath)

		return this.fileMap.get(normalizedPath)
	}

	/**
	 * Get all tracked files
	 * @returns Map of file paths to their info
	 */
	public async getAllFiles(): Promise<Map<string, FileInfo>> {
		// Ensure state is loaded
		if (!this.isLoaded) {
			await this.load()
		}

		return new Map(this.fileMap)
	}

	/**
	 * Clear all tracked files
	 */
	public async clear(): Promise<void> {
		this.fileMap.clear()
		await this.save()
	}
}
