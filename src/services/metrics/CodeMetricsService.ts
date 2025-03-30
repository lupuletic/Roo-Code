import * as vscode from "vscode"
import { telemetryService } from "../telemetry/TelemetryService"
import { 
    CodeChangeSource, 
    CodeMetrics, 
    HistoricalMetrics,
    MetricsData,
    MetricsDataWithHistory,
    emptyMetrics,
    defaultMetricsData,
    defaultMetricsDataWithHistory
} from "./types"
import { getDiffChanges } from "./DiffCalculator"
import { isSourceCodeFile, DocumentSnapshotManager } from "./FileUtils"

/**
 * Service that tracks and reports code metrics for both AI-generated and manual changes
 */
export class CodeMetricsService {
    private static instance: CodeMetricsService
    private context: vscode.ExtensionContext
    private metrics: MetricsDataWithHistory = defaultMetricsDataWithHistory
    private readonly MAX_HISTORY_ENTRIES = 30 // Store up to 30 historical entries
    private disposables: vscode.Disposable[] = []
    private documentChangeListeners: Map<string, vscode.Disposable> = new Map()
    private isApplyingAIDiff: boolean = false
    private modifiedFilesSet: Set<string> = new Set()
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
    private readonly DEBOUNCE_DELAY = 1000 // 1 second debounce for batching changes
    private readonly AI_FLAG_RESET_DELAY = 300 // 300ms delay to ensure AI changes are processed
    private documentSnapshotManager: DocumentSnapshotManager = new DocumentSnapshotManager()

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
        try {
            const storedMetrics = this.context.globalState.get<MetricsDataWithHistory>("codeMetrics")
            if (storedMetrics) {
                this.metrics = storedMetrics
            } else {
                this.metrics = { ...defaultMetricsDataWithHistory }
                await this.saveMetrics()
            }
        } catch (error) {
            console.error("Failed to initialize metrics:", error)
            this.metrics = { ...defaultMetricsDataWithHistory }
        }   
    }

    /**
     * Setup event listeners for tracking manual code changes
     */
    private setupEventListeners(): void {
        // Track file creation
        this.disposables.push(
            vscode.workspace.onDidCreateFiles((event) => {
                // Only count source code files
                const sourceCodeFiles = event.files.filter(file => 
                    isSourceCodeFile(file.fsPath)
                )
                if (sourceCodeFiles.length > 0) {
                    this.trackManualFileCreation(sourceCodeFiles.length)
                }
            }),
            vscode.workspace.onDidDeleteFiles((event) => {
                this.trackManualFileDeletion(event.files)
            }),
        )

        // Setup periodic cleanup timer for document snapshots
        this.setupPeriodicCleanup()

        // Track text document changes
        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument((doc) => {
                this.documentSnapshotManager.storeSnapshot(doc)
                this.setupDocumentChangeListener(doc)
            }),
        )

        // Setup listeners for already open documents
        vscode.workspace.textDocuments.forEach((doc) => {
            this.documentSnapshotManager.storeSnapshot(doc)
            this.setupDocumentChangeListener(doc)
        })
    }

    /**
     * Set up a periodic cleanup of document snapshots to prevent memory bloat
     */
    private setupPeriodicCleanup(): void {
        // Run cleanup every hour
        const cleanupInterval = 60 * 60 * 1000; // 1 hour in milliseconds
        
        const interval = setInterval(() => {
            this.cleanupStaleSnapshots();
        }, cleanupInterval);
        
        // Create a disposable for the interval
        const disposable = {
            dispose: () => {
                clearInterval(interval);
            }
        };
        
        // Add to disposables for cleanup
        this.disposables.push(disposable);
    }

    /**
     * Set up change listener for a specific document
     */
    private setupDocumentChangeListener(doc: vscode.TextDocument): void {
        // Only track source code files and avoid duplicating listeners
        if (isSourceCodeFile(doc.fileName) && !this.documentChangeListeners.has(doc.fileName)) {
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
     * Cleanup stale document snapshots to prevent memory bloat
     */
    private cleanupStaleSnapshots(): void {
        try {
            const openDocumentUris = new Set(
                vscode.workspace.textDocuments.map(doc => doc.uri.toString())
            );
            
            // Find and delete stale snapshots
            const removedCount = this.documentSnapshotManager.cleanupStaleSnapshots(openDocumentUris);
            
            if (removedCount > 0) {
                console.log(`Cleaned up ${removedCount} stale document snapshots`);
            }
        } catch (error) {
            console.error("Error during document snapshot cleanup:", error);
        }
    }

    /**
     * Track manual text changes in a document
     */
    private trackManualTextChanges(event: vscode.TextDocumentChangeEvent): void {
        // Skip tracking if changes are being applied by AI
        if (this.isApplyingAIDiff) {
            return
        }

        const documentUri = event.document.uri.toString()

        // Clear any existing debounce timer for this document
        if (this.debounceTimers.has(documentUri)) {
            clearTimeout(this.debounceTimers.get(documentUri))
        }

        // Set a new debounce timer
        this.debounceTimers.set(
            documentUri,
            setTimeout(() => {
                this.processDocumentChanges(event)
                this.debounceTimers.delete(documentUri)
            }, this.DEBOUNCE_DELAY),
        )
    }

    /**
     * Process document changes after debounce
     */
    private processDocumentChanges(event: vscode.TextDocumentChangeEvent): void {
        const documentUri = event.document.uri.toString()
        const newContent = event.document.getText()
        const oldContent = this.documentSnapshotManager.getSnapshot(documentUri) || ""

        // Use the improved diffing mechanism for accuracy
        const { additions, deletions } = getDiffChanges(oldContent, newContent)
        
        // Update the document snapshot with the new content
        this.documentSnapshotManager.updateSnapshot(documentUri, newContent)

        // Only update metrics if there were actual changes
        if (additions === 0 && deletions === 0) {
            return
        }

        // Track this file as modified if not already in the set
        const isNewlyModified = !this.modifiedFilesSet.has(documentUri)
        if (isNewlyModified) {
            this.modifiedFilesSet.add(documentUri)
        }

        this.updateMetrics(CodeChangeSource.MANUAL, {
            linesAdded: additions,
            linesDeleted: deletions,
            filesModified: isNewlyModified ? 1 : 0,
            filesCreated: 0,
            lastUpdated: Date.now(),
        });
        
        // Send telemetry event for consistency with AI-generated metrics
        telemetryService.captureEvent("code_changes", {
            source: CodeChangeSource.MANUAL,
            linesAdded: additions,
            linesDeleted: deletions,
            isNewFile: false,
            fileExtension: event.document.fileName.split(".").pop() || "",
            isModification: true
        })
        
        this.recordHistoricalSnapshot()
    }

    /**
     * Track AI code changes from applying diffs
     */
    public async trackAIDiffChanges(
        originalContent: string, 
        newContent: string, 
        filePath: string, 
        isNewFile: boolean
    ): Promise<void> {
        // Set flag to prevent manual tracking of these changes
        this.isApplyingAIDiff = true
        
        // Ensure filePath is valid
        if (!filePath) return;

        const fileUri = vscode.Uri.file(filePath).toString()

        // Store the new content as a snapshot
        this.documentSnapshotManager.updateSnapshot(fileUri, newContent)

        // Use the improved diffing mechanism
        const { additions, deletions } = getDiffChanges(originalContent, newContent)

        // Track this file as modified if not already in the set
        const isNewlyModified = !isNewFile && !this.modifiedFilesSet.has(fileUri)
        if (isNewlyModified || isNewFile) {
            this.modifiedFilesSet.add(fileUri)
        }

        await this.updateMetrics(CodeChangeSource.AI_GENERATED, {
            linesAdded: additions,
            linesDeleted: deletions,
            filesModified: isNewlyModified ? 1 : 0,
            filesCreated: isNewFile ? 1 : 0,
            lastUpdated: Date.now(),
        })

        // Get file extension safely
        const filePathParts = filePath.split(".")
        const fileExtension = filePathParts.length > 1 ? filePathParts.pop() : "";

        // Send telemetry event
        try {
            telemetryService.captureEvent("code_changes", {
                source: CodeChangeSource.AI_GENERATED,
                linesAdded: additions,
                linesDeleted: deletions,
                isNewFile: isNewFile,
                fileExtension,
                isModification: !isNewFile
            })
        } catch (error) {
            console.error("Error sending telemetry for AI changes:", error);
        }
        
        try {
            await this.recordHistoricalSnapshot();
        } catch (error) {
            console.error("Error recording historical snapshot for AI changes:", error);
        }

        // Reset flag after a short delay to ensure all document change events have been processed
        setTimeout(() => {
            this.isApplyingAIDiff = false
        }, this.AI_FLAG_RESET_DELAY)
    }

    /**
     * Track manual file creation
     */
    private async trackManualFileCreation(count: number): Promise<void> {
        if (count <= 0) return;
        
        await this.updateMetrics(CodeChangeSource.MANUAL, {
            linesAdded: 0,
            linesDeleted: 0,
            filesModified: 0,
            filesCreated: count,
            lastUpdated: Date.now(),
        })
        
        try {
            await this.recordHistoricalSnapshot();
        } catch (error) {
            console.error("Error recording historical snapshot for file creation:", error);
        }
        
        // Send telemetry event for consistency with AI-generated
        telemetryService.captureEvent("code_changes", {
            source: CodeChangeSource.MANUAL,
            linesAdded: 0,
            linesDeleted: 0,
            filesCreated: count,
            fileExtension: "multiple"
        });
    }
    
    /**
     * Track manual file deletion
     */
    private async trackManualFileDeletion(files: readonly vscode.Uri[]): Promise<void> {
        // Only count source code files
        const sourceCodeFiles = files.filter(file => 
            isSourceCodeFile(file.fsPath)
        );
        
        if (sourceCodeFiles.length === 0) return;
        
        // Count deleted source code files
        const deletedCount = sourceCodeFiles.length;
        
        // Remove from modified files set and document snapshots
        sourceCodeFiles.forEach(file => {
            const fileUri = file.toString();
            this.modifiedFilesSet.delete(fileUri);
            this.documentSnapshotManager.deleteSnapshot(fileUri);
        });
        
        await this.updateMetrics(CodeChangeSource.MANUAL, {
            linesAdded: 0,
            linesDeleted: 0,
            filesModified: -deletedCount, // Decrement modified files count
            filesCreated: 0,
            lastUpdated: Date.now(),
        });
        
        try {
            await this.recordHistoricalSnapshot();
        } catch (error) {
            console.error("Error recording historical snapshot for file deletion:", error);
        }
    }

    /**
     * Update metrics and save to global state
     */
    private async updateMetrics(source: CodeChangeSource, changes: Partial<CodeMetrics>): Promise<void> {
        const target = source === CodeChangeSource.AI_GENERATED ? this.metrics.aiGenerated : this.metrics.manual
        
        try {
            // Update metrics
            target.linesAdded += changes.linesAdded || 0
            target.linesDeleted += changes.linesDeleted || 0
            target.filesModified += changes.filesModified || 0
            target.filesCreated += changes.filesCreated || 0
            target.lastUpdated = changes.lastUpdated || Date.now()

            // Save updated metrics
            await this.saveMetrics()
        } catch (error) {
            console.error(`Failed to update metrics for ${source}:`, error)
        }
    }

    /**
     * Record a historical snapshot of current metrics
     */
    private async recordHistoricalSnapshot(): Promise<void> {
        const now = Date.now()
        const lastSnapshot = this.metrics.history[this.metrics.history.length - 1]
        
        // Only record a new snapshot if it's been at least 1 hour since the last one
        // or if this is the first snapshot
        if (!lastSnapshot || (now - lastSnapshot.timestamp) >= 60 * 60 * 1000) {
            try {
                // Create a deep copy of current metrics
                const snapshot: HistoricalMetrics = {
                    timestamp: now,
                    aiGenerated: { ...this.metrics.aiGenerated },
                    manual: { ...this.metrics.manual }
                }
                
                // Add to history and limit size
                this.metrics.history.push(snapshot)
                if (this.metrics.history.length > this.MAX_HISTORY_ENTRIES) {
                    this.metrics.history.shift() // Remove oldest entry
                }
                
                // Save metrics after recording a snapshot
                await this.saveMetrics()
            } catch (err) {
                console.error("Failed to save metrics snapshot:", err)
                throw err; // Re-throw for proper handling upstream
            }
        }
    }

    /**
     * Save metrics to global state
     */
    private async saveMetrics(): Promise<void> {
        try {
            await this.context.globalState.update("codeMetrics", this.metrics)
        } catch (error) {
            console.error("Failed to save metrics to global state:", error)
            throw error; // Re-throw for proper handling upstream
        }
    }

    /**
     * Get current metrics
     */
    public getMetrics(): MetricsData {
        // Create a proper deep copy to avoid reference issues
        return {
            aiGenerated: this.deepCopyMetrics(this.metrics.aiGenerated),
            manual: this.deepCopyMetrics(this.metrics.manual)
        }
    }

    /**
     * Create a deep copy of metrics object
     */
    private deepCopyMetrics(metrics: CodeMetrics): CodeMetrics {
        return {
            linesAdded: metrics.linesAdded,
            linesDeleted: metrics.linesDeleted,
            filesModified: metrics.filesModified,
            filesCreated: metrics.filesCreated,
            lastUpdated: metrics.lastUpdated
        };
    }

    /**
     * Create a deep copy of historical metrics
     */
    private deepCopyHistoricalMetrics(metrics: HistoricalMetrics): HistoricalMetrics {
        return {
            timestamp: metrics.timestamp,
            aiGenerated: this.deepCopyMetrics(metrics.aiGenerated),
            manual: this.deepCopyMetrics(metrics.manual)
        };
    }

    /**
     * Get metrics with history
     */
    public getMetricsWithHistory(): MetricsDataWithHistory {
        // Deep copy the entire metrics object with history
        return {
            aiGenerated: this.deepCopyMetrics(this.metrics.aiGenerated),
            manual: this.deepCopyMetrics(this.metrics.manual),
            history: this.metrics.history.map(item => this.deepCopyHistoricalMetrics(item))
        };
    }

    /**
     * Reset metrics
     */
    public async resetMetrics(): Promise<void> {
        try {
            // Make a clean copy of the default metrics
            this.metrics = {
                aiGenerated: { ...emptyMetrics },
                manual: { ...emptyMetrics },
                history: []
            };

            // Record initial empty snapshot and cleanup tracking sets
            await this.recordHistoricalSnapshot();
            this.modifiedFilesSet.clear();
            this.documentSnapshotManager.clear();
            
            // Send a telemetry event for metrics reset
            telemetryService.captureEvent("metrics_reset", {});
            
            await this.saveMetrics();
        } catch (error) {
            console.error("Error resetting metrics:", error);
        }
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

        // Clear debounce timers
        this.debounceTimers.forEach((timer) => clearTimeout(timer))
        this.debounceTimers.clear()
    }
}

// Re-export the types from types.ts for external users
export { CodeChangeSource } from "./types"
export type { 
    CodeMetrics,
    HistoricalMetrics,
    MetricsData,
    MetricsDataWithHistory
} from "./types"