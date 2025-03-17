import * as vscode from "vscode"
import { CodeMetricsService, CodeChangeSource } from "../CodeMetricsService"

// Mock vscode APIs
jest.mock("vscode", () => ({
	workspace: {
		onDidCreateFiles: jest.fn(() => ({ dispose: jest.fn() })),
		onDidOpenTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() })),
		textDocuments: [],
	},
	ExtensionContext: jest.fn(),
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

	beforeEach(() => {
		// Reset CodeMetricsService singleton between tests
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
	})

	describe("getInstance", () => {
		it("should create a new instance when first called with context", () => {
			const service = CodeMetricsService.getInstance(context)
			expect(service).toBeInstanceOf(CodeMetricsService)
		})

		it("should return the same instance on subsequent calls", () => {
			const service1 = CodeMetricsService.getInstance(context)
			const service2 = CodeMetricsService.getInstance()
			expect(service1).toBe(service2)
		})

		it("should throw an error if called without context before initialization", () => {
			// @ts-ignore - accessing private static field for testing
			CodeMetricsService.instance = undefined
			expect(() => CodeMetricsService.getInstance()).toThrow()
		})
	})

	describe("trackAIDiffChanges", () => {
		it("should track AI-generated code changes correctly", () => {
			const service = CodeMetricsService.getInstance(context)

			service.trackAIDiffChanges("line 1\nline 2", "line 1\nline 2\nline 3\nline 4", "test.js", false)

			const metrics = service.getMetrics()
			expect(metrics.aiGenerated.linesAdded).toBe(2)
			expect(metrics.aiGenerated.filesModified).toBe(1)
			expect(metrics.aiGenerated.filesCreated).toBe(0)
		})

		it("should track new file creation correctly", () => {
			const service = CodeMetricsService.getInstance(context)

			service.trackAIDiffChanges("", "line 1\nline 2\nline 3", "newfile.ts", true)

			const metrics = service.getMetrics()
			expect(metrics.aiGenerated.linesAdded).toBe(3)
			expect(metrics.aiGenerated.filesModified).toBe(0)
			expect(metrics.aiGenerated.filesCreated).toBe(1)
		})
	})

	describe("getMetrics", () => {
		it("should return current metrics state", () => {
			const service = CodeMetricsService.getInstance(context)

			// Track some metrics
			service.trackAIDiffChanges("", "line 1\nline 2", "file.js", true)

			const metrics = service.getMetrics()

			// Verify structure and content
			expect(metrics).toHaveProperty("aiGenerated")
			expect(metrics).toHaveProperty("manual")
			expect(metrics.aiGenerated.linesAdded).toBe(2)
			expect(metrics.aiGenerated.filesCreated).toBe(1)
		})
	})

	describe("resetMetrics", () => {
		it("should reset all metrics to zero", async () => {
			const service = CodeMetricsService.getInstance(context)

			// Track some metrics first
			service.trackAIDiffChanges("", "line 1\nline 2", "file.js", true)

			// Verify metrics were tracked
			let metrics = service.getMetrics()
			expect(metrics.aiGenerated.linesAdded).toBeGreaterThan(0)

			// Reset metrics
			await service.resetMetrics()

			// Verify metrics were reset
			metrics = service.getMetrics()
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
			const service = CodeMetricsService.getInstance(context)

			// Mock disposables
			// @ts-ignore - accessing private property for testing
			service.disposables = [{ dispose: jest.fn() }, { dispose: jest.fn() }]

			// @ts-ignore - accessing private property for testing
			service.documentChangeListeners = new Map([
				["file1.js", { dispose: jest.fn() }],
				["file2.js", { dispose: jest.fn() }],
			])

			service.dispose()

			// @ts-ignore - accessing private property for testing
			expect(service.disposables.length).toBe(0)
			// @ts-ignore - accessing private property for testing
			expect(service.documentChangeListeners.size).toBe(0)
		})
	})
})
