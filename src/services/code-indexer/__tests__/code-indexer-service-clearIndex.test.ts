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
	}
})

describe("CodeIndexerService - clearIndex functionality", () => {
	// Set up mocks and test instance
	let mockContext: Partial<vscode.ExtensionContext>
	let service: CodeIndexerService
	let MockCodebaseIndexer: jest.MockedClass<typeof CodebaseIndexer>

	// Mock instances
	let mockIndexer: jest.Mocked<CodebaseIndexer>

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
			clearIndex: jest.fn().mockResolvedValue(undefined),
			getStatus: jest.fn().mockReturnValue(IndexingStatus.IDLE),
			dispose: jest.fn(),
		} as unknown as jest.Mocked<CodebaseIndexer>

		// Replace the constructors with mocks that return our mock instances
		MockCodebaseIndexer = CodebaseIndexer as jest.MockedClass<typeof CodebaseIndexer>
		MockCodebaseIndexer.getInstance = jest.fn().mockResolvedValue(mockIndexer)

		// Create the service instance with the mock context
		service = new CodeIndexerService(mockContext as vscode.ExtensionContext)

		// Replace the private properties with our mocks for testing
		Object.defineProperty(service, "indexer", { value: mockIndexer, writable: true })
	})

	describe("clearIndex", () => {
		it("should clear the index if in running state", async () => {
			// Setup
			Object.defineProperty(service, "_status", { value: ServiceStatus.RUNNING, writable: true })
			const notificationSpy = jest.spyOn(service as any, "startProgressNotification")

			// Call
			await service.clearIndex()

			// Assert
			expect(mockIndexer.clearIndex).toHaveBeenCalled()
			expect(notificationSpy).toHaveBeenCalledWith("Clearing code index...")
			expect(service.status).toBe(ServiceStatus.RUNNING)
		})

		it("should not clear the index if not in running state", async () => {
			// Setup
			Object.defineProperty(service, "_status", { value: ServiceStatus.STOPPED, writable: true })

			// Call
			await service.clearIndex()

			// Assert
			expect(mockIndexer.clearIndex).not.toHaveBeenCalled()
			expect(logger.debug).toHaveBeenCalledWith("Cannot clear index in current status: stopped")
		})

		it("should handle errors when clearing the index", async () => {
			// Setup
			Object.defineProperty(service, "_status", { value: ServiceStatus.RUNNING, writable: true })
			mockIndexer.clearIndex.mockRejectedValue(new Error("Test error"))

			// Call & Assert
			await expect(service.clearIndex()).rejects.toThrow("Test error")
			expect(service.status).toBe(ServiceStatus.ERROR)
			expect(logger.error).toHaveBeenCalledWith("Error clearing code index:", expect.any(Error))
		})
	})

	describe("getIndexStats", () => {
		it("should return stats about the index", async () => {
			// Call
			const stats = await service.getIndexStats()

			// Assert
			expect(stats).toEqual({ fileCount: 0, chunkCount: 0 })
			expect(logger.debug).toHaveBeenCalledWith("Getting index stats")
		})
	})
})
