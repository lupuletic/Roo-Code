import * as path from "path"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import {
	getDatabasePath,
	ensureDatabaseDirectory,
	normalizePath,
	validatePath,
	getWorkspaceRelativePath,
} from "../path-utils"
import { logger } from "../../../utils/logging"

// Mock dependencies
jest.mock("vscode")
jest.mock("fs/promises")
jest.mock("../../../utils/logging", () => ({
	logger: {
		debug: jest.fn(),
		error: jest.fn(),
	},
}))

describe("path-utils", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	describe("getDatabasePath", () => {
		it("should return the correct database path using globalStorageUri", () => {
			// Mock context
			const mockContext = {
				globalStorageUri: { fsPath: "/test/storage" } as vscode.Uri,
			}

			// Call
			const result = getDatabasePath(mockContext as vscode.ExtensionContext)

			// Assertions
			expect(result).toBe(path.join("/test/storage", "lancedb"))
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("/test/storage/lancedb"))
		})

		it("should use the provided subdirectory when specified", () => {
			// Mock context
			const mockContext = {
				globalStorageUri: { fsPath: "/test/storage" } as vscode.Uri,
			}

			// Call with custom subdirectory
			const result = getDatabasePath(mockContext as vscode.ExtensionContext, "customdb")

			// Assertions
			expect(result).toBe(path.join("/test/storage", "customdb"))
		})
	})

	describe("ensureDatabaseDirectory", () => {
		it("should create the directory and verify it is writable", async () => {
			// Setup mocks
			;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)
			;(fs.writeFile as jest.Mock).mockResolvedValue(undefined)
			;(fs.unlink as jest.Mock).mockResolvedValue(undefined)

			// Call
			await ensureDatabaseDirectory("/test/db")

			// Assertions
			expect(fs.mkdir).toHaveBeenCalledWith("/test/db", { recursive: true })
			expect(fs.writeFile).toHaveBeenCalledWith(path.join("/test/db", ".write-test"), "")
			expect(fs.unlink).toHaveBeenCalledWith(path.join("/test/db", ".write-test"))
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("/test/db"))
		})

		it("should throw an error if directory creation fails", async () => {
			// Setup mock to fail
			;(fs.mkdir as jest.Mock).mockRejectedValue(new Error("Permission denied"))

			// Call & Assert
			await expect(ensureDatabaseDirectory("/test/db")).rejects.toThrow(
				"Failed to create or verify database directory",
			)
			expect(logger.error).toHaveBeenCalledWith(
				expect.stringContaining("Failed to create or verify database directory"),
			)
		})

		it("should throw an error if write verification fails", async () => {
			// Setup mocks - mkdir succeeds but writeFile fails
			;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)
			;(fs.writeFile as jest.Mock).mockRejectedValue(new Error("Permission denied"))

			// Call & Assert
			await expect(ensureDatabaseDirectory("/test/db")).rejects.toThrow(
				"Failed to create or verify database directory",
			)
		})
	})

	describe("normalizePath", () => {
		it("should normalize a simple path", () => {
			const result = normalizePath("./test/path")
			// This would resolve to an absolute path based on cwd
			expect(result).toBe(path.resolve("./test/path"))
		})

		it("should normalize a path with .. segments", () => {
			const result = normalizePath("/test/path/../other")
			// This should be normalized to /test/other
			expect(result).toBe(path.normalize(path.resolve("/test/path/../other")))
		})

		it("should handle Windows-style paths on any platform", () => {
			const windowsPath = "C:\\test\\path"
			const result = normalizePath(windowsPath)
			// The result should be an absolute path in platform-dependent format
			expect(result).toBe(path.normalize(path.resolve(windowsPath)))
		})
	})

	describe("validatePath", () => {
		it("should return true for an existing path", async () => {
			// Setup mock to succeed
			;(fs.access as jest.Mock).mockResolvedValue(undefined)

			// Call
			const result = await validatePath("/test/exists")

			// Assertions
			expect(result).toBe(true)
			expect(fs.access).toHaveBeenCalledWith("/test/exists")
		})

		it("should return false for a non-existing path", async () => {
			// Setup mock to fail
			;(fs.access as jest.Mock).mockRejectedValue(new Error("No such file"))

			// Call
			const result = await validatePath("/test/nonexisting")

			// Assertions
			expect(result).toBe(false)
			expect(fs.access).toHaveBeenCalledWith("/test/nonexisting")
		})
	})

	describe("getWorkspaceRelativePath", () => {
		it("should return a relative path when file is in workspace", () => {
			// Call
			const result = getWorkspaceRelativePath("/workspace/project/src/file.ts", "/workspace/project")

			// Assertions
			expect(result).toBe("src/file.ts")
		})

		it("should return the original path when file is not in workspace", () => {
			// Call
			const result = getWorkspaceRelativePath("/other/location/file.ts", "/workspace/project")

			// Assertions
			expect(result).toBe("/other/location/file.ts")
		})

		it("should return the original path when workspace root is not provided", () => {
			// Call
			const result = getWorkspaceRelativePath("/workspace/project/src/file.ts")

			// Assertions
			expect(result).toBe("/workspace/project/src/file.ts")
		})

		it("should handle different path formats and normalize them", () => {
			// Call with different formats but same logical path
			const result = getWorkspaceRelativePath("/workspace/project/src/../src/file.ts", "/workspace/project")

			// Assertions - should normalize both paths before comparison
			expect(result).toBe("src/file.ts")
		})
	})
})
