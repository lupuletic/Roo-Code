import * as fs from "fs/promises"
import * as path from "path"
import { PathLike, Dirent } from "fs"
import { MetadataManager, IndexMetadata, ExtendedFileMetadata } from "../metadata"
import { FileStatus } from "../file-tracker"
import { CodeIndexerConfig } from "../config"
import { fileExistsAtPath } from "../../../utils/fs"
import { logger } from "../../../utils/logging"

// Mock dependencies
jest.mock("fs/promises")
jest.mock("../../../utils/logging", () => ({
	logger: {
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	},
}))
jest.mock("../path-utils", () => ({
	ensureDatabaseDirectory: jest.fn().mockResolvedValue(undefined),
	normalizePath: jest.fn((path) => path),
}))
jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockResolvedValue(true),
}))

describe("MetadataManager", () => {
	let metadataManager: MetadataManager
	let mockConfig: CodeIndexerConfig

	beforeEach(() => {
		jest.clearAllMocks()

		// Setup mock configuration
		mockConfig = {
			databasePath: "/test/storage/lancedb",
			maxFileSizeBytes: 1000000,
			excludePatterns: ["**/node_modules/**"],
			embeddingModel: "text-embedding-ada-002",
			autoIndexOnWorkspaceOpen: true,
			watchForFileChanges: true,
			maxChunkSize: 1000,
			chunkOverlap: 100,
			showNotifications: true,
		}

		// Create metadata manager instance
		metadataManager = new MetadataManager(mockConfig)
	})

	describe("initialize", () => {
		it("should ensure metadata directories exist", async () => {
			// Call
			await metadataManager.initialize()

			// Get the path-utils mock to verify calls
			const { ensureDatabaseDirectory } = require("../path-utils")

			// Assertions
			expect(ensureDatabaseDirectory).toHaveBeenCalledWith(
				path.join(path.dirname(mockConfig.databasePath), "metadata"),
			)
			expect(ensureDatabaseDirectory).toHaveBeenCalledWith(
				path.join(path.dirname(mockConfig.databasePath), "metadata", "files"),
			)
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Metadata manager initialized"))
		})

		it("should handle initialization errors", async () => {
			// Mock ensureDatabaseDirectory to throw error
			const { ensureDatabaseDirectory } = require("../path-utils")
			ensureDatabaseDirectory.mockRejectedValueOnce(new Error("Failed to create directory"))

			// Call & assertions
			await expect(metadataManager.initialize()).rejects.toThrow("Failed to initialize metadata manager")
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Failed to initialize metadata manager"),
				expect.any(Error),
			)
		})
	})

	describe("load", () => {
		it("should load index metadata from disk if it exists", async () => {
			// Mock reading the index metadata file
			const mockIndexMetadata: IndexMetadata = {
				version: "1.0",
				createdAt: 123456789,
				lastUpdatedAt: 987654321,
				fileCount: 10,
				chunkCount: 50,
				config: {
					maxFileSizeBytes: 1000000,
					maxChunkSize: 1000,
					chunkOverlap: 100,
					embeddingModel: "text-embedding-ada-002",
				},
			}

			// Mock readFile for index metadata
			const readFileSpy = jest.spyOn(fs, "readFile")
			readFileSpy.mockImplementation((filepath: PathLike | fs.FileHandle, options?: any) => {
				if (filepath.toString().endsWith("index.json")) {
					return Promise.resolve(JSON.stringify(mockIndexMetadata)) as Promise<any>
				}
				return Promise.reject(new Error("File not found"))
			})

			// Mock readdir for file metadata
			const readdirSpy = jest.spyOn(fs, "readdir")
			const emptyDirents: Dirent[] = []
			readdirSpy.mockResolvedValue(emptyDirents)

			// Call
			await metadataManager.initialize()

			// Assertions
			expect(readFileSpy).toHaveBeenCalledWith(
				path.join(path.dirname(mockConfig.databasePath), "metadata", "index.json"),
				"utf-8",
			)
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Loaded index metadata"))

			// Check that index metadata was loaded
			expect(metadataManager.getIndexMetadata()).toEqual(mockIndexMetadata)
		})

		it("should create new index metadata if file does not exist", async () => {
			// Mock readFile to fail for index metadata
			const readFileSpy = jest.spyOn(fs, "readFile")
			readFileSpy.mockRejectedValue(new Error("File not found"))

			// Mock readdir for file metadata
			const readdirSpy = jest.spyOn(fs, "readdir")
			const emptyDirents: Dirent[] = []
			readdirSpy.mockResolvedValue(emptyDirents)

			// Call
			await metadataManager.initialize()

			// Assertions
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Index metadata not found or invalid"))

			// Check that default index metadata was created
			const indexMetadata = metadataManager.getIndexMetadata()
			expect(indexMetadata).toBeDefined()
			expect(indexMetadata?.version).toBe("1.0")
			expect(indexMetadata?.fileCount).toBe(0)
			expect(indexMetadata?.chunkCount).toBe(0)
		})

		it("should load file metadata from disk", async () => {
			// Mock readFile for index metadata
			const readFileSpy = jest.spyOn(fs, "readFile")
			readFileSpy.mockImplementation((filepath: PathLike | fs.FileHandle, options?: any) => {
				if (filepath.toString().endsWith("index.json")) {
					return Promise.resolve(
						JSON.stringify({
							version: "1.0",
							createdAt: 123456789,
							lastUpdatedAt: 987654321,
							fileCount: 2,
							chunkCount: 10,
							config: mockConfig,
						}),
					)
				} else if (filepath.toString().endsWith("file1.json")) {
					return Promise.resolve(
						JSON.stringify({
							path: "/path/to/file1.ts",
							mtime: 123456789,
							size: 1000,
							hash: "file1hash",
							indexedAt: 123456789,
							chunkCount: 5,
						}),
					)
				} else if (filepath.toString().endsWith("file2.json")) {
					return Promise.resolve(
						JSON.stringify({
							path: "/path/to/file2.ts",
							mtime: 987654321,
							size: 2000,
							hash: "file2hash",
							indexedAt: 987654321,
							chunkCount: 5,
						}),
					)
				} else {
					return Promise.resolve("")
				}
				return Promise.reject(new Error("File not found"))
			})

			// Mock readdir for file metadata
			const readdirSpy = jest.spyOn(fs, "readdir")

			// Mock Dirent objects
			const mockDirents = ["file1.json", "file2.json"].map(
				(name) => ({ name, isFile: () => true }) as unknown as Dirent,
			)
			readdirSpy.mockResolvedValue(mockDirents)

			// Call
			await metadataManager.initialize()

			// Call getFileMetadata for both files
			const file1Metadata = await metadataManager.getFileMetadata("/path/to/file1.ts")
			const file2Metadata = await metadataManager.getFileMetadata("/path/to/file2.ts")

			// Assertions
			expect(file1Metadata).toBeDefined()
			expect(file1Metadata?.path).toBe("/path/to/file1.ts")
			expect(file1Metadata?.hash).toBe("file1hash")

			expect(file2Metadata).toBeDefined()
			expect(file2Metadata?.path).toBe("/path/to/file2.ts")
			expect(file2Metadata?.hash).toBe("file2hash")

			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Loaded 2 file metadata records"))
		})
	})

	describe("save", () => {
		it("should save index metadata to disk", async () => {
			// Initialize first
			await metadataManager.initialize()

			// Mock writeFile
			const writeFileSpy = jest.spyOn(fs, "writeFile").mockResolvedValue(undefined)

			// Call
			await metadataManager.save()

			// Assertions
			expect(writeFileSpy).toHaveBeenCalledWith(
				path.join(path.dirname(mockConfig.databasePath), "metadata", "index.json"),
				expect.any(String),
			)
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Saved index metadata"))
		})

		it("should save file metadata to disk", async () => {
			// Initialize first
			await metadataManager.initialize()

			// Add some file metadata
			await metadataManager.updateFileMetadata("/path/to/file1.ts", {
				path: "/path/to/file1.ts",
				mtime: 123456789,
				size: 1000,
				hash: "file1hash",
				indexedAt: 123456789,
				chunkCount: 5,
			})

			// Mock writeFile
			const writeFileSpy = jest.spyOn(fs, "writeFile").mockResolvedValue(undefined)

			// Call
			await metadataManager.save()

			// Assertions
			expect(writeFileSpy).toHaveBeenCalledTimes(2) // index + 1 file
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Saved 1 file metadata records"))
		})

		it("should handle save errors", async () => {
			// Initialize first
			await metadataManager.initialize()

			// Mock writeFile to throw error
			const writeFileSpy = jest.spyOn(fs, "writeFile").mockRejectedValue(new Error("Write error"))

			// Call & assertions
			await expect(metadataManager.save()).rejects.toThrow("Write error")
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Failed to save metadata"),
				expect.any(Error),
			)
		})
	})

	describe("updateFileMetadata", () => {
		it("should update existing file metadata", async () => {
			// Initialize first
			await metadataManager.initialize()

			// Add file metadata
			await metadataManager.updateFileMetadata("/path/to/file.ts", {
				path: "/path/to/file.ts",
				mtime: 123456789,
				size: 1000,
				hash: "hash1",
			})

			// Update file metadata
			await metadataManager.updateFileMetadata("/path/to/file.ts", {
				hash: "hash2",
				indexedAt: 987654321,
			})

			// Get file metadata
			const metadata = await metadataManager.getFileMetadata("/path/to/file.ts")

			// Assertions
			expect(metadata).toBeDefined()
			expect(metadata?.path).toBe("/path/to/file.ts")
			expect(metadata?.mtime).toBe(123456789)
			expect(metadata?.size).toBe(1000)
			expect(metadata?.hash).toBe("hash2")
			expect(metadata?.indexedAt).toBe(987654321)
		})

		it("should create new file metadata if it does not exist", async () => {
			// Initialize first
			await metadataManager.initialize()

			// Update file metadata for a new file
			await metadataManager.updateFileMetadata("/path/to/new-file.ts", {
				mtime: 123456789,
				size: 1000,
				hash: "newhash",
			})

			// Get file metadata
			const metadata = await metadataManager.getFileMetadata("/path/to/new-file.ts")

			// Assertions
			expect(metadata).toBeDefined()
			expect(metadata?.path).toBe("/path/to/new-file.ts")
			expect(metadata?.mtime).toBe(123456789)
			expect(metadata?.size).toBe(1000)
			expect(metadata?.hash).toBe("newhash")
		})
	})

	describe("removeFileMetadata", () => {
		it("should remove file metadata from cache and disk", async () => {
			// Initialize first
			await metadataManager.initialize()

			// Add file metadata
			await metadataManager.updateFileMetadata("/path/to/file.ts", {
				path: "/path/to/file.ts",
				mtime: 123456789,
				size: 1000,
				hash: "hash",
			})

			// Mock unlink
			const unlinkSpy = jest.spyOn(fs, "unlink").mockResolvedValue(undefined)

			// Remove file metadata
			await metadataManager.removeFileMetadata("/path/to/file.ts")

			// Get file metadata
			const metadata = await metadataManager.getFileMetadata("/path/to/file.ts")

			// Assertions
			expect(metadata).toBeUndefined()
			// The exact file path will have a hash, so we just check that unlink was called
			expect(unlinkSpy).toHaveBeenCalledWith(expect.any(String))
		})
	})

	describe("compareFileMetadata", () => {
		it("should categorize files correctly based on status", async () => {
			// Initialize first
			await metadataManager.initialize()

			// Add some file metadata
			await metadataManager.updateFileMetadata("/path/to/unchanged.ts", {
				path: "/path/to/unchanged.ts",
				mtime: 123456789,
				size: 1000,
				hash: "hash1",
				indexedAt: 123456789,
			})

			// Create a file status map
			const fileStatusMap = new Map<string, FileStatus>([
				["/path/to/new.ts", FileStatus.NEW],
				["/path/to/modified.ts", FileStatus.MODIFIED],
				["/path/to/unchanged.ts", FileStatus.UNCHANGED],
				["/path/to/deleted.ts", FileStatus.DELETED],
				["/path/to/error.ts", FileStatus.ERROR],
				["/path/to/excluded.ts", FileStatus.EXCLUDED],
			])

			// Call compareFileMetadata
			const result = await metadataManager.compareFileMetadata(
				[
					"/path/to/new.ts",
					"/path/to/modified.ts",
					"/path/to/unchanged.ts",
					"/path/to/deleted.ts",
					"/path/to/error.ts",
					"/path/to/excluded.ts",
				],
				fileStatusMap,
			)

			// Assertions
			expect(result.newFiles).toContain("/path/to/new.ts")
			expect(result.modifiedFiles).toContain("/path/to/modified.ts")
			expect(result.unchangedFiles).toContain("/path/to/unchanged.ts")
			expect(result.deletedFiles).toContain("/path/to/deleted.ts")
			expect(result.errorFiles).toContain("/path/to/error.ts")
			// Excluded files should not be in any of the results
			expect(result.newFiles).not.toContain("/path/to/excluded.ts")
			expect(result.modifiedFiles).not.toContain("/path/to/excluded.ts")
			expect(result.unchangedFiles).not.toContain("/path/to/excluded.ts")
			expect(result.deletedFiles).not.toContain("/path/to/excluded.ts")
			expect(result.errorFiles).not.toContain("/path/to/excluded.ts")
		})

		it("should detect files that are in metadata but not in the file list", async () => {
			// Initialize first
			await metadataManager.initialize()

			// Add file metadata for a file that is not in the file list
			await metadataManager.updateFileMetadata("/path/to/missing.ts", {
				path: "/path/to/missing.ts",
				mtime: 123456789,
				size: 1000,
				hash: "hash",
				indexedAt: 123456789,
			})

			// Create a file status map
			const fileStatusMap = new Map<string, FileStatus>([["/path/to/existing.ts", FileStatus.UNCHANGED]])

			// Call compareFileMetadata with a file list that doesn't include the missing file
			const result = await metadataManager.compareFileMetadata(["/path/to/existing.ts"], fileStatusMap)

			// Assertions
			expect(result.deletedFiles).toContain("/path/to/missing.ts")
		})
	})

	describe("updateChunkCount", () => {
		it("should update chunk count for a file and update total chunk count", async () => {
			// Initialize first
			await metadataManager.initialize()

			// Add file metadata for two files
			await metadataManager.updateFileMetadata("/path/to/file1.ts", {
				path: "/path/to/file1.ts",
				mtime: 123456789,
				size: 1000,
				hash: "hash1",
				chunkCount: 5,
			})

			await metadataManager.updateFileMetadata("/path/to/file2.ts", {
				path: "/path/to/file2.ts",
				mtime: 987654321,
				size: 2000,
				hash: "hash2",
				chunkCount: 10,
			})

			// Update chunk count for file1
			await metadataManager.updateChunkCount("/path/to/file1.ts", 8)

			// Get file metadata
			const file1Metadata = await metadataManager.getFileMetadata("/path/to/file1.ts")

			// Assertions
			expect(file1Metadata?.chunkCount).toBe(8)

			// Check index metadata
			const indexMetadata = metadataManager.getIndexMetadata()
			expect(indexMetadata?.chunkCount).toBe(18) // 8 + 10
		})
	})

	describe("reset", () => {
		it("should reset all metadata", async () => {
			// Initialize first
			await metadataManager.initialize()

			// Add some file metadata
			await metadataManager.updateFileMetadata("/path/to/file1.ts", {
				path: "/path/to/file1.ts",
				mtime: 123456789,
				size: 1000,
				hash: "hash1",
			})

			await metadataManager.updateFileMetadata("/path/to/file2.ts", {
				path: "/path/to/file2.ts",
				mtime: 987654321,
				size: 2000,
				hash: "hash2",
			})

			// Mock readdir and unlink
			const mockDirents = [
				{ name: "file1.json", isFile: () => true },
				{ name: "file2.json", isFile: () => true },
			] as unknown as Dirent[]

			jest.spyOn(fs, "readdir").mockResolvedValue(mockDirents)
			const unlinkSpy = jest.spyOn(fs, "unlink").mockResolvedValue(undefined)

			// Call reset
			await metadataManager.reset()

			// Assertions
			expect(unlinkSpy).toHaveBeenCalledTimes(2)

			// Check that file metadata is cleared
			const file1Metadata = await metadataManager.getFileMetadata("/path/to/file1.ts")
			const file2Metadata = await metadataManager.getFileMetadata("/path/to/file2.ts")
			expect(file1Metadata).toBeUndefined()
			expect(file2Metadata).toBeUndefined()

			// Check that index metadata is reset
			const indexMetadata = metadataManager.getIndexMetadata()
			expect(indexMetadata?.fileCount).toBe(0)
			expect(indexMetadata?.chunkCount).toBe(0)
		})
	})
})
