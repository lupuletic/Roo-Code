import * as vscode from "vscode"
import { CodeIndexerService, ServiceStatus } from "../code-indexer-service"
import { CodebaseIndexer, IndexingStatus } from "../codebase-indexer"
import { WorkspaceWatcher, WatcherEvent } from "../workspace-watcher"
import { FileStatus, FileChange } from "../file-tracker"
import { logger } from "../../../utils/logging"

// Mock dependencies
jest.mock("../codebase-indexer")
jest.mock("../workspace-watcher")
jest.mock("../config")
jest.mock("../../../utils/logging", () => ({
	logger: {
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	},
}))

// Mock vscode namespace
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
		onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() }),
		findFiles: jest.fn().mockResolvedValue([{ fsPath: "file1.ts" }, { fsPath: "file2.ts" }]),
	}

	return {
		workspace: mockWorkspace,
		CancellationTokenSource: jest.fn().mockImplementation(() => ({
			token: { onCancellationRequested: jest.fn() },
			cancel: jest.fn(),
			dispose: jest.fn(),
		})),
		ProgressLocation: { Notification: 1 },
		window: {
			withProgress: jest.fn().mockImplementation((options, task) => {
				const progress = { report: jest.fn() }
				const token = { onCancellationRequested: jest.fn() }
				return task(progress, token)
			}),
		},
		Uri: {
			file: jest.fn((path) => ({ fsPath: path })),
		},
	}
})

describe("CodeIndexerService", () => {
	// Set up mocks and test instance
	let mockContext: Partial<vscode.ExtensionContext>
	let service: CodeIndexerService
	let MockCodebaseIndexer: jest.MockedClass<typeof CodebaseIndexer>
	let MockWorkspaceWatcher: jest.MockedClass<typeof WorkspaceWatcher>

	// Mock instances
	let mockIndexer: jest.Mocked<CodebaseIndexer>
	let mockWorkspaceWatcher: jest.Mocked<WorkspaceWatcher>
	let mockEventEmitter: any

	// Set up spy for private methods to test
	const getPrivateProperty = <T>(instance: any, property: string): T => {
		return instance[property] as T
	}

	beforeEach(() => {
		jest.clearAllMocks()

		// Setup mock context
		mockContext = {
			subscriptions: [],
			extensionPath: "/test/extension",
			globalStorageUri: { fsPath: "/test/storage" } as vscode.Uri,
		}

		// Setup mock indexer
		mockIndexer = {
			startIndexing: jest.fn().mockResolvedValue(undefined),
			search: jest.fn().mockResolvedValue([]),
			rebuildIndex: jest.fn().mockResolvedValue(undefined),
			getStatus: jest.fn().mockReturnValue(IndexingStatus.IDLE),
			dispose: jest.fn(),
		} as unknown as jest.Mocked<CodebaseIndexer>

		// Setup mock event emitter for the workspace watcher
		mockEventEmitter = {
			on: jest.fn(),
			emit: jest.fn(),
			removeListener: jest.fn(),
		}

		// Setup mock workspace watcher
		mockWorkspaceWatcher = {
			startWatching: jest.fn(),
			stopWatching: jest.fn(),
			onFileCreated: jest.fn().mockImplementation((listener) => {
				mockEventEmitter.on(WatcherEvent.FILE_CREATED, listener)
				return { dispose: jest.fn() }
			}),
			onFileChanged: jest.fn().mockImplementation((listener) => {
				mockEventEmitter.on(WatcherEvent.FILE_CHANGED, listener)
				return { dispose: jest.fn() }
			}),
			onFileDeleted: jest.fn().mockImplementation((listener) => {
				mockEventEmitter.on(WatcherEvent.FILE_DELETED, listener)
				return { dispose: jest.fn() }
			}),
			shouldSkipFile: jest.fn().mockReturnValue(false),
		} as unknown as jest.Mocked<WorkspaceWatcher>

		// Replace the constructors with mocks that return our mock instances
		MockCodebaseIndexer = CodebaseIndexer as jest.MockedClass<typeof CodebaseIndexer>
		MockCodebaseIndexer.getInstance = jest.fn().mockResolvedValue(mockIndexer)

		MockWorkspaceWatcher = WorkspaceWatcher as jest.MockedClass<typeof WorkspaceWatcher>
		MockWorkspaceWatcher.prototype.onFileCreated = mockWorkspaceWatcher.onFileCreated
		MockWorkspaceWatcher.prototype.onFileChanged = mockWorkspaceWatcher.onFileChanged
		MockWorkspaceWatcher.prototype.onFileDeleted = mockWorkspaceWatcher.onFileDeleted
		MockWorkspaceWatcher.prototype.startWatching = mockWorkspaceWatcher.startWatching
		MockWorkspaceWatcher.prototype.stopWatching = mockWorkspaceWatcher.stopWatching

		// Create the service instance with the mock context
		service = new CodeIndexerService(mockContext as vscode.ExtensionContext)

		// Replace the private properties with our mocks for testing
		Object.defineProperty(service, "indexer", { value: mockIndexer, writable: true })
		Object.defineProperty(service, "workspaceWatcher", { value: mockWorkspaceWatcher, writable: true })
	})

	describe("initialization", () => {
		it("should initialize successfully", async () => {
			// Call
			await service.initialize(false)

			// Assert
			expect(service.status).toBe(ServiceStatus.RUNNING)
			expect(mockWorkspaceWatcher.startWatching).toHaveBeenCalled()
			expect(mockIndexer.startIndexing).toHaveBeenCalledWith(false)
		})

		it("should skip initialization if already running", async () => {
			// Setup
			Object.defineProperty(service, "_status", { value: ServiceStatus.RUNNING, writable: true })

			// Call
			await service.initialize(false)

			// Assert
			expect(mockIndexer.startIndexing).not.toHaveBeenCalled()
		})

		it("should handle initialization errors", async () => {
			// Setup
			mockIndexer.startIndexing.mockRejectedValue(new Error("Test error"))

			// Call & Assert
			await expect(service.initialize(false)).rejects.toThrow("Test error")
			expect(service.status).toBe(ServiceStatus.ERROR)
		})
	})

	describe("file processing", () => {
		beforeEach(async () => {
			// Initialize the service before testing file processing
			await service.initialize(false)
			jest.clearAllMocks() // Clear initialization calls
		})

		it("should queue file changes", () => {
			// Get queue
			const queue = getPrivateProperty<FileChange[]>(service, "processingQueue")
			expect(queue.length).toBe(0)

			// Simulate file events
			mockEventEmitter.emit(WatcherEvent.FILE_CREATED, "test-file.ts")

			// Check queue
			expect(queue.length).toBe(1)
			expect(queue[0].path).toBe("test-file.ts")
			expect(queue[0].status).toBe(FileStatus.NEW)
		})

		it("should process file changes in batches", async () => {
			// Setup queue with test changes
			const queue = getPrivateProperty<FileChange[]>(service, "processingQueue")
			queue.push(
				{ path: "file1.ts", status: FileStatus.NEW, detectedAt: Date.now() },
				{ path: "file2.ts", status: FileStatus.MODIFIED, detectedAt: Date.now() },
				{ path: "file3.ts", status: FileStatus.DELETED, detectedAt: Date.now() },
			)

			// Spy on the handleFileXXX methods
			const handleCreatedSpy = jest.spyOn(service as any, "handleFileCreated")
			const handleChangedSpy = jest.spyOn(service as any, "handleFileChanged")
			const handleDeletedSpy = jest.spyOn(service as any, "handleFileDeleted")

			// Call the process method directly
			await (service as any).processQueue()

			// Check that the handlers were called
			expect(handleCreatedSpy).toHaveBeenCalledWith("file1.ts")
			expect(handleChangedSpy).toHaveBeenCalledWith("file2.ts")
			expect(handleDeletedSpy).toHaveBeenCalledWith("file3.ts")

			// Queue should be empty now
			expect(queue.length).toBe(0)
		})

		it("should handle file creation", async () => {
			// Call the private method
			await (service as any).handleFileCreated("test-file.ts")

			// Check that search was called to force indexing
			expect(mockIndexer.search).toHaveBeenCalledWith("file:test-file.ts", 0)
		})

		it("should handle file modification", async () => {
			// Call the private method
			await (service as any).handleFileChanged("test-file.ts")

			// Check that search was called to force re-indexing
			expect(mockIndexer.search).toHaveBeenCalledWith("file:test-file.ts", 0)
		})

		it("should handle file deletion", async () => {
			// Call the private method
			await (service as any).handleFileDeleted("test-file.ts")

			// Check that rebuild was called to remove deleted files
			expect(mockIndexer.rebuildIndex).toHaveBeenCalled()
		})
	})

	describe("service lifecycle", () => {
		beforeEach(async () => {
			// Initialize the service before testing lifecycle methods
			await service.initialize(false)
			jest.clearAllMocks() // Clear initialization calls
		})

		it("should pause processing", () => {
			// Call
			service.pauseProcessing()

			// Assert
			expect(service.status).toBe(ServiceStatus.PAUSED)
			expect(getPrivateProperty<boolean>(service, "paused")).toBe(true)
		})

		it("should resume processing", () => {
			// Setup
			Object.defineProperty(service, "_status", { value: ServiceStatus.PAUSED, writable: true })
			Object.defineProperty(service, "paused", { value: true, writable: true })

			// Call
			service.resumeProcessing()

			// Assert
			expect(service.status).toBe(ServiceStatus.RUNNING)
			expect(getPrivateProperty<boolean>(service, "paused")).toBe(false)
		})

		it("should stop the service", async () => {
			// Call
			await service.stop()

			// Assert
			expect(service.status).toBe(ServiceStatus.STOPPED)
			expect(mockWorkspaceWatcher.stopWatching).toHaveBeenCalled()
		})

		it("should properly dispose resources", () => {
			// Setup spy on stop method
			const stopSpy = jest.spyOn(service, "stop").mockResolvedValue()

			// Call
			service.dispose()

			// Assert
			expect(stopSpy).toHaveBeenCalled()
		})
	})

	describe("search and rebuild", () => {
		it("should forward search requests to the indexer", async () => {
			// Setup
			mockIndexer.search.mockResolvedValue([
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
			])

			// Call
			const results = await service.search("test query", 10, 0.5)

			// Assert
			expect(mockIndexer.search).toHaveBeenCalledWith("test query", 10, 0.5)
			expect(results).toHaveLength(1)
		})

		it("should forward rebuild requests to the indexer", async () => {
			// Setup
			Object.defineProperty(service, "_status", { value: ServiceStatus.RUNNING, writable: true })

			// Call
			await service.rebuildIndex()

			// Assert
			expect(mockIndexer.rebuildIndex).toHaveBeenCalled()
		})

		it("should not rebuild if service is not running", async () => {
			// Setup
			Object.defineProperty(service, "_status", { value: ServiceStatus.STOPPED, writable: true })

			// Call
			await service.rebuildIndex()

			// Assert
			expect(mockIndexer.rebuildIndex).not.toHaveBeenCalled()
		})
	})

	describe("singleton pattern", () => {
		it("should return the same instance when getInstance is called multiple times", async () => {
			// Call
			const instance1 = await CodeIndexerService.getInstance(mockContext as vscode.ExtensionContext)
			const instance2 = await CodeIndexerService.getInstance(mockContext as vscode.ExtensionContext)

			// Assert
			expect(instance1).toBe(instance2)
		})
	})
})
