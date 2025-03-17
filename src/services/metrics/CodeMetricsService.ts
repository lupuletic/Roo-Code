import * as vscode from "vscode"
import { telemetryService } from "../telemetry/TelemetryService"

/**
 * Result of computing diff changes
 */
interface DiffChanges {
	additions: number
	deletions: number
}

/**
 * Compute the number of line additions and deletions between two text contents
 */
function getDiffChanges(originalContent: string, newContent: string): DiffChanges {
	const originalLines = originalContent.split("\n")
	const newLines = newContent.split("\n")

	// Simple line-by-line diff calculation
	const additions = Math.max(0, newLines.length - originalLines.length)
	const deletions = Math.max(0, originalLines.length - newLines.length)
	return { additions, deletions }
}

/**
 * Types of code change operations being tracked
 */
export enum CodeChangeSource {
	AI_GENERATED = "ai_generated",
	MANUAL = "manual",
}

/**
 * Interface for code metrics data structure
 */
export interface CodeMetrics {
	linesAdded: number
	linesDeleted: number
	filesModified: number
	filesCreated: number
	lastUpdated: number
}

/**
 * Complete metrics data structure stored in global state
 */
export interface MetricsData {
	aiGenerated: CodeMetrics
	manual: CodeMetrics
}

/**
 * Default empty metrics object
 */
const emptyMetrics: CodeMetrics = {
	linesAdded: 0,
	linesDeleted: 0,
	filesModified: 0,
	filesCreated: 0,
	lastUpdated: 0,
}

/**
 * Default metrics data
 */
const defaultMetricsData: MetricsData = {
	aiGenerated: { ...emptyMetrics },
	manual: { ...emptyMetrics },
}

/**
 * Test constant for metrics service
 */
export const test = "metrics_test_value"

/**
 * Service that tracks and reports code metrics for both AI-generated and manual changes
 */
export class CodeMetricsService {
	private static instance: CodeMetricsService
	private context: vscode.ExtensionContext
	private metrics: MetricsData = defaultMetricsData
	private disposables: vscode.Disposable[] = []
	private documentChangeListeners: Map<string, vscode.Disposable> = new Map()

	private constructor(context: vscode.ExtensionContext) {
		this.context = context
		this.initializeMetrics()
		this.setupEventListeners()
	}

	/**
	 * Get the singleton instance of CodeMetricsService
	 */
	public static getInstance(context?: vscode.ExtensionContext): CodeMetricsService {
		if (!CodeMetricsService.instance) {
			if (!context) {
				throw new Error("CodeMetricsService must be initialized with context first")
			}
			CodeMetricsService.instance = new CodeMetricsService(context)
		}
		return CodeMetricsService.instance
	}

	/**
	 * Initialize metrics from global state or create default if not existing
	 */
	private async initializeMetrics(): Promise<void> {
		const storedMetrics = this.context.globalState.get<MetricsData>("codeMetrics")
		if (storedMetrics) {
			this.metrics = storedMetrics
		} else {
			this.metrics = { ...defaultMetricsData }
			await this.saveMetrics()
		}
	}

	/**
	 * Setup event listeners for tracking manual code changes
	 */
	private setupEventListeners(): void {
		// Track file creation
		this.disposables.push(
			vscode.workspace.onDidCreateFiles((event) => {
				this.trackManualFileCreation(event.files.length)
			}),
		)

		// Track text document changes
		this.disposables.push(
			vscode.workspace.onDidOpenTextDocument((doc) => {
				this.setupDocumentChangeListener(doc)
			}),
		)

		// Setup listeners for already open documents
		vscode.workspace.textDocuments.forEach((doc) => {
			this.setupDocumentChangeListener(doc)
		})
	}

	/**
	 * Set up change listener for a specific document
	 */
	private setupDocumentChangeListener(doc: vscode.TextDocument): void {
		// Only track source code files and avoid duplicating listeners
		if (this.isSourceCodeFile(doc.fileName) && !this.documentChangeListeners.has(doc.fileName)) {
			const disposable = vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() === doc.uri.toString()) {
					this.trackManualTextChanges(event)
				}
			})

			this.documentChangeListeners.set(doc.fileName, disposable)
			this.disposables.push(disposable)
		}
	}

	/**
	 * Check if a file is a source code file (not a config, binary, etc)
	 */
	private isSourceCodeFile(fileName: string): boolean {
		// Extensions to track
		const codeExtensions = [
			".ts",
			".tsx",
			".js",
			".jsx",
			".py",
			".java",
			".c",
			".cpp",
			".cs",
			".go",
			".rb",
			".php",
			".swift",
			".kt",
			".rs",
			".html",
			".css",
			".scss",
			".astro",
		]

		return codeExtensions.some((ext) => fileName.endsWith(ext))
	}

	/**
	 * Track manual text changes in a document
	 */
	private trackManualTextChanges(event: vscode.TextDocumentChangeEvent): void {
		let linesAdded = 0
		let linesDeleted = 0

		// Process each change in the document
		for (const change of event.contentChanges) {
			const oldLines = change.rangeLength > 0 ? event.document.getText(change.range).split("\n").length : 0

			const newLines = change.text.split("\n").length

			linesAdded += Math.max(0, newLines - oldLines)
			linesDeleted += Math.max(0, oldLines - newLines)
		}

		// Update metrics if there were actual changes
		if (linesAdded > 0 || linesDeleted > 0) {
			this.updateMetrics(CodeChangeSource.MANUAL, {
				linesAdded,
				linesDeleted,
				filesModified: 1,
				filesCreated: 0,
				lastUpdated: Date.now(),
			})
		}
	}

	/**
	 * Track AI code changes from applying diffs
	 */
	public trackAIDiffChanges(originalContent: string, newContent: string, filePath: string, isNewFile: boolean): void {
		const { additions, deletions } = getDiffChanges(originalContent, newContent)

		this.updateMetrics(CodeChangeSource.AI_GENERATED, {
			linesAdded: additions,
			linesDeleted: deletions,
			filesModified: isNewFile ? 0 : 1,
			filesCreated: isNewFile ? 1 : 0,
			lastUpdated: Date.now(),
		})

		// Send telemetry event
		telemetryService.captureEvent("code_changes", {
			source: CodeChangeSource.AI_GENERATED,
			linesAdded: additions,
			linesDeleted: deletions,
			isNewFile: isNewFile,
			fileExtension: filePath.split(".").pop(),
		})
	}

	/**
	 * Track manual file creation
	 */
	private trackManualFileCreation(count: number): void {
		this.updateMetrics(CodeChangeSource.MANUAL, {
			linesAdded: 0,
			linesDeleted: 0,
			filesModified: 0,
			filesCreated: count,
			lastUpdated: Date.now(),
		})
	}

	/**
	 * Update metrics and save to global state
	 */
	private async updateMetrics(source: CodeChangeSource, changes: Partial<CodeMetrics>): Promise<void> {
		const target = source === CodeChangeSource.AI_GENERATED ? this.metrics.aiGenerated : this.metrics.manual

		// Update metrics
		target.linesAdded += changes.linesAdded || 0
		target.linesDeleted += changes.linesDeleted || 0
		target.filesModified += changes.filesModified || 0
		target.filesCreated += changes.filesCreated || 0
		target.lastUpdated = changes.lastUpdated || Date.now()

		// Save updated metrics
		await this.saveMetrics()
	}

	/**
	 * Save metrics to global state
	 */
	private async saveMetrics(): Promise<void> {
		await this.context.globalState.update("codeMetrics", this.metrics)
	}

	/**
	 * Get current metrics
	 */
	public getMetrics(): MetricsData {
		return { ...this.metrics }
	}

	/**
	 * Reset metrics
	 */
	public async resetMetrics(): Promise<void> {
		this.metrics = { ...defaultMetricsData }
		await this.saveMetrics()
	}

	/**
	 * Clean up resources
	 */
	public dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables = []

		// Clear document change listeners
		this.documentChangeListeners.forEach((d) => d.dispose())
		this.documentChangeListeners.clear()
	}
}
