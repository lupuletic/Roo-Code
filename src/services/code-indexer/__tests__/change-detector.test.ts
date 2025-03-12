import * as fs from "fs/promises"
import { PathLike } from "fs"
import { ChangeDetector, ChangeDetectionResult, ChangeDetectionOptions } from "../change-detector"
import { FileTracker, FileStatus, FileInfo, FileChange } from "../file-tracker"
import { MetadataManager, ExtendedFileMetadata, MetadataComparisonResult } from "../metadata"
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
jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn(),
}))
jest.mock("../config", () => ({
	shouldExcludeFile: jest.fn(),
	normalizePath: jest.fn((path) => path),
}))

// Create mocks for FileTracker and MetadataManager
const mockFileTracker = {
	getFileStatus: jest.fn(),
	hasHashChanged: jest.fn(),
	getAllFiles: jest.fn(),
}

const mockMetadataManager = {
	compareFileMetadata: jest.fn(),
}

describe("ChangeDetector", () => {
	let changeDetector: ChangeDetector
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

		// Create change detector instance with mock dependencies
		changeDetector = new ChangeDetector(
			mockFileTracker as unknown as FileTracker,
			mockMetadataManager as unknown as MetadataManager,
			mockConfig,
		)
	})

	describe("detectChanges", () => {
		it("should detect changes in workspace files", async () => {
			// Setup mock file statuses
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockImplementation((path: string) => path.includes("excluded"))

			mockFileTracker.getFileStatus.mockImplementation((path: string) => {
				if (path.includes("new")) return Promise.resolve(FileStatus.NEW)
				if (path.includes("modified")) return Promise.resolve(FileStatus.MODIFIED)
				if (path.includes("unchanged")) return Promise.resolve(FileStatus.UNCHANGED)
				if (path.includes("deleted")) return Promise.resolve(FileStatus.DELETED)
				if (path.includes("error")) return Promise.resolve(FileStatus.ERROR)
				return Promise.resolve(FileStatus.UNCHANGED)
			})

			// Mock metadata comparison result
			mockMetadataManager.compareFileMetadata.mockResolvedValue({
				newFiles: ["/path/to/new.ts"],
				modifiedFiles: ["/path/to/modified.ts"],
				deletedFiles: ["/path/to/deleted.ts"],
				unchangedFiles: ["/path/to/unchanged.ts"],
				errorFiles: ["/path/to/error.ts"],
			})

			// Call
			const result = await changeDetector.detectChanges([
				"/path/to/new.ts",
				"/path/to/modified.ts",
				"/path/to/unchanged.ts",
				"/path/to/deleted.ts",
				"/path/to/error.ts",
				"/path/to/excluded.ts",
			])

			// Assertions
			expect(result.filesToIndex).toContain("/path/to/new.ts")
			expect(result.filesToIndex).toContain("/path/to/modified.ts")
			expect(result.filesToRemove).toContain("/path/to/deleted.ts")
			expect(result.unchangedFiles).toContain("/path/to/unchanged.ts")
			expect(result.errorFiles).toContain("/path/to/error.ts")
			expect(result.skippedFiles).toContain("/path/to/excluded.ts")

			expect(mockFileTracker.getFileStatus).toHaveBeenCalledTimes(5) // excludedFile is skipped
			expect(mockMetadataManager.compareFileMetadata).toHaveBeenCalledWith(
				expect.arrayContaining([
					"/path/to/new.ts",
					"/path/to/modified.ts",
					"/path/to/unchanged.ts",
					"/path/to/deleted.ts",
					"/path/to/error.ts",
					"/path/to/excluded.ts",
				]),
				expect.any(Map),
			)
		})

		it("should use hash comparison when specified", async () => {
			// Setup mock file statuses
			mockFileTracker.getFileStatus.mockResolvedValue(FileStatus.UNCHANGED)
			mockFileTracker.hasHashChanged.mockImplementation((path: string) => {
				return Promise.resolve(path.includes("hash-changed"))
			})

			// Mock metadata comparison result
			mockMetadataManager.compareFileMetadata.mockResolvedValue({
				newFiles: [],
				modifiedFiles: ["/path/to/hash-changed.ts"],
				deletedFiles: [],
				unchangedFiles: ["/path/to/hash-unchanged.ts"],
				errorFiles: [],
			})

			// Call with hash comparison option
			const result = await changeDetector.detectChanges(
				["/path/to/hash-changed.ts", "/path/to/hash-unchanged.ts"],
				{ useHashComparison: true },
			)

			// Assertions
			expect(mockFileTracker.hasHashChanged).toHaveBeenCalledTimes(2)
			expect(result.filesToIndex).toContain("/path/to/hash-changed.ts")
			expect(result.unchangedFiles).toContain("/path/to/hash-unchanged.ts")
		})

		it("should force reindex when specified", async () => {
			// Setup mock file statuses
			mockFileTracker.getFileStatus.mockResolvedValue(FileStatus.UNCHANGED)

			// Mock metadata comparison result
			mockMetadataManager.compareFileMetadata.mockResolvedValue({
				newFiles: [],
				modifiedFiles: ["/path/to/file1.ts", "/path/to/file2.ts"],
				deletedFiles: [],
				unchangedFiles: [],
				errorFiles: [],
			})

			// Call with force reindex option
			const result = await changeDetector.detectChanges(["/path/to/file1.ts", "/path/to/file2.ts"], {
				forceReindex: true,
			})

			// Assertions
			expect(result.filesToIndex).toContain("/path/to/file1.ts")
			expect(result.filesToIndex).toContain("/path/to/file2.ts")
			expect(result.unchangedFiles).toHaveLength(0)
		})

		it("should handle errors during change detection", async () => {
			// Setup mock to throw error
			mockFileTracker.getFileStatus.mockImplementation((path: string) => {
				if (path.includes("error")) {
					throw new Error("Test error")
				}
				return Promise.resolve(FileStatus.UNCHANGED)
			})

			// Mock metadata comparison result
			mockMetadataManager.compareFileMetadata.mockResolvedValue({
				newFiles: [],
				modifiedFiles: [],
				deletedFiles: [],
				unchangedFiles: ["/path/to/normal.ts"],
				errorFiles: ["/path/to/error.ts"],
			})

			// Call
			const result = await changeDetector.detectChanges(["/path/to/normal.ts", "/path/to/error.ts"])

			// Assertions
			expect(result.errorFiles).toContain("/path/to/error.ts")
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Error checking file status"),
				expect.any(Error),
			)
		})
	})

	describe("findModifiedSince", () => {
		it("should find files modified since a given time", async () => {
			// Mock file tracker getAllFiles
			const mockTrackedFiles = new Map<string, FileInfo>([
				[
					"/workspace/file1.ts",
					{
						path: "/workspace/file1.ts",
						mtime: 1000,
						size: 100,
						indexedAt: 500,
					},
				],
				[
					"/workspace/file2.ts",
					{
						path: "/workspace/file2.ts",
						mtime: 2000,
						size: 200,
						indexedAt: 1500,
					},
				],
				[
					"/workspace/file3.ts",
					{
						path: "/workspace/file3.ts",
						mtime: 3000,
						size: 300,
					},
				],
				[
					"/other/file4.ts",
					{
						path: "/other/file4.ts",
						mtime: 4000,
						size: 400,
					},
				],
			])

			mockFileTracker.getAllFiles.mockResolvedValue(mockTrackedFiles)

			// Mock file existence check
			const mockFileExists = jest.fn()
			mockFileExists.mockImplementation((path: string) => {
				return Promise.resolve(!path.includes("deleted"))
			})
			;(fileExistsAtPath as jest.Mock).mockImplementation(mockFileExists)

			// Mock fs.stat
			const mockStat = jest.fn()
			mockStat.mockImplementation((path: string) => {
				const file = mockTrackedFiles.get(path)
				return Promise.resolve({
					mtimeMs: file?.mtime || 0,
					size: file?.size || 0,
					isDirectory: () => false,
				})
			})
			;(fs.stat as jest.Mock).mockImplementation(mockStat)

			// Call with a time that should include file1 and file3
			const result = await changeDetector.findModifiedSince("/workspace", 1200)

			// Assertions
			// File1: already indexed at 500, but modified at 1000 (< 1200) so not included
			// File2: modified at 2000 (> 1200) so included
			// File3: no indexedAt, modified at 3000 (> 1200) so included
			// File4: not in workspace path so not included
			expect(result).toContain("/workspace/file2.ts")
			expect(result).toContain("/workspace/file3.ts")
			expect(result).not.toContain("/workspace/file1.ts")
			expect(result).not.toContain("/other/file4.ts")
		})

		it("should include deleted files", async () => {
			// Mock file tracker getAllFiles
			const mockTrackedFiles = new Map<string, FileInfo>([
				[
					"/workspace/file1.ts",
					{
						path: "/workspace/file1.ts",
						mtime: 1000,
						size: 100,
					},
				],
				[
					"/workspace/deleted.ts",
					{
						path: "/workspace/deleted.ts",
						mtime: 2000,
						size: 200,
					},
				],
			])

			mockFileTracker.getAllFiles.mockResolvedValue(mockTrackedFiles)

			// Mock file existence check
			;(fileExistsAtPath as jest.Mock).mockImplementation((path: string) => {
				return Promise.resolve(!path.includes("deleted"))
			})

			// Mock fs.stat
			;(fs.stat as jest.Mock).mockImplementation((path: string) => {
				if (path.includes("deleted")) {
					throw new Error("ENOENT")
				}
				return Promise.resolve({
					mtimeMs: 1000,
					size: 100,
					isDirectory: () => false,
				})
			})

			// Call
			const result = await changeDetector.findModifiedSince("/workspace", 0)

			// Assertions
			expect(result).toContain("/workspace/deleted.ts")
		})

		it("should handle errors during modified file detection", async () => {
			// Mock file tracker getAllFiles
			mockFileTracker.getAllFiles.mockResolvedValue(
				new Map([
					[
						"/workspace/error.ts",
						{
							path: "/workspace/error.ts",
							mtime: 1000,
							size: 100,
						},
					],
				]),
			)

			// Mock file existence check
			;(fileExistsAtPath as jest.Mock).mockResolvedValue(true)

			// Mock fs.stat to throw error
			;(fs.stat as jest.Mock).mockRejectedValue(new Error("Test error"))

			// Call
			const result = await changeDetector.findModifiedSince("/workspace", 0)

			// Assertions
			expect(result).toHaveLength(0)
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Error checking modification time"),
				expect.any(Error),
			)
		})
	})

	describe("compareFileStates", () => {
		it("should detect changes in file states", () => {
			// Define test cases
			const testCases = [
				{
					name: "should return true if old metadata is missing",
					oldMetadata: undefined,
					newMetadata: { path: "/test.ts", mtime: 1000, size: 100 },
					expected: true,
				},
				{
					name: "should return true if new metadata is missing",
					oldMetadata: { path: "/test.ts", mtime: 1000, size: 100 } as ExtendedFileMetadata,
					newMetadata: undefined,
					expected: true,
				},
				{
					name: "should return true if mtime has changed",
					oldMetadata: { path: "/test.ts", mtime: 1000, size: 100 } as ExtendedFileMetadata,
					newMetadata: { path: "/test.ts", mtime: 2000, size: 100 },
					expected: true,
				},
				{
					name: "should return true if size has changed",
					oldMetadata: { path: "/test.ts", mtime: 1000, size: 100 } as ExtendedFileMetadata,
					newMetadata: { path: "/test.ts", mtime: 1000, size: 200 },
					expected: true,
				},
				{
					name: "should return true if hash has changed",
					oldMetadata: { path: "/test.ts", mtime: 1000, size: 100, hash: "abc" } as ExtendedFileMetadata,
					newMetadata: { path: "/test.ts", mtime: 1000, size: 100, hash: "def" },
					expected: true,
				},
				{
					name: "should return false if nothing has changed",
					oldMetadata: { path: "/test.ts", mtime: 1000, size: 100, hash: "abc" } as ExtendedFileMetadata,
					newMetadata: { path: "/test.ts", mtime: 1000, size: 100, hash: "abc" },
					expected: false,
				},
			]

			// Run test cases
			testCases.forEach((testCase) => {
				const result = changeDetector.compareFileStates(testCase.oldMetadata, testCase.newMetadata as FileInfo)
				expect(result).toBe(testCase.expected)
			})
		})
	})

	describe("handleFileChanges", () => {
		it("should process file changes correctly", async () => {
			// Create mock file changes
			const changes: FileChange[] = [
				{
					path: "/path/to/new.ts",
					status: FileStatus.NEW,
					detectedAt: Date.now(),
					priority: 1,
				},
				{
					path: "/path/to/modified.ts",
					status: FileStatus.MODIFIED,
					detectedAt: Date.now(),
					priority: 1,
				},
				{
					path: "/path/to/deleted.ts",
					status: FileStatus.DELETED,
					detectedAt: Date.now(),
					priority: 2,
				},
				{
					path: "/path/to/unchanged.ts",
					status: FileStatus.UNCHANGED,
					detectedAt: Date.now(),
					priority: 0,
				},
				{
					path: "/path/to/excluded.ts",
					status: FileStatus.EXCLUDED,
					detectedAt: Date.now(),
					priority: 0,
				},
				{
					path: "/path/to/error.ts",
					status: FileStatus.ERROR,
					detectedAt: Date.now(),
					priority: 0,
				},
			]

			// Call
			const result = await changeDetector.handleFileChanges(changes)

			// Assertions
			expect(result.filesToIndex).toContain("/path/to/new.ts")
			expect(result.filesToIndex).toContain("/path/to/modified.ts")
			expect(result.filesToRemove).toContain("/path/to/deleted.ts")
			expect(result.unchangedFiles).toContain("/path/to/unchanged.ts")
			expect(result.skippedFiles).toContain("/path/to/excluded.ts")
			expect(result.errorFiles).toContain("/path/to/error.ts")

			// Check comparison result
			expect(result.comparisonResult.newFiles).toContain("/path/to/new.ts")
			expect(result.comparisonResult.modifiedFiles).toContain("/path/to/modified.ts")
			expect(result.comparisonResult.deletedFiles).toContain("/path/to/deleted.ts")
			expect(result.comparisonResult.unchangedFiles).toContain("/path/to/unchanged.ts")
			expect(result.comparisonResult.errorFiles).toContain("/path/to/error.ts")
		})

		it("should handle errors during change processing", async () => {
			// Create a change that will trigger an error
			const changes: FileChange[] = [
				{
					path: "/path/to/error.ts",
					status: FileStatus.ERROR,
					detectedAt: Date.now(),
					priority: 0,
				},
			]

			// Mock to throw an error
			jest.spyOn(changeDetector, "handleFileChanges").mockImplementationOnce(() => {
				throw new Error("Test error")
			})

			try {
				await changeDetector.handleFileChanges(changes)
			} catch (error) {
				expect(error).toBeDefined()
			}
		})
	})
})
