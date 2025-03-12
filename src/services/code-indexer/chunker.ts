import { readFile } from "fs/promises"
import path from "path"

import { Parser, Language, Node, Tree } from "web-tree-sitter"
import { logger } from "../../utils/logging"

import * as fs from "fs/promises"
import { getUriFileExtension } from "./uri"

export type CodeChunk = {
	chunk: string
	start: number
	end: number
	type: string
	filepath: string
}

// Maximum size in bytes for a single code chunk
export const MAX_CHUNK_SIZE = 8192 // 8KB chunk size limit

const supportedTypes = [
	"function_definition",
	"class_definition",
	"method_definition",
	"function_declaration",
	"class_declaration",
	"method_declaration",
	"arrow_function",
	"export_statement",
]

/**
 * Process a single file and extract code chunks
 * @param filepath Path to the file to chunk
 * @returns Array of code chunks
 */
export async function getChunks(filepath: string): Promise<CodeChunk[]> {
	try {
		const parser = await getParserForFile(filepath)
		const sourceCode = await readFile(filepath, "utf-8")
		const tree = parser.parse(sourceCode)
		const chunks: CodeChunk[] = []

		if (!tree) {
			throw new Error(`Failed to parse file: ${filepath}`)
		}

		extractChunksFromTree(tree, sourceCode, filepath, chunks)

		return chunks
	} catch (error) {
		logger.error(`Error chunking file ${filepath}:`, error)
		throw error
	}
}

/**
 * Process multiple files and extract chunks from each
 * @param filepaths Array of file paths to process
 * @param onProgress Optional callback for progress reporting
 * @returns Object containing successful chunks and errors
 */
export async function getChunksBatch(
	filepaths: string[],
	onProgress?: (processed: number, total: number, file: string) => void,
): Promise<{
	chunks: CodeChunk[]
	errors: Record<string, string>
}> {
	const allChunks: CodeChunk[] = []
	const errors: Record<string, string> = {}
	let processed = 0

	for (const filepath of filepaths) {
		try {
			// Check if file exists and is accessible
			try {
				await fs.access(filepath)
			} catch (error) {
				throw new Error(`File does not exist or is not accessible: ${filepath}`)
			}

			const fileChunks = await getChunks(filepath)
			allChunks.push(...fileChunks)

			if (onProgress) {
				processed++
				onProgress(processed, filepaths.length, filepath)
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			errors[filepath] = errorMessage
			logger.error(`Failed to chunk file ${filepath}:`, error)

			if (onProgress) {
				processed++
				onProgress(processed, filepaths.length, filepath)
			}
		}
	}

	return {
		chunks: allChunks,
		errors,
	}
}

/**
 * Extract chunks from a parsed source tree
 * @param tree The parsed syntax tree
 * @param sourceCode Source code string
 * @param filepath File path for reference
 * @param chunks Array to populate with chunks
 */
function extractChunksFromTree(tree: Tree, sourceCode: string, filepath: string, chunks: CodeChunk[]): void {
	const traverseNode = (node: Node) => {
		try {
			const { type, startIndex, endIndex } = node

			if (supportedTypes.includes(node.type)) {
				const chunkText = sourceCode.slice(startIndex, endIndex)

				// Skip chunks that exceed the maximum size
				if (chunkText.length > MAX_CHUNK_SIZE) {
					logger.warn(`Skipping oversized chunk in ${filepath}: ${type} (${chunkText.length} bytes)`)
				} else {
					chunks.push({
						chunk: chunkText,
						start: startIndex,
						end: endIndex,
						type,
						filepath,
					})
				}
			}

			for (let child of node.children) {
				if (child) traverseNode(child)
			}
		} catch (error) {
			// Log error but continue processing other nodes
			logger.error(`Error processing node in ${filepath}:`, error)
		}
	}

	traverseNode(tree.rootNode)
}

export enum LanguageName {
	CPP = "cpp",
	C_SHARP = "c_sharp",
	C = "c",
	CSS = "css",
	PHP = "php",
	BASH = "bash",
	JSON = "json",
	TYPESCRIPT = "typescript",
	TSX = "tsx",
	ELM = "elm",
	JAVASCRIPT = "javascript",
	PYTHON = "python",
	ELISP = "elisp",
	ELIXIR = "elixir",
	GO = "go",
	EMBEDDED_TEMPLATE = "embedded_template",
	HTML = "html",
	JAVA = "java",
	LUA = "lua",
	OCAML = "ocaml",
	QL = "ql",
	RESCRIPT = "rescript",
	RUBY = "ruby",
	RUST = "rust",
	SYSTEMRDL = "systemrdl",
	TOML = "toml",
	SOLIDITY = "solidity",
}

export const supportedLanguages: { [key: string]: LanguageName } = {
	cpp: LanguageName.CPP,
	hpp: LanguageName.CPP,
	cc: LanguageName.CPP,
	cxx: LanguageName.CPP,
	hxx: LanguageName.CPP,
	cp: LanguageName.CPP,
	hh: LanguageName.CPP,
	inc: LanguageName.CPP,
	cs: LanguageName.C_SHARP,
	c: LanguageName.C,
	h: LanguageName.C,
	css: LanguageName.CSS,
	php: LanguageName.PHP,
	phtml: LanguageName.PHP,
	php3: LanguageName.PHP,
	php4: LanguageName.PHP,
	php5: LanguageName.PHP,
	php7: LanguageName.PHP,
	phps: LanguageName.PHP,
	"php-s": LanguageName.PHP,
	bash: LanguageName.BASH,
	sh: LanguageName.BASH,
	json: LanguageName.JSON,
	ts: LanguageName.TYPESCRIPT,
	mts: LanguageName.TYPESCRIPT,
	cts: LanguageName.TYPESCRIPT,
	tsx: LanguageName.TSX,
	elm: LanguageName.ELM,
	js: LanguageName.JAVASCRIPT,
	jsx: LanguageName.JAVASCRIPT,
	mjs: LanguageName.JAVASCRIPT,
	cjs: LanguageName.JAVASCRIPT,
	py: LanguageName.PYTHON,
	pyw: LanguageName.PYTHON,
	pyi: LanguageName.PYTHON,
	el: LanguageName.ELISP,
	emacs: LanguageName.ELISP,
	ex: LanguageName.ELIXIR,
	exs: LanguageName.ELIXIR,
	go: LanguageName.GO,
	eex: LanguageName.EMBEDDED_TEMPLATE,
	heex: LanguageName.EMBEDDED_TEMPLATE,
	leex: LanguageName.EMBEDDED_TEMPLATE,
	html: LanguageName.HTML,
	htm: LanguageName.HTML,
	java: LanguageName.JAVA,
	lua: LanguageName.LUA,
	ocaml: LanguageName.OCAML,
	ml: LanguageName.OCAML,
	mli: LanguageName.OCAML,
	ql: LanguageName.QL,
	res: LanguageName.RESCRIPT,
	resi: LanguageName.RESCRIPT,
	rb: LanguageName.RUBY,
	erb: LanguageName.RUBY,
	rs: LanguageName.RUST,
	rdl: LanguageName.SYSTEMRDL,
	toml: LanguageName.TOML,
	sol: LanguageName.SOLIDITY,
}

async function getParserForFile(filepath: string) {
	await Parser.init()
	const parser = new Parser()
	const language = await getLanguageForFile(filepath)

	if (!language) {
		throw new Error(`Unsupported language: ${filepath}`)
	}

	parser.setLanguage(language)
	return parser
}

// Loading the wasm files to create a Language object is an expensive operation
// and with sufficient number of files can result in errors, instead keep a map
// of language name to Language object.
const languageMap = new Map<string, Language>()

export async function getLanguageForFile(filepath: string) {
	try {
		await Parser.init()
		const extension = getUriFileExtension(filepath)
		const languageName = supportedLanguages[extension]

		if (!languageName) {
			return undefined
		}

		let language = languageMap.get(languageName)

		if (!language) {
			const wasmPath = path.join(
				process.env.NODE_ENV === "test"
					? path.join(process.cwd(), "node_modules", "tree-sitter-wasms", "out")
					: path.join(__dirname, "tree-sitter-wasms"),
				`tree-sitter-${supportedLanguages[extension]}.wasm`,
			)

			language = await Language.load(wasmPath)
			languageMap.set(languageName, language)
		}

		return language
	} catch (e) {
		console.debug("Unable to load language for file", filepath, e)
		return undefined
	}
}
