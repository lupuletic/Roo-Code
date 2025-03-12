import * as vscode from "vscode"
import { CodebaseIndexer, IndexingStatus } from "../codebase-indexer"
import { FileTracker } from "../file-tracker"
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

describe("CodebaseIndexer - clearIndex functionality", () => {
	// Set up mocks and test instance
	let mockContext: Partial<vscode.ExtensionContext>
	let indexer: CodebaseIndexer

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
			clear: jest.fn(),
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

	describe("clearIndex", () => {
		it("should clear the index successfully", async () => {
			// Call
			await indexer.clearIndex()

			// Assert
			expect(mockCodeSearch.clear).toHaveBeenCalled()
			expect(mockFileTracker.clear).toHaveBeenCalled()
			expect(mockFileTracker.save).toHaveBeenCalled()
			expect(indexer.getStatus()).toBe(IndexingStatus.IDLE)
		})

		it("should handle errors when clearing the index", async () => {
			// Setup
			mockCodeSearch.clear.mockRejectedValue(new Error("Test error"))

			// Call & Assert
			await expect(indexer.clearIndex()).rejects.toThrow("Test error")
			expect(indexer.getStatus()).toBe(IndexingStatus.ERROR)
		})

		it("should prevent clearing while indexing is in progress", async () => {
			// Setup - manipulate the indexer status to simulate indexing in progress
			Object.defineProperty(indexer, "status", {
				value: IndexingStatus.INDEXING,
				writable: true,
			})

			// Call & Assert
			await expect(indexer.clearIndex()).rejects.toThrow("Cannot clear index while indexing is in progress")
		})
	})
})
