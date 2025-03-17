import React from "react"
import { render, screen } from "@testing-library/react"
import { Tooltip } from "../../../components/ui/simple-tooltip"

// Mock the Radix UI tooltip components
jest.mock("../../../components/ui/tooltip", () => ({
	Tooltip: ({ children }: { children: React.ReactNode }) => <div data-testid="radix-tooltip">{children}</div>,
	TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="tooltip-trigger">{children}</div>
	),
	TooltipContent: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="tooltip-content">{children}</div>
	),
	TooltipProvider: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="tooltip-provider">{children}</div>
	),
}))

describe("SimpleTooltip", () => {
	it("renders the trigger content", () => {
		render(
			<Tooltip content="Tooltip content">
				<button>Hover me</button>
			</Tooltip>,
		)

		expect(screen.getByText("Hover me")).toBeInTheDocument()
	})

	it("renders with custom props", () => {
		render(
			<Tooltip content="Tooltip content text" side="bottom" align="start" delayDuration={500}>
				<button data-testid="custom-button">Custom tooltip</button>
			</Tooltip>,
		)

		expect(screen.getByTestId("custom-button")).toBeInTheDocument()
		expect(screen.getByTestId("tooltip-content")).toHaveTextContent("Tooltip content text")
	})

	it("passes children to the trigger", () => {
		render(
			<Tooltip content="Tooltip content">
				<button data-testid="trigger-button">Click me</button>
			</Tooltip>,
		)

		const triggerElement = screen.getByTestId("tooltip-trigger")
		expect(triggerElement).toContainElement(screen.getByTestId("trigger-button"))
	})

	it("passes content to the tooltip content", () => {
		render(
			<Tooltip content={<span data-testid="tooltip-text">Complex content</span>}>
				<button>Hover me</button>
			</Tooltip>,
		)

		const contentElement = screen.getByTestId("tooltip-content")
		expect(contentElement).toContainElement(screen.getByTestId("tooltip-text"))
	})
})
