import * as vscode from "vscode"

/**
 * Utility functions for file operations in the CodeMetricsService
 */

/**
 * Check if a file is a source code file (not a config, binary, etc)
 */
export function isSourceCodeFile(fileName: string): boolean {
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
        ".less",
        ".sass",
        ".vue",
        ".scss",
        ".astro",
    ]

    return codeExtensions.some((ext) => fileName.endsWith(ext))
}

/**
 * Helper for snapshot storage and management
 */
export class DocumentSnapshotManager {
    private documentSnapshots: Map<string, string> = new Map()
    
    /**
     * Store a snapshot of the document text for later diffing
     */
    public storeSnapshot(doc: vscode.TextDocument): void {
        // Only store snapshots for source code files
        if (isSourceCodeFile(doc.fileName)) {
            this.documentSnapshots.set(doc.uri.toString(), doc.getText())
        }
    }
    
    /**
     * Get a snapshot for a document URI
     */
    public getSnapshot(uri: string): string | undefined {
        return this.documentSnapshots.get(uri)
    }
    
    /**
     * Update a snapshot for a document URI
     */
    public updateSnapshot(uri: string, content: string): void {
        this.documentSnapshots.set(uri, content)
    }
    
    /**
     * Check if a snapshot exists for a document URI
     */
    public hasSnapshot(uri: string): boolean {
        return this.documentSnapshots.has(uri)
    }
    
    /**
     * Delete a snapshot for a document URI
     */
    public deleteSnapshot(uri: string): boolean {
        return this.documentSnapshots.delete(uri)
    }
    
    /**
     * Clear all snapshots
     */
    public clear(): void {
        this.documentSnapshots.clear()
    }
    
    /**
     * Get all URIs with snapshots
     */
    public getAllUris(): string[] {
        return Array.from(this.documentSnapshots.keys())
    }
    
    /**
     * Cleanup stale document snapshots to prevent memory bloat
     */
    public cleanupStaleSnapshots(openDocumentUris: Set<string>): number {
        // Find snapshots for documents that are no longer open
        const staleSnapshots = Array.from(this.documentSnapshots.keys())
            .filter(uri => !openDocumentUris.has(uri))
            
        // Delete stale snapshots
        staleSnapshots.forEach(uri => {
            this.documentSnapshots.delete(uri)
        })
        
        return staleSnapshots.length
    }
}