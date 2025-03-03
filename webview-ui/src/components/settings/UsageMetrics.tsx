import React from "react"
import { VSCodeCheckbox, VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"
import { UsageMetrics as UsageMetricsType } from "../../../../src/shared/ExtensionMessage"
import {
	formatCost,
	formatUsageTime,
	getMostUsedLanguages,
	getMostUsedTools,
	getAverageCostPerTask,
} from "../../../../src/utils/metrics"

interface UsageMetricsProps {
	usageMetrics: UsageMetricsType
	usageMetricsEnabled: boolean
	setUsageMetricsEnabled: (enabled: boolean) => void
	resetUsageMetrics: () => void
}

export const UsageMetrics: React.FC<UsageMetricsProps> = ({
	usageMetrics,
	usageMetricsEnabled,
	setUsageMetricsEnabled,
	resetUsageMetrics,
}) => {
	const mostUsedTools = getMostUsedTools(usageMetrics, 5)
	const mostUsedLanguages = getMostUsedLanguages(usageMetrics, 5)
	const avgCostPerTask = getAverageCostPerTask(usageMetrics)

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-2">
				<div className="font-medium text-lg">Usage Metrics</div>
				<div className="text-sm text-vscode-descriptionForeground mb-2">
					Track statistics about how you use RooCode. All metrics are stored locally.
				</div>

				<VSCodeCheckbox
					checked={usageMetricsEnabled}
					onChange={(e: any) => setUsageMetricsEnabled(e.target.checked)}>
					<span className="font-medium">Enable usage metrics</span>
				</VSCodeCheckbox>
			</div>

			{usageMetricsEnabled && (
				<>
					<VSCodeDivider />

					{/* Summary Section */}
					<div className="flex flex-col gap-4">
						<div className="font-medium">Summary</div>

						<div className="grid grid-cols-2 gap-x-4 gap-y-3">
							<div className="flex flex-col">
								<div className="text-sm text-vscode-descriptionForeground">Lines of Code Generated</div>
								<div className="font-medium">{usageMetrics.linesOfCodeGenerated.toLocaleString()}</div>
							</div>

							<div className="flex flex-col">
								<div className="text-sm text-vscode-descriptionForeground">Files Created</div>
								<div className="font-medium">{usageMetrics.filesCreated.toLocaleString()}</div>
							</div>

							<div className="flex flex-col">
								<div className="text-sm text-vscode-descriptionForeground">Files Modified</div>
								<div className="font-medium">{usageMetrics.filesModified.toLocaleString()}</div>
							</div>

							<div className="flex flex-col">
								<div className="text-sm text-vscode-descriptionForeground">Tasks Completed</div>
								<div className="font-medium">{usageMetrics.tasksCompleted.toLocaleString()}</div>
							</div>

							<div className="flex flex-col">
								<div className="text-sm text-vscode-descriptionForeground">Total API Cost</div>
								<div className="font-medium">{formatCost(usageMetrics.totalApiCost)}</div>
							</div>

							<div className="flex flex-col">
								<div className="text-sm text-vscode-descriptionForeground">Active Usage Time</div>
								<div className="font-medium">{formatUsageTime(usageMetrics.activeUsageTimeMs)}</div>
							</div>
						</div>
					</div>

					<VSCodeDivider />

					{/* Most Used Tools */}
					<div className="flex flex-col gap-4">
						<div className="font-medium">Most Used Tools</div>

						<div className="flex flex-col gap-2">
							{mostUsedTools.length > 0 ? (
								mostUsedTools.map((tool, index) => (
									<div key={index} className="flex items-center">
										<div className="flex-1">{tool.name}</div>
										<div className="font-medium">{tool.count} uses</div>
									</div>
								))
							) : (
								<div className="text-vscode-descriptionForeground">No tool usage recorded yet</div>
							)}
						</div>
					</div>

					<VSCodeDivider />

					{/* Most Used Languages */}
					<div className="flex flex-col gap-4">
						<div className="font-medium">Most Used Languages</div>

						<div className="flex flex-col gap-2">
							{mostUsedLanguages.length > 0 ? (
								mostUsedLanguages.map((lang, index) => {
									// Calculate percentage for the bar
									const totalLines = Object.values(usageMetrics.languageUsage).reduce(
										(sum, lines) => sum + lines,
										0,
									)
									const percentage = totalLines > 0 ? (lang.lines / totalLines) * 100 : 0

									return (
										<div key={index} className="flex flex-col gap-1">
											<div className="flex justify-between">
												<div>{lang.name}</div>
												<div className="font-medium">{lang.lines} lines</div>
											</div>
											<div className="h-1 bg-vscode-button-background opacity-20 rounded">
												<div
													className="h-1 bg-vscode-button-background rounded"
													style={{ width: `${percentage}%` }}
												/>
											</div>
										</div>
									)
								})
							) : (
								<div className="text-vscode-descriptionForeground">No language usage recorded yet</div>
							)}
						</div>
					</div>

					<VSCodeDivider />

					{/* Cost Metrics */}
					<div className="flex flex-col gap-4">
						<div className="font-medium">Cost Metrics</div>

						<div className="flex flex-col gap-3">
							<div className="flex justify-between">
								<div className="text-sm text-vscode-descriptionForeground">Total API Cost</div>
								<div className="font-medium">{formatCost(usageMetrics.totalApiCost)}</div>
							</div>

							<div className="flex justify-between">
								<div className="text-sm text-vscode-descriptionForeground">Average Cost per Task</div>
								<div className="font-medium">{formatCost(avgCostPerTask)}</div>
							</div>

							{Object.entries(usageMetrics.costByProvider).length > 0 && (
								<div className="mt-2">
									<div className="text-sm text-vscode-descriptionForeground mb-2">
										Cost by Provider
									</div>
									<div className="flex flex-col gap-2">
										{Object.entries(usageMetrics.costByProvider).map(([provider, cost], index) => (
											<div key={index} className="flex justify-between">
												<div>{provider}</div>
												<div className="font-medium">{formatCost(cost)}</div>
											</div>
										))}
									</div>
								</div>
							)}
						</div>
					</div>

					<VSCodeDivider />

					{/* Reset Metrics */}
					<div className="flex flex-col gap-4">
						<div className="font-medium">Reset Metrics</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							Clear all metrics data. This action cannot be undone.
						</div>

						<VSCodeButton appearance="secondary" onClick={resetUsageMetrics}>
							Reset Usage Metrics
						</VSCodeButton>
					</div>
				</>
			)}
		</div>
	)
}
