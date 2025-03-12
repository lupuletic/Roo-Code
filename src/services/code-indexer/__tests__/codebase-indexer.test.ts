import * as vscode from "vscode"
import { CodebaseIndexer, IndexingStatus } from "../codebase-indexer"
import { FileTracker, FileStatus, FileChange } from "../file-tracker"
import { WorkspaceWatcher } from "../workspace-watcher"
import { CodeSearch } from "../code-search"
import { getDefaultConfig } from "../config"

// Mock dependencies
jest.mock("../file-tracker")
jest.mock("../workspace-watcher")
jest.mock("../code-search")
jest.mock("../config")
jest.mock("../../utils/logging", () => ({
	logger: {
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	},
}))

// Mock vscode
jest.mock("vscode", () => {
	const mockWorkspace = {
		workspaceFolders: [{ uri: { fsPath: "/test/workspace" }, name: "test" }],
		getConfiguration: jest.fn().mockReturnValue({
			get: jest.fn().mockImplementation((key: string, defaultValue: any) => {
				const config: Record<string, any> = {
					enabled: true,
					embeddingModel: "text-embedding-ada-002",
					autoIndexOnWorkspaceOpen: true,
					watchForFileChanges: true,
					excludePatterns: ["**/node_modules/**"],
					maxFileSizeBytes: 1000000,
					maxChunkSize: 1000,
					chunkOverlap: 100,
					showNotifications: true,
				}
				return config[key] !== undefined ? config[key] : defaultValue
			}),
		}),
		findFiles: jest.fn().mockResolvedValue([{ fsPath: "file1.ts" }, { fsPath: "file2.ts" }]),
	}

	return {
		workspace: mockWorkspace,
		RelativePattern: jest.fn().mockImplementation((folder, pattern) => ({ folder, pattern })),
	}
})

describe("CodebaseIndexer", () => {
	// Set up mocks and test instance
	let mockContext: Partial<vscode.ExtensionContext>
	let indexer: CodebaseIndexer
	let MockCodeSearch: jest.MockedClass<typeof CodeSearch>
	let MockFileTracker: jest.MockedClass<typeof FileTracker>
	let MockWorkspaceWatcher: jest.MockedClass<typeof WorkspaceWatcher>

	// Mock instances
	let mockCodeSearch: jest.Mocked<CodeSearch>
	let mockFileTracker: jest.Mocked<FileTracker>
	let mockWorkspaceWatcher: jest.Mocked<WorkspaceWatcher>

	beforeEach(() => {
		jest.clearAllMocks()

		// Setup mock context
		mockContext = {
			subscriptions: [],
			extensionPath: "/test/extension",
			globalStorageUri: { fsPath: "/test/storage" } as vscode.Uri,
		}

		// Setup mock configuration
		const mockConfig: ReturnType<typeof getDefaultConfig> = {
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
		;(getDefaultConfig as jest.Mock).mockReturnValue(mockConfig)

		// Mock handlers for the CodeSearch class
		mockCodeSearch = {
			initialize: jest.fn().mockResolvedValue(undefined),
			getStats: jest.fn().mockResolvedValue({ fileCount: 0, chunkCount: 0 }),
			indexFiles: jest.fn().mockResolvedValue(undefined),
			indexFile: jest.fn().mockResolvedValue(undefined),
			removeFile: jest.fn().mockResolvedValue(undefined),
			search: jest.fn().mockResolvedValue([]),
			clear: jest.fn().mockResolvedValue(undefined),
		} as unknown as jest.Mocked<CodeSearch>

		// Mock handlers for the FileTracker class
		mockFileTracker = {
			load: jest.fn().mockResolvedValue(undefined),
			save: jest.fn().mockResolvedValue(undefined),
			addFile: jest.fn().mockResolvedValue(true),
			removeFile: jest.fn().mockResolvedValue(true),
			markAsIndexed: jest.fn().mockResolvedValue(undefined),
			getFileInfo: jest.fn().mockResolvedValue(undefined),
		} as unknown as jest.Mocked<FileTracker>

		// Mock handlers for the WorkspaceWatcher class
		mockWorkspaceWatcher = {
			onFileCreated: jest.fn(),
			onFileChanged: jest.fn(),
			onFileDeleted: jest.fn(),
			startWatching: jest.fn(),
			stopWatching: jest.fn(),
			shouldSkipFile: jest.fn().mockReturnValue(false),
		} as unknown as jest.Mocked<WorkspaceWatcher>

		// Replace the constructors with mocks that return our mock instances
		;(CodeSearch as jest.MockedClass<typeof CodeSearch>).mockImplementation(() => mockCodeSearch)
		;(FileTracker as jest.MockedClass<typeof FileTracker>).mockImplementation(() => mockFileTracker)
		;(WorkspaceWatcher as jest.MockedClass<typeof WorkspaceWatcher>).mockImplementation(() => mockWorkspaceWatcher)

		// Create the indexer instance with the mock context
		indexer = new CodebaseIndexer(mockContext as vscode.ExtensionContext)
	})

	describe("initialization", () => {
		it("should initialize with the correct configuration", () => {
			expect(getDefaultConfig).toHaveBeenCalledWith(mockContext)
			expect(CodeSearch).toHaveBeenCalledWith(mockContext)
			expect(FileTracker).toHaveBeenCalled()
			expect(WorkspaceWatcher).toHaveBeenCalled()
		})

		it("should set up event handlers for file system events", () => {
			expect(mockWorkspaceWatcher.onFileCreated).toHaveBeenCalled()
			expect(mockWorkspaceWatcher.onFileChanged).toHaveBeenCalled()
			expect(mockWorkspaceWatcher.onFileDeleted).toHaveBeenCalled()
		})
	})

	describe("startIndexing", () => {
		it("should index the workspace", async () => {
			// Setup
			mockFileTracker.addFile.mockResolvedValue(true)
			mockWorkspaceWatcher.shouldSkipFile.mockReturnValue(false)

			// Call
			await indexer.startIndexing(false)

			// Assertions
			expect(mockCodeSearch.initialize).toHaveBeenCalled()
			expect(mockFileTracker.load).toHaveBeenCalled()
			expect(mockFileTracker.addFile).toHaveBeenCalled()
			expect(mockCodeSearch.indexFiles).toHaveBeenCalled()
			expect(mockFileTracker.markAsIndexed).toHaveBeenCalled()
			expect(mockFileTracker.save).toHaveBeenCalled()
		})

		it("should skip indexing if skipIfExists is true and files are already indexed", async () => {
			// Setup
			mockCodeSearch.getStats.mockResolvedValue({ fileCount: 10, chunkCount: 100 })

			// Call
			await indexer.startIndexing(true)

			// Assertions
			expect(mockCodeSearch.initialize).toHaveBeenCalled()
			expect(mockFileTracker.load).toHaveBeenCalled()
			expect(mockCodeSearch.getStats).toHaveBeenCalled()
			expect(mockCodeSearch.indexFiles).not.toHaveBeenCalled()
		})
	})

	describe("search", () => {
		it("should search the code index", async () => {
			// Setup
			const mockResults = [
				{
					uuid: "123",
					chunk: "test",
					start: 0,
					end: 10,
					type: "function",
					filepath: "test.ts",
					vector: new Float32Array(),
					_distance: 0.1,
				},
			]
			mockCodeSearch.search.mockResolvedValue(mockResults)

			// Call
			const results = await indexer.search("test query")

			// Assertions
			expect(mockCodeSearch.search).toHaveBeenCalledWith({
				query: "test query",
				limit: 5,
				distanceThreshold: undefined,
			})
			expect(results).toEqual(mockResults)
		})
	})

	describe("rebuildIndex", () => {
		it("should rebuild the code index", async () => {
			// Setup
			const startIndexingMock = jest.spyOn(indexer, "startIndexing").mockResolvedValue()

			// Call
			await indexer.rebuildIndex()

			// Assertions
			expect(mockWorkspaceWatcher.stopWatching).toHaveBeenCalled()
			expect(mockCodeSearch.clear).toHaveBeenCalled()
			expect(startIndexingMock).toHaveBeenCalledWith(false)

			// Cleanup
			startIndexingMock.mockRestore()
		})
	})

	describe("getStatus", () => {
		it("should return the current status", () => {
			expect(indexer.getStatus()).toBe(IndexingStatus.IDLE)
		})
	})

	describe("dispose", () => {
		it("should clean up resources when disposed", () => {
			// Call
			indexer.dispose()

			// Assertions
			expect(mockWorkspaceWatcher.stopWatching).toHaveBeenCalled()
			expect(mockFileTracker.save).toHaveBeenCalled()

			// Call dispose again (should do nothing)
			indexer.dispose()
			expect(mockWorkspaceWatcher.stopWatching).toHaveBeenCalledTimes(1)
		})
	})

	describe("file event handlers", () => {
		// Create helper method to get access to private methods for testing
		const getPrivateMethod = <T>(instance: any, methodName: string): T => {
			return instance[methodName].bind(instance) as T
		}

		beforeEach(() => {
			// Reset mocks for these tests
			mockFileTracker.addFile.mockReset()
			mockCodeSearch.indexFile.mockReset()
			mockCodeSearch.removeFile.mockReset()
		})

		it("should handle file creation events", async () => {
			// Setup
			const filePath = "/test/workspace/newfile.ts"
			mockFileTracker.addFile.mockResolvedValue(true)

			// Get access to the private method
			const handleFileCreated = getPrivateMethod<(path: string) => Promise<void>>(indexer, "handleFileCreated")

			// Call
			await handleFileCreated(filePath)

			// Assertions
			expect(mockFileTracker.addFile).toHaveBeenCalledWith(filePath)
			expect(mockCodeSearch.indexFile).toHaveBeenCalledWith(filePath)
			expect(mockFileTracker.markAsIndexed).toHaveBeenCalledWith(filePath)
			expect(mockFileTracker.save).toHaveBeenCalled()
		})

		it("should handle file change events", async () => {
			// Setup
			const filePath = "/test/workspace/changedfile.ts"
			mockFileTracker.addFile.mockResolvedValue(true)

			// Get access to the private method
			const handleFileChanged = getPrivateMethod<(path: string) => Promise<void>>(indexer, "handleFileChanged")

			// Call
			await handleFileChanged(filePath)

			// Assertions
			expect(mockFileTracker.addFile).toHaveBeenCalledWith(filePath)
			expect(mockCodeSearch.removeFile).toHaveBeenCalledWith(filePath)
			expect(mockCodeSearch.indexFile).toHaveBeenCalledWith(filePath)
			expect(mockFileTracker.markAsIndexed).toHaveBeenCalledWith(filePath)
			expect(mockFileTracker.save).toHaveBeenCalled()
		})

		it("should handle file deletion events", async () => {
			// Setup
			const filePath = "/test/workspace/deletedfile.ts"

			// Get access to the private method
			const handleFileDeleted = getPrivateMethod<(path: string) => Promise<void>>(indexer, "handleFileDeleted")

			// Call
			await handleFileDeleted(filePath)

			// Assertions
			expect(mockCodeSearch.removeFile).toHaveBeenCalledWith(filePath)
			expect(mockFileTracker.removeFile).toHaveBeenCalledWith(filePath)
			expect(mockFileTracker.save).toHaveBeenCalled()
		})

		it("should skip indexing files that don't need it", async () => {
			// Setup
			const filePath = "/test/workspace/unchanged.ts"
			mockFileTracker.addFile.mockResolvedValue(false)

			// Get access to the private method
			const handleFileChanged = getPrivateMethod<(path: string) => Promise<void>>(indexer, "handleFileChanged")

			// Call
			await handleFileChanged(filePath)

			// Assertions
			expect(mockFileTracker.addFile).toHaveBeenCalledWith(filePath)
			expect(mockCodeSearch.removeFile).not.toHaveBeenCalled()
			expect(mockCodeSearch.indexFile).not.toHaveBeenCalled()
		})
	})

	describe("batch processing", () => {
		it("should process file changes in batches", async () => {
			// Setup mock file changes
			const changes: FileChange[] = [
				{
					path: "/test/workspace/file1.ts",
					status: FileStatus.NEW,
					detectedAt: Date.now(),
				},
				{
					path: "/test/workspace/file2.ts",
					status: FileStatus.MODIFIED,
					detectedAt: Date.now(),
				},
				{
					path: "/test/workspace/file3.ts",
					status: FileStatus.DELETED,
					detectedAt: Date.now(),
				},
			]

			// Mock methods that will be called
			const handleFileCreatedSpy = jest.spyOn(indexer as any, "handleFileCreated").mockResolvedValue(undefined)
			const handleFileChangedSpy = jest.spyOn(indexer as any, "handleFileChanged").mockResolvedValue(undefined)
			const handleFileDeletedSpy = jest.spyOn(indexer as any, "handleFileDeleted").mockResolvedValue(undefined)

			// Call the private method
			await (indexer as any).processBatchChanges(changes)

			// Assertions
			expect(handleFileCreatedSpy).toHaveBeenCalledWith("/test/workspace/file1.ts")
			expect(handleFileChangedSpy).toHaveBeenCalledWith("/test/workspace/file2.ts")
			expect(handleFileDeletedSpy).toHaveBeenCalledWith("/test/workspace/file3.ts")
			expect(changes.length).toBe(0) // Should have processed all changes
		})
	})
})
