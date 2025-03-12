// npx jest src/services/code-indexer/__tests__/chunker.test.ts

import path from "path"

import { getChunks, getChunksBatch, MAX_CHUNK_SIZE } from "../chunker"

jest.mock("../../utils/logging", () => ({ logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() } }))

describe("chunker", () => {
	describe("getChunks", () => {
		it("should chunk TypeScript code correctly", async () => {
			const filepath = path.join(__dirname, "..", "__fixtures__", "test.ts")
			const chunks = await getChunks(filepath)

			expect(chunks.length).toBeGreaterThan(0)
			expect(chunks.some(({ type }) => type === "class_declaration")).toBe(true)
			expect(chunks.some(({ type }) => type === "method_definition")).toBe(true)
			expect(chunks.some(({ type }) => type === "function_declaration")).toBe(true)
			expect(chunks.some(({ type }) => type === "arrow_function")).toBe(true)

			chunks.forEach((chunk) => {
				expect(chunk.chunk).toBeTruthy()
				expect(chunk.start).toBeDefined()
				expect(chunk.end).toBeDefined()
				expect(chunk.filepath).toBe(filepath)
			})
		})

		it("should chunk Python code correctly", async () => {
			const filepath = path.join(__dirname, "..", "__fixtures__", "test.py")
			const chunks = await getChunks(filepath)

			expect(chunks.length).toBeGreaterThan(0)
			expect(chunks.some(({ type }) => type === "class_definition")).toBe(true)
			expect(chunks.some(({ type }) => type === "function_definition")).toBe(true)

			chunks.forEach((chunk) => {
				expect(chunk.chunk).toBeTruthy()
				expect(chunk.start).toBeDefined()
				expect(chunk.end).toBeDefined()
				expect(chunk.filepath).toBe(filepath)
			})
		})
	})

	describe("getChunksBatch", () => {
		it("should process multiple files correctly", async () => {
			const filepaths = [
				path.join(__dirname, "..", "__fixtures__", "test.ts"),
				path.join(__dirname, "..", "__fixtures__", "test.py"),
			]

			const progressCallback = jest.fn()
			const result = await getChunksBatch(filepaths, progressCallback)

			// Should have successfully processed both files
			expect(result.chunks.length).toBeGreaterThan(0)
			expect(Object.keys(result.errors).length).toBe(0)

			// Progress callback should have been called twice (once for each file)
			expect(progressCallback).toHaveBeenCalledTimes(2)

			// Verify we have chunks from both files
			const tsChunks = result.chunks.filter((c) => c.filepath.endsWith("test.ts"))
			const pyChunks = result.chunks.filter((c) => c.filepath.endsWith("test.py"))

			expect(tsChunks.length).toBeGreaterThan(0)
			expect(pyChunks.length).toBeGreaterThan(0)
		})

		it("should handle errors for non-existent files", async () => {
			const filepaths = [
				path.join(__dirname, "..", "__fixtures__", "test.ts"),
				path.join(__dirname, "..", "__fixtures__", "non-existent.ts"),
			]

			const result = await getChunksBatch(filepaths)

			// Should have successfully processed one file
			expect(result.chunks.length).toBeGreaterThan(0)

			// Should have one error
			expect(Object.keys(result.errors).length).toBe(1)
			expect(result.errors[filepaths[1]]).toBeDefined()
			expect(result.errors[filepaths[1]]).toContain("not accessible")
		})

		it("should track progress correctly", async () => {
			const filepaths = [
				path.join(__dirname, "..", "__fixtures__", "test.ts"),
				path.join(__dirname, "..", "__fixtures__", "test.py"),
			]

			const progressCallback = jest.fn()
			await getChunksBatch(filepaths, progressCallback)

			// First call: 1 processed, 2 total
			expect(progressCallback).toHaveBeenNthCalledWith(1, 1, 2, expect.any(String))

			// Second call: 2 processed, 2 total
			expect(progressCallback).toHaveBeenNthCalledWith(2, 2, 2, expect.any(String))
		})
	})

	describe("MAX_CHUNK_SIZE", () => {
		it("should be defined with a reasonable value", () => {
			expect(MAX_CHUNK_SIZE).toBeGreaterThan(1000) // At least 1KB
			expect(MAX_CHUNK_SIZE).toBeLessThan(1000000) // Less than 1MB
		})
	})
})
