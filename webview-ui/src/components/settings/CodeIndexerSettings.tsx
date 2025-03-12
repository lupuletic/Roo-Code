import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import { Dropdown } from "vscrui"
import type { DropdownOption } from "vscrui"
import { vscode } from "../../utils/vscode"

// Available embedding models
const EMBEDDING_MODELS = [
	{ value: "text-embedding-ada-002", label: "OpenAI Ada 002" },
	{ value: "text-embedding-3-small", label: "OpenAI Embedding 3 Small" },
	{ value: "text-embedding-3-large", label: "OpenAI Embedding 3 Large" },
]

type CodeIndexerSettingsProps = {
	codeIndexerEnabled: boolean
	setCodeIndexerEnabled: (value: boolean) => void
	embeddingModel: string
	setEmbeddingModel: (value: string) => void
	autoIndexOnWorkspaceOpen: boolean
	setAutoIndexOnWorkspaceOpen: (value: boolean) => void
	watchForFileChanges: boolean
	setWatchForFileChanges: (value: boolean) => void
	excludePatterns: string[]
	setExcludePatterns: (value: string[]) => void
	maxFileSizeBytes: number
	setMaxFileSizeBytes: (value: number) => void
}

const CodeIndexerSettings = ({
	codeIndexerEnabled,
	setCodeIndexerEnabled,
	embeddingModel,
	setEmbeddingModel,
	autoIndexOnWorkspaceOpen,
	setAutoIndexOnWorkspaceOpen,
	watchForFileChanges,
	setWatchForFileChanges,
	excludePatterns,
	setExcludePatterns,
	maxFileSizeBytes,
	setMaxFileSizeBytes,
}: CodeIndexerSettingsProps) => {
	const [patternInput, setPatternInput] = useState("")

	const handleAddPattern = () => {
		if (patternInput && !excludePatterns.includes(patternInput)) {
			const newPatterns = [...excludePatterns, patternInput]
			setExcludePatterns(newPatterns)
			setPatternInput("")
			vscode.postMessage({
				type: "codeIndexerExcludePatterns",
				values: newPatterns,
			})
		}
	}

	const handleTriggerIndexing = () => {
		vscode.postMessage({ type: "triggerCodeIndexing" })
	}

	const handleViewIndexStatus = () => {
		vscode.postMessage({ type: "getIndexingStatus" })
	}

	const handleClearIndex = () => {
		vscode.postMessage({ type: "clearCodeIndex" })
	}

	const handleRebuildIndex = () => {
		vscode.postMessage({ type: "rebuildCodeIndex" })
	}

	const handlePauseIndexing = () => {
		vscode.postMessage({ type: "pauseCodeIndexing" })
	}

	const handleResumeIndexing = () => {
		vscode.postMessage({ type: "resumeCodeIndexing" })
	}

	return (
		<div style={{ marginBottom: 40 }}>
			<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 15px 0" }}>Code Indexer Settings</h3>
			<p style={{ fontSize: "12px", marginBottom: 15, color: "var(--vscode-descriptionForeground)" }}>
				The code indexer creates embeddings of your codebase to provide more relevant context for AI responses.
			</p>

			<div style={{ marginBottom: 15 }}>
				<VSCodeCheckbox
					checked={codeIndexerEnabled}
					onChange={(e: any) => setCodeIndexerEnabled(e.target.checked)}>
					<span style={{ fontWeight: "500" }}>Enable code indexing</span>
				</VSCodeCheckbox>
				<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
					When enabled, Roo will index your codebase to provide better contextual suggestions.
				</p>
			</div>

			{codeIndexerEnabled && (
				<>
					<div style={{ marginBottom: 15 }}>
						<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>Embedding Model</label>
						<div className="dropdown-container">
							<Dropdown
								value={embeddingModel}
								onChange={(value: unknown) => {
									setEmbeddingModel((value as DropdownOption).value)
								}}
								style={{ width: "100%" }}
								options={EMBEDDING_MODELS}
							/>
						</div>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Choose the embedding model to use for indexing your code. More advanced models may provide
							better results but consume more tokens.
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={autoIndexOnWorkspaceOpen}
							onChange={(e: any) => setAutoIndexOnWorkspaceOpen(e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Auto-index on workspace open</span>
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Automatically start indexing when you open a workspace.
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<VSCodeCheckbox
							checked={watchForFileChanges}
							onChange={(e: any) => setWatchForFileChanges(e.target.checked)}>
							<span style={{ fontWeight: "500" }}>Watch for file changes</span>
						</VSCodeCheckbox>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Automatically update the index when files change.
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
							Max File Size (bytes)
						</label>
						<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
							<input
								type="range"
								min="10000"
								max="10000000"
								step="10000"
								value={maxFileSizeBytes}
								onChange={(e) => setMaxFileSizeBytes(parseInt(e.target.value))}
								style={{
									flexGrow: 1,
									accentColor: "var(--vscode-button-background)",
									height: "2px",
								}}
							/>
							<span style={{ minWidth: "80px", textAlign: "left" }}>
								{(maxFileSizeBytes / 1024).toFixed(0)} KB
							</span>
						</div>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Maximum size of files to index. Larger files will be skipped.
						</p>
					</div>

					<div style={{ marginBottom: 15 }}>
						<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>Exclude Patterns</label>
						<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
							Glob patterns for files to exclude from indexing.
						</p>

						<div style={{ display: "flex", gap: "5px", marginTop: "10px" }}>
							<VSCodeTextField
								value={patternInput}
								onInput={(e: any) => setPatternInput(e.target.value)}
								onKeyDown={(e: any) => {
									if (e.key === "Enter") {
										e.preventDefault()
										handleAddPattern()
									}
								}}
								placeholder="Enter glob pattern (e.g., '**/*.min.js')"
								style={{ flexGrow: 1 }}
							/>
							<VSCodeButton onClick={handleAddPattern}>Add</VSCodeButton>
						</div>

						<div
							style={{
								marginTop: "10px",
								display: "flex",
								flexWrap: "wrap",
								gap: "5px",
							}}>
							{(excludePatterns ?? []).map((pattern, index) => (
								<div
									key={index}
									style={{
										display: "flex",
										alignItems: "center",
										gap: "5px",
										backgroundColor: "var(--vscode-button-secondaryBackground)",
										padding: "2px 6px",
										borderRadius: "4px",
										border: "1px solid var(--vscode-button-secondaryBorder)",
										height: "24px",
									}}>
									<span>{pattern}</span>
									<VSCodeButton
										appearance="icon"
										style={{
											padding: 0,
											margin: 0,
											height: "20px",
											width: "20px",
											minWidth: "20px",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											color: "var(--vscode-button-foreground)",
										}}
										onClick={() => {
											const newPatterns = (excludePatterns ?? []).filter((_, i) => i !== index)
											setExcludePatterns(newPatterns)
											vscode.postMessage({
												type: "codeIndexerExcludePatterns",
												values: newPatterns,
											})
										}}>
										<span className="codicon codicon-close" />
									</VSCodeButton>
								</div>
							))}
						</div>
					</div>

					<div style={{ marginBottom: 15 }}>
						<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>Index Management</label>
						<div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "10px" }}>
							<VSCodeButton onClick={handleTriggerIndexing}>Start Indexing</VSCodeButton>
							<VSCodeButton onClick={handleViewIndexStatus}>View Status</VSCodeButton>
							<VSCodeButton onClick={handleClearIndex}>Clear Index</VSCodeButton>
							<VSCodeButton onClick={handleRebuildIndex}>Rebuild Index</VSCodeButton>
							<VSCodeButton onClick={handlePauseIndexing}>Pause</VSCodeButton>
							<VSCodeButton onClick={handleResumeIndexing}>Resume</VSCodeButton>
						</div>
					</div>
				</>
			)}
		</div>
	)
}

export default memo(CodeIndexerSettings)
