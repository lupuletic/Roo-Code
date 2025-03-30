import * as vscode from "vscode"

/**
 * Types of code change operations being tracked
 */
export enum CodeChangeSource {
    AI_GENERATED = "ai_generated",
    MANUAL = "manual",
}

/**
 * Result of computing diff changes
 */
export interface DiffChanges {
    additions: number
    deletions: number
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
 * Interface for historical metrics data
 */
export interface HistoricalMetrics {
    timestamp: number
    aiGenerated: CodeMetrics
    manual: CodeMetrics
}

/**
 * Complete metrics data structure stored in global state
 */
export interface MetricsData {
    aiGenerated: CodeMetrics
    manual: CodeMetrics
}

/**
 * Complete metrics data structure with history
 */
export interface MetricsDataWithHistory extends MetricsData {
    history: HistoricalMetrics[]
}

/**
 * Default empty metrics object
 */
export const emptyMetrics: CodeMetrics = {
    linesAdded: 0,
    linesDeleted: 0,
    filesModified: 0,
    filesCreated: 0,
    lastUpdated: 0,
}

/**
 * Default metrics data
 */
export const defaultMetricsData: MetricsData = {
    aiGenerated: { ...emptyMetrics },
    manual: { ...emptyMetrics },
}

/**
 * Default metrics data with history
 */
export const defaultMetricsDataWithHistory: MetricsDataWithHistory = {
    ...defaultMetricsData,
    history: []
}