import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import CodeMetricsPanel from "../../../components/metrics/CodeMetricsPanel"
import { vscode } from "../../../utils/vscode"

// Mock dependencies
jest.mock("react-i18next", () => ({
	useTranslation: (namespace?: string) => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				title: "Code Metrics",
				reset: "Reset Metrics",
				refresh: "Refresh Metrics",
				resetConfirmation: "Are you sure you want to reset all metrics?",
				aiGenerated: "AI Generated",
				manual: "Manual",
				comparison: "Comparison",
				linesAdded: "Lines Added",
				linesDeleted: "Lines Deleted",
				filesModified: "Files Modified",
				filesCreated: "Files Created",
				totalLineChanges: "Total Line Changes",
				totalFileChanges: "Total File Changes",
				lineChangesDistribution: "Line Changes Distribution",
				fileChangesDistribution: "File Changes Distribution",
				totalAILines: "Total AI Line Changes",
				totalManualLines: "Total Manual Line Changes",
				totalAIFiles: "Total AI File Changes",
				totalManualFiles: "Total Manual File Changes",
				lastUpdated: "Last Updated",
				loading: "Loading metrics...",
				trends: "Trends",
				error: "Error loading metrics",
				retry: "Retry",
			}
			return translations[key] || key
		},
	}),
}))

jest.mock("../../../utils/vscode", () => ({
	vscode: {
		postMessage: jest.fn(),
	},
}))

// Mock the Tooltip component
jest.mock("../../../components/ui/simple-tooltip", () => ({
	Tooltip: ({ content, children }: { content: React.ReactNode; children: React.ReactNode }) => (
		<div data-testid="tooltip">
			<div data-testid="tooltip-content" style={{ display: "none" }}>
				{content}
			</div>
			{children}
		</div>
	),
}))

describe("CodeMetricsPanel", () => {
	const mockMetricsData = {
		aiGenerated: {
			linesAdded: 14,
			linesDeleted: 0,
			filesModified: 1,
			filesCreated: 0,
			lastUpdated: Date.now(),
		},
		manual: {
			linesAdded: 111,
			linesDeleted: 6,
			filesModified: 45,
			filesCreated: 1,
			lastUpdated: Date.now(),
		},
	}
	
	const mockHistoricalData = [
		{
			timestamp: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
			aiGenerated: {
				linesAdded: 5,
				linesDeleted: 0,
				filesModified: 1,
				filesCreated: 0,
				lastUpdated: Date.now() - 7 * 24 * 60 * 60 * 1000,
			},
			manual: {
				linesAdded: 50,
				linesDeleted: 2,
				filesModified: 20,
				filesCreated: 0,
				lastUpdated: Date.now() - 7 * 24 * 60 * 60 * 1000,
			},
		}
	]

	beforeEach(() => {
		jest.clearAllMocks()
		// Setup message event listener mock
		window.addEventListener = jest.fn().mockImplementation((event, cb) => {
			if (event === "message") {
				// Simulate metrics data response
				setTimeout(() => {
					// Ensure cb is a function before calling it
					if (typeof cb === "function") {
						cb({
							data: {
								type: "codeMetricsData",
								metrics: mockMetricsData,
							},
						} as MessageEvent)
					}
				}, 0)
				
				// Simulate historical metrics data response
				setTimeout(() => {
					if (typeof cb === "function") {
						cb({
							data: { type: "codeMetricsHistoryData", history: mockHistoricalData },
						} as MessageEvent)
					}
				}, 0)
			}
		})
	})

	it("renders loading state initially", () => {
		render(<CodeMetricsPanel />)
		expect(screen.getByText("Loading metrics...")).toBeInTheDocument()
	})

	it("renders metrics data after loading", async () => {
		render(<CodeMetricsPanel />)

		// Wait for metrics to load
		await waitFor(() => {
			expect(screen.getByText("Code Metrics")).toBeInTheDocument()
		})

		// Check if tabs are rendered
		// Use a more specific query to find the tab buttons
		const tabButtons = screen.getAllByRole("button")
		expect(tabButtons.some((button) => button.textContent === "AI Generated")).toBe(true)
		expect(tabButtons.some((button) => button.textContent === "Manual")).toBe(true)
		expect(tabButtons.some((button) => button.textContent === "Comparison")).toBe(true)

		// Check if AI Generated metrics are shown by default
		// Look for the lines added value in a more specific way
		// Using regex to match the number with or without locale formatting
		expect(screen.getByText(/^14$|^14,000$|^14$/)).toBeInTheDocument()
	})

	it("switches between tabs correctly", async () => {
		render(<CodeMetricsPanel />)

		// Wait for metrics to load
		await waitFor(() => {
			expect(screen.getByText("Code Metrics")).toBeInTheDocument()
		})

		// Click on Manual tab
		const manualTab = Array.from(screen.getAllByRole("button")).find((button) => button.textContent === "Manual")
		if (manualTab) fireEvent.click(manualTab)
		// Look for the manual lines added value in a more specific way
		// Using regex to match the number with or without locale formatting
		expect(screen.getByText(/^111$|^111,000$|^111$/)).toBeInTheDocument()

		// Click on Comparison tab
		const comparisonTab = Array.from(screen.getAllByRole("button")).find(
			(button) => button.textContent === "Comparison",
		)
		if (comparisonTab) fireEvent.click(comparisonTab)
		expect(screen.getByText("Line Changes Distribution")).toBeInTheDocument()
	})
	
	it("switches to trends tab and displays historical data", async () => {
		render(<CodeMetricsPanel />)

		// Wait for metrics to load
		await waitFor(() => {
			expect(screen.getByText("Code Metrics")).toBeInTheDocument()
		})

		// Click on Trends tab
		const trendsTab = Array.from(screen.getAllByRole("button")).find((button) => button.textContent === "Trends")
		if (trendsTab) fireEvent.click(trendsTab)
		expect(screen.getByText("Code Growth Over Time")).toBeInTheDocument()
	})

	it("renders new productivity metrics", async () => {
		render(<CodeMetricsPanel />)

		// Wait for metrics to load
		await waitFor(() => {
			expect(screen.getByText("Code Metrics")).toBeInTheDocument()
		})

		// Switch to AI Generated tab to check for Net Code Growth
		const aiTab = Array.from(screen.getAllByRole("button")).find((button) => button.textContent === "AI Generated")
		if (aiTab) fireEvent.click(aiTab)
		expect(screen.getByText(/Net Code Growth/)).toBeInTheDocument()

		// Switch to Comparison tab to check for Productivity Boost
		const comparisonTab = Array.from(screen.getAllByRole("button")).find(
			(button) => button.textContent === "Comparison",
		)
		if (comparisonTab) fireEvent.click(comparisonTab)
		expect(screen.getByText(/Productivity Boost/)).toBeInTheDocument()
	})

	it("resets metrics when reset button is clicked", async () => {
		render(<CodeMetricsPanel />)

		// Wait for metrics to load
		await waitFor(() => {
			expect(screen.getByText("Code Metrics")).toBeInTheDocument()
		})

		// Click reset button
		fireEvent.click(screen.getByText("Reset Metrics"))

		// Check if postMessage was called with resetCodeMetrics
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "resetCodeMetrics",
		})
	})

	it("fetches metrics on mount", () => {
		render(<CodeMetricsPanel />)

		// Check if postMessage was called with getCodeMetrics
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "getCodeMetrics",
		})
	})
	
	it("fetches historical metrics on mount", () => {
		render(<CodeMetricsPanel />)

		// Check if postMessage was called with getCodeMetricsHistory
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "getCodeMetricsHistory",
		})
	})
	
	

	it("refreshes metrics when refresh button is clicked", async () => {
		render(<CodeMetricsPanel />)

		// Wait for metrics to load
		await waitFor(() => {
			expect(screen.getByText("Code Metrics")).toBeInTheDocument()
		})

		// Click refresh button and verify postMessage was called
		fireEvent.click(screen.getByText("Refresh Metrics"))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "getCodeMetrics" })
	})
})
