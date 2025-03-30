import { getDiffChanges } from "../DiffCalculator"

describe("DiffCalculator", () => {
    describe("getDiffChanges", () => {
        it("should correctly count simple additions", () => {
            const original = "line 1\nline 2"
            const modified = "line 1\nline 2\nline 3\nline 4"
            
            const result = getDiffChanges(original, modified)
            
            expect(result.additions).toBe(2)
            expect(result.deletions).toBe(0)
        })
        
        it("should correctly count simple deletions", () => {
            const original = "line 1\nline 2\nline 3\nline 4"
            const modified = "line 1\nline 4"
            
            const result = getDiffChanges(original, modified)
            
            expect(result.additions).toBe(0)
            expect(result.deletions).toBe(2)
        })
        
        it("should handle empty original content", () => {
            const original = ""
            const modified = "line 1\nline 2\nline 3"
            
            const result = getDiffChanges(original, modified)
            
            expect(result.additions).toBe(3)
            expect(result.deletions).toBe(0)
        })
        
        it("should handle empty modified content", () => {
            const original = "line 1\nline 2\nline 3"
            const modified = ""
            
            const result = getDiffChanges(original, modified)
            
            expect(result.additions).toBe(0)
            expect(result.deletions).toBe(3)
        })
        
        it("should correctly identify modified lines with similar content", () => {
            const original = "function calculateTotal(items) {\n  let total = 0;\n  for (const item of items) {\n    total += item.price;\n  }\n  return total;\n}"
            const modified = "function calculateTotal(items) {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price;\n  }\n  return sum;\n}"
            
            // The only changes are "total" to "sum" twice which are similar enough
            // to be detected as modifications, not complete rewrites
            const result = getDiffChanges(original, modified)
            
            // Should detect these as minor changes, not full line additions/deletions
            expect(result.additions).toBe(1)
            expect(result.deletions).toBe(1)
        })
        
        it("should correctly handle complex modifications", () => {
            const original = "line 1\nline 2\nline 3\nline 4\nline 5"
            const modified = "line 1\nline 2 modified\nline 3\nnew line\nline 5 changed"
            
            const result = getDiffChanges(original, modified)
            
            // Here we have 2 modified lines and 1 new line
            // Line 2 is modified slightly ("line 2" -> "line 2 modified")
            // Line 4 is completely different ("line 4" -> "new line") 
            // Line 5 is modified ("line 5" -> "line 5 changed")
            expect(result.additions).toBe(3)
            expect(result.deletions).toBe(3)
        })
        
        it("should properly handle single character changes", () => {
            const original = "const value = 5;"
            const modified = "const value = 6;"
            
            const result = getDiffChanges(original, modified)
            
            // This is the key test for our issue - a single character change
            // should NOT count as a full line addition + deletion
            expect(result.additions).toBe(0)
            expect(result.deletions).toBe(0)
        })
    })
})