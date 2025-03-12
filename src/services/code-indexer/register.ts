import * as vscode from "vscode"
import { logger } from "../../utils/logging"
import { initializeCodeIndexer, disposeCodeIndexer, rebuildCodeIndex } from "./index"

/**
 * Register the code indexer service with the extension
 *
 * This function should be called from extension.ts during activation
 * @param context VSCode extension context
 */
export function registerCodeIndexer(context: vscode.ExtensionContext): void {
	// Register the contributed settings
	const configContributions = {
		"roo-cline.codeIndexer.enabled": {
			type: "boolean",
			description: "Enable the code indexer feature for semantic code search",
			default: true,
		},
		"roo-cline.codeIndexer.autoIndexOnWorkspaceOpen": {
			type: "boolean",
			description: "Automatically index code when a workspace is opened",
			default: true,
		},
		"roo-cline.codeIndexer.watchForFileChanges": {
			type: "boolean",
			description: "Watch for file changes and update the index automatically",
			default: true,
		},
		"roo-cline.codeIndexer.maxFileSizeBytes": {
			type: "number",
			description: "Maximum file size in bytes to index (default: 1MB)",
			default: 1048576,
		},
		"roo-cline.codeIndexer.embeddingModel": {
			type: "string",
			description: "OpenAI embedding model to use for code indexing",
			default: "text-embedding-ada-002",
		},
		"roo-cline.codeIndexer.excludePatterns": {
			type: "array",
			description: "Patterns to exclude from indexing",
			default: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
		},
	}

	// Check if the feature is enabled
	const config = vscode.workspace.getConfiguration("roo-cline.codeIndexer")
	const isEnabled = config.get<boolean>("enabled", true)

	if (!isEnabled) {
		logger.info("Code indexer feature is disabled")
		return
	}

	try {
		// Initialize the code indexer
		initializeCodeIndexer(context)

		// Register commands
		context.subscriptions.push(vscode.commands.registerCommand("roo-cline.rebuildCodeIndex", rebuildCodeIndex))

		// Register dispose handler
		context.subscriptions.push({
			dispose: disposeCodeIndexer,
		})

		logger.info("Code indexer service registered")
	} catch (error) {
		logger.error("Failed to register code indexer service:", error)
	}
}
