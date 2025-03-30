/**
 * Improved diff calculation utility that handles character-level changes
 */

import { DiffChanges } from "./types"

/**
 * Calculate similarity between two strings (0.0 to 1.0)
 * Uses Levenshtein distance to determine how similar two strings are
 */
function calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1.0
    if (a.length === 0 || b.length === 0) return 0.0
    
    // Levenshtein distance calculation
    const matrix: number[][] = []
    
    // Initialize matrix
    for (let i = 0; i <= a.length; i++) {
        matrix[i] = [i]
    }
    
    for (let j = 0; j <= b.length; j++) {
        matrix[0][j] = j
    }
    
    // Fill matrix
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,      // deletion
                matrix[i][j - 1] + 1,      // insertion
                matrix[i - 1][j - 1] + cost // substitution
            )
        }
    }
    
    // Calculate similarity as 1 - (distance / max length)
    const distance = matrix[a.length][b.length]
    const maxLength = Math.max(a.length, b.length)
    return 1 - distance / maxLength
}

// Threshold for considering lines similar enough to be a modification
// rather than a complete deletion and addition
const LINE_SIMILARITY_THRESHOLD = 0.5

/**
 * Compute the number of line additions and deletions between two text contents
 * This improved version accounts for character-level changes by:
 * 1. Detecting line modifications (similar lines) to avoid double-counting
 * 2. Using a more accurate diff algorithm to track real additions and deletions
 */
export function getDiffChanges(originalContent: string, newContent: string): DiffChanges {
    // Split content into lines and handle empty content
    const originalLines = originalContent ? originalContent.split("\n") : []
    const newLines = newContent ? newContent.split("\n") : []
    
    // Count actual line changes
    let additions = 0
    let deletions = 0
    
    // Use a modified LCS-based diff approach with similarity detection
    let i = 0, j = 0
    
    while (i < originalLines.length || j < newLines.length) {
        // If we've reached the end of either array, the remaining lines in the other are all changes
        if (i >= originalLines.length) {
            additions += newLines.length - j
            break
        }
        if (j >= newLines.length) {
            deletions += originalLines.length - i
            break
        }
        
        // If lines are exactly the same, move to next line in both arrays
        if (originalLines[i] === newLines[j]) {
            i++
            j++
        } else {
            // Check if lines are similar enough to be considered a modification
            // rather than a complete deletion and addition
            const similarity = calculateSimilarity(originalLines[i], newLines[j])
            
            if (similarity >= LINE_SIMILARITY_THRESHOLD) {
                // Lines are similar but not identical - consider it a modification
                // A modification is counted as both an addition and a deletion but with 
                // a weight based on how different the lines are
                const changeWeight = Math.max(0.3, 1 - similarity) 
                
                // Only count significant changes
                if (changeWeight > 0.1) {
                    // For moderate to high similarity, only count as 0.5 lines changed
                    // This prevents minor character changes from counting as full line changes
                    if (similarity > 0.7) {
                        // Minor change - don't count it at all for very similar lines
                        if (similarity > 0.9) {
                            // Don't count very minor changes (like single character edits)
                        } else {
                            // Count as a fraction of a line for moderately similar lines
                            additions += 0.25
                            deletions += 0.25
                        }
                    } else {
                        // Significant changes - count as one full line change
                        additions += 0.5
                        deletions += 0.5
                    }
                }
                
                // Move to next line in both arrays
                i++
                j++
            } else {
                // Try to find the current original line in the remaining new lines
                const nextMatchInNew = newLines.indexOf(originalLines[i], j)
                // Try to find the current new line in the remaining original lines
                const nextMatchInOriginal = originalLines.indexOf(newLines[j], i)
                
                // Choose the closest match to minimize changes
                if (nextMatchInNew !== -1 && (nextMatchInOriginal === -1 || nextMatchInNew - j < nextMatchInOriginal - i)) {
                    // Current original line found later in new content, so lines were added
                    additions += nextMatchInNew - j
                    j = nextMatchInNew
                } else if (nextMatchInOriginal !== -1) {
                    // Current new line found later in original content, so lines were deleted
                    deletions += nextMatchInOriginal - i
                    i = nextMatchInOriginal
                } else {
                    // No exact match found - check for similar lines
                    let bestSimilarity = 0
                    let bestNewIndex = -1
                    let bestOriginalIndex = -1
                    
                    // Look ahead to find the most similar lines
                    const lookAheadLimit = 3 // Limit how far we look ahead
                    
                    // Check for similar lines in new content
                    for (let ni = j; ni < j + lookAheadLimit && ni < newLines.length; ni++) {
                        for (let oi = i; oi < i + lookAheadLimit && oi < originalLines.length; oi++) {
                            const sim = calculateSimilarity(originalLines[oi], newLines[ni])
                            if (sim > bestSimilarity && sim >= LINE_SIMILARITY_THRESHOLD) {
                                bestSimilarity = sim
                                bestNewIndex = ni
                                bestOriginalIndex = oi
                            }
                        }
                    }
                    
                    if (bestSimilarity >= LINE_SIMILARITY_THRESHOLD) {
                        // Found similar lines - count lines in between as changes
                        deletions += bestOriginalIndex - i
                        additions += bestNewIndex - j
                        
                        // For similar but not identical lines, add a modification count
        // based on how different they are
        if (originalLines[bestOriginalIndex] !== newLines[bestNewIndex]) {
            // If similarity is very high, don't count minor changes
            if (bestSimilarity < 0.9) {
                // Count as a single change for both addition and deletion
                // but avoid counting it as two full line changes
                additions += 0.5
                                deletions += 0.5
            }
                        }
                        
                        // Move indexes
                        i = bestOriginalIndex + 1
                        j = bestNewIndex + 1
                    } else {
                        // No match or similar line found, count as both addition and deletion
                        additions++
                        deletions++
                        i++
                        j++
                    }
                }
            }
        }
    }
    
    // Round the final counts to avoid fractional line counts
    return { 
        additions: Math.round(additions), 
        deletions: Math.round(deletions) 
    }
}