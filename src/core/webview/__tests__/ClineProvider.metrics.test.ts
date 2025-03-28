import * as vscode from "vscode"
import { ClineProvider } from "../ClineProvider"
import { createEmptyMetrics } from "../../../utils/metrics"
import { UsageMetrics } from "../../../shared/ExtensionMessage"
import { Cline } from "../../Cline"

// Mock the Cline class
jest.mock("../../Cline")

// Mock the vscode module
jest.mock("vscode", () => ({
	window: {
		createOutputChannel: jest.fn().mockReturnValue({
			appendLine: jest.fn(),
		}),
	},
	ExtensionContext: jest.fn(),
	ConfigurationTarget: {
		Global: 1,
	},
	workspace: {
		getConfiguration: jest.fn().mockReturnValue({
			update: jest.fn(),
		}),
	},
	Uri: {
		file: jest.fn(),
		parse: jest.fn(),
	},
	commands: {
		executeCommand: jest.fn(),
	},
	env: {
		clipboard: {
			writeText: jest.fn(),
		},
	},
}))

describe("ClineProvider metrics", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Create mock context with globalState
		mockContext = {
			globalState: {
				get: jest.fn(),
				update: jest.fn().mockResolvedValue(undefined),
				keys: jest.fn().mockReturnValue([]),
			},
			secrets: {
				get: jest.fn(),
				store: jest.fn(),
				delete: jest.fn(),
			},
			extensionUri: {} as vscode.Uri,
			extensionPath: "",
			storageUri: {} as vscode.Uri,
			globalStorageUri: {} as vscode.Uri,
			logUri: {} as vscode.Uri,
			subscriptions: [],
			workspaceState: {} as vscode.Memento,
			extensionMode: vscode.ExtensionMode.Production,
			asAbsolutePath: jest.fn(),
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: jest.fn(),
		} as unknown as vscode.OutputChannel

		provider = new ClineProvider(mockContext, mockOutputChannel)
	})

	describe("updateMetrics", () => {
		it("should update usageMetrics in global state", async () => {
			// Arrange
			const metrics: UsageMetrics = createEmptyMetrics()
			metrics.linesOfCodeGenerated = 100
			metrics.filesCreated = 5

			// Act
			await provider.updateMetrics(metrics)

			// Assert
			expect(mockContext.globalState.update).toHaveBeenCalledWith("usageMetrics", metrics)
		})

		it("should handle errors gracefully", async () => {
			// Arrange
			const metrics: UsageMetrics = createEmptyMetrics()
			const error = new Error("Test error")
			mockContext.globalState.update = jest.fn().mockRejectedValue(error)

			// Act
			const result = await provider.updateMetrics(metrics)

			// Assert
			expect(result).toBeUndefined()
			expect(mockOutputChannel.appendLine).toHaveBeenCalled()
		})

		it("should update webview if visible", async () => {
			// Arrange
			const metrics: UsageMetrics = createEmptyMetrics()
			;(provider as any).view = {
				visible: true,
				webview: {
					postMessage: jest.fn(),
				},
			} as unknown as vscode.WebviewView

			// Spy on postStateToWebview
			const postStateToWebviewSpy = jest.spyOn(provider, "postStateToWebview").mockResolvedValue()

			// Act
			await provider.updateMetrics(metrics)

			// Assert
			expect(postStateToWebviewSpy).toHaveBeenCalled()
		})

		it("should not update webview if not visible", async () => {
			// Arrange
			const metrics: UsageMetrics = createEmptyMetrics()
			;(provider as any).view = {
				visible: false,
				webview: {
					postMessage: jest.fn(),
				},
			} as unknown as vscode.WebviewView

			// Spy on postStateToWebview
			const postStateToWebviewSpy = jest.spyOn(provider, "postStateToWebview").mockResolvedValue()

			// Act
			await provider.updateMetrics(metrics)

			// Assert
			expect(postStateToWebviewSpy).not.toHaveBeenCalled()
		})
	})

	describe("initClineWithTask", () => {
		it("should pass usageMetricsEnabled to Cline constructor", async () => {
			// Setup
			const mockCline = {
				abortTask: jest.fn(),
			}
			;(Cline as unknown as jest.Mock).mockImplementation(() => mockCline)

			// Mock getState to return default values
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {},
				usageMetricsEnabled: true,
				// Add other required properties
				mode: "code",
				mcpEnabled: true,
				enableCheckpoints: true,
				preferredLanguage: "English",
				writeDelayMs: 1000,
				rateLimitSeconds: 0,
				requestDelaySeconds: 5,
				maxOpenTabsContext: 20,
				experiments: {},
				customModes: [],
			} as any)

			// Test with metrics enabled
			await provider.initClineWithTask("test task")
			expect(Cline as unknown as jest.Mock).toHaveBeenCalledWith(
				expect.objectContaining({
					enableMetrics: true, // Default value
				}),
			)

			// Test with metrics disabled
			jest.spyOn(provider, "getState").mockResolvedValue({
				apiConfiguration: {},
				usageMetricsEnabled: false,
				// Add other required properties
				mode: "code",
				mcpEnabled: true,
				enableCheckpoints: true,
				preferredLanguage: "English",
				writeDelayMs: 1000,
				rateLimitSeconds: 0,
				requestDelaySeconds: 5,
				maxOpenTabsContext: 20,
				experiments: {},
				customModes: [],
			} as any)

			await provider.initClineWithTask("test task")
			expect(Cline as unknown as jest.Mock).toHaveBeenCalledWith(
				expect.objectContaining({
					enableMetrics: false,
				}),
			)
		})
	})
})
