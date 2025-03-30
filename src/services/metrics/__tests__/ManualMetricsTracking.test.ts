import * as vscode from "vscode"
import { CodeMetricsService, CodeChangeSource } from "../CodeMetricsService"

// Mock setTimeout and clearTimeout
jest.useFakeTimers()

// Mock vscode APIs
let onChangeTextDocumentCallback: Function | null = null
let onOpenTextDocumentCallback: Function | null = null
jest.mock("vscode", () => ({
	workspace: {
		onDidCreateFiles: jest.fn(() => ({ dispose: jest.fn() })),
		onDidDeleteFiles: jest.fn(() => ({ dispose: jest.fn() })),
		onDidOpenTextDocument: jest.fn((callback) => {
			onOpenTextDocumentCallback = callback
			return { dispose: jest.fn() }
		}),
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

describe("Manual Metrics Tracking", () => {
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
		const a = 'test';
		const b = 'ttest';

		
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

	// Test that our implementation correctly uses document snapshots for diffing
	it("should use document snapshots for accurate manual change tracking", async () => {
		service = await createFreshService()
		
		// Set the document snapshot through the manager
		// @ts-ignore - accessing private property for testing
		service.documentSnapshotManager.updateSnapshot("file:///test.ts", "line 1\nline 2")
		
		// Create a mock document change event
		const mockEvent = {
			document: {
				uri: { toString: () => "file:///test.ts" },
				getText: jest.fn().mockReturnValue("line 1\nline 2\nline 3"),
			},
			contentChanges: [
				{
					range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
					rangeLength: 0,
					text: "line 3\n",
				},
			],
		}
		
		// Directly call the private method
		// @ts-ignore - accessing private method for testing
		service.processDocumentChanges(mockEvent)
		
		// Verify metrics
		const metrics = service.getMetrics()
		expect(metrics.manual.linesAdded).toBe(1) // Should detect 1 added line
		expect(metrics.manual.linesDeleted).toBe(0)
		expect(metrics.manual.filesModified).toBe(1)
		
		// Verify the snapshot was updated through the manager
		// @ts-ignore - accessing private property for testing
		expect(service.documentSnapshotManager.getSnapshot("file:///test.ts")).toBe("line 1\nline 2\nline 3")
	})
	
	// Test line deletions
	it("should accurately track line deletions", async () => {
		service = await createFreshService()
		
		// Set the document snapshot through the manager
		// @ts-ignore - accessing private property for testing
		service.documentSnapshotManager.updateSnapshot("file:///test.ts", "line 1\nline 2\nline 3\nline 4")
		
		// Create a mock document change event
		const mockEvent = {
			document: {
				uri: { toString: () => "file:///test.ts" },
				getText: jest.fn().mockReturnValue("line 1\nline 4"),
			},
			contentChanges: [
				{
					range: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } },
					rangeLength: 14, // "line 2\nline 3\n"
					text: "",
				},
			],
		}
		
		// Directly call the private method
		// @ts-ignore - accessing private method for testing
		service.processDocumentChanges(mockEvent)
		
		// Verify metrics
		const metrics = service.getMetrics()
		expect(metrics.manual.linesAdded).toBe(0)
		expect(metrics.manual.linesDeleted).toBe(2) // Should detect 2 deleted lines
		expect(metrics.manual.filesModified).toBe(1)
	})
	
	// Test complex changes with both additions and deletions
	it("should accurately track complex changes", async () => {
		service = await createFreshService()
		
		// Set the document snapshot through the manager
		// @ts-ignore - accessing private property for testing
		service.documentSnapshotManager.updateSnapshot("file:///test.ts", "line 1\nline 2\nline 3\nline 4")
		
		// Create a mock document change event
		const mockEvent = {
			document: {
				uri: { toString: () => "file:///test.ts" },
				getText: jest.fn().mockReturnValue("line 1\nnew line A\nnew line B\nline 4"),
			},
			contentChanges: [
				{
					range: { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } },
					rangeLength: 14, // "line 2\nline 3\n"
					text: "new line A\nnew line B\n",
				},
			],
		}
		
		// Directly call the private method
		// @ts-ignore - accessing private method for testing
		service.processDocumentChanges(mockEvent)
		
		// Verify metrics
		const metrics = service.getMetrics()
		expect(metrics.manual.linesAdded).toBe(2) // 2 new lines added
		expect(metrics.manual.linesDeleted).toBe(2) // 2 old lines deleted
		expect(metrics.manual.filesModified).toBe(1)
	})
	
	// Test that AI changes are not counted as manual changes
	it("should not track manual changes when applying AI diffs", async () => {
		service = await createFreshService()
		
		// First, track an AI change to set up the metrics
		service.trackAIDiffChanges("line 1\nline 2", "line 1\nline 2\nline 3", "test.ts", false)
		
		// Verify AI metrics were updated
		let metrics = service.getMetrics()
		expect(metrics.aiGenerated.linesAdded).toBe(1)
		expect(metrics.aiGenerated.filesModified).toBe(1)
		
		// Now create a mock document change event that would normally be triggered by the AI change
		const mockEvent = {
			document: {
				uri: { toString: () => "file:///test.ts" },
				getText: jest.fn().mockReturnValue("line 1\nline 2\nline 3"),
			},
			contentChanges: [
				{
					range: { start: { line: 2, character: 0 }, end: { line: 2, character: 0 } },
					rangeLength: 0,
					text: "line 3\n",
				},
			],
		}
		
		// Directly call the trackManualTextChanges method with isApplyingAIDiff set to true
		// @ts-ignore - accessing private property for testing
		service.isApplyingAIDiff = true
		// @ts-ignore - accessing private method for testing
		service.trackManualTextChanges(mockEvent)
		
		// Fast-forward timers to trigger debounced processing
		jest.runAllTimers()
		
		// Verify metrics - manual metrics should not have changed
		metrics = service.getMetrics()
		expect(metrics.manual.linesAdded).toBe(0) // No manual lines should be counted
		expect(metrics.manual.filesModified).toBe(0) // No manual files should be counted
		expect(metrics.aiGenerated.linesAdded).toBe(1) // AI changes should be tracked
		expect(metrics.aiGenerated.filesModified).toBe(1)
	})
})