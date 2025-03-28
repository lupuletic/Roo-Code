// @ts-nocheck - Disabling TypeScript checking for tests
import { Cline } from "../Cline"
import * as metrics from "../../utils/metrics"
import { logger } from "../../utils/logging"
import { UsageMetrics } from "../../shared/ExtensionMessage"

// Mock the metrics module
jest.mock("../../utils/metrics", () => ({
	createEmptyMetrics: jest.fn().mockReturnValue({
		linesOfCodeGenerated: 0,
		filesCreated: 0,
		filesModified: 0,
		languageUsage: {},
		tasksCompleted: 0,
		commandsExecuted: 0,
		apiCallsMade: 0,
		browserSessionsLaunched: 0,
		activeUsageTimeMs: 0,
		totalApiCost: 0,
		costByProvider: {},
		costByTask: {},
		toolUsage: {},
		lastReset: Date.now(),
	}),
	trackFileCreated: jest.fn().mockImplementation((metrics: UsageMetrics, path: string, content: string) => ({
		...metrics,
		linesOfCodeGenerated: metrics.linesOfCodeGenerated + 10,
		filesCreated: metrics.filesCreated + 1,
	})),
	trackFileModified: jest.fn().mockImplementation((metrics: UsageMetrics, path: string, diff: string) => ({
		...metrics,
		linesOfCodeGenerated: metrics.linesOfCodeGenerated + 5,
		filesModified: metrics.filesModified + 1,
	})),
	trackCommandExecuted: jest.fn().mockImplementation((metrics: UsageMetrics, command: string) => ({
		...metrics,
		commandsExecuted: metrics.commandsExecuted + 1,
	})),
	trackBrowserSession: jest.fn().mockImplementation((metrics: UsageMetrics) => ({
		...metrics,
		browserSessionsLaunched: metrics.browserSessionsLaunched + 1,
	})),
	trackApiCall: jest
		.fn()
		.mockImplementation((metrics: UsageMetrics, provider: string, cost: number, taskId?: string) => ({
			...metrics,
			apiCallsMade: metrics.apiCallsMade + 1,
			totalApiCost: metrics.totalApiCost + cost,
		})),
	trackTaskCompleted: jest.fn().mockImplementation((metrics: UsageMetrics, taskId: string) => ({
		...metrics,
		tasksCompleted: metrics.tasksCompleted + 1,
	})),
	trackToolUsage: jest.fn().mockImplementation((metrics: UsageMetrics, toolName: string) => ({
		...metrics,
		toolUsage: {
			...metrics.toolUsage,
			[toolName]: (metrics.toolUsage[toolName] || 0) + 1,
		},
	})),
}))

// Mock the logger
jest.mock("../../utils/logging", () => ({
	logger: {
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	},
}))

describe("Cline metrics tracking", () => {
	let cline: Cline
	let mockProvider: any

	beforeEach(() => {
		// Create mock provider
		mockProvider = {
			getState: jest.fn().mockResolvedValue({
				usageMetricsEnabled: true,
				usageMetrics: metrics.createEmptyMetrics(),
			}),
			updateMetrics: jest.fn().mockImplementation((metrics) => Promise.resolve(metrics)),
		}

		// Create Cline instance with mocked provider
		cline = new Cline({
			provider: mockProvider,
			apiConfiguration: {
				apiProvider: "anthropic",
			},
			startTask: false,
		})
	})

	describe("trackMetrics", () => {
		it("should not track metrics when disabled", async () => {
			// Arrange
			;(cline as any).metricsEnabled = false

			// Act
			await (cline as any).trackMetrics((metrics) => metrics)

			// Assert
			expect(mockProvider.updateMetrics).not.toHaveBeenCalled()
		})

		it("should not track metrics when provider is unavailable", async () => {
			// Arrange
			;(cline as any).providerRef = { deref: () => undefined }

			// Act
			await (cline as any).trackMetrics((metrics) => metrics)

			// Assert
			expect(mockProvider.updateMetrics).not.toHaveBeenCalled()
		})

		it("should not track metrics when disabled in settings", async () => {
			// Arrange
			mockProvider.getState.mockResolvedValue({
				usageMetricsEnabled: false,
				usageMetrics: metrics.createEmptyMetrics(),
			})

			// Act
			await (cline as any).trackMetrics((metrics) => metrics)

			// Assert
			expect(mockProvider.updateMetrics).not.toHaveBeenCalled()
		})

		it("should track metrics when enabled", async () => {
			// Arrange
			const action = jest.fn().mockImplementation((metrics: UsageMetrics) => ({
				...metrics,
				linesOfCodeGenerated: 100,
			}))

			// Act
			await (cline as any).trackMetrics((m) => action(m))

			// Assert
			expect(action).toHaveBeenCalled()
			expect(mockProvider.updateMetrics).toHaveBeenCalled()
			expect(logger.debug).toHaveBeenCalledWith("Tracking metrics")
		})

		it("should call the correct metrics function for file creation", async () => {
			// Arrange
			const path = "test/file.js"
			const content = 'console.log("Hello World");'

			// Act
			await (cline as any).trackMetrics((m) => metrics.trackFileCreated(m, path, content))

			// Assert
			expect(metrics.trackFileCreated).toHaveBeenCalledWith(expect.anything(), path, content)
			expect(mockProvider.updateMetrics).toHaveBeenCalled()
		})

		it("should call the correct metrics function for file modification", async () => {
			// Arrange
			const path = "test/file.js"
			const diff = '@@ -1,3 +1,4 @@\n console.log("Hello");\n+console.log("World");\n'

			// Act
			await (cline as any).trackMetrics((m) => metrics.trackFileModified(m, path, diff))

			// Assert
			expect(metrics.trackFileModified).toHaveBeenCalledWith(expect.anything(), path, diff)
			expect(mockProvider.updateMetrics).toHaveBeenCalled()
		})

		it("should call the correct metrics function for command execution", async () => {
			// Arrange
			const command = "npm install"

			// Act
			await (cline as any).trackMetrics((m: UsageMetrics) => metrics.trackCommandExecuted(m, command))

			// Assert
			expect(metrics.trackCommandExecuted).toHaveBeenCalledWith(expect.anything(), command)
			expect(mockProvider.updateMetrics).toHaveBeenCalled()
		})

		it("should call the correct metrics function for browser sessions", async () => {
			// Act
			await (cline as any).trackMetrics((m: UsageMetrics) => metrics.trackBrowserSession(m))

			// Assert
			expect(metrics.trackBrowserSession).toHaveBeenCalled()
			expect(mockProvider.updateMetrics).toHaveBeenCalled()
		})

		it("should call the correct metrics function for API calls", async () => {
			// Arrange
			const provider = "claude-3-sonnet"
			const cost = 0.0123
			const taskId = "task-123"

			// Act
			await (cline as any).trackMetrics((m: UsageMetrics) => metrics.trackApiCall(m, provider, cost, taskId))

			// Assert
			expect(metrics.trackApiCall).toHaveBeenCalledWith(expect.anything(), provider, cost, taskId)
			expect(mockProvider.updateMetrics).toHaveBeenCalled()
		})

		it("should call the correct metrics function for task completion", async () => {
			// Arrange
			const taskId = "task-123"

			// Act
			await (cline as any).trackMetrics((m: UsageMetrics) => metrics.trackTaskCompleted(m, taskId))

			// Assert
			expect(metrics.trackTaskCompleted).toHaveBeenCalledWith(expect.anything(), taskId)
			expect(mockProvider.updateMetrics).toHaveBeenCalled()
		})

		it("should call the correct metrics function for tool usage", async () => {
			// Arrange
			const toolName = "switch_mode"

			// Act
			await (cline as any).trackMetrics((m: UsageMetrics) => metrics.trackToolUsage(m, toolName))

			// Assert
			expect(metrics.trackToolUsage).toHaveBeenCalledWith(expect.anything(), toolName)
			expect(mockProvider.updateMetrics).toHaveBeenCalled()
		})
	})
})
