import * as path from "path"
import * as fs from "fs/promises"
import { logger } from "../../utils/logging"
import { ensureDatabaseDirectory, normalizePath } from "./path-utils"
import { FileInfo, FileStatus } from "./file-tracker"
import { CodeIndexerConfig } from "./config"

/**
 * Metadata about the entire index
 */
export interface IndexMetadata {
	/** Version of the metadata format */
	version: string

	/** Time the index was created */
	createdAt: number

	/** Time the index was last updated */
	lastUpdatedAt: number

	/** Number of files in the index */
	fileCount: number

	/** Number of chunks in the index */
	chunkCount: number

	/** Configuration used for indexing */
	config: Partial<CodeIndexerConfig>
}

/**
 * Metadata about a workspace
 */
export interface WorkspaceMetadata {
	/** Workspace root path */
	rootPath: string

	/** Time the workspace was first indexed */
	firstIndexedAt: number

	/** Time the workspace was last indexed */
	lastIndexedAt: number

	/** Number of files in the workspace */
	fileCount: number
}

/**
 * Extended file metadata interface
 */
export interface ExtendedFileMetadata extends FileInfo {
	/** Error information if indexing failed */
	error?: string

	/** Last time the file was checked */
	lastCheckedAt?: number

	/** Number of chunks in the file */
	chunkCount?: number

	/** Additional file-specific metadata */
	metadata?: Record<string, any>
}

/**
 * Result of a metadata comparison
 */
export interface MetadataComparisonResult {
	/** Files that are new and need indexing */
	newFiles: string[]

	/** Files that have been modified and need re-indexing */
	modifiedFiles: string[]

	/** Files that have been deleted and need to be removed from the index */
	deletedFiles: string[]

	/** Files that are unchanged and don't need re-indexing */
	unchangedFiles: string[]

	/** Files that couldn't be processed due to errors */
	errorFiles: string[]
}

/**
 * Class to manage metadata storage, persistence, and queries
 */
export class MetadataManager {
	/** Path to the metadata directory */
	private metadataDir: string

	/** Path to the index metadata file */
	private indexMetadataPath: string

	/** Path to the file metadata directory */
	private fileMetadataDir: string

	/** In-memory cache of file metadata */
	private fileMetadataCache: Map<string, ExtendedFileMetadata> = new Map()

	/** Index metadata */
	private indexMetadata: IndexMetadata | null = null

	/** Whether the metadata is loaded */
	private isLoaded: boolean = false

	/**
	 * @param config Configuration object
	 */
	constructor(private readonly config: CodeIndexerConfig) {
		// Set up paths
		const dbDir = path.dirname(config.databasePath)
		this.metadataDir = path.join(dbDir, "metadata")
		this.indexMetadataPath = path.join(this.metadataDir, "index.json")
		this.fileMetadataDir = path.join(this.metadataDir, "files")
	}

	/**
	 * Initialize metadata storage
	 */
	public async initialize(): Promise<void> {
		try {
			// Ensure metadata directories exist
			await ensureDatabaseDirectory(this.metadataDir)
			await ensureDatabaseDirectory(this.fileMetadataDir)

			// Try to load existing metadata
			await this.load()

			logger.debug(`Metadata manager initialized at ${this.metadataDir}`)
		} catch (error) {
			logger.error(`Failed to initialize metadata manager:`, error)
			throw new Error(`Failed to initialize metadata manager: ${error}`)
		}
	}

	/**
	 * Load metadata from disk
	 */
	public async load(): Promise<void> {
		if (this.isLoaded) {
			return
		}

		try {
			// Load index metadata
			try {
				const indexMetadataContent = await fs.readFile(this.indexMetadataPath, "utf-8")
				this.indexMetadata = JSON.parse(indexMetadataContent) as IndexMetadata
				logger.debug(`Loaded index metadata from ${this.indexMetadataPath}`)
			} catch (error) {
				// If the file doesn't exist or is invalid, create new metadata
				logger.debug(`Index metadata not found or invalid, creating new`)
				this.indexMetadata = this.createDefaultIndexMetadata()
			}

			// Load file metadata
			const files = await fs.readdir(this.fileMetadataDir).catch(() => [])

			for (const file of files) {
				if (!file.endsWith(".json")) continue

				try {
					const filePath = path.join(this.fileMetadataDir, file)
					const content = await fs.readFile(filePath, "utf-8")
					const metadata = JSON.parse(content) as ExtendedFileMetadata

					// Use the filepath from the metadata as the key
					if (metadata.path) {
						this.fileMetadataCache.set(metadata.path, metadata)
					}
				} catch (error) {
					logger.error(`Error loading metadata file ${file}:`, error)
				}
			}

			logger.debug(`Loaded ${this.fileMetadataCache.size} file metadata records`)
			this.isLoaded = true
		} catch (error) {
			logger.error(`Failed to load metadata:`, error)
			// Start fresh
			this.indexMetadata = this.createDefaultIndexMetadata()
			this.fileMetadataCache.clear()
			this.isLoaded = true
		}
	}

	/**
	 * Save all metadata to disk
	 */
	public async save(): Promise<void> {
		if (!this.isLoaded) {
			await this.load()
		}

		try {
			// Update index metadata
			if (this.indexMetadata) {
				this.indexMetadata.lastUpdatedAt = Date.now()
				this.indexMetadata.fileCount = this.fileMetadataCache.size

				await fs.writeFile(this.indexMetadataPath, JSON.stringify(this.indexMetadata, null, 2))
				logger.debug(`Saved index metadata to ${this.indexMetadataPath}`)
			}

			// Save file metadata
			// Only save files that have been modified since load
			for (const [filePath, metadata] of this.fileMetadataCache.entries()) {
				// Create a hash of the filepath to use as the filename
				const hash = Buffer.from(filePath)
					.toString("base64")
					.replace(/\//g, "_")
					.replace(/\+/g, "-")
					.replace(/=/g, "")

				const filePath2 = path.join(this.fileMetadataDir, `${hash}.json`)
				await fs.writeFile(filePath2, JSON.stringify(metadata, null, 2))
			}

			logger.debug(`Saved ${this.fileMetadataCache.size} file metadata records`)
		} catch (error) {
			logger.error(`Failed to save metadata:`, error)
			throw error
		}
	}

	/**
	 * Create default index metadata
	 * @returns Default index metadata
	 */
	private createDefaultIndexMetadata(): IndexMetadata {
		const now = Date.now()

		return {
			version: "1.0",
			createdAt: now,
			lastUpdatedAt: now,
			fileCount: 0,
			chunkCount: 0,
			config: {
				maxFileSizeBytes: this.config.maxFileSizeBytes,
				maxChunkSize: this.config.maxChunkSize,
				chunkOverlap: this.config.chunkOverlap,
				embeddingModel: this.config.embeddingModel,
			},
		}
	}

	/**
	 * Get metadata for a file
	 * @param filePath Path to the file
	 * @returns File metadata or undefined if not found
	 */
	public async getFileMetadata(filePath: string): Promise<ExtendedFileMetadata | undefined> {
		if (!this.isLoaded) {
			await this.load()
		}

		const normalizedPath = normalizePath(filePath)
		return this.fileMetadataCache.get(normalizedPath)
	}

	/**
	 * Update metadata for a file
	 * @param filePath Path to the file
	 * @param metadata File metadata
	 */
	public async updateFileMetadata(filePath: string, metadata: Partial<ExtendedFileMetadata>): Promise<void> {
		if (!this.isLoaded) {
			await this.load()
		}

		const normalizedPath = normalizePath(filePath)
		const existing = this.fileMetadataCache.get(normalizedPath)

		const newMetadata: ExtendedFileMetadata = {
			...existing,
			...metadata,
			path: normalizedPath,
		} as ExtendedFileMetadata

		this.fileMetadataCache.set(normalizedPath, newMetadata)
	}

	/**
	 * Remove metadata for a file
	 * @param filePath Path to the file
	 */
	public async removeFileMetadata(filePath: string): Promise<void> {
		if (!this.isLoaded) {
			await this.load()
		}

		const normalizedPath = normalizePath(filePath)
		this.fileMetadataCache.delete(normalizedPath)

		// Try to remove the file from disk
		try {
			// Create a hash of the filepath to use as the filename
			const hash = Buffer.from(normalizedPath)
				.toString("base64")
				.replace(/\//g, "_")
				.replace(/\+/g, "-")
				.replace(/=/g, "")

			const metadataFilePath = path.join(this.fileMetadataDir, `${hash}.json`)
			await fs.unlink(metadataFilePath).catch(() => {})
		} catch (error) {
			// Ignore errors when removing metadata files
			logger.debug(`Error removing metadata file for ${normalizedPath}:`, error)
		}
	}

	/**
	 * Get all file metadata
	 * @returns Map of file paths to their metadata
	 */
	public async getAllFileMetadata(): Promise<Map<string, ExtendedFileMetadata>> {
		if (!this.isLoaded) {
			await this.load()
		}

		return new Map(this.fileMetadataCache)
	}

	/**
	 * Determine which files have changed since they were last indexed
	 * @param filePaths Array of file paths to check
	 * @param fileStatusMap Map of file paths to their current status
	 * @returns Result of the comparison
	 */
	public async compareFileMetadata(
		filePaths: string[],
		fileStatusMap: Map<string, FileStatus>,
	): Promise<MetadataComparisonResult> {
		if (!this.isLoaded) {
			await this.load()
		}

		const result: MetadataComparisonResult = {
			newFiles: [],
			modifiedFiles: [],
			deletedFiles: [],
			unchangedFiles: [],
			errorFiles: [],
		}

		// Check each file
		for (const filePath of filePaths) {
			const normalizedPath = normalizePath(filePath)
			const status = fileStatusMap.get(normalizedPath) || FileStatus.NEW

			switch (status) {
				case FileStatus.NEW:
					result.newFiles.push(normalizedPath)
					break
				case FileStatus.MODIFIED:
					result.modifiedFiles.push(normalizedPath)
					break
				case FileStatus.DELETED:
					result.deletedFiles.push(normalizedPath)
					break
				case FileStatus.UNCHANGED:
					result.unchangedFiles.push(normalizedPath)
					break
				case FileStatus.ERROR:
					result.errorFiles.push(normalizedPath)
					break
				default:
					// Skip excluded files
					break
			}
		}

		// Find files in metadata that are not in the file list (deleted)
		for (const [filePath] of this.fileMetadataCache) {
			if (!filePaths.includes(filePath) && !filePaths.includes(normalizePath(filePath))) {
				result.deletedFiles.push(filePath)
			}
		}

		logger.debug(
			`File comparison result: new=${result.newFiles.length}, modified=${result.modifiedFiles.length}, deleted=${result.deletedFiles.length}, unchanged=${result.unchangedFiles.length}, error=${result.errorFiles.length}`,
		)

		return result
	}

	/**
	 * Update chunk count for a file
	 * @param filePath Path to the file
	 * @param chunkCount Number of chunks in the file
	 */
	public async updateChunkCount(filePath: string, chunkCount: number): Promise<void> {
		await this.updateFileMetadata(filePath, { chunkCount })

		// Update index metadata
		if (this.indexMetadata) {
			let totalChunks = 0
			for (const metadata of this.fileMetadataCache.values()) {
				totalChunks += metadata.chunkCount || 0
			}
			this.indexMetadata.chunkCount = totalChunks
		}
	}

	/**
	 * Get the index metadata
	 * @returns Index metadata
	 */
	public getIndexMetadata(): IndexMetadata | null {
		return this.indexMetadata
	}

	/**
	 * Reset all metadata
	 */
	public async reset(): Promise<void> {
		this.fileMetadataCache.clear()
		this.indexMetadata = this.createDefaultIndexMetadata()

		// Delete all metadata files
		try {
			const files = await fs.readdir(this.fileMetadataDir).catch(() => [])

			for (const file of files) {
				if (!file.endsWith(".json")) continue

				try {
					const filePath = path.join(this.fileMetadataDir, file)
					await fs.unlink(filePath)
				} catch (error) {
					logger.error(`Error deleting metadata file ${file}:`, error)
				}
			}

			// Save fresh metadata
			await this.save()

			logger.debug(`Metadata reset complete`)
		} catch (error) {
			logger.error(`Failed to reset metadata:`, error)
			throw error
		}
	}
}
