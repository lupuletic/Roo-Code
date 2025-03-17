/**
 * Utilities for computing diff statistics and changes
 */

/**
 * Result of computing diff changes
 */
export interface DiffChanges {
	additions: number
	deletions: number
}

/**
 * Compute the number of line additions and deletions between two text contents
 */
export function getDiffChanges(originalContent: string, newContent: string): DiffChanges {
	const originalLines = originalContent.split("\n")
	const newLines = newContent.split("\n")

	// Simple line-by-line diff calculation
	const additions = Math.max(0, newLines.length - originalLines.length)
	const deletions = Math.max(0, originalLines.length - newLines.length)

	return { additions, deletions }
}

/**
 * Get more detailed diff information by comparing line content
 * This is a more sophisticated version that actually compares line content
 */
export function getDetailedDiffChanges(originalContent: string, newContent: string): DiffChanges {
	const originalLines = originalContent.split("\n")
	const newLines = newContent.split("\n")

	let additions = 0
	let deletions = 0

	// Use Longest Common Subsequence approach to identify changed lines
	const lcsMatrix = buildLCSMatrix(originalLines, newLines)
	const diff = backtrackLCS(lcsMatrix, originalLines, newLines, originalLines.length, newLines.length)

	// Count additions and deletions
	for (const change of diff) {
		if (change.type === "add") {
			additions++
		} else if (change.type === "remove") {
			deletions++
		}
	}

	return { additions, deletions }
}

interface DiffChange {
	type: "add" | "remove" | "unchanged"
	line: string
}

/**
 * Build a Longest Common Subsequence matrix for diff computation
 */
function buildLCSMatrix(originalLines: string[], newLines: string[]): number[][] {
	const matrix: number[][] = Array(originalLines.length + 1)
		.fill(null)
		.map(() => Array(newLines.length + 1).fill(0))

	for (let i = 1; i <= originalLines.length; i++) {
		for (let j = 1; j <= newLines.length; j++) {
			if (originalLines[i - 1] === newLines[j - 1]) {
				matrix[i][j] = matrix[i - 1][j - 1] + 1
			} else {
				matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1])
			}
		}
	}

	return matrix
}

/**
 * Backtrack the LCS matrix to produce a diff
 */
function backtrackLCS(
	matrix: number[][],
	originalLines: string[],
	newLines: string[],
	i: number,
	j: number,
): DiffChange[] {
	if (i === 0 && j === 0) {
		return []
	}

	if (i > 0 && j > 0 && originalLines[i - 1] === newLines[j - 1]) {
		return [
			...backtrackLCS(matrix, originalLines, newLines, i - 1, j - 1),
			{ type: "unchanged", line: originalLines[i - 1] },
		]
	}

	if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
		return [...backtrackLCS(matrix, originalLines, newLines, i, j - 1), { type: "add", line: newLines[j - 1] }]
	}

	return [...backtrackLCS(matrix, originalLines, newLines, i - 1, j), { type: "remove", line: originalLines[i - 1] }]
}
