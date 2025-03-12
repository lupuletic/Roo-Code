import * as vscode from "vscode"
import { CodeSearch, IndexingProgress } from "../code-search"
import { getChunks } from "../chunker"

// Mock MetadataManager
jest.mock("../metadata", () => ({
	MetadataManager: jest.fn().mockImplementation(() => ({
		initialize: jest.fn().mockResolvedValue(undefined),
		load: jest.fn().mockResolvedValue(undefined),
		save: jest.fn().mockResolvedValue(undefined),
		updateFileMetadata: jest.fn().mockResolvedValue(undefined),
		removeFileMetadata: jest.fn().mockResolvedValue(undefined),
		compareFileMetadata: jest
			.fn()
			.mockResolvedValue({
				newFiles: [],
				modifiedFiles: [],
				deletedFiles: [],
				unchangedFiles: [],
				errorFiles: [],
			}),
		reset: jest.fn().mockResolvedValue(undefined),
		getIndexMetadata: jest.fn().mockReturnValue(null),
		getAllFileMetadata: jest.fn().mockResolvedValue(new Map()),
	})),
}))

// Mock dependencies
jest.mock("../path-utils", () => ({
	validatePath: jest.fn().mockResolvedValue(true),
	ensureDatabaseDirectory: jest.fn().mockResolvedValue(undefined),
	normalizePath: jest.fn((path) => path),
}))

jest.mock("@lancedb/lancedb", () => {
	// Create a chainable mock for query methods
	function createChainableMock() {
		// First create an object with the methods
		const mock: Record<string, jest.Mock> = {
			where: jest.fn(),
			limit: jest.fn(),
			select: jest.fn(),
			toArray: jest.fn().mockResolvedValue([]),
		}

		// Then set up the return values to create the chain
		mock.where.mockImplementation(() => {
			return {
				limit: mock.limit,
				toArray: mock.toArray,
			}
		})

		mock.limit.mockImplementation(() => {
			return { toArray: mock.toArray }
		})

		mock.select.mockImplementation(() => {
			return { toArray: mock.toArray }
		})

		return mock
	}

	// Mock table with both direct methods and query chainable methods
	const mockTable = {
		add: jest.fn().mockResolvedValue(undefined),
		query: jest.fn().mockReturnValue(createChainableMock()),
		search: jest.fn().mockReturnValue({
			limit: jest.fn().mockReturnValue({
				toArray: jest.fn().mockResolvedValue([]),
			}),
		}),
		createIndex: jest.fn().mockResolvedValue(undefined),
		countRows: jest.fn().mockResolvedValue(100),
	}

	// Mock connection with table operations
	const mockConnection = {
		openTable: jest.fn().mockResolvedValue(mockTable),
		createEmptyTable: jest.fn().mockResolvedValue(mockTable),
		dropTable: jest.fn().mockResolvedValue(undefined),
	}

	return {
		connect: jest.fn().mockResolvedValue(mockConnection),
		LanceSchema: jest.fn().mockReturnValue({}),
		getRegistry: jest.fn().mockReturnValue({
			get: jest.fn().mockReturnValue({
				create: jest.fn().mockReturnValue({
					sourceField: jest.fn((field) => field),
					vectorField: jest.fn().mockReturnValue([]),
				}),
			}),
		}),
		Utf8: jest.fn(),
		Int32: jest.fn(),
	}
})

jest.mock("../chunker", () => ({
	getChunks: jest.fn().mockResolvedValue([
		{
			chunk: "function test() { return 42; }",
			start: 0,
			end: 29,
			type: "function_definition",
			filepath: "/path/to/file.ts",
		},
	]),
	getChunksBatch: jest.fn().mockResolvedValue({
		chunks: [
			{
				chunk: "function test() { return 42; }",
				start: 0,
				end: 29,
				type: "function_definition",
				filepath: "/path/to/file.ts",
			},
		],
		errors: {},
	}),
}))

// Mock fs
jest.mock("fs", () => {
	const originalModule = jest.requireActual("fs")
	return {
		...originalModule,
		promises: {
			access: jest.fn().mockImplementation((filepath, mode) => {
				if (filepath.includes("nonexistent")) {
					return Promise.reject(new Error("ENOENT: no such file or directory"))
				}
				return Promise.resolve()
			}),
		},
		constants: { F_OK: 0 },
	}
})

// Mock FileTracker
jest.mock("../file-tracker", () => ({
	...jest.requireActual("../file-tracker"),
	FileTracker: jest.fn().mockImplementation(() => ({
		load: jest.fn().mockResolvedValue(undefined),
		save: jest.fn().mockResolvedValue(undefined),
		updateFileHash: jest.fn().mockResolvedValue(undefined),
		removeFile: jest.fn().mockResolvedValue(true),
		getFileStatus: jest.fn().mockResolvedValue("new"),
		clear: jest.fn().mockResolvedValue(undefined),
	})),
}))

jest.mock("uuid", () => ({
	v4: jest.fn().mockReturnValue("mock-uuid"),
}))

describe("CodeSearch", () => {
	let codeSearch: CodeSearch
	let mockContext: Partial<vscode.ExtensionContext>
	let mockConnectionResult: any
	let mockTableResult: any
	let mockMetadataManager: any
	let validatePath: jest.Mock
	let mockEventEmitter: vscode.EventEmitter<IndexingProgress>

	beforeEach(() => {
		jest.clearAllMocks()

		// Get path utils mocks
		const pathUtils = require("../path-utils")
		validatePath = pathUtils.validatePath

		// Setup mock context
		mockContext = {
			globalStorageUri: { fsPath: "/test/storage" } as vscode.Uri,
		}

		// Create an instance of CodeSearch for testing
		codeSearch = new CodeSearch(mockContext as vscode.ExtensionContext)

		// Get the mocked connection and table for later assertions
		const lancedb = require("@lancedb/lancedb")
		mockConnectionResult = lancedb.connect.mockReturnValue

		// Access the mockTable through the connection's openTable method
		mockTableResult = lancedb.connect().openTable()

		// Mock EventEmitter
		mockEventEmitter = { fire: jest.fn() } as unknown as vscode.EventEmitter<IndexingProgress>
		codeSearch["_onProgress"] = mockEventEmitter
	})

	afterEach(() => {
		jest.resetAllMocks()
	})

	describe("initialize", () => {
		it("should connect to LanceDB and initialize the table", async () => {
			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)

			// Call
			await codeSearch.initialize()

			// Assertions for path validation
			expect(validatePath).toHaveBeenCalledWith("./lancedb")

			// Get the lancedb module to access the mocks
			const lancedb = require("@lancedb/lancedb")

			// Get the metadata module to verify calls
			const { MetadataManager } = require("../metadata")
			const metadataInstance = MetadataManager()
			expect(metadataInstance.initialize).toHaveBeenCalled()

			// Assertions
			expect(lancedb.connect).toHaveBeenCalledWith("./lancedb")
			expect(lancedb.connect().openTable).toHaveBeenCalledWith("code_chunks")
		})

		it("should create a new table if it does not exist", async () => {
			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)

			// Setup - make openTable throw error
			const lancedb = require("@lancedb/lancedb")
			const mockConnection = lancedb.connect()
			mockConnection.openTable.mockRejectedValueOnce(new Error("Table not found"))

			// Call
			await codeSearch.initialize()

			// Assertions
			expect(mockConnection.createEmptyTable).toHaveBeenCalledWith(
				"code_chunks",
				expect.anything(),
				expect.objectContaining({ mode: "overwrite" }),
			)
		})

		it("should throw an error if the database path is invalid", async () => {
			// Setup - make validatePath return false
			validatePath.mockResolvedValueOnce(false)

			// Call & assertions
			await expect(codeSearch.initialize()).rejects.toThrow("Database path doesn't exist or is not accessible")
		})
	})

	describe("indexFile", () => {
		beforeEach(async () => {
			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)

			// Initialize before testing
			await codeSearch.initialize()
		})

		it("should chunk the file and add it to the database", async () => {
			// Call
			const result = await codeSearch.indexFile("/path/to/file.ts")

			// Assertions
			expect(getChunks).toHaveBeenCalledWith("/path/to/file.ts")

			// Get the mock table to verify add was called
			const lancedb = require("@lancedb/lancedb")
			const mockTable = lancedb.connect().openTable()

			expect(mockTable.add).toHaveBeenCalledWith([
				{
					uuid: "mock-uuid",
					chunk: "function test() { return 42; }",
					start: 0,
					end: 29,
					type: "function_definition",
					filepath: "/path/to/file.ts",
				},
			])

			expect(result).toEqual([
				{
					uuid: "mock-uuid",
					chunk: "function test() { return 42; }",
					start: 0,
					end: 29,
					type: "function_definition",
					filepath: "/path/to/file.ts",
				},
			])
		})

		it("should handle empty chunks gracefully", async () => {
			// Mock getChunks to return empty array
			const chunker = require("../chunker")
			chunker.getChunks.mockResolvedValueOnce([])

			// Call
			const result = await codeSearch.indexFile("/path/to/empty-file.ts")

			// Should return empty array
			expect(result).toEqual([])

			// Should not add anything to the database
			const lancedb = require("@lancedb/lancedb")
			const mockTable = lancedb.connect().openTable()
			expect(mockTable.add).not.toHaveBeenCalled()
		})
	})

	describe("indexFiles", () => {
		beforeEach(async () => {
			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)

			// Initialize before testing
			await codeSearch.initialize()
		})

		it("should index multiple files", async () => {
			// Mock compareFileMetadata to return some files that need processing
			const chunker = require("../chunker")
			const getChunksBatchMock = chunker.getChunksBatch

			getChunksBatchMock.mockResolvedValueOnce({
				chunks: Array(10)
					.fill(0)
					.map((_, i) => ({
						chunk: `function test${i}() {}`,
						start: 0,
						end: 20,
						type: "function_definition",
						filepath: i < 5 ? "/path/to/file1.ts" : "/path/to/file2.ts",
					})),
				errors: {},
			})

			const { MetadataManager } = require("../metadata")
			const metadataInstance = MetadataManager()
			metadataInstance.compareFileMetadata.mockResolvedValueOnce({
				newFiles: ["/path/to/file1.ts"],
				modifiedFiles: ["/path/to/file2.ts"],
				deletedFiles: [],
				unchangedFiles: [],
				errorFiles: [],
			})

			// Call
			const result = await codeSearch.indexFiles(["/path/to/file1.ts", "/path/to/file2.ts"])

			// Assertions
			expect(metadataInstance.compareFileMetadata).toHaveBeenCalled()
			expect(chunker.getChunksBatch).toHaveBeenCalled()

			// Verify progress was fired
			expect(mockEventEmitter.fire).toHaveBeenCalled()

			// Get the mock table to verify add method was called
			const lancedb = require("@lancedb/lancedb")
			const mockTable = lancedb.connect().openTable()
			expect(metadataInstance.save).toHaveBeenCalled()

			expect(mockTable.add).toHaveBeenCalled()
			expect(result.chunks.length).toBeGreaterThan(0)
			expect(Object.keys(result.errors).length).toBe(0)
		})

		it("should handle errors during batch indexing", async () => {
			// Mock compareFileMetadata to return some files that need processing
			const chunker = require("../chunker")
			const getChunksBatchMock = chunker.getChunksBatch

			getChunksBatchMock.mockResolvedValueOnce({
				chunks: [
					{
						chunk: "function test() {}",
						start: 0,
						end: 20,
						type: "function_definition",
						filepath: "/path/to/file1.ts",
					},
				],
				errors: { "/path/to/file2.ts": "File not found" },
			})

			const { MetadataManager } = require("../metadata")
			const metadataInstance = MetadataManager()
			metadataInstance.compareFileMetadata.mockResolvedValueOnce({
				newFiles: ["/path/to/file1.ts"],
				modifiedFiles: ["/path/to/file2.ts"],
				deletedFiles: [],
				unchangedFiles: [],
				errorFiles: [],
			})

			// Call
			const result = await codeSearch.indexFiles(["/path/to/file1.ts", "/path/to/file2.ts"])

			// Assertions
			expect(chunker.getChunksBatch).toHaveBeenCalled()
			expect(mockEventEmitter.fire).toHaveBeenCalled()

			// Verify error and success handling
			expect(result.chunks.length).toBeGreaterThan(0)
			expect(Object.keys(result.errors).length).toBe(1)
			expect(result.errors["/path/to/file2.ts"]).toBe("File not found")
		})

		it("should process deleted files", async () => {
			// Mock compareFileMetadata to return some deleted files
			const { MetadataManager } = require("../metadata")
			const metadataInstance = MetadataManager()
			metadataInstance.compareFileMetadata.mockResolvedValueOnce({
				newFiles: [],
				modifiedFiles: [],
				deletedFiles: ["/path/to/deleted-file.ts"],
				unchangedFiles: [],
				errorFiles: [],
			})

			// Spy on removeFiles
			const removeFilesSpy = jest.spyOn(codeSearch, "removeFiles")
			removeFilesSpy.mockResolvedValueOnce({ removed: ["/path/to/deleted-file.ts"], errors: {} })

			// Call
			await codeSearch.indexFiles(["/path/to/deleted-file.ts"])

			// Verify removeFiles was called with the deleted file
			expect(removeFilesSpy).toHaveBeenCalledWith(["/path/to/deleted-file.ts"])

			// Clean up
			removeFilesSpy.mockRestore()
		})
	})

	describe("checkIndexConsistency", () => {
		beforeEach(async () => {
			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)

			// Initialize before testing
			await codeSearch.initialize()

			// Mock getIndexedFiles to return test filepaths
			jest.spyOn(codeSearch, "getIndexedFiles").mockResolvedValue([
				"/path/to/valid-file.ts",
				"/path/to/nonexistent-file.ts",
				"/path/to/another-valid-file.ts",
			])
		})

		it("should identify and clean up orphaned files", async () => {
			// Mock removeFile to succeed
			const removeFileSpy = jest.spyOn(codeSearch, "removeFile")
			removeFileSpy.mockResolvedValue(true)

			// Call
			const result = await codeSearch.checkIndexConsistency()

			// Should find one orphaned file
			expect(result.total).toBe(3)
			expect(result.orphaned).toBe(1)
			expect(result.removed).toBe(1)
			expect(Object.keys(result.errors).length).toBe(0)

			// Verify removeFile was called for the nonexistent file
			expect(removeFileSpy).toHaveBeenCalledWith("/path/to/nonexistent-file.ts")

			// Clean up
			removeFileSpy.mockRestore()
		})

		it("should handle errors during consistency check", async () => {
			// Mock removeFile to fail
			const removeFileSpy = jest.spyOn(codeSearch, "removeFile")
			removeFileSpy.mockRejectedValue(new Error("Failed to remove file"))

			// Call
			const result = await codeSearch.checkIndexConsistency()

			// Should find one orphaned file but have an error removing it
			expect(result.total).toBe(3)
			expect(result.orphaned).toBe(1)
			expect(result.removed).toBe(0)
			expect(Object.keys(result.errors).length).toBe(1)

			// Clean up
			removeFileSpy.mockRestore()
		})

		it("should check metadata consistency", async () => {
			// Mock getAllFileMetadata to return test metadata
			const { MetadataManager } = require("../metadata")
			const metadataInstance = MetadataManager()

			const testMetadata = new Map()
			testMetadata.set("/path/to/valid-file.ts", { hash: "abc123" })
			testMetadata.set("/path/to/orphaned-metadata.ts", { hash: "def456" })
			testMetadata.set("__stats__", { fileCount: 3, chunkCount: 10 })

			metadataInstance.getAllFileMetadata.mockResolvedValueOnce(testMetadata)

			// Call
			await codeSearch.checkIndexConsistency()

			// Should call removeFileMetadata for orphaned metadata
			expect(metadataInstance.removeFileMetadata).toHaveBeenCalledWith("/path/to/orphaned-metadata.ts")
		})
	})

	describe("removeFile", () => {
		beforeEach(async () => {
			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)

			// Initialize before testing
			await codeSearch.initialize()

			// Setup query mock to return chunks
			const lancedb = require("@lancedb/lancedb")
			const mockConnection = lancedb.connect()
			const mockTable = mockConnection.openTable()

			// Setup mockTable.query().where() to return records when queried
			const mockQuery = mockTable.query()

			// Make where return records when filepath is queried
			mockQuery.where.mockImplementation((whereClause: string) => {
				if (whereClause.includes("filepath")) {
					return {
						toArray: jest.fn().mockResolvedValue([
							{ uuid: "chunk1", filepath: "/path/to/file.ts" },
							{ uuid: "chunk2", filepath: "/path/to/file.ts" },
						]),
					}
				}
				return { toArray: mockQuery.toArray }
			})

			// Setup mockTable.query().toArray() to return all records
			mockQuery.toArray.mockResolvedValue([
				{ uuid: "chunk1", filepath: "/path/to/file.ts" },
				{ uuid: "chunk2", filepath: "/path/to/file.ts" },
				{ uuid: "chunk3", filepath: "/path/to/other-file.ts" },
			])
		})

		it("should remove all chunks associated with a file", async () => {
			// Call
			const result = await codeSearch.removeFile("/path/to/file.ts")

			// Get the metadata module to verify calls
			const { MetadataManager } = require("../metadata")
			const metadataInstance = MetadataManager()
			expect(metadataInstance.removeFileMetadata).toHaveBeenCalledWith("/path/to/file.ts")

			// Get the mock connection to verify dropTable was called
			const lancedb = require("@lancedb/lancedb")
			const mockConnection = lancedb.connect()

			// Get the file tracker to verify calls
			const { FileTracker } = require("../file-tracker")
			const fileTrackerInstance = FileTracker()
			expect(fileTrackerInstance.removeFile).toHaveBeenCalledWith("/path/to/file.ts")

			// Verify dropTable was called (for the table recreation approach)
			expect(mockConnection.dropTable).toHaveBeenCalled()

			// Should return true on successful removal
			expect(result).toBe(true)
		})

		it("should handle files with no chunks gracefully", async () => {
			// Setup query to return no chunks for this file
			const lancedb = require("@lancedb/lancedb")
			const mockTable = lancedb.connect().openTable()
			const mockQuery = mockTable.query()

			mockQuery.where.mockImplementation((whereClause: string) => {
				if (whereClause.includes("filepath")) {
					return {
						toArray: jest.fn().mockResolvedValue([]),
					}
				}
				return { toArray: mockQuery.toArray }
			})

			// Call
			const result = await codeSearch.removeFile("/path/to/empty-file.ts")

			// Should still remove from tracker and metadata
			const { FileTracker } = require("../file-tracker")
			const fileTrackerInstance = FileTracker()
			expect(fileTrackerInstance.removeFile).toHaveBeenCalledWith("/path/to/empty-file.ts")

			const { MetadataManager } = require("../metadata")
			const metadataInstance = MetadataManager()
			expect(metadataInstance.removeFileMetadata).toHaveBeenCalledWith("/path/to/empty-file.ts")

			// Should not drop the table or recreate (since there's nothing to delete)
			const mockConnection = lancedb.connect()
			expect(mockConnection.dropTable).not.toHaveBeenCalled()

			// Should return true on successful removal
			expect(result).toBe(true)
		})
	})

	describe("removeFiles", () => {
		beforeEach(async () => {
			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)

			// Initialize before testing
			await codeSearch.initialize()
		})

		it("should remove multiple files and track results", async () => {
			// Mock removeFile to succeed for first file and fail for second
			const removeFileSpy = jest.spyOn(codeSearch, "removeFile")
			removeFileSpy
				.mockResolvedValueOnce(true) // First file succeeds
				.mockRejectedValueOnce(new Error("Test error")) // Second file fails

			// Call
			const result = await codeSearch.removeFiles(["/path/to/file1.ts", "/path/to/file2.ts"])

			// Should report one success and one failure
			expect(result.removed).toEqual(["/path/to/file1.ts"])
			expect(Object.keys(result.errors)).toEqual(["/path/to/file2.ts"])
			expect(result.errors["/path/to/file2.ts"]).toContain("Test error")

			// Verify saveState was called
			const { MetadataManager } = require("../metadata")
			const metadataInstance = MetadataManager()
			expect(metadataInstance.save).toHaveBeenCalled()

			// Cleanup
			removeFileSpy.mockRestore()
		})

		it("should handle empty input gracefully", async () => {
			// Call with empty array
			const result = await codeSearch.removeFiles([])

			// Should have empty results
			expect(result.removed).toEqual([])
			expect(Object.keys(result.errors)).toEqual([])
		})
	})

	describe("search", () => {
		beforeEach(async () => {
			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)

			// Initialize before testing
			await codeSearch.initialize()

			// Setup mock search results
			const lancedb = require("@lancedb/lancedb")
			const mockTable = lancedb.connect().openTable()

			const mockResults = [
				{
					uuid: "result1",
					chunk: "function test1() { return 1; }",
					start: 0,
					end: 29,
					type: "function_definition",
					filepath: "/path/to/file1.ts",
					vector: new Float32Array(),
					_distance: 0.1,
				},
				{
					uuid: "result2",
					chunk: "function test2() { return 2; }",
					start: 0,
					end: 29,
					type: "function_definition",
					filepath: "/path/to/file2.ts",
					vector: new Float32Array(),
					_distance: 0.2,
				},
				{
					uuid: "result3",
					chunk: "function test3() { return 3; }",
					start: 0,
					end: 29,
					type: "function_definition",
					filepath: "/path/to/file3.ts",
					vector: new Float32Array(),
					_distance: 0.3,
				},
			]

			// Make the search chain return our mock results
			mockTable.search.mockReturnValue({
				limit: jest.fn().mockReturnValue({
					toArray: jest.fn().mockResolvedValue(mockResults),
				}),
			})
		})

		it("should search with the given query and limit", async () => {
			// Call
			const results = await codeSearch.search({ query: "test query", limit: 10 })

			// Get the mock table to verify search was called
			const lancedb = require("@lancedb/lancedb")
			const mockTable = lancedb.connect().openTable()

			// Assertions
			expect(mockTable.search).toHaveBeenCalledWith("test query")
			expect(mockTable.search().limit).toHaveBeenCalledWith(10)
			expect(results.length).toBe(3)
		})

		it("should filter results by distance threshold if provided", async () => {
			// Call with distance threshold
			const results = await codeSearch.search({
				query: "test query",
				limit: 10,
				distanceThreshold: 0.2,
			})

			// Only results with distance <= 0.2 should be returned
			expect(results.length).toBe(2)
		})
	})

	describe("find", () => {
		beforeEach(async () => {
			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)

			// Initialize before testing
			await codeSearch.initialize()

			// Setup mock query results
			const lancedb = require("@lancedb/lancedb")
			const mockTable = lancedb.connect().openTable()
			const mockQuery = mockTable.query()

			const mockResult = {
				uuid: "test-uuid",
				chunk: "function test() { return 42; }",
				start: 0,
				end: 29,
				type: "function_definition",
				filepath: "/path/to/file.ts",
			}

			// Make where return a chainable with our mock result
			mockQuery.where.mockReturnValue({
				limit: jest.fn().mockReturnValue({
					toArray: jest.fn().mockResolvedValue([mockResult]),
				}),
			})
		})

		it("should find a chunk by UUID", async () => {
			// Call
			const result = await codeSearch.find("test-uuid")

			// Get the mock table to verify query was called
			const lancedb = require("@lancedb/lancedb")
			const mockTable = lancedb.connect().openTable()
			const mockQuery = mockTable.query()

			// Assertions
			expect(mockQuery.where).toHaveBeenCalledWith(expect.stringContaining("test-uuid"))

			expect(result).toMatchObject({
				uuid: "test-uuid",
				chunk: "function test() { return 42; }",
				start: 0,
				end: 29,
				type: "function_definition",
				filepath: "/path/to/file.ts",
			})
		})
	})

	describe("clear", () => {
		beforeEach(async () => {
			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)

			// Initialize before testing
			await codeSearch.initialize()
		})

		it("should drop the table and reinitialize", async () => {
			// Create spy for initialize
			const oldInitialize = codeSearch.initialize
			const initializeSpy = jest.spyOn(codeSearch, "initialize")

			// Call
			await codeSearch.clear()

			// Get the mock connection to verify dropTable was called
			const lancedb = require("@lancedb/lancedb")
			const mockConnection = lancedb.connect()

			// Get the metadata module to verify calls
			const { MetadataManager } = require("../metadata")
			const metadataInstance = MetadataManager()
			expect(metadataInstance.reset).toHaveBeenCalled()

			// Assertions
			expect(mockConnection.dropTable).toHaveBeenCalledWith("code_chunks")
			expect(initializeSpy).toHaveBeenCalled()

			// Cleanup
			codeSearch.initialize = oldInitialize
			initializeSpy.mockRestore()
		})
	})

	describe("getInstance", () => {
		beforeEach(() => {
			// Reset the singleton instance
			// We need to access the private static instance directly using a workaround
			;(CodeSearch as any).instance = undefined

			// Ensure validatePath returns true
			validatePath.mockResolvedValue(true)
		})

		it("should create a new instance if none exists", async () => {
			// Call
			const instance = await CodeSearch.getInstance(mockContext as vscode.ExtensionContext)

			// Should be an instance of CodeSearch
			expect(instance).toBeInstanceOf(CodeSearch)

			// initialize should have been called
			const lancedb = require("@lancedb/lancedb")
			expect(lancedb.connect).toHaveBeenCalled()
		})

		it("should return the existing instance on subsequent calls", async () => {
			// Call twice
			const instance1 = await CodeSearch.getInstance(mockContext as vscode.ExtensionContext)
			const instance2 = await CodeSearch.getInstance(mockContext as vscode.ExtensionContext)

			// Should be the same instance
			expect(instance1).toBe(instance2)

			// initialize should have been called only once
			const lancedb = require("@lancedb/lancedb")
			expect(lancedb.connect).toHaveBeenCalledTimes(1)
		})
	})
})
