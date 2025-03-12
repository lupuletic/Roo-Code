import * as vscode from "vscode"
import { registerCodeIndexer } from "../index"
import { initializeCodeIndexer } from "../index"
import { CodeIndexerService } from "../code-indexer-service"

// Mock VSCode
jest.mock("vscode", () => {
	return {
		workspace: {
			getConfiguration: jest.fn().mockReturnValue({
				get: jest.fn().mockImplementation((key, defaultValue) => {
					return defaultValue
				}),
			}),
		},
		commands: {
			registerCommand: jest.fn().mockReturnValue({ dispose: jest.fn() }),
		},
		window: {
			showInformationMessage: jest.fn(),
		},
	}
})

// Mock the CodeIndexerService
jest.mock("../code-indexer-service", () => {
	return {
		CodeIndexerService: {
			getInstance: jest.fn().mockResolvedValue({
				registerCommands: jest.fn(),
				initialize: jest.fn().mockResolvedValue(undefined),
			}),
		},
	}
})

// Mock our indexer function
jest.mock("../index", () => {
	const actual = jest.requireActual("../index")
	return {
		...actual,
		initializeCodeIndexer: jest.fn().mockResolvedValue(undefined),
	}
})

describe("Code Indexer Command Registration", () => {
	let mockContext: vscode.ExtensionContext
	// Create mock service methods
	const mockRegisterCommands = jest.fn()
	const mockInitialize = jest.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		jest.clearAllMocks()
		mockRegisterCommands.mockClear()

		// Create mock context
		mockContext = {
			subscriptions: [],
		} as unknown as vscode.ExtensionContext

		// Set up the mock service instance
		// Configure the getInstance mock to return our mock service
		;(CodeIndexerService.getInstance as jest.Mock).mockResolvedValue({
			registerCommands: mockRegisterCommands,
			initialize: mockInitialize,
		})
	})

	it("should initialize the service and register commands", async () => {
		// Call the registration function
		registerCodeIndexer(mockContext)

		// Check that initializeCodeIndexer was called
		expect(initializeCodeIndexer).toHaveBeenCalledWith(mockContext)

		// Wait for the promise chain to complete and test its side effects
		await new Promise(process.nextTick)

		// Verify that registerCommands was called with the context
		expect(mockRegisterCommands).toHaveBeenCalledWith(mockContext)
	})
})
