import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { UsageMetrics } from "../UsageMetrics"
import { createEmptyMetrics } from "../../../../../src/utils/metrics"

describe("UsageMetrics", () => {
	const mockSetUsageMetricsEnabled = jest.fn()
	const mockResetUsageMetrics = jest.fn()

	const defaultProps = {
		usageMetrics: createEmptyMetrics(),
		usageMetricsEnabled: true,
		setUsageMetricsEnabled: mockSetUsageMetricsEnabled,
		resetUsageMetrics: mockResetUsageMetrics,
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("renders component with default metrics", () => {
		render(<UsageMetrics {...defaultProps} />)

		// Check if title is present
		expect(screen.getByText("Usage Metrics")).toBeInTheDocument()

		// Check if toggle is present and enabled
		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeInTheDocument()
		expect(checkbox).toBeChecked()

		// Check if summary section is present
		expect(screen.getByText("Summary")).toBeInTheDocument()
		expect(screen.getByText("Lines of Code Generated")).toBeInTheDocument()
		expect(screen.getByText("0")).toBeInTheDocument() // Default value for linesOfCodeGenerated
	})

	it("renders only the toggle when metrics are disabled", () => {
		render(<UsageMetrics {...defaultProps} usageMetricsEnabled={false} />)

		// Check if title is present
		expect(screen.getByText("Usage Metrics")).toBeInTheDocument()

		// Check if toggle is present and disabled
		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeInTheDocument()
		expect(checkbox).not.toBeChecked()

		// Check that detailed sections are not shown
		expect(screen.queryByText("Summary")).not.toBeInTheDocument()
		expect(screen.queryByText("Lines of Code Generated")).not.toBeInTheDocument()
	})

	it("calls setUsageMetricsEnabled when toggle is clicked", () => {
		render(<UsageMetrics {...defaultProps} />)

		const checkbox = screen.getByRole("checkbox")
		fireEvent.click(checkbox)

		expect(mockSetUsageMetricsEnabled).toHaveBeenCalledWith(false)
	})

	it("calls resetUsageMetrics when reset button is clicked", () => {
		render(<UsageMetrics {...defaultProps} />)

		const resetButton = screen.getByText("Reset Usage Metrics")
		fireEvent.click(resetButton)

		expect(mockResetUsageMetrics).toHaveBeenCalled()
	})

	it("displays metrics data correctly", () => {
		const metrics = {
			...createEmptyMetrics(),
			linesOfCodeGenerated: 1500,
			filesCreated: 25,
			filesModified: 45,
			tasksCompleted: 10,
			totalApiCost: 3.25,
			languageUsage: {
				JavaScript: 800,
				TypeScript: 500,
				HTML: 200,
			},
			toolUsage: {
				write_to_file: 25,
				apply_diff: 30,
			},
		}

		render(<UsageMetrics {...defaultProps} usageMetrics={metrics} />)

		// Check summary values
		expect(screen.getByText("1,500")).toBeInTheDocument() // Lines of code
		expect(screen.getByText("25")).toBeInTheDocument() // Files created
		expect(screen.getByText("45")).toBeInTheDocument() // Files modified
		expect(screen.getByText("10")).toBeInTheDocument() // Tasks completed
		expect(screen.getByText("$3.2500")).toBeInTheDocument() // Total cost

		// Check if language data is displayed
		expect(screen.getByText("JavaScript")).toBeInTheDocument()
		expect(screen.getByText("TypeScript")).toBeInTheDocument()
		expect(screen.getByText("800 lines")).toBeInTheDocument()
		expect(screen.getByText("500 lines")).toBeInTheDocument()

		// Check if tool usage data is displayed
		expect(screen.getByText("write_to_file")).toBeInTheDocument()
		expect(screen.getByText("apply_diff")).toBeInTheDocument()
		expect(screen.getByText("25 uses")).toBeInTheDocument()
		expect(screen.getByText("30 uses")).toBeInTheDocument()
	})
})
