import * as vscode from "vscode"
import { registerCodeIndexer } from "../register"
import { initializeCodeIndexer, disposeCodeIndexer, rebuildCodeIndex } from "../index"

// Mock dependencies
jest.mock("../index", () => ({
	initializeCodeIndexer: jest.fn(),
	disposeCodeIndexer: jest.fn(),
	rebuildCodeIndex: jest.fn(),
}))

jest.mock("../../utils/logging", () => ({
	logger: {
		info: jest.fn(),
		error: jest.fn(),
	},
}))

// Mock vscode module
jest.mock("vscode", () => {
	return {
		workspace: {
			getConfiguration: jest.fn().mockReturnValue({ get: jest.fn().mockReturnValue(true) }),
		},
		commands: {
			registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
		},
	}
})

describe("registerCodeIndexer", () => {
	let mockContext: any
	let mockConfig: any

	beforeEach(() => {
		jest.clearAllMocks()

		// Mock extension context
		mockContext = {
			subscriptions: [],
		}

		// Mock workspace configuration
		mockConfig = {
			get: jest.fn().mockReturnValue(true), // Default to enabled
		}

		// Update the mock to use our test-specific config
		;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig)
		;(vscode.commands.registerCommand as jest.Mock).mockReturnValue({ dispose: jest.fn() })
	})

	it("should initialize and register when enabled", () => {
		// Call the function
		registerCodeIndexer(mockContext)

		// Verify it checked the configuration
		expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("roo-cline.codeIndexer")
		expect(mockConfig.get).toHaveBeenCalledWith("enabled", true)

		// Verify it initialized the code indexer
		expect(initializeCodeIndexer).toHaveBeenCalledWith(mockContext)

		// Verify it registered the command
		expect(vscode.commands.registerCommand).toHaveBeenCalledWith("roo-cline.rebuildCodeIndex", rebuildCodeIndex)

		// Verify it added the command to subscriptions
		expect(mockContext.subscriptions.length).toBe(2)

		// Verify it added the dispose handler
		const disposeHandler = mockContext.subscriptions[1]
		expect(disposeHandler.dispose).toBe(disposeCodeIndexer)
	})

	it("should not initialize when disabled", () => {
		// Set the feature to disabled
		mockConfig.get.mockReturnValue(false)

		// Call the function
		registerCodeIndexer(mockContext)

		// Verify it checked the configuration
		expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("roo-cline.codeIndexer")
		expect(mockConfig.get).toHaveBeenCalledWith("enabled", true)

		// Verify it did not initialize
		expect(initializeCodeIndexer).not.toHaveBeenCalled()

		// Verify it did not register the command
		expect(vscode.commands.registerCommand).not.toHaveBeenCalled()

		// Verify no subscriptions were added
		expect(mockContext.subscriptions.length).toBe(0)
	})

	it("should handle errors during initialization", () => {
		// Mock initializeCodeIndexer to throw an error
		;(initializeCodeIndexer as jest.Mock).mockImplementation(() => {
			throw new Error("Test error")
		})

		// Call the function - should not throw
		registerCodeIndexer(mockContext)

		// Verify it logged the error
		const logger = require("../../utils/logging").logger
		expect(logger.error).toHaveBeenCalledWith("Failed to register code indexer service:", expect.any(Error))
	})
})
