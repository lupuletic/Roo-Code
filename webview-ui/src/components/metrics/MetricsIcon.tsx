import React from "react"

interface MetricsIconProps {
	onClick: () => void
}

const MetricsIcon: React.FC<MetricsIconProps> = ({ onClick }) => {
	return (
		<div
			className="flex items-center justify-center w-8 h-8 rounded hover:bg-vscode-button-hoverBackground cursor-pointer"
			onClick={onClick}
			title="Usage Metrics">
			<svg
				width="16"
				height="16"
				viewBox="0 0 16 16"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
				className="text-vscode-icon-foreground">
				<path d="M1.5 13.5h13v-1h-13v1zm3.5-3h1v-7h-1v7zm3 0h1V3.5h-1v7zm3 0h1v-5h-1v5z" fill="currentColor" />
			</svg>
		</div>
	)
}

export default MetricsIcon
