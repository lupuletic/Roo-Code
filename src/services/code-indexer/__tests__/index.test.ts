import * as vscode from "vscode"
import {
	clearCodeIndex,
	getIndexStatus,
	pauseCodeIndexer,
	registerCodeIndexer,
	resumeCodeIndexer,
	startCodeIndexing,
	disposeCodeIndexer,
} from "../index"
import { CodeIndexerService, ServiceStatus } from "../code-indexer-service"
import { IndexingStatus } from "../codebase-indexer"
import { logger } from "../../../utils/logging"

// Mock dependencies
jest.mock("../code-indexer-service")
jest.mock("../../../utils/logging", () => ({
	logger: {
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	},
}))

// Mock VSCode
jest.mock("vscode", () => {
	return {
		window: {
			showInformationMessage: jest.fn(),
		},
		commands: {
			registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
		},
		workspace: {
			getConfiguration: jest.fn().mockReturnValue({
				get: jest.fn((key, defaultValue) => defaultValue),
			}),
		},
	}
})

describe("Code Indexer Module", () => {
	const mockContext: Partial<vscode.ExtensionContext> = {
		subscriptions: [],
	}

	let mockService: jest.Mocked<Partial<CodeIndexerService>>

	beforeEach(() => {
		jest.clearAllMocks()

		// Create mock service
		mockService = {
			status: ServiceStatus.RUNNING,
			initialize: jest.fn().mockResolvedValue(undefined),
			search: jest.fn().mockResolvedValue([]),
			rebuildIndex: jest.fn().mockResolvedValue(undefined),
			clearIndex: jest.fn().mockResolvedValue(undefined),
			pauseProcessing: jest.fn(),
			resumeProcessing: jest.fn(),
			getIndexStats: jest.fn().mockResolvedValue({ fileCount: 10, chunkCount: 100 }),
			dispose: jest.fn(),
		} as unknown as jest.Mocked<Partial<CodeIndexerService>>

		// Mock getInstance to return our mock instance
		const MockCodeIndexerService = CodeIndexerService as jest.MockedClass<typeof CodeIndexerService>
		MockCodeIndexerService.getInstance = jest.fn().mockResolvedValue(mockService)
	})

	describe("Command Registration", () => {
		it("should register all commands correctly", async () => {
			// Call the function
			registerCodeIndexer(mockContext as vscode.ExtensionContext)

			// Verify commands are registered
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"cline.startCodeIndexing",
				expect.any(Function),
			)

			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"cline.getIndexingStatus",
				expect.any(Function),
			)

			expect(vscode.commands.registerCommand).toHaveBeenCalledWith("cline.rebuildCodeIndex", expect.any(Function))

			expect(vscode.commands.registerCommand).toHaveBeenCalledWith("cline.clearCodeIndex", expect.any(Function))

			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"cline.pauseCodeIndexing",
				expect.any(Function),
			)

			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"cline.resumeCodeIndexing",
				expect.any(Function),
			)
		})
	})

	describe("Index Management Commands", () => {
		it("should start code indexing", async () => {
			await startCodeIndexing(false)
			expect(mockService.initialize).toHaveBeenCalledWith(false)
		})

		it("should clear the index", async () => {
			await clearCodeIndex()
			expect(mockService.clearIndex).toHaveBeenCalled()
		})

		it("should pause indexing", () => {
			pauseCodeIndexer()
			expect(mockService.pauseProcessing).toHaveBeenCalled()
		})

		it("should resume indexing", () => {
			resumeCodeIndexer()
			expect(mockService.resumeProcessing).toHaveBeenCalled()
		})

		it("should get index status", async () => {
			const result = await getIndexStatus()
			expect(result.status).toBe(IndexingStatus.IDLE)
			expect(result.stats).toEqual({ fileCount: 10, chunkCount: 100 })
		})

		it("should dispose of the service", () => {
			disposeCodeIndexer()
			expect(mockService.dispose).toHaveBeenCalled()
		})
	})

	describe("Error Handling", () => {
		it("should handle errors during initialization", async () => {
			const MockCodeIndexerService = CodeIndexerService as jest.MockedClass<typeof CodeIndexerService>
			MockCodeIndexerService.getInstance = jest.fn().mockRejectedValue(new Error("Test error"))

			await startCodeIndexing(false)

			expect(logger.error).toHaveBeenCalledWith("Failed to initialize code indexer:", expect.any(Error))
		})

		it("should handle missing service gracefully", async () => {
			// Set service to undefined to simulate uninitialized state
			const MockCodeIndexerService = CodeIndexerService as jest.MockedClass<typeof CodeIndexerService>
			MockCodeIndexerService.getInstance = jest.fn().mockResolvedValue(undefined)

			await clearCodeIndex()

			expect(logger.warn).toHaveBeenCalledWith("Code indexer not initialized, cannot clear index")
		})
	})
})
