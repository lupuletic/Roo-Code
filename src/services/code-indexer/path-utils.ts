import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { logger } from "../../utils/logging"

/**
 * Get the database path from the extension's global storage location
 * @param context VSCode extension context
 * @param subDirectory Optional subdirectory within the global storage
 * @returns Full path to the database directory
 */
export function getDatabasePath(context: vscode.ExtensionContext, subDirectory: string = "lancedb"): string {
	const storagePath = context.globalStorageUri.fsPath
	const dbPath = path.join(storagePath, subDirectory)
	logger.debug(`Database path resolved to: ${dbPath}`)
	return dbPath
}

/**
 * Ensures the database directory exists and is writable
 * @param dbPath Path to the database directory
 * @throws Error if the directory cannot be created or accessed
 */
export async function ensureDatabaseDirectory(dbPath: string): Promise<void> {
	try {
		await fs.mkdir(dbPath, { recursive: true })

		// Verify that the directory is writable by creating a test file
		const testFilePath = path.join(dbPath, ".write-test")
		await fs.writeFile(testFilePath, "")
		await fs.unlink(testFilePath)

		logger.debug(`Database directory verified at: ${dbPath}`)
	} catch (error) {
		logger.error(`Failed to create or verify database directory: ${error}`)
		throw new Error(`Failed to create or verify database directory: ${error}`)
	}
}

/**
 * Normalize a file path for consistent comparison and storage
 * @param filePath Path to normalize
 * @returns Normalized absolute path
 */
export function normalizePath(filePath: string): string {
	// Resolve to absolute path and normalize
	const resolved = path.resolve(filePath)
	return path.normalize(resolved)
}

/**
 * Validate if a path exists and is accessible
 * @param filePath Path to validate
 * @returns Promise resolving to true if path exists and is accessible
 */
export async function validatePath(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch (error) {
		return false
	}
}

/**
 * Get the relative path from workspace root
 * @param filePath Absolute file path
 * @param workspaceRoot Workspace root path
 * @returns Relative path or original path if not in workspace
 */
export function getWorkspaceRelativePath(filePath: string, workspaceRoot?: string): string {
	if (!workspaceRoot) {
		return filePath
	}

	const normalizedFile = normalizePath(filePath)
	const normalizedRoot = normalizePath(workspaceRoot)

	if (normalizedFile.startsWith(normalizedRoot)) {
		return path.relative(normalizedRoot, normalizedFile)
	}

	return filePath
}
