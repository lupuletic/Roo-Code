import { connect, Connection, Table } from "@lancedb/lancedb"
import "@lancedb/lancedb/embedding/openai"
import { LanceSchema, getRegistry } from "@lancedb/lancedb/embedding"
import { Utf8, Int32 } from "apache-arrow"
import { v4 as uuid } from "uuid"
import * as fs from "fs"
import * as vscode from "vscode"
import { logger } from "../../utils/logging"

import { CodeChunk, getChunks, getChunksBatch } from "./chunker"
import { CodeIndexerConfig, getDefaultConfig } from "./config"
import { ensureDatabaseDirectory, validatePath, normalizePath } from "./path-utils"
import { calculateFileHash, FileTracker, FileStatus } from "./file-tracker"
import { MetadataManager, MetadataComparisonResult } from "./metadata"

export type IndexedCodeChunk = CodeChunk & {
	uuid: string
}

export type CodeSearchResult = IndexedCodeChunk & {
	vector: Float32Array
	_distance: number
}

// Interface for batch indexing progress
export interface IndexingProgress {
	totalFiles: number
	processedFiles: number
	currentFile?: string
	errors?: Record<string, string>
}

export class CodeSearch {
	private readonly tableName: string = "code_chunks"
	private readonly config: CodeIndexerConfig
	private fileTracker: FileTracker
	private metadataManager: MetadataManager

	private connection?: Connection
	private _table?: Table
	private isInitialized: boolean = false

	// Event emitter for progress reporting
	private _onProgress: vscode.EventEmitter<IndexingProgress> = new vscode.EventEmitter<IndexingProgress>()

	constructor(private readonly context: vscode.ExtensionContext) {
		this.config = getDefaultConfig(context)
		this.fileTracker = new FileTracker(this.config)
		this.metadataManager = new MetadataManager(this.config)
		logger.debug(`CodeSearch initialized with database path: ${this.config.databasePath}`)
	}

	// Event to subscribe to for progress updates
	public readonly onProgress: vscode.Event<IndexingProgress> = this._onProgress.event

	// Access to the LanceDB table
	public get table() {
		if (!this._table) {
			throw new Error("LanceDB table not initialized. Call initialize() first.")
		}

		return this._table
	}

	public async initialize() {
		if (this.isInitialized) {
			return
		}

		// Ensure the database directory exists
		await ensureDatabaseDirectory(this.config.databasePath)
		logger.debug(`Verified database directory at ${this.config.databasePath}`)

		// Initialize metadata manager
		await this.metadataManager.initialize()
		logger.debug(`Initialized metadata manager`)

		// Initialize file tracker
		await this.fileTracker.load()

		// Try to connect to the database
		try {
			// Validate the path exists before connecting
			const isValid = await validatePath(this.config.databasePath)
			if (!isValid) {
				throw new Error(`Database path doesn't exist or is not accessible: ${this.config.databasePath}`)
			}

			this.connection = await connect(this.config.databasePath)
			logger.debug(`Connected to LanceDB at ${this.config.databasePath}`)
		} catch (error) {
			logger.error(`Failed to connect to LanceDB at ${this.config.databasePath}:`, error)
			throw new Error(`Failed to connect to vector database at ${this.config.databasePath}: ${error}`)
		}

		const fnCreator = getRegistry().get("openai")

		if (!fnCreator) {
			throw new Error("OpenAI embedding function not found. Is the OpenAI API key set?")
		}

		const embeddingFn = fnCreator.create({
			model: this.config.embeddingModel,
		})

		try {
			this._table = await this.connection.openTable(this.tableName)
			logger.debug(`Opened existing table ${this.tableName}`)
		} catch {
			logger.debug(`Creating new table ${this.tableName}`)
			const schema = LanceSchema({
				uuid: new Utf8(),
				chunk: embeddingFn.sourceField(new Utf8()),
				start: new Int32(),
				end: new Int32(),
				type: new Utf8(),
				filepath: new Utf8(),
				vector: embeddingFn.vectorField(),
			})

			this._table = await this.connection.createEmptyTable(this.tableName, schema, { mode: "overwrite" })
			logger.debug(`Created new table ${this.tableName}`)

			this.table.createIndex("uuid")
			logger.debug(`Created index on uuid column`)
		}

		this.isInitialized = true
		logger.debug(`CodeSearch initialization complete`)
	}

	/**
	 * Index multiple files in a batch operation with progress tracking
	 * @param filePaths Array of file paths to index
	 * @param options Optional parameters for indexing
	 * @returns Promise resolving to indexing result
	 */
	public async indexFiles(
		filePaths: string[],
		options?: {
			progressTitle?: string
			batchSize?: number
		},
	): Promise<{
		chunks: IndexedCodeChunk[]
		errors: Record<string, string>
	}> {
		const batchSize = options?.batchSize || 50
		const progressTitle = options?.progressTitle || "Indexing files"

		logger.debug(`Indexing ${filePaths.length} files with batch size ${batchSize}`)
		const allChunks: IndexedCodeChunk[] = []
		const errors: Record<string, string> = {}
		let processedFiles = 0

		// Initialize progress
		this._onProgress.fire({
			totalFiles: filePaths.length,
			processedFiles: 0,
		})

		try {
			// Create a map of file statuses by checking each file
			const fileStatusMap = new Map<string, FileStatus>()

			for (const filePath of filePaths) {
				try {
					const status = await this.fileTracker.getFileStatus(filePath)
					fileStatusMap.set(normalizePath(filePath), status)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error)
					errors[filePath] = `Error getting file status: ${errorMessage}`
					logger.error(`Error checking status for ${filePath}:`, error)
				}
			}

			// Compare with metadata to determine which files need processing
			const comparisonResult = await this.metadataManager.compareFileMetadata(
				filePaths.filter((path) => !errors[path]),
				fileStatusMap,
			)

			logger.debug(
				`File comparison results: new=${comparisonResult.newFiles.length}, modified=${comparisonResult.modifiedFiles.length}, deleted=${comparisonResult.deletedFiles.length}`,
			)

			// Process deleted files first
			if (comparisonResult.deletedFiles.length > 0) {
				await this.removeFiles(comparisonResult.deletedFiles)
				processedFiles += comparisonResult.deletedFiles.length

				// Update progress
				this._onProgress.fire({
					totalFiles: filePaths.length,
					processedFiles,
					errors,
				})
			}

			// Process new and modified files
			const filesToProcess = [...comparisonResult.newFiles, ...comparisonResult.modifiedFiles]

			// Process files in batches
			for (let i = 0; i < filesToProcess.length; i += batchSize) {
				const batch = filesToProcess.slice(i, i + batchSize)

				// Get chunks for all files in this batch
				const { chunks, errors: chunkErrors } = await getChunksBatch(batch, (processed, total, currentFile) => {
					this._onProgress.fire({
						totalFiles: filePaths.length,
						processedFiles: processedFiles + processed,
						currentFile,
						errors,
					})
				})

				// Add any chunking errors to our error tracking
				Object.assign(errors, chunkErrors)

				// Index the chunks
				if (chunks.length > 0) {
					const records = chunks.map((chunk) => ({
						uuid: uuid(),
						...chunk,
					}))

					// Add to database
					try {
						await this.table.add(records)
						allChunks.push(...records)

						// Update file tracking and metadata for successfully chunked files
						for (const filePath of batch) {
							if (!chunkErrors[filePath]) {
								const fileChunks = records.filter((r) => r.filepath === filePath)

								if (fileChunks.length > 0) {
									// Calculate file hash
									const content = fileChunks.map((r) => r.chunk).join("\n")
									const hash = calculateFileHash(content)

									// Update file tracking
									await this.fileTracker.updateFileHash(filePath, hash)

									// Update metadata
									await this.metadataManager.updateFileMetadata(filePath, {
										hash,
										indexedAt: Date.now(),
										chunkCount: fileChunks.length,
									})
								}
							}
						}
					} catch (error) {
						logger.error(`Error adding batch of chunks to database:`, error)
						const errorMessage = error instanceof Error ? error.message : String(error)
						for (const filePath of batch) {
							if (!errors[filePath]) {
								errors[filePath] = `Error adding to database: ${errorMessage}`
							}
						}
					}
				}

				processedFiles += batch.length

				// Update progress
				this._onProgress.fire({
					totalFiles: filePaths.length,
					processedFiles,
					errors,
				})
			}

			// Save metadata and file tracker state
			await this.saveState()

			// Final progress update
			this._onProgress.fire({
				totalFiles: filePaths.length,
				processedFiles: filePaths.length,
				errors,
			})

			return { chunks: allChunks, errors }
		} catch (error) {
			logger.error(`Error during batch indexing:`, error)
			const errorMessage = error instanceof Error ? error.message : String(error)

			// Update progress with the error
			this._onProgress.fire({
				totalFiles: filePaths.length,
				processedFiles,
				errors: { ...errors, global: errorMessage },
			})

			return { chunks: allChunks, errors }
		}
	}

	/**
	 * Check index consistency, identifying and cleaning up orphaned records
	 * @returns Object containing statistics about the consistency check
	 */
	public async checkIndexConsistency(): Promise<{
		total: number
		orphaned: number
		removed: number
		errors: Record<string, string>
	}> {
		logger.debug("Checking index consistency")

		const errors: Record<string, string> = {}
		let orphaned = 0
		let removed = 0

		try {
			// Get all indexed files from the database
			const indexedFiles = await this.getIndexedFiles()

			// Check each file to see if it still exists on disk
			for (const filepath of indexedFiles) {
				try {
					await fs.promises.access(filepath, fs.constants.F_OK)
				} catch (error) {
					// File doesn't exist anymore, mark as orphaned
					orphaned++

					// Remove from index
					try {
						await this.removeFile(filepath)
						removed++
					} catch (removeError) {
						const errorMessage = removeError instanceof Error ? removeError.message : String(removeError)
						errors[filepath] = `Error removing orphaned file: ${errorMessage}`
						logger.error(`Error removing orphaned file ${filepath}:`, removeError)
					}
				}
			}

			// Check for metadata consistency
			const metadata = await this.metadataManager.getAllFileMetadata()
			const metadataFiles = Array.from(metadata.keys())

			// Check for files in metadata but not in the database
			for (const metadataFile of metadataFiles) {
				if (metadataFile === "__stats__") continue // Skip stats record

				if (!indexedFiles.includes(metadataFile)) {
					// File is in metadata but not in database
					try {
						await this.metadataManager.removeFileMetadata(metadataFile)
						logger.debug(`Removed orphaned metadata for ${metadataFile}`)
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error)
						errors[metadataFile] = `Error removing orphaned metadata: ${errorMessage}`
						logger.error(`Error removing orphaned metadata for ${metadataFile}:`, error)
					}
				}
			}

			// Save state after cleaning up
			await this.saveState()

			return {
				total: indexedFiles.length,
				orphaned,
				removed,
				errors,
			}
		} catch (error) {
			logger.error(`Error checking index consistency:`, error)
			const errorMessage = error instanceof Error ? error.message : String(error)
			return {
				total: 0,
				orphaned,
				removed,
				errors: { ...errors, global: errorMessage },
			}
		}
	}

	/**
	 * Remove files from the index
	 * @param filePaths Array of file paths to remove
	 * @returns Object containing results of the removal operation
	 */
	public async removeFiles(filePaths: string[]): Promise<{
		removed: string[]
		errors: Record<string, string>
	}> {
		logger.debug(`Removing ${filePaths.length} files from index`)
		const removed: string[] = []
		const errors: Record<string, string> = {}

		for (const filePath of filePaths) {
			try {
				await this.removeFile(filePath)
				removed.push(filePath)
			} catch (error) {
				logger.error(`Error removing file ${filePath} from index:`, error)
				const errorMessage = error instanceof Error ? error.message : String(error)
				errors[filePath] = errorMessage
			}
		}

		// Save state after removal
		await this.saveState()

		return { removed, errors }
	}

	/**
	 * Save the current state of the index
	 */
	private async saveState(): Promise<void> {
		try {
			// Save file tracker state
			await this.fileTracker.save()

			// Save metadata
			await this.metadataManager.save()

			logger.debug("Index state saved successfully")
		} catch (error) {
			logger.error("Error saving index state:", error)
		}
	}

	/**
	 * Index a single file
	 * @param filepath Path to the file to index
	 * @returns Indexed chunks or null if there was an error
	 */
	public async indexFile(filepath: string): Promise<IndexedCodeChunk[] | null> {
		try {
			const chunks = await getChunks(filepath)
			const records = chunks.map((chunk) => ({
				uuid: uuid(),
				...chunk,
			}))

			if (records.length === 0) {
				logger.debug(`No chunks found in file ${filepath}`)
				return []
			}

			await this.table.add(records)
			logger.debug(`Added ${records.length} chunks from ${filepath}`)

			// Calculate file hash
			const content = records.map((r) => r.chunk).join("\n")
			const hash = calculateFileHash(content)

			// Update file tracking
			await this.fileTracker.updateFileHash(filepath, hash)

			// Update metadata
			await this.metadataManager.updateFileMetadata(filepath, {
				hash,
				indexedAt: Date.now(),
				chunkCount: records.length,
			})

			return records
		} catch (error) {
			logger.error(`Error adding chunks to database for ${filepath}:`, error)
			throw error
		}
	}

	/**
	 * Remove a file from the index
	 * @param filepath Path to the file to remove
	 * @returns True if successful, throws error otherwise
	 */
	public async removeFile(filepath: string): Promise<boolean> {
		logger.debug(`Removing file ${filepath} from index`)

		try {
			// Check if we need an efficient deletion approach
			// Count the number of records in the database
			const totalRecords = await this.table.countRows()

			// Find records for this file
			const query = `filepath == '${filepath.replace(/'/g, "\\'")}'`
			const fileRecords = await this.table.query().where(query).toArray()

			if (fileRecords.length === 0) {
				// No records found, nothing to delete
				logger.debug(`No records found for file ${filepath}`)

				// Still remove from file tracker and metadata
				this.fileTracker.removeFile(filepath)
				await this.metadataManager.removeFileMetadata(filepath)

				return true
			}

			// Calculate the ratio of records to be deleted
			const deleteRatio = fileRecords.length / totalRecords

			if (deleteRatio > 0.5) {
				// If we're deleting more than half the records, it's more efficient
				// to recreate the table with only the records we want to keep
				logger.debug(
					`Deleting ${fileRecords.length} records (${(deleteRatio * 100).toFixed(2)}% of total) from ${filepath}`,
				)

				// Get all records and filter out the ones we want to delete
				const allRecords = await this.table.query().toArray()
				const recordsToKeep = allRecords.filter((r) => r.filepath !== filepath)

				// Drop the table and recreate it
				await this.connection?.dropTable(this.tableName)
				await this.initialize()

				// Add back the records we want to keep
				if (recordsToKeep.length > 0) {
					await this.table.add(recordsToKeep)
				}
			} else {
				// For smaller deletions, delete records one by one or in batches
				logger.debug(`Deleting ${fileRecords.length} records from ${filepath}`)

				// Get the UUIDs of records to delete
				const uuidsToDelete = fileRecords.map((r) => r.uuid)

				// Recreate table without these records (workaround for lack of direct delete)
				const allRecords = await this.table.query().toArray()
				const recordsToKeep = allRecords.filter((r) => !uuidsToDelete.includes(r.uuid))

				await this.connection?.dropTable(this.tableName)
				await this.initialize()
				if (recordsToKeep.length > 0) await this.table.add(recordsToKeep)
			}

			this.fileTracker.removeFile(filepath)
			await this.metadataManager.removeFileMetadata(filepath)
			logger.debug(`Removed ${filepath} from index, file tracker, and metadata`)
			return true
		} catch (error) {
			logger.error(`Error removing file ${filepath} from index:`, error)
			throw error
		}
	}

	/**
	 * Check if a file is already indexed
	 * @param filepath Path to the file
	 * @returns True if the file is indexed
	 */
	public async isFileIndexed(filepath: string): Promise<boolean> {
		try {
			const result = await this.table.query().where(`filepath == '${filepath}'`).limit(1).toArray()
			return result.length > 0
		} catch (error) {
			logger.error(`Error checking if file ${filepath} is indexed:`, error)
			return false
		}
	}

	/**
	 * Get all indexed files
	 * @returns Array of file paths
	 */
	public async getIndexedFiles(): Promise<string[]> {
		try {
			const allRecords = await this.table.query().select(["filepath"]).toArray()
			// Use a Set to get unique filepaths
			const uniqueFilepaths = new Set(allRecords.map((r: { filepath: string }) => r.filepath))
			return Array.from(uniqueFilepaths)
		} catch (error: any) {
			logger.error(`Error getting indexed files:`, error)
			return []
		}
	}

	public async find(uuid: string): Promise<IndexedCodeChunk | undefined> {
		const result = await this.table.query().where(`uuid == '${uuid}'`).limit(1).toArray()

		return result[0]
	}

	public async search({
		query,
		limit = 5,
		distanceThreshold,
	}: {
		query: string
		limit?: number
		distanceThreshold?: number
	}): Promise<CodeSearchResult[]> {
		logger.debug(`Searching for: ${query} (limit: ${limit})`)

		try {
			const results = await this.table.search(query).limit(limit).toArray()
			logger.debug(`Found ${results.length} results`)

			if (distanceThreshold) {
				const filtered = results.filter(({ _distance }) => _distance <= distanceThreshold)
				logger.debug(`Filtered to ${filtered.length} results with distance <= ${distanceThreshold}`)
				return filtered
			}

			return results
		} catch (error) {
			logger.error(`Error searching:`, error)
			return []
		}
	}

	/**
	 * Get database statistics
	 * @returns Statistics about the indexed content
	 */
	public async getStats(): Promise<{ fileCount: number; chunkCount: number }> {
		try {
			// Try to get stats from metadata first
			const indexMetadata = this.metadataManager.getIndexMetadata()
			if (indexMetadata) {
				return {
					fileCount: indexMetadata.fileCount,
					chunkCount: indexMetadata.chunkCount,
				}
			}

			// Get all records
			const allRecords = await this.table.query().toArray()

			// Count unique filepaths
			const uniqueFilepaths = new Set(allRecords.map((r: { filepath: string }) => r.filepath))

			// Update metadata with the calculated stats
			if (this.isInitialized) {
				await this.metadataManager.updateFileMetadata("__stats__", {
					path: "__stats__",
					size: 0,
					mtime: Date.now(),
					metadata: {
						fileCount: uniqueFilepaths.size,
						chunkCount: allRecords.length,
					},
				})
			}

			// Return statistics
			return { fileCount: uniqueFilepaths.size, chunkCount: allRecords.length }
		} catch (error) {
			logger.error(`Error getting stats:`, error)
			return { fileCount: 0, chunkCount: 0 }
		}
	}

	public async clear() {
		if (this.connection) {
			logger.debug(`Clearing index`)
			await this.connection.dropTable(this.tableName)
			await this.initialize()
			this.fileTracker.clear()
			await this.metadataManager.reset()
			await this.saveState()
			logger.debug(`Index cleared`)
		}
	}

	private static instance?: CodeSearch

	public static async getInstance(context: vscode.ExtensionContext) {
		if (!this.instance) {
			this.instance = new CodeSearch(context)
			await this.instance.initialize()
		}

		return this.instance
	}
}
