import * as path from "path"
import * as fs from "fs/promises"
import { logger } from "../../utils/logging"
import { FileStatus, FileTracker, FileInfo, FileChange } from "./file-tracker"
import { MetadataManager, MetadataComparisonResult, ExtendedFileMetadata } from "./metadata"
import { CodeIndexerConfig, shouldExcludeFile, normalizePath } from "./config"
import { fileExistsAtPath } from "../../utils/fs"

/**
 * Result of a file change detection operation
 */
export interface ChangeDetectionResult {
	/** Files that need to be indexed */
	filesToIndex: string[]

	/** Files that need to be removed from the index */
	filesToRemove: string[]

	/** Files that haven't changed */
	unchangedFiles: string[]

	/** Files that were skipped (e.g., excluded patterns, too large) */
	skippedFiles: string[]

	/** Files that had errors during processing */
	errorFiles: string[]

	/** Detailed comparison result with additional metadata */
	comparisonResult: MetadataComparisonResult
}

/**
 * Options for file change detection
 */
export interface ChangeDetectionOptions {
	/** Whether to force reindex even for unchanged files */
	forceReindex?: boolean

	/** Whether to compare file hashes for more accurate change detection */
	useHashComparison?: boolean

	/** Whether to include excluded files in the result */
	includeExcluded?: boolean

	/** Whether to include error files in the result */
	includeErrors?: boolean
}

/**
 * Class that implements file change detection logic
 */
export class ChangeDetector {
	/**
	 * @param fileTracker FileTracker instance
	 * @param metadataManager MetadataManager instance
	 * @param config Configuration options
	 */
	constructor(
		private readonly fileTracker: FileTracker,
		private readonly metadataManager: MetadataManager,
		private readonly config: CodeIndexerConfig,
	) {}

	/**
	 * Detect changes in workspace files
	 * @param filePaths Array of file paths to check
	 * @param options Detection options
	 * @returns Change detection result
	 */
	public async detectChanges(
		filePaths: string[],
		options: ChangeDetectionOptions = {},
	): Promise<ChangeDetectionResult> {
		logger.debug(`Detecting changes in ${filePaths.length} files`)

		// Get file status for each file
		const fileStatusMap = new Map<string, FileStatus>()
		const skippedFiles: string[] = []
		const errorFiles: string[] = []

		for (const filePath of filePaths) {
			try {
				// Normalize path
				const normalizedPath = normalizePath(filePath)

				// Check if file is excluded
				if (shouldExcludeFile(normalizedPath, this.config.excludePatterns)) {
					skippedFiles.push(normalizedPath)
					continue
				}

				// Get file status
				let status = await this.fileTracker.getFileStatus(normalizedPath)

				// If using hash comparison and file is not new/deleted
				if (options.useHashComparison && status !== FileStatus.NEW && status !== FileStatus.DELETED) {
					// Check if hash has changed
					const hashChanged = await this.fileTracker.hasHashChanged(normalizedPath)
					if (hashChanged && status === FileStatus.UNCHANGED) {
						status = FileStatus.MODIFIED
					}
				}

				// Force reindex if specified
				if (options.forceReindex && status === FileStatus.UNCHANGED) {
					status = FileStatus.MODIFIED
				}

				fileStatusMap.set(normalizedPath, status)

				if (status === FileStatus.ERROR) {
					errorFiles.push(normalizedPath)
				}
			} catch (error) {
				logger.error(`Error checking file status for ${filePath}:`, error)
				errorFiles.push(filePath)
			}
		}

		// Compare with metadata to get a comprehensive change set
		const comparisonResult = await this.metadataManager.compareFileMetadata(filePaths, fileStatusMap)

		// Build the final result
		const result: ChangeDetectionResult = {
			filesToIndex: [...comparisonResult.newFiles, ...comparisonResult.modifiedFiles],
			filesToRemove: [...comparisonResult.deletedFiles],
			unchangedFiles: [...comparisonResult.unchangedFiles],
			skippedFiles,
			errorFiles: [...comparisonResult.errorFiles, ...errorFiles],
			comparisonResult,
		}

		// Log summary
		logger.debug(
			`Change detection complete: to index=${result.filesToIndex.length}, to remove=${result.filesToRemove.length}, unchanged=${result.unchangedFiles.length}, skipped=${result.skippedFiles.length}, errors=${result.errorFiles.length}`,
		)

		return result
	}

	/**
	 * Identify files modified since last index
	 * @param workspaceRoot Root directory of the workspace
	 * @param lastIndexTime Time of last indexing (or 0 for initial indexing)
	 * @returns Array of modified file paths
	 */
	public async findModifiedSince(workspaceRoot: string, lastIndexTime: number = 0): Promise<string[]> {
		logger.debug(`Finding files modified since ${new Date(lastIndexTime).toISOString()}`)

		try {
			// Get all files that are currently being tracked
			const trackedFiles = await this.fileTracker.getAllFiles()
			const modifiedFiles: string[] = []

			// Check each file to see if it's been modified since the last index time
			for (const [filePath, fileInfo] of trackedFiles.entries()) {
				try {
					// Skip files that are not under the workspace root
					if (!filePath.startsWith(workspaceRoot)) {
						continue
					}

					// Skip files that have been indexed after the last index time
					if (fileInfo.indexedAt && fileInfo.indexedAt > lastIndexTime) {
						continue
					}

					// Check if file exists
					const exists = await fileExistsAtPath(filePath)
					if (!exists) {
						modifiedFiles.push(filePath) // File is deleted, consider it modified
						continue
					}

					// Get file stats
					const stats = await fs.stat(filePath)

					// Check if file has been modified since last index time
					if (stats.mtimeMs > lastIndexTime) {
						modifiedFiles.push(filePath)
					}
				} catch (error) {
					logger.error(`Error checking modification time for ${filePath}:`, error)
				}
			}

			logger.debug(`Found ${modifiedFiles.length} files modified since ${new Date(lastIndexTime).toISOString()}`)
			return modifiedFiles
		} catch (error) {
			logger.error(`Error finding modified files:`, error)
			return []
		}
	}

	/**
	 * Compare file states to detect changes
	 * @param oldMetadata Previous file metadata
	 * @param newMetadata Current file metadata
	 * @returns True if the file has changed
	 */
	public compareFileStates(
		oldMetadata: ExtendedFileMetadata | undefined,
		newMetadata: FileInfo | undefined,
	): boolean {
		// If either metadata is missing, the file has changed
		if (!oldMetadata || !newMetadata) {
			return true
		}

		// Compare modification time
		if (newMetadata.mtime > oldMetadata.mtime) {
			return true
		}

		// Compare size
		if (newMetadata.size !== oldMetadata.size) {
			return true
		}

		// Compare hash if available
		if (oldMetadata.hash && newMetadata.hash && oldMetadata.hash !== newMetadata.hash) {
			return true
		}

		// No changes detected
		return false
	}

	/**
	 * Handle file changes detected by the file system watcher
	 * @param changes Array of file changes
	 * @returns Change detection result
	 */
	public async handleFileChanges(changes: FileChange[]): Promise<ChangeDetectionResult> {
		logger.debug(`Handling ${changes.length} file changes`)

		const filesToIndex: string[] = []
		const filesToRemove: string[] = []
		const unchangedFiles: string[] = []
		const skippedFiles: string[] = []
		const errorFiles: string[] = []

		// Process each change
		for (const change of changes) {
			try {
				switch (change.status) {
					case FileStatus.NEW:
					case FileStatus.MODIFIED:
						// Add to files to index
						filesToIndex.push(change.path)
						break

					case FileStatus.DELETED:
						// Add to files to remove
						filesToRemove.push(change.path)
						break

					case FileStatus.UNCHANGED:
						// No action needed
						unchangedFiles.push(change.path)
						break

					case FileStatus.EXCLUDED:
						// Skip excluded files
						skippedFiles.push(change.path)
						break

					case FileStatus.ERROR:
						// Add to error files
						errorFiles.push(change.path)
						break
				}
			} catch (error) {
				logger.error(`Error handling file change for ${change.path}:`, error)
				errorFiles.push(change.path)
			}
		}

		// Create comparison result
		const comparisonResult: MetadataComparisonResult = {
			newFiles: filesToIndex.filter((f) => {
				const change = changes.find((c) => c.path === f)
				return change?.status === FileStatus.NEW
			}),
			modifiedFiles: filesToIndex.filter((f) => {
				const change = changes.find((c) => c.path === f)
				return change?.status === FileStatus.MODIFIED
			}),
			deletedFiles: filesToRemove,
			unchangedFiles,
			errorFiles,
		}

		// Build the final result
		const result: ChangeDetectionResult = {
			filesToIndex,
			filesToRemove,
			unchangedFiles,
			skippedFiles,
			errorFiles,
			comparisonResult,
		}

		logger.debug(
			`File change handling complete: to index=${result.filesToIndex.length}, to remove=${result.filesToRemove.length}, unchanged=${result.unchangedFiles.length}, skipped=${result.skippedFiles.length}, errors=${result.errorFiles.length}`,
		)

		return result
	}
}
