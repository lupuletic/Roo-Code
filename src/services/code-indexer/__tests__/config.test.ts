import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { minimatch } from "minimatch"
import { getDefaultConfig, ensureDatabaseDirectory, shouldExcludeFile, normalizePath } from "../config"

// Mock dependencies
jest.mock("vscode")
jest.mock("fs/promises")
jest.mock("minimatch")

describe("config", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	describe("getDefaultConfig", () => {
		it("should return config with default values and user settings", () => {
			// Mock context
			const mockContext = {
				globalStorageUri: { fsPath: "/test/storage" } as vscode.Uri,
			}

			// Mock workspace configuration
			const mockConfig = {
				get: jest.fn().mockImplementation((key: string, defaultValue: any) => {
					// Return some custom values for certain settings
					if (key === "embeddingModel") return "custom-model"
					if (key === "maxFileSizeBytes") return 2000000
					// Return the default for others
					return defaultValue
				}),
			}
			;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig)

			// Call
			const config = getDefaultConfig(mockContext as vscode.ExtensionContext)

			// Assertions
			expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("cline.codeIndexer")
			expect(config.databasePath).toBe(path.join("/test/storage", "lancedb"))
			expect(config.embeddingModel).toBe("custom-model")
			expect(config.maxFileSizeBytes).toBe(2000000)
			expect(config.excludePatterns).toBeDefined()
			expect(config.autoIndexOnWorkspaceOpen).toBeDefined()
			expect(config.watchForFileChanges).toBeDefined()
			expect(config.maxChunkSize).toBeDefined()
			expect(config.chunkOverlap).toBeDefined()
			expect(config.showNotifications).toBeDefined()
		})

		it("should use custom values for all settings if provided", () => {
			// Mock context
			const mockContext = {
				globalStorageUri: { fsPath: "/test/storage" } as vscode.Uri,
			}

			// Mock workspace configuration with all custom values
			const mockConfig = {
				get: jest.fn().mockImplementation((key: string, defaultValue: any) => {
					const customValues: Record<string, any> = {
						embeddingModel: "custom-model",
						maxFileSizeBytes: 2000000,
						excludePatterns: ["**/custom/**"],
						autoIndexOnWorkspaceOpen: false,
						watchForFileChanges: false,
						maxChunkSize: 500,
						chunkOverlap: 50,
						showNotifications: false,
					}
					return customValues[key] !== undefined ? customValues[key] : defaultValue
				}),
			}
			;(vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(mockConfig)

			// Call
			const config = getDefaultConfig(mockContext as vscode.ExtensionContext)

			// Assertions
			expect(config.maxChunkSize).toBe(500)
			expect(config.chunkOverlap).toBe(50)
			expect(config.showNotifications).toBe(false)
		})
	})

	describe("ensureDatabaseDirectory", () => {
		it("should create the database directory", async () => {
			// Call
			await ensureDatabaseDirectory("/test/database")

			// Assertions
			expect(fs.mkdir).toHaveBeenCalledWith("/test/database", { recursive: true })
		})

		it("should throw an error if directory creation fails", async () => {
			// Mock mkdir to fail
			;(fs.mkdir as jest.Mock).mockRejectedValue(new Error("Permission denied"))

			// Call & Assert
			await expect(ensureDatabaseDirectory("/test/database")).rejects.toThrow(
				"Failed to create database directory",
			)
		})
	})

	describe("shouldExcludeFile", () => {
		it("should return true if file matches any exclude pattern", () => {
			// Mock minimatch to return true
			;(minimatch as unknown as jest.Mock).mockReturnValue(true)

			// Call
			const result = shouldExcludeFile("/path/to/file.ts", ["**/*.ts"])

			// Assertions
			expect(minimatch).toHaveBeenCalledWith("/path/to/file.ts", "**/*.ts")
			expect(result).toBe(true)
		})

		it("should return false if file does not match any exclude pattern", () => {
			// Mock minimatch to return false
			;(minimatch as unknown as jest.Mock).mockReturnValue(false)

			// Call
			const result = shouldExcludeFile("/path/to/file.ts", ["**/*.js"])

			// Assertions
			expect(minimatch).toHaveBeenCalledWith("/path/to/file.ts", "**/*.js")
			expect(result).toBe(false)
		})

		it("should check multiple patterns and return true if any match", () => {
			// Mock minimatch to return false for first pattern, true for second
			;(minimatch as unknown as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(true)

			// Call
			const result = shouldExcludeFile("/path/to/file.ts", ["**/*.js", "**/*.ts"])

			// Assertions
			expect(minimatch).toHaveBeenCalledTimes(2)
			expect(result).toBe(true)
		})
	})

	describe("normalizePath", () => {
		it("should normalize the file path", () => {
			// Setup
			const originalPath = "/path/to/../to/./file.ts"
			const expectedPath = path.normalize(originalPath)

			// Call
			const result = normalizePath(originalPath)

			// Assertions
			expect(result).toBe(expectedPath)
		})

		it("should handle Windows paths correctly", () => {
			// Setup
			const originalPathWithBackslashes = "C:\\path\\to\\..\\to\\.\\file.ts"
			const expectedPath = path.normalize(originalPathWithBackslashes)

			// Call
			const result = normalizePath(originalPathWithBackslashes)

			// Assertions
			expect(result).toBe(expectedPath)
		})
	})
})
