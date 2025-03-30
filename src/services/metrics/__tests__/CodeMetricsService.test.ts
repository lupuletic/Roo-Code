import * as vscode from "vscode"
import { CodeMetricsService, CodeChangeSource } from "../CodeMetricsService"

// Mock setTimeout and clearTimeout
jest.useFakeTimers()

// Mock vscode APIs
let onChangeTextDocumentCallback: Function | null = null
jest.mock("vscode", () => ({
	workspace: {
		onDidCreateFiles: jest.fn(() => ({ dispose: jest.fn() })),
		onDidDeleteFiles: jest.fn(() => ({ dispose: jest.fn() })),
		onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidChangeTextDocument: jest.fn((callback) => {
			onChangeTextDocumentCallback = callback
			return { dispose: jest.fn() }
		}),
		textDocuments: [],
	},
	Uri: {
		file: jest.fn((path) => ({ toString: () => `file://${path}` })),
	},
	ExtensionContext: jest.fn(),
	Disposable: {
		from: jest.fn((...disposables) => ({ dispose: jest.fn() }))
	}
}))

// Mock the telemetry service
jest.mock("../../telemetry/TelemetryService", () => ({
	telemetryService: {
		captureEvent: jest.fn(),
	},
}))

describe("CodeMetricsService", () => {
	let context: vscode.ExtensionContext
	let mockGlobalState: Map<string, any>
	let service: CodeMetricsService

	// Helper function to create a fresh service instance for each test
	const createFreshService = async () => {
		// Reset CodeMetricsService singleton
		// @ts-ignore - accessing private static field for testing
		CodeMetricsService.instance = undefined

		// Mock the vscode extension context and globalState
		mockGlobalState = new Map()
		context = {
			globalState: {
				get: jest.fn((key) => mockGlobalState.get(key)),
				update: jest.fn((key, value) => {
					mockGlobalState.set(key, value)
					return Promise.resolve()
				}),
			},
		} as unknown as vscode.ExtensionContext

		// Initialize service
		service = CodeMetricsService.getInstance(context)
		
		// Reset metrics to ensure a clean state
		await service.resetMetrics()
		
		// Clear any existing metrics
		// @ts-ignore - accessing private property for testing
		service.metrics = {
			aiGenerated: {
				linesAdded: 0,
				linesDeleted: 0,
				filesModified: 0,
				filesCreated: 0,
				lastUpdated: 0,
			},
			manual: {
				linesAdded: 0,
				linesDeleted: 0,
				filesModified: 0,
				filesCreated: 0,
				lastUpdated: 0,
			},
			history: []
		}
		
		// Clear modified files set
		// @ts-ignore - accessing private property for testing
		service.modifiedFilesSet.clear()
		
		// Clear document snapshots
		// @ts-ignore - accessing private property for testing
		service.documentSnapshotManager.clear()
		
		return service
	}

	beforeEach(async () => {
		// Create a fresh service for each test
		service = await createFreshService()
	})

	describe("getInstance", () => {
		it("should create a new instance when first called with context", () => {
			expect(service).toBeInstanceOf(CodeMetricsService)
		})

		it("should return the same instance on subsequent calls", () => {
			const service1 = service
			const service2 = CodeMetricsService.getInstance()
			expect(service1).toBe(service2)
		})

		it("should throw an error if called without context before initialization", async () => {
			// Reset the singleton
			// @ts-ignore - accessing private static field for testing
			CodeMetricsService.instance = undefined
			expect(() => CodeMetricsService.getInstance()).toThrow()
		})
	})

	describe("trackAIDiffChanges", () => {
		it("should track AI-generated code changes correctly", async () => {
			service.trackAIDiffChanges("line 1\nline 2", "line 1\nline 2\nline 3\nline 4", "test.js", false)

			const metrics = service.getMetrics()
			expect(metrics.aiGenerated.linesAdded).toBe(2) // Now correctly calculates 2 added lines
			expect(metrics.aiGenerated.filesModified).toBe(1)
			expect(metrics.aiGenerated.filesCreated).toBe(0)
		})

		it("should track new file creation correctly", async () => {
			service.trackAIDiffChanges("", "line 1\nline 2\nline 3\n", "newfile.ts", true)

			const metrics = service.getMetrics()
			expect(metrics.aiGenerated.linesAdded).toBe(4) // Now correctly calculates 4 added lines (3 lines + 1 empty line)
			expect(metrics.aiGenerated.filesModified).toBe(0) // New file shouldn't count as modified
			expect(metrics.aiGenerated.filesCreated).toBe(1)
		})

		it("should track line-by-line changes correctly", async () => {
			// Test replacing lines (should count as both additions and deletions)
			service.trackAIDiffChanges(
				"line 1\nline 2\nline 3\nline 4",
				"line 1\nmodified line\nline 3\nnew line",
				"modified.js",
				false,
			)

			const metrics = service.getMetrics()
			expect(metrics.aiGenerated.linesAdded).toBe(2) // "modified line" and "new line"
			expect(metrics.aiGenerated.linesDeleted).toBe(2) // "line 2" and "line 4"
			expect(metrics.aiGenerated.filesModified).toBe(1)
		})
	})

	describe("File tracking deduplication", () => {
		it("should not double count the same file being modified", async () => {
			// First modification
			service.trackAIDiffChanges("original", "modified once", "same-file.js", false)

			// Second modification to the same file
			service.trackAIDiffChanges("modified once", "modified twice", "same-file.js", false)

			const metrics = service.getMetrics()
			expect(metrics.aiGenerated.filesModified).toBe(1) // Should only count once
		})
	})

	describe("AI vs Manual change tracking", () => {
		it("should not track manual changes when applying AI diffs", async () => {
			// Directly test the isApplyingAIDiff flag behavior
			// @ts-ignore - accessing private property for testing
			expect(service.isApplyingAIDiff).toBe(false)

			// Track AI changes
			service.trackAIDiffChanges("line 1\nline 2", "line 1\nline 2\nline 3", "test.js", false)

			// @ts-ignore - accessing private property for testing
			expect(service.isApplyingAIDiff).toBe(true)

			// Fast-forward timers to trigger the timeout that resets the flag
			jest.advanceTimersByTime(100)

			// @ts-ignore - accessing private property for testing
			expect(service.isApplyingAIDiff).toBe(false)
		})
	})

	describe("getMetrics", () => {
		it("should return current metrics state", async () => {
			// Track some metrics
			service.trackAIDiffChanges("", "line 1\nline 2\n", "file.js", true)

			const metrics = service.getMetrics()

			// Verify structure and content
			expect(metrics).toHaveProperty("aiGenerated")
			expect(metrics).toHaveProperty("manual")
			expect(metrics.aiGenerated.linesAdded).toBeGreaterThan(0)
			expect(metrics.aiGenerated.filesCreated).toBeGreaterThan(0)
		})
	})

	describe("resetMetrics", () => {
		it("should reset all metrics to zero completely", async () => {
			// Track some metrics first
			service.trackAIDiffChanges("", "line 1\nline 2\n", "file.js", true)

			// Verify metrics were tracked
			let metrics = service.getMetrics()
			expect(metrics.aiGenerated.linesAdded).toBeGreaterThan(0)

			// Reset metrics
			await service.resetMetrics()

			// Verify metrics were reset
			metrics = service.getMetrics()
			// Now we expect all values to be properly reset to 0
			expect(metrics.aiGenerated.linesAdded).toBe(0)
			expect(metrics.aiGenerated.linesDeleted).toBe(0)
			expect(metrics.aiGenerated.filesModified).toBe(0)
			expect(metrics.aiGenerated.filesCreated).toBe(0)
			expect(metrics.manual.linesAdded).toBe(0)
			expect(metrics.manual.linesDeleted).toBe(0)
			expect(metrics.manual.filesModified).toBe(0)
			expect(metrics.manual.filesCreated).toBe(0)
		})
	})

	describe("dispose", () => {
		it("should clean up resources", () => {
			// Mock disposables
			// @ts-ignore - accessing private property for testing
			service.disposables = [{ dispose: jest.fn() }, { dispose: jest.fn() }]

			// @ts-ignore - accessing private property for testing
			service.documentChangeListeners = new Map([
				["file1.js", { dispose: jest.fn() }],
				["file2.js", { dispose: jest.fn() }],
			])

			// @ts-ignore - accessing private property for testing
			service.debounceTimers = new Map([
				["file1.js", setTimeout(() => {}, 1000)],
				["file2.js", setTimeout(() => {}, 1000)],
			])

			service.dispose()

			// @ts-ignore - accessing private property for testing
			expect(service.disposables.length).toBe(0)
			// @ts-ignore - accessing private property for testing
			expect(service.documentChangeListeners.size).toBe(0)
			// @ts-ignore - accessing private property for testing
			expect(service.debounceTimers.size).toBe(0)
		})
	})

	describe("Manual change tracking with debounce", () => {
		it("should debounce multiple change events", async () => {
			// Create a mock document change event
			const mockEvent = {
				document: {
					uri: { toString: () => "file:///test-file.js" },
					getText: jest.fn().mockReturnValue("new text"),
				},
				contentChanges: [
					{
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
						rangeLength: 8,
						text: "new text",
					},
				],
			}

			// Set up the document snapshot
			// @ts-ignore - accessing private property for testing
			service.documentSnapshots.set("file:///test-file.js", "old text")

			// Directly call the processDocumentChanges method to simulate a change
			// @ts-ignore - accessing private method for testing
			service.processDocumentChanges(mockEvent)

			// Verify metrics were updated
			let metrics = service.getMetrics()
			expect(metrics.manual.filesModified).toBe(1)

			// Send another change event for the same file
			// @ts-ignore - accessing private method for testing
			service.processDocumentChanges(mockEvent)

			// File count should still be 1
			metrics = service.getMetrics()
			expect(metrics.manual.filesModified).toBe(1)
		})
	})

	describe("Historical metrics tracking", () => {
		it("should record historical snapshots", async () => {
			// Mock Date.now to control timestamps
			const originalDateNow = Date.now
			const mockTime = 1600000000000 // Fixed timestamp
			Date.now = jest.fn(() => mockTime)
			
			// Track some changes
			service.trackAIDiffChanges("", "line 1\nline 2", "file1.js", true)
			
			// Advance time by 2 hours to ensure a new snapshot is created
			Date.now = jest.fn(() => mockTime + 2 * 60 * 60 * 1000)
			
			// Track more changes
			service.trackAIDiffChanges("line 1\nline 2", "line 1\nline 2\nline 3", "file2.js", true)
			
			// Get metrics with history
			const metricsWithHistory = service.getMetricsWithHistory()
			
			// Verify history is recorded
			expect(metricsWithHistory.history).toBeDefined()
			expect(metricsWithHistory.history.length).toBeGreaterThanOrEqual(1)
			
			// Restore original Date.now
			Date.now = originalDateNow
		})
	})
})
