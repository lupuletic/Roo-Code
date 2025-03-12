import * as fs from "fs/promises"
import * as path from "path"
import {
	FileTracker,
	calculateFileHash,
	FileInfo,
	FileStatus,
	determineFileStatus,
	createFileChange,
} from "../file-tracker"
import { CodeIndexerConfig } from "../config"
import { fileExistsAtPath } from "../../../utils/fs"
import { logger } from "../../../utils/logging"

// Mock dependencies
jest.mock("fs/promises")
jest.mock("crypto")
jest.mock("../../../utils/fs")
jest.mock("../../../utils/logging", () => ({
	logger: {
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	},
}))
jest.mock("../config", () => ({
	shouldExcludeFile: jest.fn(),
	normalizePath: jest.fn((path) => path),
}))

describe("FileTracker", () => {
	let fileTracker: FileTracker
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

		// Create file tracker instance
		fileTracker = new FileTracker(mockConfig)
	})

	describe("load", () => {
		it("should load the state file if it exists", async () => {
			// Mock file exists check
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)

			// Mock file content
			const stateData: Record<string, FileInfo> = {
				"/path/to/file1.ts": {
					path: "/path/to/file1.ts",
					mtime: 123456789,
					size: 1000,
					hash: "abc123",
					indexedAt: 123456789,
				},
				"/path/to/file2.ts": {
					path: "/path/to/file2.ts",
					mtime: 987654321,
					size: 2000,
					hash: "def456",
					indexedAt: 987654321,
				},
			}

			// Mock reading the file
			;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(stateData))

			// Call
			await fileTracker.load()

			// Assertions
			expect(fileExistsAtPath).toHaveBeenCalled()
			expect(fs.readFile).toHaveBeenCalled()
			expect(logger.debug).toHaveBeenCalledWith("Loaded 2 tracked files from state")

			// Verify loaded files are in the tracker
			const file1Info = await fileTracker.getFileInfo("/path/to/file1.ts")
			const file2Info = await fileTracker.getFileInfo("/path/to/file2.ts")

			expect(file1Info).toEqual(stateData["/path/to/file1.ts"])
			expect(file2Info).toEqual(stateData["/path/to/file2.ts"])
		})

		it("should start fresh if the state file does not exist", async () => {
			// Mock file exists check
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(false)

			// Call
			await fileTracker.load()

			// Assertions
			expect(fileExistsAtPath).toHaveBeenCalled()
			expect(fs.readFile).not.toHaveBeenCalled()
			expect(logger.debug).toHaveBeenCalledWith("File tracker state does not exist, starting fresh")

			// Verify no files in the tracker
			const allFiles = await fileTracker.getAllFiles()
			expect(allFiles.size).toBe(0)
		})

		it("should handle errors when loading the state file", async () => {
			// Mock file exists check
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)

			// Mock error reading the file
			;(fs.readFile as jest.Mock).mockRejectedValue(new Error("File read error"))

			// Call
			await fileTracker.load()

			// Assertions
			expect(fileExistsAtPath).toHaveBeenCalled()
			expect(fs.readFile).toHaveBeenCalled()
			expect(logger.error).toHaveBeenCalledWith("Failed to load file tracker state:", expect.any(Error))

			// Verify no files in the tracker
			const allFiles = await fileTracker.getAllFiles()
			expect(allFiles.size).toBe(0)
		})
	})

	describe("save", () => {
		it("should save the state to disk", async () => {
			// Mock a file in the tracker
			const mockFile: FileInfo = {
				path: "/path/to/file.ts",
				mtime: 123456789,
				size: 1000,
				hash: "abc123",
				indexedAt: 123456789,
			}

			// Add the file to the tracker
			await fileTracker.load()
			await fileTracker.addFile("/path/to/file.ts")

			// Mock fs.stat to not trigger actual file system calls
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: mockFile.mtime,
				size: mockFile.size,
				isDirectory: () => false,
			})

			// Manually set the file info
			await fileTracker.markAsIndexed("/path/to/file.ts", mockFile.hash)

			// Clear mocks before saving
			jest.clearAllMocks()

			// Call
			await fileTracker.save()

			// Assertions
			expect(fs.mkdir).toHaveBeenCalled()
			expect(fs.writeFile).toHaveBeenCalled()
			expect(logger.debug).toHaveBeenCalledWith("Saved 1 tracked files to state")

			// Verify the saved content
			const expectedContent = JSON.stringify(
				{
					"/path/to/file.ts": mockFile,
				},
				null,
				2,
			)

			// Get the second argument of the first call to writeFile
			const actualContent = (fs.writeFile as jest.Mock).mock.calls[0][1]

			// Check if the actual content includes the expected file path
			expect(actualContent).toContain("/path/to/file.ts")
		})

		it("should handle errors when saving the state", async () => {
			// Mock error creating directory
			;(fs.mkdir as jest.Mock).mockRejectedValue(new Error("Permission denied"))

			// Call
			await fileTracker.save()

			// Assertions
			expect(fs.mkdir).toHaveBeenCalled()
			expect(logger.error).toHaveBeenCalledWith("Failed to save file tracker state:", expect.any(Error))
		})
	})

	describe("addFile", () => {
		beforeEach(async () => {
			// Ensure tracker is loaded
			await fileTracker.load()
		})

		it("should add a new file that needs indexing", async () => {
			// Mock the config shouldExcludeFile to return false
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(false)

			// Mock fs.stat
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			// Call
			const needsIndexing = await fileTracker.addFile("/path/to/new-file.ts")

			// Assertions
			expect(needsIndexing).toBe(true)

			// Verify file info
			const fileInfo = await fileTracker.getFileInfo("/path/to/new-file.ts")
			expect(fileInfo).toBeDefined()
			expect(fileInfo?.path).toBe("/path/to/new-file.ts")
			expect(fileInfo?.mtime).toBe(123456789)
			expect(fileInfo?.size).toBe(1000)
			expect(fileInfo?.indexedAt).toBeUndefined()
		})

		it("should skip excluded files", async () => {
			// Mock the config shouldExcludeFile to return true
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(true)

			// Call
			const needsIndexing = await fileTracker.addFile("/path/to/excluded-file.ts")

			// Assertions
			expect(needsIndexing).toBe(false)
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Skipping excluded file"))
		})

		it("should skip directories", async () => {
			// Mock the config shouldExcludeFile to return false
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(false)

			// Mock fs.stat to return a directory
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 0,
				isDirectory: () => true,
			})

			// Call
			const needsIndexing = await fileTracker.addFile("/path/to/directory")

			// Assertions
			expect(needsIndexing).toBe(false)
		})

		it("should skip files that are too large", async () => {
			// Mock the config shouldExcludeFile to return false
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(false)

			// Mock fs.stat to return a large file
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: mockConfig.maxFileSizeBytes + 1,
				isDirectory: () => false,
			})

			// Call
			const needsIndexing = await fileTracker.addFile("/path/to/large-file.ts")

			// Assertions
			expect(needsIndexing).toBe(false)
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Skipping file exceeding size limit"))
		})

		it("should handle errors when adding a file", async () => {
			// Mock error checking file
			;(fs.stat as jest.Mock).mockRejectedValue(new Error("File not found"))

			// Call
			const needsIndexing = await fileTracker.addFile("/path/to/nonexistent-file.ts")

			// Assertions
			expect(needsIndexing).toBe(false)
			expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Error adding file"), expect.any(Error))
		})
	})

	describe("removeFile", () => {
		beforeEach(async () => {
			// Ensure tracker is loaded
			await fileTracker.load()

			// Add a file to the tracker
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			await fileTracker.addFile("/path/to/file.ts")
		})

		it("should remove a file from the tracker", async () => {
			// Call
			const removed = await fileTracker.removeFile("/path/to/file.ts")

			// Assertions
			expect(removed).toBe(true)
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Removed file from tracker"))

			// Verify file is gone
			const fileInfo = await fileTracker.getFileInfo("/path/to/file.ts")
			expect(fileInfo).toBeUndefined()
		})

		it("should return false if the file was not in the tracker", async () => {
			// Call
			const removed = await fileTracker.removeFile("/path/to/nonexistent-file.ts")

			// Assertions
			expect(removed).toBe(false)
		})
	})

	describe("needsIndexing", () => {
		beforeEach(async () => {
			// Ensure tracker is loaded
			await fileTracker.load()
		})

		it("should return true for files not in the tracker", async () => {
			// Call
			const needsIndexing = await fileTracker.needsIndexing("/path/to/new-file.ts")

			// Assertions
			expect(needsIndexing).toBe(true)
		})

		it("should return true for modified files", async () => {
			// Add a file to the tracker
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			await fileTracker.addFile("/path/to/file.ts")
			await fileTracker.markAsIndexed("/path/to/file.ts")

			// Mock file exists
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)

			// Mock modified file (newer mtime)
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456790, // Newer timestamp
				size: 1000,
				isDirectory: () => false,
			})

			// Call
			const needsIndexing = await fileTracker.needsIndexing("/path/to/file.ts")

			// Assertions
			expect(needsIndexing).toBe(true)
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("File has been modified"))
		})

		it("should return true for files with changed size", async () => {
			// Add a file to the tracker
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			await fileTracker.addFile("/path/to/file.ts")
			await fileTracker.markAsIndexed("/path/to/file.ts")

			// Mock file exists
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)

			// Mock file with different size
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1001, // Different size
				isDirectory: () => false,
			})

			// Call
			const needsIndexing = await fileTracker.needsIndexing("/path/to/file.ts")

			// Assertions
			expect(needsIndexing).toBe(true)
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("File size has changed"))
		})

		it("should return true for files that have never been indexed", async () => {
			// Add a file to the tracker but don't mark as indexed
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			await fileTracker.addFile("/path/to/file.ts")

			// Mock file exists
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)

			// Call
			const needsIndexing = await fileTracker.needsIndexing("/path/to/file.ts")

			// Assertions
			expect(needsIndexing).toBe(true)
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("File has never been indexed"))
		})

		it("should return false for unchanged files that have been indexed", async () => {
			// Add a file to the tracker and mark as indexed
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			await fileTracker.addFile("/path/to/file.ts")
			await fileTracker.markAsIndexed("/path/to/file.ts")

			// Mock file exists
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)

			// Mock same file stats
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			// Call
			const needsIndexing = await fileTracker.needsIndexing("/path/to/file.ts")

			// Assertions
			expect(needsIndexing).toBe(false)
		})

		it("should return false and remove the file if it no longer exists", async () => {
			// Add a file to the tracker
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			await fileTracker.addFile("/path/to/file.ts")

			// Clear mocks
			jest.clearAllMocks()

			// Mock file does not exist
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(false)

			// Call
			const needsIndexing = await fileTracker.needsIndexing("/path/to/file.ts")

			// Assertions
			expect(needsIndexing).toBe(false)

			// Verify file was removed
			const fileInfo = await fileTracker.getFileInfo("/path/to/file.ts")
			expect(fileInfo).toBeUndefined()
		})

		it("should handle errors when checking if a file needs indexing", async () => {
			// Add a file to the tracker
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			await fileTracker.addFile("/path/to/file.ts")

			// Mock file exists but stat fails
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)
			;(fs.stat as jest.Mock).mockRejectedValue(new Error("Permission denied"))

			// Call
			const needsIndexing = await fileTracker.needsIndexing("/path/to/file.ts")

			// Assertions
			expect(needsIndexing).toBe(false)
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Error checking if file needs indexing"),
				expect.any(Error),
			)
		})
	})

	describe("markAsIndexed", () => {
		beforeEach(async () => {
			// Ensure tracker is loaded
			await fileTracker.load()
		})

		it("should update the indexedAt timestamp and hash for a file", async () => {
			// Add a file to the tracker
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			await fileTracker.addFile("/path/to/file.ts")

			// Mock Date.now()
			const now = 987654321
			jest.spyOn(Date, "now").mockReturnValue(now)

			// Call
			await fileTracker.markAsIndexed("/path/to/file.ts", "test-hash")

			// Assertions
			const fileInfo = await fileTracker.getFileInfo("/path/to/file.ts")
			expect(fileInfo).toBeDefined()
			expect(fileInfo?.indexedAt).toBe(now)
			expect(fileInfo?.hash).toBe("test-hash")
		})

		it("should do nothing if the file is not in the tracker", async () => {
			// Call
			await fileTracker.markAsIndexed("/path/to/nonexistent-file.ts", "test-hash")

			// Assertions
			const fileInfo = await fileTracker.getFileInfo("/path/to/nonexistent-file.ts")
			expect(fileInfo).toBeUndefined()
		})
	})

	describe("updateFileHash", () => {
		it("should call markAsIndexed with the hash", async () => {
			// Create a spy on markAsIndexed
			const spy = jest.spyOn(fileTracker, "markAsIndexed")

			// Call
			await fileTracker.updateFileHash("/path/to/file.ts", "new-hash")

			// Assertions
			expect(spy).toHaveBeenCalledWith("/path/to/file.ts", "new-hash")

			// Cleanup
			spy.mockRestore()
		})
	})

	describe("clear", () => {
		it("should clear all tracked files and save the state", async () => {
			// Add some files to the tracker
			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			await fileTracker.load()
			await fileTracker.addFile("/path/to/file1.ts")
			await fileTracker.addFile("/path/to/file2.ts")

			// Clear mocks
			jest.clearAllMocks()

			// Call
			await fileTracker.clear()

			// Assertions
			const allFiles = await fileTracker.getAllFiles()
			expect(allFiles.size).toBe(0)
			expect(fs.writeFile).toHaveBeenCalled()
		})
	})

	describe("calculateFileHash", () => {
		it("should return a hash of the file content", () => {
			// Mock crypto.createHash
			const createHashMock = jest.fn().mockReturnValue({
				update: jest.fn().mockReturnThis(),
				digest: jest.fn().mockReturnValue("test-hash"),
			})
			jest.requireMock("crypto").createHash = createHashMock

			// Call
			const hash = calculateFileHash("file content")

			// Assertions
			expect(createHashMock).toHaveBeenCalledWith("sha256")
			expect(hash).toBe("test-hash")
		})

		it("should handle errors when calculating hash", () => {
			// Mock crypto.createHash to throw an error
			const createHashMock = jest.fn().mockImplementation(() => {
				throw new Error("Crypto error")
			})
			jest.requireMock("crypto").createHash = createHashMock

			// Call
			const hash = calculateFileHash("file content")

			// Assertions
			expect(createHashMock).toHaveBeenCalledWith("sha256")
			expect(logger.error).toHaveBeenCalledWith("Error calculating file hash:", expect.any(Error))
			expect(hash).toBe("")
		})
	})

	describe("determineFileStatus", () => {
		it("should return DELETED for a non-existent file with fileInfo", async () => {
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(false)

			const fileInfo: FileInfo = {
				path: "/path/to/deleted-file.ts",
				mtime: 123456789,
				size: 1000,
				hash: "abc123",
			}

			const status = await determineFileStatus("/path/to/deleted-file.ts", fileInfo, mockConfig)
			expect(status).toBe(FileStatus.DELETED)
		})

		it("should return ERROR for a non-existent file with no fileInfo", async () => {
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(false)

			const status = await determineFileStatus("/path/to/nonexistent-file.ts", undefined, mockConfig)
			expect(status).toBe(FileStatus.ERROR)
		})

		it("should return EXCLUDED for an excluded file", async () => {
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(true)

			const status = await determineFileStatus("/path/to/excluded-file.ts", undefined, mockConfig)
			expect(status).toBe(FileStatus.EXCLUDED)
		})

		it("should return EXCLUDED for a directory", async () => {
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(false)

			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 0,
				isDirectory: () => true,
			})

			const status = await determineFileStatus("/path/to/directory", undefined, mockConfig)
			expect(status).toBe(FileStatus.EXCLUDED)
		})

		it("should return EXCLUDED for a file that is too large", async () => {
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(false)

			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: mockConfig.maxFileSizeBytes + 1,
				isDirectory: () => false,
			})

			const status = await determineFileStatus("/path/to/large-file.ts", undefined, mockConfig)
			expect(status).toBe(FileStatus.EXCLUDED)
		})

		it("should return NEW for a file with no fileInfo", async () => {
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(false)

			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			const status = await determineFileStatus("/path/to/new-file.ts", undefined, mockConfig)
			expect(status).toBe(FileStatus.NEW)
		})

		it("should return NEW for a file with no indexedAt timestamp", async () => {
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(false)

			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			const fileInfo: FileInfo = {
				path: "/path/to/new-file.ts",
				mtime: 123456789,
				size: 1000,
			}

			const status = await determineFileStatus("/path/to/new-file.ts", fileInfo, mockConfig)
			expect(status).toBe(FileStatus.NEW)
		})

		it("should return MODIFIED for a file with a different mtime", async () => {
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(false)

			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456790, // Newer timestamp
				size: 1000,
				isDirectory: () => false,
			})

			const fileInfo: FileInfo = {
				path: "/path/to/modified-file.ts",
				mtime: 123456789,
				size: 1000,
				indexedAt: 123456789,
			}

			const status = await determineFileStatus("/path/to/modified-file.ts", fileInfo, mockConfig)
			expect(status).toBe(FileStatus.MODIFIED)
		})

		it("should return UNCHANGED for a file that has not changed", async () => {
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(false)

			;(fs.stat as jest.Mock).mockResolvedValue({
				mtimeMs: 123456789,
				size: 1000,
				isDirectory: () => false,
			})

			const fileInfo: FileInfo = {
				path: "/path/to/unchanged-file.ts",
				mtime: 123456789,
				size: 1000,
				indexedAt: 123456789,
			}

			const status = await determineFileStatus("/path/to/unchanged-file.ts", fileInfo, mockConfig)
			expect(status).toBe(FileStatus.UNCHANGED)
		})
	})

	describe("createFileChange", () => {
		it("should create a file change object with default priority", () => {
			const change = createFileChange("/path/to/file.ts", FileStatus.MODIFIED)

			expect(change.path).toBe("/path/to/file.ts")
			expect(change.status).toBe(FileStatus.MODIFIED)
			expect(change.detectedAt).toBeGreaterThan(0)
			expect(change.priority).toBe(1)
		})

		it("should create a file change object with file stats", () => {
			const stats = {
				mtimeMs: 123456789,
				size: 1000,
			} as any

			const change = createFileChange("/path/to/file.ts", FileStatus.MODIFIED, stats, 2)

			expect(change.path).toBe("/path/to/file.ts")
			expect(change.status).toBe(FileStatus.MODIFIED)
			expect(change.detectedAt).toBeGreaterThan(0)
			expect(change.size).toBe(1000)
			expect(change.mtime).toBe(123456789)
			expect(change.priority).toBe(2)
		})
	})

	describe("File change tracking", () => {
		beforeEach(async () => {
			await fileTracker.load()
		})

		it("should track file changes in the change queue", async () => {
			const change = createFileChange("/path/to/changed-file.ts", FileStatus.MODIFIED)
			fileTracker.addChange(change)

			const changes = fileTracker.getChanges()
			expect(changes.size).toBe(1)
			expect(changes.get("/path/to/changed-file.ts")).toBe(change)
		})

		it("should remove changes from the queue", async () => {
			const change = createFileChange("/path/to/changed-file.ts", FileStatus.MODIFIED)
			fileTracker.addChange(change)
			fileTracker.removeChange("/path/to/changed-file.ts")

			const changes = fileTracker.getChanges()
			expect(changes.size).toBe(0)
		})
	})

	describe("getFilesByStatus", () => {
		beforeEach(async () => {
			await fileTracker.load()

			// Add a few files with different states
			// Mock files exist check
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)

			// Mock shouldExcludeFile to handle excluded files
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockImplementation((path: string) => path.includes("excluded"))

			// Setup regular file
			;(fs.stat as jest.Mock).mockImplementation((path: string) => {
				// Return different stats based on the file path
				if (path.includes("unchanged")) {
					return Promise.resolve({
						mtimeMs: 100000,
						size: 500,
						isDirectory: () => false,
					})
				} else if (path.includes("modified")) {
					return Promise.resolve({
						mtimeMs: 200000, // Newer timestamp
						size: 600,
						isDirectory: () => false,
					})
				} else if (path.includes("directory")) {
					return Promise.resolve({
						mtimeMs: 100000,
						size: 0,
						isDirectory: () => true,
					})
				} else {
					return Promise.resolve({
						mtimeMs: 100000,
						size: 500,
						isDirectory: () => false,
					})
				}
			})

			// Mock markAsIndexed to actually update the fileInfo
			jest.spyOn(fileTracker, "markAsIndexed").mockImplementation(async (path, hash) => {
				const fileInfo = await fileTracker.getFileInfo(path)
				if (fileInfo) {
					fileInfo.indexedAt = 100000
					if (hash) {
						fileInfo.hash = hash
					}
				}
			})

			// Add files to the tracker
			await fileTracker.addFile("/path/to/unchanged-file.ts")
			await fileTracker.markAsIndexed("/path/to/unchanged-file.ts", "hash1")

			await fileTracker.addFile("/path/to/modified-file.ts")
			await fileTracker.markAsIndexed("/path/to/modified-file.ts", "hash2")

			await fileTracker.addFile("/path/to/new-file.ts")

			await fileTracker.addFile("/path/to/excluded-file.ts")

			await fileTracker.addFile("/path/to/directory")
		})

		it("should return files with the NEW status", async () => {
			const newFiles = await fileTracker.getFilesByStatus(FileStatus.NEW)

			expect(newFiles.size).toBe(1)
			expect(newFiles.has("/path/to/new-file.ts")).toBe(true)
		})

		it("should return files with the MODIFIED status", async () => {
			const modifiedFiles = await fileTracker.getFilesByStatus(FileStatus.MODIFIED)

			expect(modifiedFiles.size).toBe(1)
			expect(modifiedFiles.has("/path/to/modified-file.ts")).toBe(true)
		})

		it("should return files with the EXCLUDED status when includeExcluded is true", async () => {
			const excludedFiles = await fileTracker.getFilesByStatus(FileStatus.EXCLUDED, { includeExcluded: true })

			expect(excludedFiles.size).toBeGreaterThan(0)
			// Should include both the excluded file and the directory
			expect(excludedFiles.has("/path/to/excluded-file.ts") || excludedFiles.has("/path/to/directory")).toBe(true)
		})
	})

	describe("hasHashChanged", () => {
		it("should detect hash changes", async () => {
			// Mock a file with a hash
			await fileTracker.load()
			await fileTracker.addFile("/path/to/file.ts")
			await fileTracker.markAsIndexed("/path/to/file.ts", "original-hash")

			// Mock file content read
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)
			;(fs.readFile as jest.Mock).mockResolvedValue("new content")

			// Mock crypto.createHash to return a different hash
			const createHashMock = jest.fn().mockReturnValue({
				update: jest.fn().mockReturnThis(),
				digest: jest.fn().mockReturnValue("new-hash"),
			})
			jest.requireMock("crypto").createHash = createHashMock

			// Check if hash has changed
			const hashChanged = await fileTracker.hasHashChanged("/path/to/file.ts")
			expect(hashChanged).toBe(true)
		})

		it("should return true for files not in the tracker", async () => {
			await fileTracker.load()
			const hashChanged = await fileTracker.hasHashChanged("/path/to/nonexistent-file.ts")
			expect(hashChanged).toBe(true)
		})
	})
})
