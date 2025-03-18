import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { vscode } from "../../utils/vscode"
import { Button } from "../ui/button"
import { WebviewMessage } from "../../../../src/shared/WebviewMessage"
import { Tooltip } from "../ui/simple-tooltip"

// Define the structure to match the backend CodeMetrics interface
interface CodeMetrics {
	linesAdded: number
	linesDeleted: number
	filesModified: number
	filesCreated: number
	lastUpdated: number
	// We'll calculate these derived metrics in the component
}

interface MetricsData {
	aiGenerated: CodeMetrics
	manual: CodeMetrics
}

const CodeMetricsPanel: React.FC = () => {
	const { t } = useTranslation("metrics")
	const [metrics, setMetrics] = useState<MetricsData | null>(null)
	const [activeTab, setActiveTab] = useState<"aiGenerated" | "manual" | "comparison">("aiGenerated")
	const [loading, setLoading] = useState<boolean>(true)

	// Fetch metrics from the extension
	const fetchMetrics = () => {
		setLoading(true)
		vscode.postMessage({
			type: "getCodeMetrics",
		} as WebviewMessage)
	}

	// Reset metrics after confirmation
	const resetMetrics = async () => {
		// Instead of using confirm, we'll immediately reset and rely on the UI to confirm
		vscode.postMessage({
			type: "resetCodeMetrics",
		} as WebviewMessage)
		// Fetch updated metrics after reset
		setTimeout(fetchMetrics, 500)
	}

	useEffect(() => {
		// Initial fetch
		fetchMetrics()

		// Listen for metrics data from extension
		const messageHandler = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "codeMetricsData") {
				setMetrics(message.metrics)
				setLoading(false)
			}
		}

		window.addEventListener("message", messageHandler)

		// Set up periodic refresh every 5 minutes
		const interval = setInterval(fetchMetrics, 60 * 1000) // Changed to 1 minute for more frequent updates

		return () => {
			window.removeEventListener("message", messageHandler)
			clearInterval(interval)
		}
	}, [])

	// Format last updated date
	const formatDate = (timestamp: number) => {
		if (!timestamp) return "Never"
		return new Date(timestamp).toLocaleString()
	}

	if (loading) {
		return (
			<div className="p-4 flex items-center justify-center">
				<div className="animate-pulse">{t("loading")}</div>
			</div>
		)
	}

	if (!metrics) {
		return (
			<div className="p-4">
				<div className="text-vscode-errorForeground">{t("error")}</div>
				<Button onClick={fetchMetrics} className="mt-2">
					{t("retry")}
				</Button>
			</div>
		)
	}

	return (
		<div className="p-4 text-vscode-foreground">
			{/* Header with title and reset button */}
			<div className="flex justify-between items-center mb-6">
				<h2 className="text-xl font-semibold text-vscode-foreground">{t("title")}</h2>
				<div className="flex space-x-2">
					<Tooltip content={t("refresh")}>
						<Button
							variant="outline"
							size="sm"
							onClick={fetchMetrics}
							className="hover:bg-vscode-button-secondaryBackground transition-colors">
							{t("refresh")}
						</Button>
					</Tooltip>
					<Tooltip content={t("resetConfirmation")}>
						<Button
							variant="outline"
							size="sm"
							onClick={resetMetrics}
							className="hover:bg-vscode-button-secondaryBackground transition-colors">
							{t("reset")}
						</Button>
					</Tooltip>
				</div>
			</div>

			{/* Improved tab navigation */}
			<div className="mb-8 flex border-b border-vscode-panel-border">
				<button
					className={`px-4 py-2 font-medium transition-colors ${activeTab === "aiGenerated" ? "border-b-2 border-vscode-charts-green text-vscode-foreground" : "text-vscode-descriptionForeground hover:text-vscode-foreground"}`}
					onClick={() => setActiveTab("aiGenerated")}>
					{t("aiGenerated")}
				</button>
				<button
					className={`px-4 py-2 font-medium transition-colors ${activeTab === "manual" ? "border-b-2 border-vscode-charts-blue text-vscode-foreground" : "text-vscode-descriptionForeground hover:text-vscode-foreground"}`}
					onClick={() => setActiveTab("manual")}>
					{t("manual")}
				</button>
				<button
					className={`px-4 py-2 font-medium transition-colors ${activeTab === "comparison" ? "border-b-2 border-vscode-charts-yellow text-vscode-foreground" : "text-vscode-descriptionForeground hover:text-vscode-foreground"}`}
					onClick={() => setActiveTab("comparison")}>
					{t("comparison")}
				</button>
				<div className="flex-grow border-b border-vscode-panel-border"></div>
			</div>

			{activeTab === "aiGenerated" && <MetricsCard metrics={metrics.aiGenerated} title={t("aiGenerated")} />}

			{activeTab === "manual" && <MetricsCard metrics={metrics.manual} title={t("manual")} />}

			{activeTab === "comparison" && (
				<ComparisonView aiMetrics={metrics.aiGenerated} manualMetrics={metrics.manual} />
			)}

			<div className="text-xs text-vscode-descriptionForeground mt-8">
				{t("lastUpdated")}: {formatDate(Math.max(metrics.aiGenerated.lastUpdated, metrics.manual.lastUpdated))}
			</div>
		</div>
	)
}

const MetricsCard: React.FC<{ metrics: CodeMetrics; title: string }> = ({ metrics, title }) => {
	const { t } = useTranslation("metrics")

	// Calculate productivity metrics
	const totalLineChanges = metrics.linesAdded + metrics.linesDeleted
	const totalFileChanges = metrics.filesModified + metrics.filesCreated
	const netLineChanges = metrics.linesAdded - metrics.linesDeleted

	return (
		<div className="rounded-lg bg-vscode-editorWidget-background">
			<h3 className="text-lg font-medium mb-6 text-vscode-foreground">{title}</h3>

			{/* Primary metrics - Lines Added/Deleted */}
			<div className="grid grid-cols-2 gap-8 mb-8">
				<div>
					<div className="text-vscode-descriptionForeground text-sm mb-2">{t("linesAdded")}</div>
					<div className="text-4xl font-bold flex items-baseline">
						{metrics.linesAdded.toLocaleString()}
						<span className="text-sm ml-1 text-vscode-charts-green">+</span>
					</div>
				</div>
				<div>
					<div className="text-vscode-descriptionForeground text-sm mb-2">{t("linesDeleted")}</div>
					<div className="text-4xl font-bold flex items-baseline">
						{metrics.linesDeleted.toLocaleString()}
						<span className="text-sm ml-1 text-vscode-errorForeground">−</span>
					</div>
				</div>
			</div>

			{/* Secondary metrics - Files Modified/Created */}
			<div className="grid grid-cols-2 gap-8 mb-8">
				<div>
					<div className="text-vscode-descriptionForeground text-sm mb-2">{t("filesModified")}</div>
					<div className="text-3xl font-semibold">{metrics.filesModified.toLocaleString()}</div>
				</div>
				<div>
					<div className="text-vscode-descriptionForeground text-sm mb-2">{t("filesCreated")}</div>
					<div className="text-3xl font-semibold">{metrics.filesCreated.toLocaleString()}</div>
				</div>
			</div>

			{/* Summary metrics - Totals and Net Changes */}
			<div className="grid grid-cols-2 gap-8 mb-4">
				<div>
					<div className="text-vscode-descriptionForeground text-sm mb-2">{t("totalLineChanges")}</div>
					<div className="text-2xl font-medium">{totalLineChanges.toLocaleString()}</div>
				</div>
				<div>
					<div className="text-vscode-descriptionForeground text-sm mb-2">{t("totalFileChanges")}</div>
					<div className="text-2xl font-medium">{totalFileChanges.toLocaleString()}</div>
				</div>
			</div>

			{/* Productivity indicator - Net line changes */}
			<div className="mt-8 pt-6 border-t border-vscode-panel-border">
				<div className="flex items-baseline">
					<div className="text-sm font-medium mr-2">Net Code Growth:</div>
					<div
						className={`text-2xl font-bold ${netLineChanges >= 0 ? "text-vscode-charts-green" : "text-vscode-errorForeground"}`}>
						{netLineChanges >= 0 ? "+" : ""}
						{netLineChanges.toLocaleString()} lines
					</div>
				</div>
				<div className="text-xs text-vscode-descriptionForeground mt-1">
					Measures the overall code growth after accounting for deletions
				</div>
			</div>
		</div>
	)
}

const ComparisonView: React.FC<{
	aiMetrics: CodeMetrics
	manualMetrics: CodeMetrics
}> = ({ aiMetrics, manualMetrics }) => {
	const { t } = useTranslation("metrics")

	// Calculate percentages
	const aiTotalLines = aiMetrics.linesAdded + aiMetrics.linesDeleted
	const manualTotalLines = manualMetrics.linesAdded + manualMetrics.linesDeleted
	const totalLines = aiTotalLines + manualTotalLines
	const aiLinesPercentage = totalLines ? Math.round((aiTotalLines / totalLines) * 100) : 0
	const manualLinesPercentage = 100 - aiLinesPercentage

	const aiTotalFiles = aiMetrics.filesCreated + aiMetrics.filesModified
	const manualTotalFiles = manualMetrics.filesCreated + manualMetrics.filesModified
	const totalFiles = aiTotalFiles + manualTotalFiles
	const aiFilesPercentage = totalFiles ? Math.round((aiTotalFiles / totalFiles) * 100) : 0
	const manualFilesPercentage = 100 - aiFilesPercentage

	return (
		<div className="rounded-lg bg-vscode-editorWidget-background">
			<h3 className="text-lg font-medium mb-6 text-vscode-foreground">{t("comparison")}</h3>

			{/* Productivity boost metrics */}
			<div className="mb-8">
				<div className="text-sm font-medium mb-2">Productivity Boost</div>
				<div className="flex items-baseline">
					<div className="text-4xl font-bold text-vscode-charts-green">
						{aiTotalLines > 0 && manualTotalLines > 0
							? Math.round((aiTotalLines / manualTotalLines) * 100) / 100
							: 0}
						x
					</div>
					<div className="ml-2 text-sm text-vscode-descriptionForeground">
						AI-generated code relative to manual effort
					</div>
				</div>
			</div>

			{/* Line changes distribution with improved visualization */}
			<div className="mb-8">
				<div className="text-sm font-medium mb-3">{t("lineChangesDistribution")}</div>
				<div className="w-full bg-vscode-disabledForeground bg-opacity-10 rounded-full h-8 overflow-hidden flex">
					<Tooltip content={`${aiLinesPercentage}% ${t("aiGenerated")}`}>
						<div
							className="bg-vscode-charts-green h-full transition-all duration-500 ease-in-out flex items-center justify-center text-sm font-medium text-white"
							style={{ width: `${aiLinesPercentage}%` }}>
							{aiLinesPercentage > 15 ? `${aiLinesPercentage}%` : ""}
						</div>
					</Tooltip>
					<Tooltip content={`${manualLinesPercentage}% ${t("manual")}`}>
						<div
							className="bg-vscode-charts-blue h-full transition-all duration-500 ease-in-out flex items-center justify-center text-sm font-medium text-white"
							style={{ width: `${manualLinesPercentage}%` }}>
							{manualLinesPercentage > 15 ? `${manualLinesPercentage}%` : ""}
						</div>
					</Tooltip>
				</div>
				<div className="flex justify-between text-sm mt-3">
					<div className="flex items-center">
						<div className="w-4 h-4 rounded-full bg-vscode-charts-green mr-2"></div>
						<span className="font-medium">{aiLinesPercentage}%</span>{" "}
						<span className="ml-1">{t("aiGenerated")}</span>
					</div>
					<div className="flex items-center">
						<div className="w-4 h-4 rounded-full bg-vscode-charts-blue mr-2"></div>
						<span className="font-medium">{manualLinesPercentage}%</span>{" "}
						<span className="ml-1">{t("manual")}</span>
					</div>
				</div>
				<div className="text-xs text-vscode-descriptionForeground mt-2">
					Shows the proportion of code changes made by AI vs. manual coding
				</div>
			</div>

			{/* File changes distribution with improved visualization */}
			<div className="mb-8">
				<div className="text-sm font-medium mb-3">{t("fileChangesDistribution")}</div>
				<div className="w-full bg-vscode-disabledForeground bg-opacity-10 rounded-full h-8 overflow-hidden flex">
					<Tooltip content={`${aiFilesPercentage}% ${t("aiGenerated")}`}>
						<div
							className="bg-vscode-charts-green h-full transition-all duration-500 ease-in-out flex items-center justify-center text-sm font-medium text-white"
							style={{ width: `${aiFilesPercentage}%` }}>
							{aiFilesPercentage > 15 ? `${aiFilesPercentage}%` : ""}
						</div>
					</Tooltip>
					<Tooltip content={`${manualFilesPercentage}% ${t("manual")}`}>
						<div
							className="bg-vscode-charts-blue h-full transition-all duration-500 ease-in-out flex items-center justify-center text-sm font-medium text-white"
							style={{ width: `${manualFilesPercentage}%` }}>
							{manualFilesPercentage > 15 ? `${manualFilesPercentage}%` : ""}
						</div>
					</Tooltip>
				</div>
				<div className="flex justify-between text-sm mt-3">
					<div className="flex items-center">
						<div className="w-4 h-4 rounded-full bg-vscode-charts-green mr-2"></div>
						<span className="font-medium">{aiFilesPercentage}%</span>{" "}
						<span className="ml-1">{t("aiGenerated")}</span>
					</div>
					<div className="flex items-center">
						<div className="w-4 h-4 rounded-full bg-vscode-charts-blue mr-2"></div>
						<span className="font-medium">{manualFilesPercentage}%</span>{" "}
						<span className="ml-1">{t("manual")}</span>
					</div>
				</div>
				<div className="text-xs text-vscode-descriptionForeground mt-2">
					Shows the proportion of files affected by AI vs. manual changes
				</div>
			</div>

			{/* Side-by-side comparison of metrics */}
			<div className="grid grid-cols-2 gap-8 mt-8 pt-6 border-t border-vscode-panel-border">
				<div>
					<h4 className="text-sm font-medium flex items-center mb-4">
						<div className="w-4 h-4 rounded-full bg-vscode-charts-green mr-2"></div>
						{t("aiGenerated")}
					</h4>
					<div className="text-sm text-vscode-descriptionForeground mb-2">{t("totalLineChanges")}</div>
					<div className="text-3xl font-bold mb-4">{aiTotalLines.toLocaleString()}</div>
					<div className="text-sm text-vscode-descriptionForeground mb-2">{t("totalFileChanges")}</div>
					<div className="text-3xl font-bold">{aiTotalFiles.toLocaleString()}</div>
				</div>
				<div>
					<h4 className="text-sm font-medium flex items-center mb-4">
						<div className="w-4 h-4 rounded-full bg-vscode-charts-blue mr-2"></div>
						{t("manual")}
					</h4>
					<div className="text-sm text-vscode-descriptionForeground mb-2">{t("totalLineChanges")}</div>
					<div className="text-3xl font-bold mb-4">{manualTotalLines.toLocaleString()}</div>
					<div className="text-sm text-vscode-descriptionForeground mb-2">{t("totalFileChanges")}</div>
					<div className="text-3xl font-bold">{manualTotalFiles.toLocaleString()}</div>
				</div>
			</div>
		</div>
	)
}

export default CodeMetricsPanel
