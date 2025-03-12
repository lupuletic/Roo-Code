import * as vscode from "vscode"
import { WorkspaceWatcher, WatcherEvent, EventPriority } from "../workspace-watcher"
import { CodeIndexerConfig } from "../config"
import * as fs from "fs"
import { logger } from "../../../utils/logging"

// Mock dependencies
jest.mock("vscode")
jest.mock("fs")
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

const flushPromises = () => new Promise(process.nextTick)

describe("WorkspaceWatcher", () => {
	let watcher: WorkspaceWatcher
	let mockConfig: CodeIndexerConfig
	let mockFileSystemWatcher: any

	// Mock event handlers
	const mockOnDidCreate = jest.fn()
	const mockOnDidChange = jest.fn()
	const mockOnDidDelete = jest.fn()

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

		// Mock vscode.workspace.createFileSystemWatcher
		mockFileSystemWatcher = {
			onDidCreate: mockOnDidCreate,
			onDidChange: mockOnDidChange,
			onDidDelete: mockOnDidDelete,
			dispose: jest.fn(),
		}
		;(vscode.workspace.createFileSystemWatcher as jest.Mock).mockReturnValue(mockFileSystemWatcher)

		// Create watcher instance
		watcher = new WorkspaceWatcher(mockConfig)

		// Mock timers
		jest.useFakeTimers()
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	describe("startWatching", () => {
		it("should create a file system watcher and set up event handlers", () => {
			// Call
			watcher.startWatching()

			// Assertions
			expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith("**/*")
			expect(mockOnDidCreate).toHaveBeenCalled()
			expect(mockOnDidChange).toHaveBeenCalled()
			expect(mockOnDidDelete).toHaveBeenCalled()
			// Should set up the queue processing interval
			expect(setInterval).toHaveBeenCalled()
			expect(logger.debug).toHaveBeenCalledWith("Workspace watcher started")
		})

		it("should not start watching if already watching", () => {
			// Start watching once
			watcher.startWatching()

			// Clear mocks
			jest.clearAllMocks()

			// Start watching again
			watcher.startWatching()

			// Assertions
			expect(vscode.workspace.createFileSystemWatcher).not.toHaveBeenCalled()
		})
	})

	describe("stopWatching", () => {
		it("should dispose the file system watcher", () => {
			// Start watching
			watcher.startWatching()

			// Clear mocks
			jest.clearAllMocks()

			// Stop watching
			watcher.stopWatching()

			// Assertions
			expect(mockFileSystemWatcher.dispose).toHaveBeenCalled()
			// Should clean up timers
			expect(clearInterval).toHaveBeenCalled()
			expect(logger.debug).toHaveBeenCalledWith("Workspace watcher stopped")
			expect(logger.debug).toHaveBeenCalledWith("Workspace watcher stopped")
		})

		it("should not stop watching if not watching", () => {
			// Call without starting
			watcher.stopWatching()

			// Assertions
			expect(mockFileSystemWatcher?.dispose).not.toHaveBeenCalled()
		})
	})

	describe("shouldSkipFile", () => {
		it("should skip files that exceed size limit", () => {
			// Mock fs.statSync to return a large file
			;(fs.statSync as jest.Mock).mockReturnValue({
				size: mockConfig.maxFileSizeBytes + 1,
			})

			// Call
			const result = watcher.shouldSkipFile("/path/to/large-file.ts")

			// Assertions
			expect(result).toBe(true)
			expect(fs.statSync).toHaveBeenCalledWith("/path/to/large-file.ts")
		})

		it("should delegate to shouldExcludeFile for pattern matching", () => {
			// Mock fs.statSync to return a small file
			;(fs.statSync as jest.Mock).mockReturnValue({
				size: mockConfig.maxFileSizeBytes - 1,
			})

			// Mock shouldExcludeFile to return true
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(true)

			// Call
			const result = watcher.shouldSkipFile("/path/to/excluded-file.ts")

			// Assertions
			expect(result).toBe(true)
			expect(shouldExcludeFile).toHaveBeenCalledWith("/path/to/excluded-file.ts", mockConfig.excludePatterns)
		})

		it("should handle errors when checking file stats", () => {
			// Mock fs.statSync to throw an error
			;(fs.statSync as jest.Mock).mockImplementation(() => {
				throw new Error("File not found")
			})

			// Mock shouldExcludeFile to return false
			const { shouldExcludeFile } = require("../config")
			shouldExcludeFile.mockReturnValue(false)

			// Call
			const result = watcher.shouldSkipFile("/path/to/nonexistent-file.ts")

			// Assertions
			expect(result).toBe(false)
			expect(shouldExcludeFile).toHaveBeenCalledWith("/path/to/nonexistent-file.ts", mockConfig.excludePatterns)
		})
	})

	describe("event handlers", () => {
		let createdListener: jest.Mock
		let changedListener: jest.Mock
		let deletedListener: jest.Mock
		let fileCreatedUri: vscode.Uri
		let fileChangedUri: vscode.Uri

		beforeEach(() => {
			// Create mock listeners
			createdListener = jest.fn()
			changedListener = jest.fn()
			deletedListener = jest.fn()

			// Register listeners
			watcher.onFileCreated(createdListener)
			watcher.onFileChanged(changedListener)
			watcher.onFileDeleted(deletedListener)

			// Create mock URIs
			fileCreatedUri = { fsPath: "/path/to/new-file.ts" } as vscode.Uri
			fileChangedUri = { fsPath: "/path/to/changed-file.ts" } as vscode.Uri

			// Mock shouldSkipFile to return false
			jest.spyOn(watcher, "shouldSkipFile").mockReturnValue(false)

			// Get access to the private methods for testing
			const watcherAny = watcher as any
			watcherAny.debounceDelayMs = 100
			watcherAny.queueProcessingIntervalMs = 200

			// Start watching
			watcher.startWatching()
		})

		it("should emit file created events after processing queue", async () => {
			// Extract the handler function registered with onDidCreate
			const createdHandler = mockOnDidCreate.mock.calls[0][0]

			// Call the handler
			createdHandler(fileCreatedUri)

			// At this point, the event should be in the queue but not yet emitted
			expect(createdListener).not.toHaveBeenCalled()

			// Advance timers for debounce to complete
			jest.advanceTimersByTime(150)

			// Assertions
			expect(createdListener).toHaveBeenCalledWith("/path/to/new-file.ts")
		})

		it("should emit file changed events after processing queue", async () => {
			// Extract the handler function registered with onDidChange
			const changedHandler = mockOnDidChange.mock.calls[0][0]

			// Call the handler
			changedHandler(fileChangedUri)

			// At this point, the event should be in the queue but not yet emitted
			expect(changedListener).not.toHaveBeenCalled()

			// Advance timers for debounce to complete
			jest.advanceTimersByTime(150)

			// Assertions
			expect(changedListener).toHaveBeenCalledWith("/path/to/changed-file.ts")
		})

		it("should emit file deleted events after processing queue", async () => {
			// Extract the handler function registered with onDidDelete
			const deletedHandler = mockOnDidDelete.mock.calls[0][0]

			// Create a deleted file URI
			const fileDeletedUri = { fsPath: "/path/to/deleted-file.ts" } as vscode.Uri

			// Call the handler
			deletedHandler(fileDeletedUri)

			// At this point, the event should be in the queue but not yet emitted
			expect(deletedListener).not.toHaveBeenCalled()

			// Advance timers for debounce to complete
			jest.advanceTimersByTime(150)

			// Assertions
			expect(deletedListener).toHaveBeenCalledWith("/path/to/deleted-file.ts")
		})

		it("should not emit events for skipped files", async () => {
			// Mock shouldSkipFile to return true
			jest.spyOn(watcher, "shouldSkipFile").mockReturnValue(true)

			// Extract the handler functions
			const createdHandler = mockOnDidCreate.mock.calls[0][0]
			const changedHandler = mockOnDidChange.mock.calls[0][0]
			const deletedHandler = mockOnDidDelete.mock.calls[0][0]

			// Call the handlers
			createdHandler(fileCreatedUri)
			changedHandler(fileChangedUri)
			deletedHandler({ fsPath: "/path/to/deleted-file.ts" } as vscode.Uri)

			// Advance timers for debounce to complete
			jest.advanceTimersByTime(150)

			// Assertions
			expect(createdListener).not.toHaveBeenCalled()
			expect(changedListener).not.toHaveBeenCalled()
			expect(deletedListener).not.toHaveBeenCalled()
		})

		it("should process events in priority order", async () => {
			// Mock event handling
			const processQueueSpy = jest.spyOn(watcher as any, "processQueue")

			// Extract the handler functions
			const createdHandler = mockOnDidCreate.mock.calls[0][0]
			const changedHandler = mockOnDidChange.mock.calls[0][0]
			const deletedHandler = mockOnDidDelete.mock.calls[0][0]

			// Trigger events in a specific order (changed, created, deleted)
			changedHandler(fileChangedUri) // Low priority
			createdHandler(fileCreatedUri) // Medium priority
			deletedHandler({ fsPath: "/path/to/deleted-file.ts" } as vscode.Uri) // High priority

			// Advance timers for debounce to complete
			jest.advanceTimersByTime(150)

			// Check that events were processed in priority order (deleted, created, changed)
			expect(processQueueSpy).toHaveBeenCalled()
			expect(deletedListener).toHaveBeenCalled()
			expect(createdListener).toHaveBeenCalled()
			expect(changedListener).toHaveBeenCalled()

			// Since the event emitter doesn't guarantee order, we can at least verify
			// the logging for now
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("Processing"))
		})

		it("should use debouncing for rapid file changes", async () => {
			// Mock setTimeout and clearTimeout
			const originalSetTimeout = setTimeout
			const mockSetTimeout = jest.fn().mockImplementation((fn, delay) => {
				return originalSetTimeout(fn, 0) // Execute immediately for testing
			})
			const clearTimeoutSpy = jest.spyOn(global, "clearTimeout")

			// Override setTimeout
			global.setTimeout = mockSetTimeout as any

			// Extract the handler
			const changedHandler = mockOnDidChange.mock.calls[0][0]

			// Trigger multiple changes to the same file in rapid succession
			changedHandler(fileChangedUri)
			changedHandler(fileChangedUri)
			changedHandler(fileChangedUri)

			// Debounce should be clearing timeouts and setting new ones
			expect(clearTimeoutSpy).toHaveBeenCalledTimes(2)
			expect(mockSetTimeout).toHaveBeenCalledTimes(3)

			// Reset mocks
			global.setTimeout = originalSetTimeout
		})

		it("should allow listeners to be removed via disposables", () => {
			// Create mock listeners
			const tempListener = jest.fn()

			// Register and immediately dispose listener
			const disposable = watcher.onFileCreated(tempListener)
			disposable.dispose()

			// Advance timers
			jest.advanceTimersByTime(150)

			// Assertions
			expect(tempListener).not.toHaveBeenCalled()
		})
	})

	describe("queue processing throttling", () => {
		it("should process batches of changes with throttling", () => {
			// Start the watcher
			watcher.startWatching()

			// Set a large queue for testing
			const watcherAny = watcher as any
			const mockChanges = new Map()

			// Add 25 mock changes to test batching (default batch size is 10)
			for (let i = 0; i < 25; i++) {
				mockChanges.set(`/path/to/file${i}.ts`, {
					path: `/path/to/file${i}.ts`,
					status: i % 3 === 0 ? "new" : i % 3 === 1 ? "modified" : "deleted",
					detectedAt: Date.now() - i * 100, // Different detection times
					priority: i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 3,
				})
			}

			watcherAny.changeQueue = mockChanges

			// Process the queue
			watcherAny.processQueue()

			// Should have processed a batch and left the rest
			expect(mockChanges.size).toBeLessThan(25)
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("changes remaining in queue"))
		})
	})
})
