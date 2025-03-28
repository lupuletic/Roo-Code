import { UsageMetrics } from "../shared/ExtensionMessage"

/**
 * Creates an empty metrics object with all values initialized to zero
 */
export function createEmptyMetrics(): UsageMetrics {
	return {
		// Code metrics
		linesOfCodeGenerated: 0,
		filesCreated: 0,
		filesModified: 0,
		languageUsage: {},

		// Usage metrics
		tasksCompleted: 0,
		commandsExecuted: 0,
		apiCallsMade: 0,
		browserSessionsLaunched: 0,
		activeUsageTimeMs: 0,

		// Cost metrics
		totalApiCost: 0,
		costByProvider: {},
		costByTask: {},

		// Tool usage
		toolUsage: {},

		// Last reset timestamp
		lastReset: Date.now(),
	}
}

/**
 * Simple implementation of path.extname for browser compatibility
 */
function getFileExtension(filePath: string): string {
	const lastDotIndex = filePath.lastIndexOf(".")
	return lastDotIndex !== -1 ? filePath.slice(lastDotIndex) : ""
}

/**
 * Tracks lines of code written via write_to_file
 */
export function trackFileCreated(metrics: UsageMetrics, filePath: string, content: string): UsageMetrics {
	const updatedMetrics = { ...metrics }

	// Count lines
	const lines = content.split("\n").length
	updatedMetrics.linesOfCodeGenerated += lines
	updatedMetrics.filesCreated += 1

	// Track language usage
	const extension = getFileExtension(filePath).toLowerCase().replace(".", "")
	if (extension) {
		const language = getLanguageFromExtension(extension)
		if (language) {
			updatedMetrics.languageUsage[language] = (updatedMetrics.languageUsage[language] || 0) + lines
		}
	}

	// Track tool usage
	updatedMetrics.toolUsage["write_to_file"] = (updatedMetrics.toolUsage["write_to_file"] || 0) + 1

	return updatedMetrics
}

/**
 * Tracks lines of code modified via apply_diff
 */
export function trackFileModified(metrics: UsageMetrics, filePath: string, diff: string): UsageMetrics {
	const updatedMetrics = { ...metrics }

	// Count added lines in the diff
	const addedLines = diff.split("\n").filter((line) => line.startsWith("+")).length

	updatedMetrics.linesOfCodeGenerated += addedLines
	updatedMetrics.filesModified += 1

	// Track language usage
	const extension = getFileExtension(filePath).toLowerCase().replace(".", "")
	if (extension) {
		const language = getLanguageFromExtension(extension)
		if (language) {
			updatedMetrics.languageUsage[language] = (updatedMetrics.languageUsage[language] || 0) + addedLines
		}
	}

	// Track tool usage
	updatedMetrics.toolUsage["apply_diff"] = (updatedMetrics.toolUsage["apply_diff"] || 0) + 1

	return updatedMetrics
}

/**
 * Tracks API calls and costs
 */
export function trackApiCall(metrics: UsageMetrics, provider: string, cost: number, taskId?: string): UsageMetrics {
	const updatedMetrics = { ...metrics }

	updatedMetrics.apiCallsMade += 1
	updatedMetrics.totalApiCost += cost

	// Track cost by provider
	updatedMetrics.costByProvider[provider] = (updatedMetrics.costByProvider[provider] || 0) + cost

	// Track cost by task if taskId is provided
	if (taskId) {
		updatedMetrics.costByTask[taskId] = (updatedMetrics.costByTask[taskId] || 0) + cost
	}

	return updatedMetrics
}

/**
 * Tracks task completion
 */
export function trackTaskCompleted(metrics: UsageMetrics, taskId: string): UsageMetrics {
	const updatedMetrics = { ...metrics }

	updatedMetrics.tasksCompleted += 1

	return updatedMetrics
}

/**
 * Tracks CLI command execution
 */
export function trackCommandExecuted(metrics: UsageMetrics, command: string): UsageMetrics {
	const updatedMetrics = { ...metrics }

	updatedMetrics.commandsExecuted += 1

	// Track tool usage
	updatedMetrics.toolUsage["execute_command"] = (updatedMetrics.toolUsage["execute_command"] || 0) + 1

	return updatedMetrics
}

/**
 * Tracks browser sessions
 */
export function trackBrowserSession(metrics: UsageMetrics): UsageMetrics {
	const updatedMetrics = { ...metrics }

	updatedMetrics.browserSessionsLaunched += 1

	// Track tool usage
	updatedMetrics.toolUsage["browser_action"] = (updatedMetrics.toolUsage["browser_action"] || 0) + 1

	return updatedMetrics
}

/**
 * Tracks generic tool usage
 */
export function trackToolUsage(metrics: UsageMetrics, toolName: string): UsageMetrics {
	const updatedMetrics = { ...metrics }

	// Track tool usage
	updatedMetrics.toolUsage[toolName] = (updatedMetrics.toolUsage[toolName] || 0) + 1

	return updatedMetrics
}

/**
 * Updates usage time
 */
export function trackUsageTime(metrics: UsageMetrics, timeMs: number): UsageMetrics {
	const updatedMetrics = { ...metrics }

	updatedMetrics.activeUsageTimeMs += timeMs

	return updatedMetrics
}

/**
 * Helper function to convert file extension to language name
 */
function getLanguageFromExtension(extension: string): string | null {
	const extensionMap: Record<string, string> = {
		// Web languages
		js: "JavaScript",
		jsx: "JavaScript",
		ts: "TypeScript",
		tsx: "TypeScript",
		html: "HTML",
		css: "CSS",
		scss: "CSS",
		sass: "CSS",
		less: "CSS",

		// Backend languages
		py: "Python",
		rb: "Ruby",
		php: "PHP",
		java: "Java",
		cs: "C#",
		go: "Go",
		rs: "Rust",
		c: "C",
		cpp: "C++",
		cc: "C++",
		h: "C/C++ Header",
		hpp: "C++ Header",

		// Data/Config
		json: "JSON",
		yml: "YAML",
		yaml: "YAML",
		xml: "XML",
		toml: "TOML",
		ini: "INI",
		md: "Markdown",
		csv: "CSV",
		sql: "SQL",

		// Shell/Scripts
		sh: "Shell",
		bash: "Shell",
		zsh: "Shell",
		ps1: "PowerShell",

		// Others
		swift: "Swift",
		kt: "Kotlin",
		fs: "F#",
		clj: "Clojure",
		ex: "Elixir",
		exs: "Elixir",
		hs: "Haskell",
	}

	return extensionMap[extension] || extension.toUpperCase()
}

/**
 * Get most used tools from metrics
 */
export function getMostUsedTools(metrics: UsageMetrics, limit: number = 5): Array<{ name: string; count: number }> {
	return Object.entries(metrics.toolUsage)
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, limit)
}

/**
 * Get most used languages from metrics
 */
export function getMostUsedLanguages(metrics: UsageMetrics, limit: number = 5): Array<{ name: string; lines: number }> {
	return Object.entries(metrics.languageUsage)
		.map(([name, lines]) => ({ name, lines }))
		.sort((a, b) => b.lines - a.lines)
		.slice(0, limit)
}

/**
 * Calculate average cost per task
 */
export function getAverageCostPerTask(metrics: UsageMetrics): number {
	if (metrics.tasksCompleted === 0) {
		return 0
	}
	return metrics.totalApiCost / metrics.tasksCompleted
}

/**
 * Format time in ms to human readable format
 */
export function formatUsageTime(timeMs: number): string {
	if (timeMs < 60000) {
		return `${Math.round(timeMs / 1000)} seconds`
	} else if (timeMs < 3600000) {
		return `${Math.round(timeMs / 60000)} minutes`
	} else {
		const hours = Math.floor(timeMs / 3600000)
		const minutes = Math.round((timeMs % 3600000) / 60000)
		return `${hours} hour${hours !== 1 ? "s" : ""} ${minutes} minute${minutes !== 1 ? "s" : ""}`
	}
}

/**
 * Format cost as currency
 */
export function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`
}
