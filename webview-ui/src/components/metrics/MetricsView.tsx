import React, { useEffect } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { formatLargeNumber } from "@/utils/format"
import { vscode } from "../../utils/vscode"

interface MetricsViewProps {
	onClose: () => void
}

const MetricsView: React.FC<MetricsViewProps> = ({ onClose }) => {
	const { usageMetrics } = useExtensionState()

	// Output structured logging information about metrics state
	// TODO: Replace with proper OutputChannel logging when a message type is available
	useEffect(() => {
		if (usageMetrics) {
			console.log("[MetricsView] Rendering metrics:", {
				type: typeof usageMetrics,
				keys: usageMetrics ? Object.keys(usageMetrics) : "no metrics",
				isEmpty: !usageMetrics || !Object.keys(usageMetrics).length,
			})
		}
	}, [usageMetrics])

	// Fixed condition: Only check if usageMetrics exists, not if it has keys
	// This fixes the bug where metrics weren't displaying even though they existed
	if (!usageMetrics) {
		return (
			<div className="flex flex-col items-center justify-center h-full">
				<p>No metrics data availab le.</p>
				<VSCodeButton onClick={onClose} style={{ marginTop: "20px" }}>
					Close
				</VSCodeButton>
			</div>
		)
	}

	const calculatePercentage = (value: number, max: number): number => {
		return Math.min(100, Math.max(0, (value / max) * 100))
	}

	// Helper to render a metric bar
	const renderMetricBar = (value: number, label: string, max: number = 100, icon?: string) => {
		const percentage = calculatePercentage(value, max)

		return (
			<div className="mb-4">
				<div className="flex justify-between mb-1">
					<span className="text-sm font-medium">
						{icon && <span className={`codicon codicon-${icon} mr-1 text-xs`}></span>}
						{label}
					</span>
					<span className="text-sm">{formatLargeNumber(value)}</span>
				</div>
				<div className="h-1 bg-vscode-button-background opacity-20 rounded">
					<div
						className="h-1 bg-vscode-button-background rounded transition-all duration-300"
						style={{ width: `${percentage}%` }}
					/>
				</div>
			</div>
		)
	}

	return (
		<div className="p-6 h-full overflow-auto">
			<div className="flex items-center justify-between mb-8">
				<div className="flex items-center">
					<span className="codicon codicon-graph mr-2 text-lg text-vscode-descriptionForeground"></span>
					<h1 className="text-xl font-bold">Usage Metrics</h1>
				</div>
				<VSCodeButton appearance="icon" onClick={onClose} title="Return to Chat">
					<span className="codicon codicon-close"></span>
				</VSCodeButton>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
				<section>
					<h2 className="text-lg font-semibold mb-4">Summary</h2>
					{renderMetricBar(
						usageMetrics.linesOfCodeGenerated,
						"Lines of Code Generated",
						1000,
						"symbol-property",
					)}
					{renderMetricBar(usageMetrics.filesCreated, "Files Created", 100, "file-add")}
					{renderMetricBar(usageMetrics.filesModified, "Files Modified", 100, "edit")}
					{renderMetricBar(usageMetrics.tasksCompleted, "Tasks Completed", 50, "check-all")}
				</section>

				<section>
					<h2 className="text-lg font-semibold mb-4">API Usage</h2>
					{renderMetricBar(usageMetrics.apiCallsMade, "API Calls Made", 500, "server")}
					{renderMetricBar(usageMetrics.browserSessionsLaunched, "Browser Sessions Launched", 50, "browser")}
					{renderMetricBar(
						usageMetrics.activeUsageTimeMs / 60000,
						"Active Usage Time (minutes)",
						240,
						"clock",
					)}
				</section>
			</div>

			<section className="mb-8">
				<h2 className="text-lg font-semibold mb-4">Language Usage</h2>
				<div className="bg-vscode-editorWidget-background p-4 rounded mb-4">
					{Object.keys(usageMetrics.languageUsage || {}).length > 0 ? (
						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
							{Object.entries(usageMetrics.languageUsage || {}).map(([language, lines]) => (
								<div
									key={language}
									className="bg-vscode-editor-background p-3 rounded border border-vscode-panel-border">
									<div className="font-medium mb-1">{language}</div>
									<div className="text-sm text-vscode-descriptionForeground">
										{formatLargeNumber(lines)} lines
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="text-center py-3 text-vscode-descriptionForeground">
							No language usage data yet
						</div>
					)}
				</div>
			</section>

			<section className="mb-8">
				<h2 className="text-lg font-semibold mb-4">Tool Usage</h2>
				<div className="bg-vscode-editorWidget-background p-4 rounded mb-4">
					{Object.keys(usageMetrics.toolUsage || {}).length > 0 ? (
						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
							{Object.entries(usageMetrics.toolUsage || {}).map(([tool, count]) => (
								<div
									key={tool}
									className="bg-vscode-editor-background p-3 rounded border border-vscode-panel-border">
									<div className="font-medium mb-1">{tool}</div>
									<div className="text-sm text-vscode-descriptionForeground">
										{formatLargeNumber(count)} uses
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="text-center py-3 text-vscode-descriptionForeground">No tool usage data yet</div>
					)}
				</div>
			</section>

			<section className="mb-8">
				<h2 className="text-lg font-semibold mb-4">API Cost</h2>
				<div className="bg-vscode-editorWidget-background p-4 rounded mb-4">
					<div className="flex justify-between mb-3">
						<span className="flex items-center">
							<span className="codicon codicon-account mr-1"></span>
							Total API Cost
						</span>
						<span className="font-medium text-vscode-button-foreground">
							${usageMetrics.totalApiCost?.toFixed(4) || "0.0000"}
						</span>
					</div>
					<div className="h-px bg-vscode-descriptionForeground opacity-20 my-3" />
					<div className="text-sm text-vscode-descriptionForeground mb-2">Cost by Provider</div>
					{Object.keys(usageMetrics.costByProvider || {}).length > 0 ? (
						Object.entries(usageMetrics.costByProvider || {}).map(([provider, cost]) => (
							<div
								key={provider}
								className="flex justify-between mb-1 pb-1 border-b border-vscode-panel-border border-opacity-20">
								<span className="text-sm">{provider}</span>
								<span className="text-sm">${cost.toFixed(4)}</span>
							</div>
						))
					) : (
						<div className="text-center py-2 text-sm text-vscode-descriptionForeground">
							No cost data yet
						</div>
					)}
				</div>
			</section>

			<div className="flex justify-center">
				<VSCodeButton
					appearance="secondary"
					onClick={() => vscode.postMessage({ type: "resetUsageMetrics" })}
					className="px-4">
					<span className="codicon codicon-debug-restart mr-2"></span>
					Reset Metrics
				</VSCodeButton>
			</div>
		</div>
	)
}

export default MetricsView
