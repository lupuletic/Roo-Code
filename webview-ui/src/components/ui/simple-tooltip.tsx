import * as React from "react"
import { Tooltip as RadixTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"

interface TooltipProps {
	content: React.ReactNode
	children: React.ReactNode
	side?: "top" | "right" | "bottom" | "left"
	align?: "start" | "center" | "end"
	delayDuration?: number
}

/**
 * A simplified tooltip component that wraps the Radix UI tooltip primitive
 */
export const Tooltip: React.FC<TooltipProps> = ({
	content,
	children,
	side = "top",
	align = "center",
	delayDuration = 300,
}) => {
	return (
		<TooltipProvider>
			<RadixTooltip delayDuration={delayDuration}>
				<TooltipTrigger asChild>{children}</TooltipTrigger>
				<TooltipContent side={side} align={align}>
					{content}
				</TooltipContent>
			</RadixTooltip>
		</TooltipProvider>
	)
}
